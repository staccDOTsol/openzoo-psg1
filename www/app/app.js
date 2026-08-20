'use strict';

var $ = function (id) { return document.getElementById(id); };
var SKEY = 'openzoo.psg1.session.v1';
var GATEWAY = 'https://x402-tokens.fly.dev';

var persisted = {};
try { persisted = JSON.parse(localStorage.getItem(SKEY) || '{}'); } catch (_) {}

var state = {
  messages: persisted.messages || [],
  ctx: persisted.ctx || null,
  spent: persisted.spent || 0,
  saved: persisted.saved || 0,
  calls: persisted.calls || 0,
  model: persisted.model || '',
  busy: false
};

var wallet = { address: null, method: null };
var preferredAsset = '';

function persist() {
  try {
    localStorage.setItem(SKEY, JSON.stringify({
      messages: state.messages,
      ctx: state.ctx,
      spent: state.spent,
      saved: state.saved,
      calls: state.calls,
      model: $('model').value || ''
    }));
  } catch (_) {}
}

function payHooks() {
  return {
    payer: wallet.address,
    contextId: state.ctx || undefined,
    preferredAsset: preferredAsset || undefined,
    onStatus: function (msg) { setRailChip('', msg); },
    onRail: function (pick) {
      setRailChip('on', 'paying ' + OpenZooPay.railSymbol(pick.chosen));
    }
  };
}

function setRailChip(kind, text) {
  var el = $('railChip');
  el.hidden = !text;
  el.className = 'chip' + (kind ? ' ' + kind : '');
  el.textContent = text || '';
}

function showUnpayable(err) {
  var box = $('railWarn');
  var rails = (err && err.rails) || [];
  box.hidden = false;
  box.innerHTML =
    '<strong>Need yUSDCx or wTOKENx</strong> — Solana rails settle in NAV-wrapped Token-2022 twins, not plain USDC. Fund a twin in Jupiter Wallet, then retry.' +
    (rails.length ? '<div class="rails-list">' + rails.map(function (r) {
      return '<button class="rail-pick" data-asset="' + r.asset + '">' +
        OpenZooPay.describeRail(r) + '</button>';
    }).join('') + '</div>' : '');
  box.querySelectorAll('.rail-pick').forEach(function (btn) {
    btn.addEventListener('click', function () {
      preferredAsset = btn.getAttribute('data-asset');
      box.hidden = true;
      setRailChip('', 'will try selected rail next (not wrap-on-device)');
    });
  });
  setRailChip('warn', 'need yUSDCx or wTOKENx');
}

function handlePayError(err) {
  if (err && err.code === 'UNPAYABLE') {
    showUnpayable(err);
    return err.message;
  }
  var msg = OpenZooPay.humanizePayError(err);
  setRailChip('bad', msg);
  return msg;
}

function maxTokens(model) {
  return /deepseek|grok|thinking|fable|sonnet-5|-r1|reason/i.test(model || '') ? 16384 : 4096;
}

function keepModel(id) {
  return id && id.charAt(0) !== '~' && id.indexOf(':batch') < 0;
}

async function loadModels() {
  try {
    var r = await fetch(GATEWAY + '/v1/models');
    if (r.status === 402) {
      r = await OpenZooPay.paidFetch('/v1/models', { method: 'GET', body: null }, payHooks());
    }
    var d = await r.json();
    var models = (d.data || []).filter(function (m) { return keepModel(m.id); });
    models.sort(function (a, b) { return a.id.localeCompare(b.id); });
    var dl = $('modelList');
    dl.innerHTML = '';
    models.forEach(function (m) {
      var o = document.createElement('option');
      o.value = m.id;
      dl.appendChild(o);
    });
    if (!$('model').value) {
      var pick = models.filter(function (m) { return m.id.indexOf('gpt-4o-mini') >= 0; })[0]
        || models.filter(function (m) { return m.id.indexOf('gemini-2.5-flash') >= 0; })[0]
        || models[0];
      if (pick) $('model').value = pick.id;
    }
    $('netChip').textContent = models.length + ' models';
    $('netChip').classList.add('on');
  } catch (_) {
    $('netChip').textContent = 'gateway unreachable';
  }
}

function bubble(text, mine, meta) {
  var row = document.createElement('div');
  row.className = 'row';
  row.setAttribute('data-row', mine ? 'user' : 'assistant');
  var wrap = document.createElement('div');
  wrap.setAttribute('data-role', 'bubble-wrap');
  var b = document.createElement('div');
  b.className = 'bubble ' + (mine ? 'me' : 'zoo');
  b.setAttribute('data-role', 'bubble');
  b.textContent = text;
  wrap.appendChild(b);
  if (meta) {
    var m = document.createElement('div');
    m.className = 'meta';
    m.setAttribute('data-role', 'bubble-meta');
    m.textContent = meta;
    wrap.appendChild(m);
  }
  row.appendChild(wrap);
  $('chat').appendChild(row);
  $('chat').scrollTop = $('chat').scrollHeight;
  return b;
}

function applyReceipt(thinking, x402) {
  var x = x402 || {};
  state.calls += 1;
  if (typeof x.billedUsd === 'number') state.spent += x.billedUsd;
  if (typeof x.savesVsDirect === 'number' && x.savesVsDirect > 0) state.saved += x.savesVsDirect;
  var bits = [];
  if (typeof x.billedUsd === 'number') bits.push('$' + x.billedUsd.toFixed(4));
  if (x.lecore && x.lecore.engaged) bits.push((x.lecore.recalled != null ? x.lecore.recalled : '?') + ' slices');
  if (bits.length) {
    var old = thinking.parentElement.querySelector('[data-role=bubble-meta]');
    if (old) old.remove();
    var meta = document.createElement('div');
    meta.className = 'meta';
    meta.setAttribute('data-role', 'bubble-meta');
    meta.textContent = bits.join(' · ');
    thinking.insertAdjacentElement('afterend', meta);
  }
  renderTicker();
}

function renderTicker() {
  $('spent').textContent = 'this session: $' + Number(state.spent || 0).toFixed(4);
  $('saved').textContent = state.saved > 0 ? ('saved ~$' + Number(state.saved).toFixed(4) + ' vs direct') : '';
  $('calls').textContent = state.calls ? (state.calls + (state.calls === 1 ? ' call' : ' calls')) : '';
}

function setCtxChip() {
  var chip = $('ctxChip');
  if (state.ctx) {
    chip.hidden = false;
    chip.classList.add('on');
    chip.textContent = state.ctx.slice(0, 14) + '… attached';
  } else {
    chip.hidden = true;
    chip.textContent = '';
  }
}

async function send() {
  var text = $('box').value.trim();
  if (!text || state.busy) return;
  if (!wallet.address) {
    setRailChip('warn', 'connect Jupiter Wallet to pay chat');
    return;
  }
  state.busy = true;
  $('box').value = '';
  $('sendBtn').disabled = true;
  bubble(text, true);
  state.messages.push({ role: 'user', content: text });
  var thinking = bubble('…', false);
  try {
    var headers = { 'Content-Type': 'application/json' };
    if (state.ctx) headers['x-hrr-context'] = state.ctx;
    var res = await OpenZooPay.paidFetch('/v1/chat/completions', {
      method: 'POST',
      headers: headers,
      body: JSON.stringify({
        model: $('model').value,
        messages: state.messages,
        max_tokens: maxTokens($('model').value)
      })
    }, payHooks());
    var d = await res.json().catch(function () { return {}; });
    if (res.status === 402) throw new Error('Gateway still required payment after X-PAYMENT');
    if (!res.ok) {
      throw new Error((d.error && d.error.message) || d.error || ('HTTP ' + res.status));
    }
    var ch = d.choices && d.choices[0];
    var content = (ch && ch.message && ch.message.content) || '';
    if (!content && ch && ch.finish_reason === 'length') {
      content = 'The model used the whole max_tokens budget thinking and returned no words. Try again.';
    } else if (!content) {
      content = (d.error && d.error.message) || 'Unexpected reply: ' + JSON.stringify(d).slice(0, 200);
    }
    thinking.textContent = content;
    state.messages.push({ role: 'assistant', content: content });
    applyReceipt(thinking, d.x402 || {});
    $('railWarn').hidden = true;
    persist();
  } catch (e) {
    thinking.textContent = handlePayError(e);
    state.messages.pop();
  }
  state.busy = false;
  $('sendBtn').disabled = false;
}

async function bind() {
  var corpus = $('corpus').value;
  if (!corpus.trim()) return;
  $('bindStatus').textContent = 'binding…';
  try {
    var res = await OpenZooPay.paidFetch('/v1/hrr/bind', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ corpus: corpus })
    }, payHooks());
    var d = await res.json().catch(function () { return {}; });
    if (d.context_id) {
      state.ctx = d.context_id;
      $('bindStatus').textContent = 'bound ' + (corpus.length / 1000).toFixed(0) + 'k chars';
      setCtxChip();
      $('drawer').classList.remove('open');
      $('brainBtn').classList.remove('on');
      persist();
    } else {
      $('bindStatus').textContent = handlePayError({ message: d.error && d.error.message ? d.error.message : (d.error || 'bind failed') });
    }
  } catch (e) {
    $('bindStatus').textContent = handlePayError(e);
  }
}

function closeDrawers() {
  $('drawer').classList.remove('open');
  $('statsDrawer').classList.remove('open');
  $('brainBtn').classList.remove('on');
  $('statsBtn').classList.remove('on');
}

function toggleDrawer(which) {
  var open = which === 'bind' ? $('drawer') : $('statsDrawer');
  var btn = which === 'bind' ? $('brainBtn') : $('statsBtn');
  var willOpen = !open.classList.contains('open');
  closeDrawers();
  if (willOpen) {
    open.classList.add('open');
    btn.classList.add('on');
    if (which === 'stats') loadStats();
  }
}

async function loadStats() {
  $('statsBox').textContent = 'loading…';
  try {
    var res = await fetch(GATEWAY + '/v1/stats');
    var data = await res.json();
    if (!res.ok) throw new Error(data.error || ('HTTP ' + res.status));
    var t = data.today || {};
    function cell(k, v) {
      return '<div class="stat"><div class="k">' + escapeHtml(k) + '</div><div class="v">' +
        escapeHtml(v == null ? '—' : String(v)) + '</div></div>';
    }
    $('statsBox').innerHTML =
      '<div class="stats">' +
        cell('calls today', t.calls) +
        cell('paid', t.paid) +
        cell('usd paid', t.usdPaid != null ? '$' + Number(t.usdPaid).toFixed(2) : '—') +
        cell('leCore', t.lecoreSavingX != null ? t.lecoreSavingX + '×' : '—') +
      '</div>' +
      '<pre class="dump">' + escapeHtml(JSON.stringify({
        app: data.app, today: data.today, growth: data.growth, topModels: (data.topModels || []).slice(0, 5)
      }, null, 2)) + '</pre>';
  } catch (e) {
    $('statsBox').textContent = e.message || String(e);
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, function (c) {
    return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
  });
}

function restore() {
  state.messages.forEach(function (m) { bubble(m.content, m.role === 'user'); });
  renderTicker();
  if (state.model) $('model').value = state.model;
  setCtxChip();
}

function setWalletUi() {
  var chip = $('walletChip');
  if (wallet.address) {
    chip.textContent = wallet.address.slice(0, 4) + '…' + wallet.address.slice(-4);
    chip.classList.add('on');
  } else {
    chip.textContent = 'no wallet';
    chip.classList.remove('on');
  }
}

window.addEventListener('message', function (event) {
  if (event.source !== window.parent) return;
  var data = event.data;
  if (!data || !data.type) return;
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
});
window.parent.postMessage({ type: 'wallet-request-info' }, '*');

$('sendBtn').onclick = send;
$('box').addEventListener('keydown', function (e) {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
});
$('brainBtn').onclick = function () { toggleDrawer('bind'); };
$('statsBtn').onclick = function () { toggleDrawer('stats'); };
$('bindBtn').onclick = bind;
$('newBtn').onclick = function () {
  try { localStorage.removeItem(SKEY); } catch (_) {}
  location.reload();
};
$('exit').onclick = function () {
  window.parent.postMessage({ type: 'wallet-disconnect' }, '*');
};
$('corpus').addEventListener('drop', function (e) {
  e.preventDefault();
  var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
  if (f) {
    var reader = new FileReader();
    reader.onload = function () { $('corpus').value = reader.result; };
    reader.readAsText(f);
  }
});
$('corpus').addEventListener('dragover', function (e) { e.preventDefault(); });
$('model').addEventListener('change', persist);

restore();
setWalletUi();
loadModels();
