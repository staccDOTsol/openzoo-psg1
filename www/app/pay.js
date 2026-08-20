/* OpenZoo x402 payment + gateway helpers.
   Phone talks to https://x402-tokens.fly.dev directly (CORS live).
   No localhost:8402. No @solana/web3.js. Do not rebuild the payment tx. */
'use strict';

var OpenZooPay = (function () {
  var GATEWAY = 'https://x402-tokens.fly.dev';
  var RPC_URL = 'https://api.mainnet-beta.solana.com';
  var TOKEN_2022 = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';
  var TOKEN_LEGACY = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
  var TWIN_HINT = 'yUSDCx or wTOKENx';

  function gatewayUrl(path) {
    return GATEWAY + path;
  }

  function railSymbol(row) {
    return (row && row.extra && row.extra.symbol) || 'token';
  }

  function isSolanaExact(row) {
    return !!(row && row.scheme === 'exact' &&
      typeof row.network === 'string' &&
      row.network.indexOf('solana:') === 0);
  }

  function solanaRails(accepts) {
    var out = [];
    var list = accepts || [];
    for (var i = 0; i < list.length; i++) {
      if (isSolanaExact(list[i])) out.push(list[i]);
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
    var bin = '';
    for (var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin);
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
      'This wallet cannot cover a Solana rail. Fund ' + TWIN_HINT +
      ' (NAV-wrapped Token-2022 twins). Plain USDC cannot pay.';
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
      return 'Payment did not settle. The chosen rail is probably unfunded. ' +
        'Fund ' + TWIN_HINT + ' in Jupiter Wallet — not plain USDC — then retry.';
    }
    return msg;
  }

  async function rpc(method, params) {
    var res = await fetch(RPC_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: method, params: params })
    });
    if (!res.ok) throw new Error('RPC HTTP ' + res.status);
    var body = await res.json();
    if (body.error) throw new Error(body.error.message || 'RPC error');
    return body.result;
  }

  function addParsedBalances(result, into) {
    var value = (result && result.value) || [];
    for (var i = 0; i < value.length; i++) {
      var info = value[i] && value[i].account && value[i].account.data &&
        value[i].account.data.parsed && value[i].account.data.parsed.info;
      if (!info || !info.mint || !info.tokenAmount) continue;
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
    for (var i = 0; i < rails.length; i++) {
      var row = rails[i];
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
    for (var i = 0; i < rails.length; i++) {
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

  async function chooseRail(accepts, hooks) {
    var rails = solanaRails(accepts);
    if (!rails.length) {
      throw new Error('Gateway offered no payable Solana rail (EVM rows are not for this app).');
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
    var chosen = null;
    if (detected) chosen = pickPayableRail(rails, balances);
    if (!chosen && hooks.preferredAsset) {
      var pref = pickPreferredRail(rails, hooks.preferredAsset);
      if (pref) chosen = pref;
    }
    if (!chosen) {
      throw new UnpayableError(rails, balances,
        detected
          ? ('No Solana rail is funded. Need ' + TWIN_HINT +
            '. Plain USDC cannot pay these Token-2022 twins.')
          : ('Could not read balances. Do not guess rail 1. Fund ' + TWIN_HINT +
            ' and pick a rail, or reconnect the wallet.')
      );
    }
    return { chosen: chosen, rails: rails, balances: balances, detected: detected };
  }

  async function settle402(body, hooks) {
    hooks = hooks || {};
    if (hooks.onStatus) hooks.onStatus('Selecting a Solana rail…');
    var pick = await chooseRail(body.accepts, hooks);
    if (hooks.onRail) hooks.onRail(pick);
    if (!hooks.payer) throw new Error('Connect Jupiter Wallet to pay.');
    if (hooks.onStatus) hooks.onStatus('Building payment for ' + railSymbol(pick.chosen) + '…');
    var built = await buildPayment(pick.chosen, hooks.payer);
    if (hooks.onStatus) hooks.onStatus('Approve in Jupiter Wallet (sign only — not send)…');
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

    if (hooks.onStatus) hooks.onStatus('Calling gateway…');
    var res = await fetch(gatewayUrl(path), requestInit);
    if (res.status === 402) {
      var quote = await res.json().catch(function () { return {}; });
      var paid = await settle402(quote, hooks);
      headers = mergeHeaders(headers, { 'X-PAYMENT': paid.header });
      requestInit.headers = headers;
      if (hooks.onStatus) hooks.onStatus('Retrying with X-PAYMENT…');
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
        for (var i = 0; i < parts.length; i++) {
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

  return {
    GATEWAY: GATEWAY,
    TWIN_HINT: TWIN_HINT,
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
    paidFetch: paidFetch,
    settle402: settle402,
    readSseOrJson: readSseOrJson
  };
})();
