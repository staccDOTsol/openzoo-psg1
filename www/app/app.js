'use strict';

var SYSTEM_PROMPT =
  'You are OpenZoo on a Play Solana PSG1 handheld. You can chat. ' +
  'The user may attach holographic / HRR context via Bind (x-hrr-context). ' +
  'You do not have RUN, WRITE, READ, or SERVE tools, a filesystem, or a shell. ' +
  'Do not claim those work. Do not invent tool results.';

var DEFAULT_MODELS = [
  'openai/gpt-4o-mini',
  'google/gemini-2.5-flash',
  'google/gemini-3.7-flash',
  'nvidia/nemotron-3.5-lightning',
  'x-ai/grok-4.6'
];

var wallet = { address: null, method: null };
var tab = 'chat';
var messages = [];
var contextId = '';
var namespace = '';
var preferredAsset = '';
var sending = false;

var $ = function (id) { return document.getElementById(id); };

function shortAddr(a) {
  if (!a) return 'not connected';
  return a.slice(0, 4) + '…' + a.slice(-4);
}

function setRail(kind, html) {
  var el = $('rail');
  el.className = 'rail' + (kind ? ' ' + kind : '');
  el.innerHTML = html;
}

function setWalletUi() {
  $('wallet-label').textContent = wallet.address
    ? shortAddr(wallet.address) + ' · ' + (wallet.method || 'MWA')
    : 'not connected';
  if (!wallet.address) {
    setRail('', 'Connect <strong>Jupiter Wallet</strong> (MWA) to pay Solana rails. Stats are free.');
  } else if (!$('rail').classList.contains('warn') && !$('rail').classList.contains('ok')) {
    setRail('', 'Wallet <strong>' + shortAddr(wallet.address) +
      '</strong>. Settlement needs <strong>yUSDCx</strong> or <strong>wTOKENx</strong> — not plain USDC.');
  }
}

function showTab(name) {
  tab = name;
  ['chat', 'bind', 'stats'].forEach(function (id) {
    $('tab-' + id).classList.toggle('active', id === name);
    $('panel-' + id).classList.toggle('active', id === name);
  });
  if (name === 'stats') loadStats();
}

function appendMsg(role, text) {
  var log = $('chat-log');
  var el = document.createElement('div');
  el.className = 'msg ' + role;
  el.textContent = text;
  log.appendChild(el);
  log.scrollTop = log.scrollHeight;
  return el;
}

function payHooks() {
  return {
    payer: wallet.address,
    contextId: contextId || undefined,
    namespace: namespace || undefined,
    preferredAsset: preferredAsset || undefined,
    onStatus: function (msg) { setRail('', msg); },
    onRail: function (pick) {
      var row = pick.chosen;
      setRail('ok', 'Paying with <strong>' + OpenZooPay.railSymbol(row) + '</strong> · ' +
        OpenZooPay.describeRail(row));
    }
  };
}

function showUnpayable(err) {
  var rails = (err && err.rails) || [];
  var lines = rails.map(function (r) { return OpenZooPay.describeRail(r); });
  setRail('warn',
    '<strong>Need yUSDCx or wTOKENx</strong> to pay. ' +
    'Solana rails settle in NAV-wrapped Token-2022 twins, not plain USDC. ' +
    'Fund a twin in Jupiter Wallet, then retry.' +
    (lines.length ? '<div class="rails-list">' + rails.map(function (r) {
      return '<button class="rail-pick" data-asset="' + r.asset + '">' +
        OpenZooPay.describeRail(r) + '</button>';
    }).join('') + '</div>' : '')
  );
  $('rail').querySelectorAll('.rail-pick').forEach(function (btn) {
    btn.addEventListener('click', function () {
      preferredAsset = btn.getAttribute('data-asset');
      setRail('', 'Will try <strong>' + preferredAsset.slice(0, 6) + '…</strong> on the next paid call. This is not wrap-on-device.');
    });
  });
}

function handlePayError(err) {
  if (err && err.code === 'UNPAYABLE') {
    showUnpayable(err);
    return err.message;
  }
  var msg = OpenZooPay.humanizePayError(err);
  setRail('bad', msg);
  return msg;
}

async function sendChat() {
  if (sending) return;
  var text = $('prompt').value.trim();
  if (!text) return;
  if (!wallet.address) {
    setRail('warn', 'Connect <strong>Jupiter Wallet</strong> before chat. Payment is the auth.');
    return;
  }
  $('prompt').value = '';
  messages.push({ role: 'user', content: text });
  appendMsg('user', text);
  var bubble = appendMsg('assistant', '…');
  sending = true;
  $('send').disabled = true;
  try {
    var body = {
      model: $('model').value,
      messages: [{ role: 'system', content: SYSTEM_PROMPT }].concat(messages),
      max_tokens: 512,
      stream: true
    };
    var res = await OpenZooPay.paidFetch('/v1/chat/completions', {
      method: 'POST',
      body: JSON.stringify(body)
    }, payHooks());
    if (res.status === 402) {
      throw new Error('Gateway still required payment after X-PAYMENT');
    }
    if (!res.ok) {
      var fail = await res.json().catch(function () { return {}; });
      throw new Error((fail.error && fail.error.message) || fail.error || ('HTTP ' + res.status));
    }
    var out = await OpenZooPay.readSseOrJson(res, function (full) {
      bubble.textContent = full || '…';
      $('chat-log').scrollTop = $('chat-log').scrollHeight;
    });
    var reply = out.text || '(empty reply)';
    bubble.textContent = reply;
    messages.push({ role: 'assistant', content: reply });
    if (res._openzooRail) {
      setRail('ok', 'Settled with <strong>' + OpenZooPay.railSymbol(res._openzooRail) + '</strong>');
    }
  } catch (err) {
    var msg = handlePayError(err);
    bubble.textContent = msg;
    messages.pop();
  } finally {
    sending = false;
    $('send').disabled = false;
  }
}

async function doBind() {
  var corpus = $('corpus').value.trim();
  if (!corpus) {
    $('bind-result').textContent = 'Paste a corpus first. Bind does not invent success.';
    return;
  }
  var payload = { corpus: corpus };
  var existing = $('context-id').value.trim();
  if (existing) payload.context_id = existing;
  $('bind-go').disabled = true;
  $('bind-result').textContent = 'Binding…';
  try {
    var res = await OpenZooPay.paidFetch('/v1/hrr/bind', {
      method: 'POST',
      body: JSON.stringify(payload)
    }, payHooks());
    var json = await res.json().catch(function () { return {}; });
    if (!res.ok) {
      throw new Error(json.error || json.message || ('HTTP ' + res.status));
    }
    if (!json.context_id) {
      throw new Error('Gateway did not return a context_id');
    }
    contextId = json.context_id;
    $('context-id').value = contextId;
    $('bind-result').textContent = 'Bound ' + (json.bound != null ? json.bound : '?') +
      ' item(s). context_id=' + contextId + ' (sent as x-hrr-context on chat)';
    setRail('ok', 'Context attached: <strong>' + contextId + '</strong>');
  } catch (err) {
    $('bind-result').textContent = handlePayError(err);
  } finally {
    $('bind-go').disabled = false;
  }
}

function attachPasted() {
  var id = $('context-id').value.trim();
  if (!id) {
    contextId = '';
    $('bind-result').textContent = 'Cleared attached context.';
    return;
  }
  if (/^ctx_[0-9A-HJKMNP-TV-Z]+$/i.test(id)) {
    contextId = id;
    namespace = '';
    $('bind-result').textContent = 'Will send x-hrr-context: ' + id;
  } else {
    contextId = '';
    namespace = id;
    $('bind-result').textContent = 'Not a ctx_ id — will send x-openzoo-namespace instead. This is not a bind.';
  }
}

async function loadStats() {
  $('stats-box').innerHTML = '<div class="help">Loading public /v1/stats…</div>';
  try {
    var res = await fetch(OpenZooPay.gatewayUrl('/v1/stats'));
    var data = await res.json();
    if (!res.ok) throw new Error(data.error || ('HTTP ' + res.status));
    var t = data.today || {};
    $('stats-box').innerHTML =
      '<div class="stats">' +
        stat('calls today', t.calls) +
        stat('paid', t.paid) +
        stat('usd paid', t.usdPaid != null ? '$' + Number(t.usdPaid).toFixed(2) : '—') +
        stat('conversion', t.conversionPct != null ? t.conversionPct + '%' : '—') +
        stat('leCore save', t.lecoreSavingX != null ? t.lecoreSavingX + '×' : '—') +
        stat('payers', t.distinctPayers) +
      '</div>' +
      '<div class="help" style="margin-top:8px">Public, CORS-enabled. No wallet required.</div>' +
      '<pre class="dump">' + escapeHtml(JSON.stringify({
        app: data.app, today: data.today, growth: data.growth, topModels: (data.topModels || []).slice(0, 5)
      }, null, 2)) + '</pre>';
  } catch (err) {
    $('stats-box').innerHTML = '<div class="help">' + escapeHtml(err.message || String(err)) + '</div>';
  }
}

function stat(k, v) {
  return '<div class="stat"><div class="k">' + escapeHtml(String(k)) + '</div><div class="v">' +
    escapeHtml(v == null ? '—' : String(v)) + '</div></div>';
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, function (c) {
    return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
  });
}

async function loadModels() {
  var sel = $('model');
  DEFAULT_MODELS.forEach(function (id) {
    var o = document.createElement('option');
    o.value = id; o.textContent = id;
    sel.appendChild(o);
  });
  try {
    var res = await fetch(OpenZooPay.gatewayUrl('/v1/models'));
    var data = await res.json();
    var ids = ((data && data.data) || []).map(function (m) { return m.id; });
    ids.forEach(function (id) {
      if (DEFAULT_MODELS.indexOf(id) >= 0) return;
      var o = document.createElement('option');
      o.value = id; o.textContent = id;
      sel.appendChild(o);
    });
  } catch (_) { /* curated list is enough */ }
}

function onWallet(data) {
  if (data.type === 'wallet-connected') {
    wallet.address = data.address;
    wallet.method = data.method;
    setWalletUi();
  }
  if (data.type === 'wallet-disconnected') {
    wallet.address = null;
    wallet.method = null;
    setWalletUi();
  }
}

window.addEventListener('message', function (event) {
  if (event.source !== window.parent) return;
  if (event.data && event.data.type) onWallet(event.data);
});
window.parent.postMessage({ type: 'wallet-request-info' }, '*');

$('tab-chat').onclick = function () { showTab('chat'); };
$('tab-bind').onclick = function () { showTab('bind'); };
$('tab-stats').onclick = function () { showTab('stats'); };
$('send').onclick = sendChat;
$('prompt').addEventListener('keydown', function (e) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendChat();
  }
});
$('bind-go').onclick = doBind;
$('bind-attach').onclick = attachPasted;
$('exit').onclick = function () {
  window.parent.postMessage({ type: 'wallet-disconnect' }, '*');
};

setWalletUi();
loadModels();
appendMsg('system', 'CHAT only. Bind attaches HRR context. No RUN / WRITE / READ / SERVE.');
