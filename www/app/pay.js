/* OpenZoo x402 + live /supported rails.
   Phone talks to https://x402-tokens.fly.dev (CORS live). No local proxy hop.
   402 pay: partial-sign only, never broadcast. Wrap may send. */
'use strict';

var OpenZooPay = (function (OpenZooWrap, OpenZooCodec) {
  var GATEWAY = 'https://x402-tokens.fly.dev';
  var RPC_URL = 'https://api.mainnet-beta.solana.com';
  var TOKEN_2022 = OpenZooWrap.TOKEN_2022;
  var TOKEN_LEGACY = OpenZooWrap.TOKEN_LEGACY;

  function gatewayUrl(path) {
    return GATEWAY + path;
  }

  function railSymbol(row) {
    return OpenZooWrap.railLabel(row) || ((row && row.extra && row.extra.symbol) || 'token');
  }

  function isSolanaExact(row) {
    return !!(row && row.scheme === 'exact' &&
      typeof row.network === 'string' &&
      row.network.indexOf('solana:') === 0);
  }

  function solanaRails(accepts) {
    var out = [];
    var list = OpenZooWrap.hideDrained(accepts || []);
    var i;
    for (i = 0; i < list.length; i++) {
      if (isSolanaExact(list[i]) && list[i].asset !== OpenZooWrap.DRAINED_MINT) out.push(list[i]);
    }
    return out;
  }

  function formatAtomic(amount, decimals) {
    var dec = typeof decimals === 'number' ? decimals : 6;
    var s = String(amount || '0');
    if (dec <= 0) return s;
    while (s.length <= dec) s = '0' + s;
    var whole = s.slice(0, s.length - dec);
    var frac = s.slice(s.length - dec).replace(/0+$/, '');
    return frac ? whole + '.' + frac : whole;
  }

  function billedUsd(row) {
    return row && row.extra && row.extra.billedUsd;
  }

  function describeRail(row) {
    var usd = billedUsd(row);
    var amt = formatAtomic(row.maxAmountRequired, row.extra && row.extra.decimals);
    var line = railSymbol(row) + '  ' + amt;
    if (usd != null) line += '  (~$' + Number(usd).toFixed(4) + ')';
    return line;
  }

  function bytesToB64(bytes) {
    return OpenZooCodec.bytesToB64(bytes);
  }

  function encodeXPayment(envelope, signedTxB64) {
    var env = JSON.parse(JSON.stringify(envelope || {}));
    if (!env.payload) env.payload = {};
    env.payload.transaction = signedTxB64;
    var json = JSON.stringify(env);
    var bytes = new TextEncoder().encode(json);
    return bytesToB64(bytes);
  }

  function UnpayableError(rails, balances, message) {
    this.name = 'UnpayableError';
    this.code = 'UNPAYABLE';
    this.rails = rails || [];
    this.balances = balances || {};
    this.message = message ||
      'This wallet needs USDC, TOKEN, or LEOS before it can pay.';
  }
  UnpayableError.prototype = Object.create(Error.prototype);

  function humanizePayError(err) {
    var msg = (err && err.message) ? String(err.message) : String(err || '');
    var low = msg.toLowerCase();
    if (
      low.indexOf('simulat') >= 0 ||
      low.indexOf('insufficient') >= 0 ||
      low.indexOf('custom program error') >= 0 ||
      low.indexOf('0x1') >= 0
    ) {
      return 'Payment did not settle. Top up this wallet with USDC, TOKEN, or LEOS, then retry.';
    }
    if (low.indexOf('sol') >= 0 && (low.indexOf('fee') >= 0 || low.indexOf('lamport') >= 0 || low.indexOf('rent') >= 0)) {
      return 'Need a little SOL in this wallet to top up.';
    }
    return msg;
  }

  async function rpc(method, params) {
    return OpenZooWrap.rpc(method, params, RPC_URL);
  }

  function addParsedBalances(result, into) {
    var value = (result && result.value) || [];
    var i;
    for (i = 0; i < value.length; i++) {
      var info = value[i] && value[i].account && value[i].account.data &&
        value[i].account.data.parsed && value[i].account.data.parsed.info;
      if (!info || !info.mint || !info.tokenAmount) continue;
      if (info.mint === OpenZooWrap.DRAINED_MINT) continue;
      var amt = String(info.tokenAmount.amount || '0');
      var prev = into[info.mint] || '0';
      try {
        into[info.mint] = (BigInt(prev) + BigInt(amt)).toString();
      } catch (_) {
        into[info.mint] = amt;
      }
    }
  }

  async function fetchBalances(owner) {
    var balances = {};
    var ok = 0;
    if (!owner) return { balances: balances, detected: false };
    var opts = { encoding: 'jsonParsed' };
    try {
      var a = await rpc('getTokenAccountsByOwner', [owner, { programId: TOKEN_2022 }, opts]);
      addParsedBalances(a, balances);
      ok++;
    } catch (_) { /* Token-2022 read failed; still try legacy */ }
    try {
      var b = await rpc('getTokenAccountsByOwner', [owner, { programId: TOKEN_LEGACY }, opts]);
      addParsedBalances(b, balances);
      ok++;
    } catch (_) {}
    return { balances: balances, detected: ok > 0 };
  }

  function pickPayableRail(rails, balances) {
    if (!rails || !rails.length) return null;
    var have = balances || {};
    var i;
    for (i = 0; i < rails.length; i++) {
      var row = rails[i];
      if (row.asset === OpenZooWrap.DRAINED_MINT) continue;
      var need;
      try { need = BigInt(row.maxAmountRequired || '0'); }
      catch (_) { continue; }
      var got;
      try { got = BigInt(have[row.asset] || '0'); }
      catch (_) { got = BigInt(0); }
      if (got >= need) return row;
    }
    return null;
  }

  function pickPreferredRail(rails, asset) {
    if (!asset) return null;
    var i;
    for (i = 0; i < rails.length; i++) {
      if (rails[i].asset === asset || railSymbol(rails[i]) === asset) return rails[i];
    }
    return null;
  }

  function signViaBridge(txB64) {
    return new Promise(function (resolve, reject) {
      var id = 'tx-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
      var settled = false;
      var timer = setTimeout(function () {
        if (settled) return;
        settled = true;
        window.removeEventListener('message', onMsg);
        reject(new Error('Wallet sign timed out. Approve the transaction in Jupiter Wallet.'));
      }, 120000);

      function finish(fn, val) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        window.removeEventListener('message', onMsg);
        fn(val);
      }

      function onMsg(ev) {
        if (ev.source !== window.parent) return;
        var d = ev.data;
        if (!d || d.id !== id) return;
        if (d.type !== 'wallet-sign-transaction-response' && d.type !== 'wallet-sign-response') return;
        if (d.error) finish(reject, new Error(d.error));
        else finish(resolve, d.signedTransaction);
      }

      window.addEventListener('message', onMsg);
      window.parent.postMessage({
        type: 'wallet-sign-transaction',
        id: id,
        transaction: txB64
      }, '*');
    });
  }

  async function buildPayment(accept, payer) {
    var res = await fetch(gatewayUrl('/v1/pay/build'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accept: accept, payer: payer })
    });
    var body = await res.json().catch(function () { return {}; });
    if (!res.ok) {
      throw new Error(body.error || ('pay/build failed HTTP ' + res.status));
    }
    if (!body.transaction || !body.envelope) {
      throw new Error('pay/build returned no transaction/envelope');
    }
    return body;
  }

  function underlyingHoldings(balances) {
    return {
      token: BigInt(balances[OpenZooWrap.TOKEN_MINT] || '0'),
      usdc: BigInt(balances[OpenZooWrap.USDC_MINT] || '0'),
      leos: BigInt(balances[OpenZooWrap.LEOS_MINT] || '0')
    };
  }

  function pickWrappableRail(rails, balances, kinds) {
    var have = underlyingHoldings(balances);
    var i;
    for (i = 0; i < rails.length; i++) {
      var row = rails[i];
      if (row.asset === OpenZooWrap.DRAINED_MINT) continue;
      var pool = OpenZooWrap.acquireForMint(kinds, row.asset);
      if (!pool) continue;
      var under = BigInt(balances[pool.underlying] || '0');
      if (under <= 0n) continue;
      return { row: row, pool: pool, underlying: under };
    }
    var prefer = [
      { mint: OpenZooWrap.TOKEN_MINT, have: have.token },
      { mint: OpenZooWrap.USDC_MINT, have: have.usdc },
      { mint: OpenZooWrap.LEOS_MINT, have: have.leos }
    ];
    for (i = 0; i < prefer.length; i++) {
      if (prefer[i].have <= 0n) continue;
      var twin = OpenZooWrap.findTwinForUnderlying(kinds, prefer[i].mint);
      if (!twin) continue;
      var match = pickPreferredRail(rails, twin.wrapped);
      if (match) return { row: match, pool: twin, underlying: prefer[i].have };
    }
    return null;
  }

  async function topUpForRail(row, pool, balances, hooks) {
    var need = BigInt(row.maxAmountRequired || '0');
    var have = BigInt(balances[row.asset] || '0');
    if (have >= need) return { wrapped: false };
    var short = need - have;
    var state = await OpenZooWrap.poolState(pool, RPC_URL);
    var deposit = OpenZooWrap.depositForShares(short, state.reserves, state.supply);
    var under = BigInt(balances[pool.underlying] || '0');
    if (under < deposit) {
      throw new UnpayableError([row], balances,
        'This wallet needs more USDC, TOKEN, or LEOS to cover the call.');
    }
    if (hooks.onStatus) hooks.onStatus('Topping up…');
    var compiled = await OpenZooWrap.compileWrapTx(pool, hooks.payer, deposit, RPC_URL);
    if (pool.wrapped === OpenZooWrap.WTOKENx2) {
      if (compiled.accountCount !== 9 || compiled.bump !== 254) {
        throw new Error('wTOKENx2 wrap shape is wrong');
      }
    }
    var sig = await OpenZooWrap.signAndSendViaBridge(compiled.transaction);
    return { wrapped: true, signature: sig, deposit: deposit.toString() };
  }

  async function chooseRail(accepts, hooks) {
    var rails = solanaRails(accepts);
    if (!rails.length) {
      throw new Error('Nothing this phone can pay right now. Try again in a moment.');
    }
    var balances = {};
    var detected = false;
    if (hooks.payer) {
      try {
        var got = await fetchBalances(hooks.payer);
        balances = got.balances;
        detected = got.detected;
      } catch (_) {
        detected = false;
      }
    }
    var kinds = [];
    try { kinds = await OpenZooWrap.acquireDirectory(); }
    catch (_) { kinds = []; }

    var chosen = null;
    var wrapPlan = null;
    if (detected) chosen = pickPayableRail(rails, balances);
    if (!chosen && hooks.preferredAsset) {
      var pref = pickPreferredRail(rails, hooks.preferredAsset);
      if (pref) chosen = pref;
    }
    if (!chosen && detected && kinds.length) {
      wrapPlan = pickWrappableRail(rails, balances, kinds);
      if (wrapPlan) chosen = wrapPlan.row;
    }
    if (!chosen) {
      throw new UnpayableError(rails, balances,
        detected
          ? 'This wallet needs USDC, TOKEN, or LEOS before it can pay.'
          : 'Could not read this wallet. Reconnect Jupiter Wallet and retry.'
      );
    }
    return {
      chosen: chosen,
      rails: rails,
      balances: balances,
      detected: detected,
      wrapPlan: wrapPlan
    };
  }

  async function settle402(body, hooks) {
    hooks = hooks || {};
    if (hooks.onStatus) hooks.onStatus('Preparing payment…');
    var pick = await chooseRail(body.accepts, hooks);
    if (hooks.onRail) hooks.onRail(pick);
    if (!hooks.payer) throw new Error('Connect Jupiter Wallet to pay.');
    if (pick.wrapPlan) {
      await topUpForRail(pick.chosen, pick.wrapPlan.pool, pick.balances, hooks);
      var again = await fetchBalances(hooks.payer);
      pick.balances = again.balances;
      if (pickPayableRail([pick.chosen], pick.balances) == null) {
        throw new UnpayableError(pick.rails, pick.balances,
          'Top-up finished but this wallet still cannot cover the call. Retry.');
      }
    }
    if (hooks.onStatus) hooks.onStatus('Approve in Jupiter Wallet…');
    var built = await buildPayment(pick.chosen, hooks.payer);
    var signed = await signViaBridge(built.transaction);
    if (!signed) throw new Error('Wallet returned an empty signature');
    return {
      header: encodeXPayment(built.envelope, signed),
      rail: pick.chosen,
      rails: pick.rails,
      balances: pick.balances
    };
  }

  function mergeHeaders(base, extra) {
    var out = {};
    var k;
    for (k in base) if (Object.prototype.hasOwnProperty.call(base, k)) out[k] = base[k];
    if (extra) for (k in extra) if (Object.prototype.hasOwnProperty.call(extra, k)) out[k] = extra[k];
    return out;
  }

  async function paidFetch(path, init, hooks) {
    hooks = hooks || {};
    init = init || {};
    var headers = mergeHeaders({
      'Content-Type': 'application/json',
      'Authorization': 'Bearer openzoo-psg1'
    }, init.headers);
    if (hooks.contextId) headers['x-hrr-context'] = hooks.contextId;
    if (hooks.namespace) headers['x-openzoo-namespace'] = hooks.namespace;

    var requestInit = {
      method: init.method || 'POST',
      headers: headers
    };
    if (init.body != null) requestInit.body = init.body;

    if (hooks.onStatus) hooks.onStatus('Talking to the zoo…');
    var res = await fetch(gatewayUrl(path), requestInit);
    if (res.status === 402) {
      var quote = await res.json().catch(function () { return {}; });
      var paid = await settle402(quote, hooks);
      headers = mergeHeaders(headers, { 'X-PAYMENT': paid.header });
      requestInit.headers = headers;
      if (hooks.onStatus) hooks.onStatus('Retrying…');
      res = await fetch(gatewayUrl(path), requestInit);
      res._openzooRail = paid.rail;
    }
    return res;
  }

  async function readSseOrJson(res, onDelta) {
    var ctype = (res.headers.get('content-type') || '').toLowerCase();
    if (ctype.indexOf('text/event-stream') >= 0 && res.body && res.body.getReader) {
      var reader = res.body.getReader();
      var dec = new TextDecoder();
      var buf = '';
      var full = '';
      while (true) {
        var chunk = await reader.read();
        if (chunk.done) break;
        buf += dec.decode(chunk.value, { stream: true });
        var parts = buf.split('\n');
        buf = parts.pop();
        var i;
        for (i = 0; i < parts.length; i++) {
          var line = parts[i];
          if (line.indexOf('data:') !== 0) continue;
          var data = line.slice(5).trim();
          if (!data || data === '[DONE]') continue;
          try {
            var ev = JSON.parse(data);
            var delta = ev.choices && ev.choices[0] && ev.choices[0].delta && ev.choices[0].delta.content;
            if (delta) {
              full += delta;
              if (onDelta) onDelta(full, delta);
            }
          } catch (_) {}
        }
      }
      return { text: full, stream: true };
    }
    var json = await res.json().catch(function () { return {}; });
    if (!res.ok) {
      var err = json.error;
      var msg = (err && err.message) || json.error || json.message || ('HTTP ' + res.status);
      throw new Error(typeof msg === 'string' ? msg : JSON.stringify(msg));
    }
    var text = json.choices && json.choices[0] && json.choices[0].message
      ? (json.choices[0].message.content || '')
      : '';
    return { text: text, stream: false, json: json };
  }

  async function silentBind(corpus, hooks, contextId) {
    if (!corpus || !String(corpus).trim()) return contextId || null;
    var CHUNK = 512 * 1024;
    var ctx = contextId || null;
    var i;
    for (i = 0; i < corpus.length; i += CHUNK) {
      var part = corpus.slice(i, i + CHUNK);
      var body = ctx ? { corpus: part, context_id: ctx } : { corpus: part };
      var res = await paidFetch('/v1/hrr/bind', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      }, hooks);
      var d = await res.json().catch(function () { return {}; });
      if (d.context_id) ctx = d.context_id;
      else break;
    }
    return ctx;
  }

  return {
    GATEWAY: GATEWAY,
    gatewayUrl: gatewayUrl,
    solanaRails: solanaRails,
    isSolanaExact: isSolanaExact,
    railSymbol: railSymbol,
    describeRail: describeRail,
    formatAtomic: formatAtomic,
    billedUsd: billedUsd,
    encodeXPayment: encodeXPayment,
    UnpayableError: UnpayableError,
    humanizePayError: humanizePayError,
    fetchBalances: fetchBalances,
    pickPayableRail: pickPayableRail,
    pickWrappableRail: pickWrappableRail,
    paidFetch: paidFetch,
    settle402: settle402,
    readSseOrJson: readSseOrJson,
    silentBind: silentBind
  };
})(
  typeof OpenZooWrap !== 'undefined' ? OpenZooWrap : require('./wrap.js'),
  typeof OpenZooCodec !== 'undefined' ? OpenZooCodec : require('./codec.js')
);

if (typeof module !== 'undefined' && module.exports) module.exports = OpenZooPay;
