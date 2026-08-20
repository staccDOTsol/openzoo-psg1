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

  var PENDING_KEY = 'openzoo.psg1.pending402';
  var PENDING_TTL_MS = 15 * 60 * 1000;
  var resumeWaiters = [];
  var appForeground = true;
  var memoryStore = {};

  function storeGet(key) {
    try {
      if (typeof sessionStorage !== 'undefined') return sessionStorage.getItem(key);
    } catch (_) {}
    return Object.prototype.hasOwnProperty.call(memoryStore, key) ? memoryStore[key] : null;
  }

  function storeSet(key, value) {
    try {
      if (typeof sessionStorage !== 'undefined') {
        sessionStorage.setItem(key, value);
        return;
      }
    } catch (_) {}
    memoryStore[key] = value;
  }

  function storeDel(key) {
    try {
      if (typeof sessionStorage !== 'undefined') sessionStorage.removeItem(key);
    } catch (_) {}
    delete memoryStore[key];
  }

  function persistPending402(state) {
    if (!state) {
      storeDel(PENDING_KEY);
      return null;
    }
    var row = {
      path: state.path || '',
      method: state.method || 'POST',
      headers: state.headers || {},
      body: state.body == null ? null : state.body,
      quote: state.quote || null,
      payer: state.payer || '',
      contextId: state.contextId || null,
      namespace: state.namespace || null,
      savedAt: Date.now()
    };
    try { storeSet(PENDING_KEY, JSON.stringify(row)); } catch (_) {}
    return row;
  }

  function loadPending402() {
    var raw = storeGet(PENDING_KEY);
    if (!raw) return null;
    try {
      var row = JSON.parse(raw);
      if (!row || !row.quote) return null;
      if (row.savedAt && (Date.now() - row.savedAt) > PENDING_TTL_MS) {
        storeDel(PENDING_KEY);
        return null;
      }
      return row;
    } catch (_) {
      return null;
    }
  }

  function clearPending402() {
    storeDel(PENDING_KEY);
  }

  function notifyPause() {
    appForeground = false;
  }

  function notifyResume() {
    appForeground = true;
    var waiters = resumeWaiters.slice();
    resumeWaiters = [];
    var i;
    for (i = 0; i < waiters.length; i++) {
      try { waiters[i](); } catch (_) {}
    }
  }

  function waitForResumeOr(ms) {
    return new Promise(function (resolve) {
      var done = false;
      function finish() {
        if (done) return;
        done = true;
        resolve(appForeground);
      }
      resumeWaiters.push(finish);
      setTimeout(finish, typeof ms === 'number' ? ms : 2000);
    });
  }

  function errorText(err) {
    if (err == null) return '';
    if (typeof err === 'string') return err;
    if (err.message) return String(err.message);
    if (err.name && err.name !== 'Error') return String(err.name);
    return String(err);
  }

  function isTransientNetwork(err) {
    var msg = errorText(err);
    var low = msg.toLowerCase();
    var name = err && err.name ? String(err.name).toLowerCase() : '';
    if (name === 'typeerror' || name === 'networkerror' || name === 'aborterror') return true;
    return (
      low.indexOf('load failed') >= 0 ||
      low.indexOf('failed to fetch') >= 0 ||
      low.indexOf('networkerror') >= 0 ||
      low.indexOf('network request failed') >= 0 ||
      low.indexOf('the internet connection appears to be offline') >= 0 ||
      low.indexOf('failed to load') >= 0 ||
      low.indexOf('err_internet') >= 0 ||
      low.indexOf('err_connection') >= 0 ||
      low.indexOf('err_name_not_resolved') >= 0 ||
      low.indexOf('net::') >= 0 ||
      low.indexOf('aborted') >= 0 ||
      low.indexOf('abort') >= 0 && low.indexOf('user') < 0 ||
      /\btypeerror\b/.test(low)
    );
  }

  function humanizeNetworkError() {
    return 'Connection dropped while talking to the zoo. Return to OpenZoo and we will retry — approve in Jupiter Wallet if it is still open.';
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
    if (err && err.code === 'UNPAYABLE' && err.message) return String(err.message);
    var msg = errorText(err);
    if (isTransientNetwork(err) || isTransientNetwork(msg)) return humanizeNetworkError();
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
    if (
      /^typeerror\b/.test(low) ||
      low.indexOf('load failed') >= 0 ||
      low === 'undefined' ||
      low === 'error' ||
      !msg
    ) {
      return humanizeNetworkError();
    }
    return msg;
  }

  async function gatewayFetch(url, init, hooks) {
    hooks = hooks || {};
    var last = null;
    var i;
    for (i = 0; i < 4; i++) {
      try {
        return await fetch(url, init);
      } catch (e) {
        last = e;
        if (!isTransientNetwork(e)) {
          var hard = new Error(humanizePayError(e));
          hard.cause = e;
          throw hard;
        }
        if (hooks.onStatus) hooks.onStatus('Waiting to retry…');
        await waitForResumeOr(appForeground ? 800 : 4000);
      }
    }
    throw new Error(humanizePayError(last));
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

  async function buildPayment(accept, payer, hooks) {
    var res = await gatewayFetch(gatewayUrl('/v1/pay/build'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accept: accept, payer: payer })
    }, hooks);
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
    var built = await buildPayment(pick.chosen, hooks.payer, hooks);
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
    var res = await gatewayFetch(gatewayUrl(path), requestInit, hooks);
    if (res.status === 402) {
      var quote = await res.json().catch(function () { return {}; });
      persistPending402({
        path: path,
        method: requestInit.method,
        headers: headers,
        body: init.body == null ? null : init.body,
        quote: quote,
        payer: hooks.payer,
        contextId: hooks.contextId,
        namespace: hooks.namespace
      });
      var paid;
      try {
        paid = await settle402(quote, hooks);
      } catch (e) {
        if (isTransientNetwork(e)) {
          if (hooks.onStatus) hooks.onStatus('Retrying payment…');
          await waitForResumeOr(appForeground ? 600 : 4000);
          paid = await settle402(quote, hooks);
        } else {
          throw e;
        }
      }
      headers = mergeHeaders(headers, { 'X-PAYMENT': paid.header });
      requestInit.headers = headers;
      if (hooks.onStatus) hooks.onStatus('Retrying…');
      try {
        res = await gatewayFetch(gatewayUrl(path), requestInit, hooks);
      } catch (e) {
        throw new Error(humanizePayError(e));
      }
      res._openzooRail = paid.rail;
      if (res.status !== 402) clearPending402();
    }
    return res;
  }

  async function resumePendingPay(hooks) {
    hooks = hooks || {};
    var pending = loadPending402();
    if (!pending || !pending.quote) return null;
    if (hooks.payer && !pending.payer) pending.payer = hooks.payer;
    var settleHooks = {
      payer: pending.payer || hooks.payer,
      contextId: pending.contextId || hooks.contextId,
      namespace: pending.namespace || hooks.namespace,
      onStatus: hooks.onStatus,
      onRail: hooks.onRail
    };
    if (hooks.onStatus) hooks.onStatus('Retrying payment…');
    var paid = await settle402(pending.quote, settleHooks);
    var headers = mergeHeaders({
      'Content-Type': 'application/json',
      'Authorization': 'Bearer openzoo-psg1'
    }, pending.headers || {});
    if (settleHooks.contextId) headers['x-hrr-context'] = settleHooks.contextId;
    if (settleHooks.namespace) headers['x-openzoo-namespace'] = settleHooks.namespace;
    headers['X-PAYMENT'] = paid.header;
    var requestInit = { method: pending.method || 'POST', headers: headers };
    if (pending.body != null) requestInit.body = pending.body;
    var res = await gatewayFetch(gatewayUrl(pending.path), requestInit, hooks);
    res._openzooRail = paid.rail;
    if (res.status !== 402) clearPending402();
    return res;
  }

  function onAppResume(hooks) {
    notifyResume();
    if (!hooks || !hooks.autoRetry) return Promise.resolve(null);
    var pending = loadPending402();
    if (!pending) return Promise.resolve(null);
    return resumePendingPay(hooks).catch(function (e) {
      if (hooks.onStatus) hooks.onStatus(humanizePayError(e), 'warn');
      return null;
    });
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
    isTransientNetwork: isTransientNetwork,
    persistPending402: persistPending402,
    loadPending402: loadPending402,
    clearPending402: clearPending402,
    notifyPause: notifyPause,
    notifyResume: notifyResume,
    onAppResume: onAppResume,
    resumePendingPay: resumePendingPay,
    fetchBalances: fetchBalances,
    pickPayableRail: pickPayableRail,
    pickWrappableRail: pickWrappableRail,
    paidFetch: paidFetch,
    settle402: settle402,
    buildPayment: buildPayment,
    readSseOrJson: readSseOrJson,
    silentBind: silentBind
  };
})(
  typeof OpenZooWrap !== 'undefined' ? OpenZooWrap : require('./wrap.js'),
  typeof OpenZooCodec !== 'undefined' ? OpenZooCodec : require('./codec.js')
);

if (typeof module !== 'undefined' && module.exports) module.exports = OpenZooPay;
