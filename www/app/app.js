'use strict';

var $ = function (id) { return document.getElementById(id); };
var SKEY = 'openzoo.psg1.grokui.v1';
var COLORS = ['#5b8def', '#f28c4d', '#b8f240', '#e05cf6', '#34c759', '#ff6b6b', '#64d2ff', '#ffd60a'];

function loadStore() {
  try { return JSON.parse(localStorage.getItem(SKEY) || '{}'); }
  catch (_) { return {}; }
}

function uid() {
  return 't-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

function hydrateThread(t) {
  if (!t || typeof t !== 'object') return t;
  t.tier = OpenZooRace.normalizeTier(t.tier);
  if (t.race == null && t.raceNeed == null) {
    t.race = OpenZooRace.DEFAULT_N;
    t.raceNeed = OpenZooRace.DEFAULT_NEED;
  }
  return t;
}

var persisted = loadStore();
var threads = Array.isArray(persisted.threads) && persisted.threads.length
  ? persisted.threads.map(hydrateThread)
  : [newThread('openzoo')];
var activeId = persisted.activeId && threads.some(function (t) { return t.id === persisted.activeId; })
  ? persisted.activeId
  : threads[0].id;
var wallet = { address: null, method: null };
var pendingFiles = [];
var busy = false;
var sidebarOpen = false;
var catalogIds = [];
var payQueue = OpenZooRace.createPayQueue();

function newThread(name) {
  return {
    id: uid(),
    name: name || 'new',
    color: COLORS[Math.floor(Math.random() * COLORS.length)],
    createdAt: Date.now(),
    lastActivityAt: Date.now(),
    messages: [],
    memory: null,
    boundHistoryCount: 0,
    attached: 0,
    spent: 0,
    direct: 0,
    calls: 0,
    model: '',
    tier: 'medium',
    race: OpenZooRace.DEFAULT_N,
    raceNeed: OpenZooRace.DEFAULT_NEED
  };
}

function active() {
  var i;
  for (i = 0; i < threads.length; i++) if (threads[i].id === activeId) return threads[i];
  return threads[0];
}

function persist() {
  try {
    localStorage.setItem(SKEY, JSON.stringify({
      threads: threads,
      activeId: activeId
    }));
  } catch (_) {}
}

function copyText(text, rect) {
  var value = String(text || '');
  if (!value) return Promise.resolve(false);
  if (window.OpenZooCopy && OpenZooCopy.copyAddress) {
    return OpenZooCopy.copyAddress(value, rect);
  }
  if (window.OpenZooCopy && OpenZooCopy.copyText) {
    return OpenZooCopy.copyText(value).then(function (ok) {
      if (ok) toast('copied', rect);
      return ok;
    });
  }
  toast('copied', rect);
  return Promise.resolve(true);
}

function showPayPrompt(opts) {
  opts = opts || {};
  return new Promise(function (resolve) {
    var overlay = $('payPromptOverlay');
    var title = $('payPromptTitle');
    var body = $('payPromptBody');
    var addrRow = $('payPromptAddrRow');
    var addr = $('payPromptAddr');
    var okBtn = $('payPromptOk');
    var cancelBtn = $('payPromptCancel');
    title.textContent = opts.title || '';
    body.textContent = opts.body || '';
    if (opts.address) {
      addrRow.hidden = false;
      addr.textContent = opts.address;
      addrRow.title = 'Tap to copy';
      addrRow.onclick = function (e) {
        copyText(opts.address, e.currentTarget.getBoundingClientRect());
      };
    } else {
      addrRow.hidden = true;
      addr.textContent = '';
      addrRow.onclick = null;
    }
    okBtn.textContent = opts.ok || 'ok';
    cancelBtn.textContent = opts.cancel || 'not now';
    function finish(val) {
      overlay.classList.remove('show');
      okBtn.onclick = null;
      cancelBtn.onclick = null;
      overlay.onclick = null;
      resolve(val);
    }
    okBtn.onclick = function () { finish(true); };
    cancelBtn.onclick = function () { finish(false); };
    overlay.onclick = function (e) {
      if (e.target === overlay) finish(false);
    };
    overlay.classList.add('show');
  });
}

function promptWrap(info) {
  var copy = (info && info.copy) || OpenZooPay.wrapPromptCopy(info && info.symbol);
  return showPayPrompt({
    title: copy.title,
    body: copy.body,
    ok: copy.ok,
    cancel: copy.cancel
  });
}

function promptFunds(info) {
  var copy = info && info.kind === 'sol'
    ? OpenZooPay.shortSolCopy()
    : OpenZooPay.shortTokensCopy(info && info.tokens);
  var address = (info && info.address) || wallet.address;
  return showPayPrompt({
    title: copy.title,
    body: copy.body,
    address: address,
    ok: 'copied',
    cancel: 'close'
  }).then(function (ok) {
    if (ok && address) return copyText(address);
    return false;
  });
}

function payHooks(opts) {
  opts = opts || {};
  var t = active();
  var hooks = {
    payer: wallet.address,
    onStatus: setStatus,
    confirmWrap: promptWrap,
    needFunds: promptFunds
  };
  if (Object.prototype.hasOwnProperty.call(opts, 'contextId')) {
    if (opts.contextId) hooks.contextId = opts.contextId;
  } else if (t.memory) {
    hooks.contextId = t.memory;
  }
  return hooks;
}

function setStatus(msg, kind) {
  var el = $('statusChip');
  if (!msg) {
    el.hidden = true;
    el.textContent = '';
    return;
  }
  el.hidden = false;
  el.className = 'status-chip' + (kind ? ' ' + kind : '');
  el.textContent = msg;
}

function toast(text, rect) {
  if (window.OpenZooCopy) OpenZooCopy.showCopiedToast(rect, text || 'copied');
  else {
    var el = $('copiedToast');
    el.textContent = text || 'copied';
    el.classList.add('show');
    setTimeout(function () { el.classList.remove('show'); }, 1200);
  }
}

function initials(name) {
  var parts = String(name || 'oz').trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

function previewOf(t) {
  var last = t.messages[t.messages.length - 1];
  return last ? String(last.content || '').replace(/\s+/g, ' ').slice(0, 72) : 'new thread';
}

function renderThreads() {
  var q = ($('search').value || '').toLowerCase();
  var box = $('threads');
  box.innerHTML = '';
  var list = threads.slice().sort(function (a, b) { return (b.lastActivityAt || 0) - (a.lastActivityAt || 0); });
  var shown = 0;
  list.forEach(function (t) {
    if (q && (t.name || '').toLowerCase().indexOf(q) < 0 && previewOf(t).toLowerCase().indexOf(q) < 0) return;
    shown++;
    var row = document.createElement('div');
    row.className = 'trow' + (t.id === activeId ? ' active' : '');
    row.innerHTML =
      '<div class="tavatar" style="background:' + t.color + '">' + initials(t.name) + '</div>' +
      '<div class="tmeta"><div class="tname"></div><div class="tprev"></div></div>' +
      '<button class="tclose" type="button" title="Close">✕</button>';
    row.querySelector('.tname').textContent = t.name;
    row.querySelector('.tprev').textContent = previewOf(t);
    row.addEventListener('click', function (e) {
      if (e.target.closest('.tclose')) return;
      activeId = t.id;
      persist();
      render();
      closeSidebar();
    });
    row.querySelector('.tclose').addEventListener('click', function (e) {
      e.stopPropagation();
      threads = threads.filter(function (x) { return x.id !== t.id; });
      if (!threads.length) threads = [newThread('openzoo')];
      if (activeId === t.id) activeId = threads[0].id;
      persist();
      render();
    });
    box.appendChild(row);
  });
  if (!shown) {
    var empty = document.createElement('div');
    empty.className = 'tempty';
    empty.textContent = q ? 'No matching threads.' : 'No threads yet.';
    box.appendChild(empty);
  }
}

function renderHeader() {
  var t = active();
  var id = $('chatHeaderId');
  id.innerHTML =
    '<div class="tavatar" style="width:26px;height:26px;border-radius:7px;font-size:11px;background:' +
    t.color + '">' + initials(t.name) + '</div>' +
    '<div class="hname"><div></div>' +
    (t.attached ? '<div class="hattached">files attached</div>' : '') +
    '</div>';
  id.querySelector('.hname > div').textContent = t.name;
  if (t.model && !$('model').value) $('model').value = t.model;
  else if (t.model) $('model').value = t.model;
  syncDials(t);
}

function racePlanOf(t) {
  t = t || active();
  if (t.race == null && t.raceNeed == null) return OpenZooRace.defaultDial();
  return OpenZooRace.parseDial(OpenZooRace.formatDial(t.race, t.raceNeed));
}

function syncDials(t) {
  t = t || active();
  var tierSel = $('tierSel');
  var raceSel = $('raceSel');
  if (!tierSel || !raceSel) return;
  t.tier = OpenZooRace.normalizeTier(t.tier);
  var plan = racePlanOf(t);
  t.race = plan.n;
  t.raceNeed = plan.need;
  tierSel.value = t.tier;
  raceSel.value = OpenZooRace.formatDial(plan);
  var racing = plan.n >= 2;
  tierSel.className = 'dial tier' + (racing && (t.tier === 'expensive' || t.tier === 'grok4.6') ? ' hot' : '');
  raceSel.className = 'dial race' + (racing ? ' hot' : '');
  $('model').classList.toggle('pinned', racing);
  $('model').title = racing
    ? 'Racing the ' + t.tier + ' band — the single model picker is ignored until race is off.'
    : 'Pin one model (race off)';
}

function sessionTotals() {
  var spent = 0, direct = 0, calls = 0;
  threads.forEach(function (t) {
    spent += Number(t.spent || 0);
    direct += Number(t.direct || 0);
    calls += Number(t.calls || 0);
  });
  return {
    spent: spent,
    direct: direct,
    calls: calls,
    savingX: OpenZooSpill.hudSavingX(direct, spent)
  };
}

function renderHud() {
  var s = sessionTotals();
  $('hYouSpent').textContent = '$' + s.spent.toFixed(4);
  $('hYouSaved').textContent = s.savingX != null ? (s.savingX.toFixed(2) + '×') : '—';
  $('hCalls').textContent = String(s.calls);
  $('hFoot').textContent = wallet.address
    ? (wallet.address.slice(0, 4) + '…' + wallet.address.slice(-4) + ' · Jupiter Wallet')
    : 'Connect Jupiter Wallet to pay from this handheld.';
}

function bubble(text, mine, pending) {
  var row = document.createElement('div');
  row.className = 'row ' + (mine ? 'user' : 'bot') + (pending ? ' pending' : '');
  var b = document.createElement('div');
  b.className = 'bubble';
  b.textContent = text;
  row.appendChild(b);
  $('log').appendChild(row);
  $('log').scrollTop = $('log').scrollHeight;
  return b;
}

function renderLog() {
  var t = active();
  var log = $('log');
  log.innerHTML = '';
  if (!t.messages.length) {
    var w = document.createElement('div');
    w.className = 'welcome';
    w.textContent = 'openzoo on Play Solana. Start a thread, attach files or notes if you want the zoo to remember them, and message. Payment comes from Jupiter Wallet — the app tops up in the background when it can.';
    log.appendChild(w);
    return;
  }
  t.messages.forEach(function (m) { bubble(m.content, m.role === 'user'); });
}

function renderAttachChips() {
  var box = $('attachChips');
  box.innerHTML = '';
  pendingFiles.forEach(function (f, i) {
    var chip = document.createElement('span');
    chip.className = 'achip';
    chip.innerHTML = '<span></span><span class="ax">✕</span>';
    chip.querySelector('span').textContent = f.name;
    chip.querySelector('.ax').addEventListener('click', function () {
      pendingFiles.splice(i, 1);
      renderAttachChips();
      syncSend();
    });
    box.appendChild(chip);
  });
}

function render() {
  renderThreads();
  renderHeader();
  renderLog();
  renderHud();
  renderAttachChips();
  syncSend();
}

function syncSend() {
  $('send').classList.toggle('show', !!$('inp').value.trim() || pendingFiles.length > 0);
}

function maxTokens(model) {
  return /deepseek|grok|thinking|fable|sonnet-5|-r1|reason/i.test(model || '') ? 16384 : 4096;
}

function keepModel(id) {
  return id && id.charAt(0) !== '~' && id.indexOf(':batch') < 0;
}

async function loadModels() {
  try {
    var r = await fetch(OpenZooPay.GATEWAY + '/v1/models');
    if (r.status === 402) {
      r = await OpenZooPay.paidFetch('/v1/models', { method: 'GET', body: null }, payHooks());
    }
    var d = await r.json();
    var models = (d.data || []).filter(function (m) { return keepModel(m.id); });
    models.sort(function (a, b) { return a.id.localeCompare(b.id); });
    catalogIds = models.map(function (m) { return m.id; });
    var dl = $('modelList');
    dl.innerHTML = '';
    models.forEach(function (m) {
      var o = document.createElement('option');
      o.value = m.id;
      dl.appendChild(o);
    });
    var t = active();
    if (!t.model) {
      var pick = models.filter(function (m) { return m.id.indexOf('gpt-4o-mini') >= 0; })[0]
        || models.filter(function (m) { return m.id.indexOf('gemini-2.5-flash') >= 0; })[0]
        || models[0];
      if (pick) {
        t.model = pick.id;
        $('model').value = pick.id;
        persist();
      }
    } else {
      $('model').value = t.model;
    }
  } catch (_) {}
}

function looksText(file) {
  return /^text\//.test(file.type) ||
    /\.(txt|md|js|mjs|ts|tsx|jsx|py|json|css|html|csv|log|ya?ml|sh|rs|go|java|c|h|cpp|rb|php)$/i.test(file.name);
}

function readFileAsText(file) {
  return new Promise(function (resolve) {
    var r = new FileReader();
    r.onload = function () { resolve(r.result); };
    r.onerror = function () { resolve(null); };
    r.readAsText(file);
  });
}

async function ingestFiles(fileList) {
  var files = Array.from(fileList || []);
  var i;
  for (i = 0; i < files.length; i++) {
    var f = files[i];
    var name = f.webkitRelativePath || f.name;
    var content = (looksText(f) && f.size < 400000) ? await readFileAsText(f) : null;
    pendingFiles.push({ name: name, size: f.size, content: content });
  }
  renderAttachChips();
  syncSend();
}

function corpusFromPending() {
  return pendingFiles.map(function (f) {
    if (f.content != null) return '--- ' + f.name + ' ---\n' + f.content;
    return '--- ' + f.name + ' ---\n(binary, ' + f.size + ' bytes)';
  }).join('\n\n');
}

async function remember(corpus, status) {
  if (!corpus || !corpus.trim()) return;
  var t = active();
  if (status) setStatus(status);
  try {
    var ctx = await OpenZooPay.silentBind(corpus, payHooks(), t.memory);
    if (ctx) {
      t.memory = ctx;
      t.attached = (t.attached || 0) + 1;
      persist();
      renderHeader();
    }
  } catch (e) {
    setStatus(OpenZooPay.humanizePayError(e), 'warn');
  }
}

async function rememberHistory(t) {
  var range = OpenZooSpill.prefixRange(t.messages.length, t.boundHistoryCount);
  if (range.to <= range.from) return t.memory;
  var delta = t.messages.slice(range.from, range.to);
  var corpus = OpenZooSpill.formatHistory(delta, t.name);
  try {
    var ctx = await OpenZooPay.silentBind(corpus, payHooks(), t.memory);
    if (ctx) {
      t.memory = ctx;
      t.boundHistoryCount = range.to;
      persist();
    }
    return ctx || t.memory;
  } catch (_) {
    return t.memory;
  }
}

function noteReceipt(t, x, billedBits) {
  if (!x) return;
  OpenZooSpill.applyReceipt(t, x);
  if (billedBits && typeof x.billedUsd === 'number') {
    billedBits.push('$' + x.billedUsd.toFixed(4));
  }
}

async function racePaidChat(t, messages, contextId, model, tokens, signal, onDelta, billedBits) {
  var headers = { 'Content-Type': 'application/json' };
  if (contextId) headers['x-hrr-context'] = contextId;
  var res = await payQueue(function () {
    return OpenZooPay.paidFetch('/v1/chat/completions', {
      method: 'POST',
      headers: headers,
      body: JSON.stringify({
        model: model,
        messages: messages,
        max_tokens: tokens || maxTokens(model),
        stream: true
      }),
      signal: signal
    }, payHooks({ contextId: contextId }));
  });
  if (res.status === 402) throw new Error('payment failed');
  if (!res.ok) {
    var errBody = await res.json().catch(function () { return {}; });
    var msg = (errBody.error && errBody.error.message) || errBody.error || ('HTTP ' + res.status);
    throw new Error(typeof msg === 'string' ? msg : ('HTTP ' + res.status));
  }
  var got = await OpenZooPay.readSseOrJson(res, function (_full, delta) {
    if (delta) onDelta(delta);
  });
  if (got.json) noteReceipt(t, got.json.x402, billedBits);
  if (!got.stream && got.text) onDelta(got.text);
  return got.text;
}

async function raceStream(t, messages, onDelta, contextId, model, tokens, signal, billedBits) {
  return racePaidChat(t, messages, contextId, model, tokens, signal, onDelta, billedBits);
}

async function raceJudgeCall(t, prompt, maxTok, billedBits) {
  var judge = OpenZooRace.judgeModel(catalogIds);
  var res = await payQueue(function () {
    return OpenZooPay.paidFetch('/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: judge,
        messages: [{ role: 'user', content: prompt }],
        max_tokens: maxTok || 24
      })
    }, payHooks());
  });
  var d = await res.json().catch(function () { return {}; });
  if (!res.ok) throw new Error((d.error && d.error.message) || ('HTTP ' + res.status));
  noteReceipt(t, d.x402, billedBits);
  return (d.choices && d.choices[0] && d.choices[0].message && d.choices[0].message.content) || '';
}

async function raceClassify(t, messages, cand, billedBits) {
  var verdict = await raceJudgeCall(t, OpenZooRace.classifyPrompt(messages, cand), 24, billedBits);
  return OpenZooRace.parseClassifyScore(verdict);
}

async function racePairwise(t, messages, tied, billedBits) {
  var verdict = await raceJudgeCall(t, OpenZooRace.pairwisePrompt(messages, tied), 8, billedBits);
  return OpenZooRace.pickTiedLetter(verdict, tied);
}

async function send() {
  var text = $('inp').value.trim();
  if ((!text && !pendingFiles.length) || busy) return;
  if (!wallet.address) {
    setStatus('Connect Jupiter Wallet to pay.', 'warn');
    return;
  }
  var t = active();
  t.model = $('model').value || t.model;
  t.tier = OpenZooRace.normalizeTier($('tierSel').value);
  var dial = OpenZooRace.parseDial($('raceSel').value);
  t.race = dial.n;
  t.raceNeed = dial.need;
  busy = true;
  $('inp').value = '';
  syncSend();

  var attached = pendingFiles.slice();
  var attachCorpus = corpusFromPending();
  pendingFiles = [];
  renderAttachChips();

  if (attachCorpus) {
    var names = attached.map(function (f) { return f.name; }).join(', ');
    if (!text) text = 'Look at what I attached: ' + names;
    await remember(attachCorpus, 'Attaching…');
  }

  t.messages.push({ role: 'user', content: text });
  t.lastActivityAt = Date.now();
  if (t.name === 'openzoo' || t.name === 'new') t.name = text.slice(0, 28);
  persist();
  renderLog();
  renderThreads();
  var thinking = bubble('…', false, true);

  try {
    await rememberHistory(t);
    var plan = OpenZooSpill.outgoingChat(t.messages, t.memory);
    var racePlan = racePlanOf(t);
    var content;
    var billedBits = [];
    if (racePlan.n >= 2) {
      setStatus(OpenZooRace.formatRaceStatus(0, racePlan.need));
      var painted = '';
      content = await OpenZooRace.brainRace(
        plan.messages,
        function (chunk, meta) {
          if (!chunk) return;
          if (meta && meta.replace) painted = String(chunk);
          else painted += String(chunk);
          thinking.textContent = painted || '…';
        },
        plan.contextId,
        OpenZooRace.tierModels(t.tier, racePlan.n, true, catalogIds),
        racePlan.need,
        maxTokens(t.model),
        setStatus,
        {
          stream: function (messages, onDelta, contextId, model, tokens, _r, _k, _st, signal) {
            return raceStream(t, messages, onDelta, contextId, model, tokens, signal, billedBits);
          },
          classify: function (messages, cand) {
            return raceClassify(t, messages, cand, billedBits);
          },
          pairwise: function (messages, tied) {
            return racePairwise(t, messages, tied, billedBits);
          }
        }
      );
    } else {
      var headers = { 'Content-Type': 'application/json' };
      if (plan.contextId) headers['x-hrr-context'] = plan.contextId;
      var res = await OpenZooPay.paidFetch('/v1/chat/completions', {
        method: 'POST',
        headers: headers,
        body: JSON.stringify({
          model: t.model,
          messages: plan.messages,
          max_tokens: maxTokens(t.model)
        })
      }, payHooks({ contextId: plan.contextId }));
      var d = await res.json().catch(function () { return {}; });
      if (res.status === 402) throw new Error('Still waiting on payment. Approve in Jupiter Wallet and retry.');
      if (!res.ok) throw new Error((d.error && d.error.message) || d.error || ('HTTP ' + res.status));
      var ch = d.choices && d.choices[0];
      content = (ch && ch.message && ch.message.content) || '';
      if (!content && ch && ch.finish_reason === 'length') {
        content = 'The model used the whole thinking budget and said nothing. Try again.';
      } else if (!content) {
        content = (d.error && d.error.message) || 'Unexpected reply.';
      }
      OpenZooSpill.applyReceipt(t, d.x402 || {});
      var x = d.x402 || {};
      if (typeof x.billedUsd === 'number') billedBits.push('$' + x.billedUsd.toFixed(4));
      if (x.lecore && x.lecore.engaged) billedBits.push((x.lecore.recalled != null ? x.lecore.recalled : '?') + ' slices');
    }
    if (!content) throw new Error(OpenZooRace.RACE_EVERY_FAILED);
    thinking.textContent = content;
    thinking.parentElement.classList.remove('pending');
    t.messages.push({ role: 'assistant', content: content });
    if (billedBits.length) {
      var meta = document.createElement('div');
      meta.className = 'meta';
      meta.textContent = billedBits.join(' · ');
      thinking.insertAdjacentElement('afterend', meta);
    }
    persist();
    renderHud();
    setStatus('');
    rememberHistory(t);
  } catch (e) {
    var shown = OpenZooPay.humanizePayError(e);
    thinking.textContent = shown;
    thinking.parentElement.classList.remove('pending');
    if (!e || e.name !== 'NeedFundsError') t.messages.pop();
    persist();
    setStatus(shown, 'warn');
  }
  busy = false;
}

function fmtAmt(raw, decimals) {
  try {
    return OpenZooPay.formatAtomic(raw, decimals);
  } catch (_) {
    return String(raw || '0');
  }
}

async function openWallet() {
  $('walletOverlay').classList.add('show');
  var body = $('walletBody');
  body.textContent = 'loading…';
  var html = '';
  if (!wallet.address) {
    body.innerHTML = '<div class="wnote">Connect Jupiter Wallet from the start screen.</div>';
    return;
  }
  body.innerHTML = '';
  if (window.OpenZooCopy && OpenZooCopy.walletRow) {
    body.appendChild(OpenZooCopy.walletRow('Solana', wallet.address));
  } else {
    html += '<div class="wrow"><div class="wlab">Solana</div><div class="waddr"></div></div>';
    body.innerHTML = html;
    var addrEl = body.querySelector('.waddr');
    addrEl.textContent = wallet.address;
    addrEl.addEventListener('click', function () {
      if (window.OpenZooCopy) OpenZooCopy.copyAddress(wallet.address, addrEl.getBoundingClientRect(), addrEl);
    });
  }
  try {
    var got = await OpenZooPay.fetchBalances(wallet.address);
    var b = got.balances || {};
    var lines = [
      ['USDC', b[OpenZooWrap.USDC_MINT] || '0', 6],
      ['TOKEN', b[OpenZooWrap.TOKEN_MINT] || '0', 6],
      ['LEOS', b[OpenZooWrap.LEOS_MINT] || '0', 9]
    ];
    var box = document.createElement('div');
    box.className = 'wbal';
    box.textContent = lines.map(function (row) {
      return row[0] + '  ' + fmtAmt(row[1], row[2]);
    }).join('\n');
    body.appendChild(box);
    var note = document.createElement('div');
    note.className = 'wnote';
    note.textContent = 'USDC, TOKEN, or LEOS here is enough. The app tops up before a paid call when it needs to. This is Jupiter Wallet on this handheld — not a local burner, not openzoo’s wallet.';
    body.appendChild(note);
  } catch (_) {
    var fail = document.createElement('div');
    fail.className = 'wnote';
    fail.textContent = 'Could not read holdings right now.';
    body.appendChild(fail);
  }
}

function closeSidebar() {
  sidebarOpen = false;
  $('sidebar').classList.remove('open');
}

function openSidebar() {
  sidebarOpen = true;
  $('sidebar').classList.add('open');
}

window.addEventListener('message', function (event) {
  if (event.source !== window.parent) return;
  var data = event.data;
  if (!data || !data.type) return;
  if (data.type === 'wallet-connected') {
    wallet.address = data.address;
    wallet.method = data.method;
    renderHud();
  }
  if (data.type === 'wallet-disconnected') {
    wallet.address = null;
    wallet.method = null;
    renderHud();
  }
  if (data.type === 'app-pause' && window.OpenZooPay) {
    OpenZooPay.notifyPause();
  }
  if (data.type === 'app-resume' && window.OpenZooPay) {
    OpenZooPay.onAppResume(busy ? { onStatus: setStatus } : Object.assign(payHooks(), { autoRetry: true, onStatus: setStatus }));
  }
});
window.parent.postMessage({ type: 'wallet-request-info' }, '*');

$('send').onclick = send;
$('inp').addEventListener('input', syncSend);
$('inp').addEventListener('keydown', function (e) {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
});
$('model').addEventListener('change', function () {
  active().model = $('model').value;
  persist();
});
$('tierSel').addEventListener('change', function () {
  var t = active();
  t.tier = OpenZooRace.normalizeTier($('tierSel').value);
  persist();
  syncDials(t);
});
$('raceSel').addEventListener('change', function () {
  var t = active();
  var plan = OpenZooRace.parseDial($('raceSel').value);
  t.race = plan.n;
  t.raceNeed = plan.need;
  persist();
  syncDials(t);
});
$('search').addEventListener('input', renderThreads);
$('newMsgBtn').onclick = function () {
  var t = newThread('new');
  threads.push(t);
  activeId = t.id;
  persist();
  render();
  closeSidebar();
  $('inp').focus();
};
$('menuBtn').onclick = function () {
  if (sidebarOpen) closeSidebar();
  else openSidebar();
};
$('walletBtn').onclick = openWallet;
$('walletClose').onclick = function () { $('walletOverlay').classList.remove('show'); };
$('walletOverlay').addEventListener('click', function (e) {
  if (e.target === $('walletOverlay')) $('walletOverlay').classList.remove('show');
});
$('hudBtn').onclick = function () { $('hud').classList.toggle('show'); };
$('exit').onclick = function () {
  window.parent.postMessage({ type: 'wallet-disconnect' }, '*');
};

var plusMenu = $('plusMenu');
$('plusBtn').onclick = function (e) {
  e.stopPropagation();
  plusMenu.classList.toggle('show');
};
document.addEventListener('click', function () { plusMenu.classList.remove('show'); });
$('attachBtn').onclick = function (e) {
  e.stopPropagation();
  plusMenu.classList.remove('show');
  $('fileInp').click();
};
$('folderBtn').onclick = function (e) {
  e.stopPropagation();
  plusMenu.classList.remove('show');
  $('folderInp').click();
};
$('textBtn').onclick = function (e) {
  e.stopPropagation();
  plusMenu.classList.remove('show');
  $('textAttachOverlay').classList.add('show');
  $('textAttach').focus();
};
$('fileInp').addEventListener('change', async function () {
  await ingestFiles($('fileInp').files);
  $('fileInp').value = '';
});
$('folderInp').addEventListener('change', async function () {
  await ingestFiles($('folderInp').files);
  $('folderInp').value = '';
});
$('textAttachOk').onclick = function () {
  var text = $('textAttach').value;
  if (text.trim()) {
    pendingFiles.push({ name: 'notes.txt', size: text.length, content: text });
    renderAttachChips();
    syncSend();
  }
  $('textAttach').value = '';
  $('textAttachOverlay').classList.remove('show');
};
$('textAttachCancel').onclick = function () {
  $('textAttachOverlay').classList.remove('show');
};
$('textAttachOverlay').addEventListener('click', function (e) {
  if (e.target === $('textAttachOverlay')) $('textAttachOverlay').classList.remove('show');
});

if (window.OpenZooCopy && OpenZooCopy.bindSelectToCopy) OpenZooCopy.bindSelectToCopy(document);

document.addEventListener('visibilitychange', function () {
  if (!window.OpenZooPay) return;
  if (document.hidden) OpenZooPay.notifyPause();
  else OpenZooPay.notifyResume();
});
window.addEventListener('pageshow', function () {
  if (window.OpenZooPay) OpenZooPay.notifyResume();
});

render();
loadModels();
