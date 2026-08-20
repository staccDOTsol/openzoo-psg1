/* Clipboard + select-to-copy for the grokui phone UI.
   Cordova WebView is file:// — navigator.clipboard is missing or a no-op.
   Real copy goes through the shell → MWA.copyText (ClipboardManager). */
'use strict';

var OpenZooCopy = (function () {
  function root() {
    if (typeof window !== 'undefined') return window;
    if (typeof globalThis !== 'undefined' && globalThis.window) return globalThis.window;
    return null;
  }

  function doc() {
    var w = root();
    return (w && w.document) || (typeof document !== 'undefined' ? document : null);
  }

  function selectedText() {
    var document = doc();
    if (!document) return '';
    var el = document.activeElement;
    if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')) {
      if (el.type === 'password') return '';
      var a = el.selectionStart;
      var b = el.selectionEnd;
      if (typeof a === 'number' && typeof b === 'number' && b > a) {
        return String(el.value || '').slice(a, b);
      }
      return '';
    }
    var window = root();
    var sel = window && window.getSelection && window.getSelection();
    return sel ? String(sel.toString() || '') : '';
  }

  function selectedRect() {
    var document = doc();
    var window = root();
    if (!document) return null;
    var el = document.activeElement;
    if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') && el.type !== 'password') {
      var a = el.selectionStart;
      var b = el.selectionEnd;
      if (typeof a === 'number' && typeof b === 'number' && b > a) return el.getBoundingClientRect();
    }
    var sel = window && window.getSelection && window.getSelection();
    if (!sel || !sel.rangeCount) return null;
    var r = sel.getRangeAt(0).getBoundingClientRect();
    if (!r || (r.width === 0 && r.height === 0)) return null;
    return r;
  }

  function snapshotSelection() {
    var document = doc();
    var window = root();
    if (!document) return { kind: 'none' };
    var el = document.activeElement;
    if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')) {
      return { kind: 'field', el: el, start: el.selectionStart, end: el.selectionEnd };
    }
    var sel = window && window.getSelection && window.getSelection();
    if (!sel || !sel.rangeCount) return { kind: 'none' };
    var ranges = [];
    var i;
    for (i = 0; i < sel.rangeCount; i++) ranges.push(sel.getRangeAt(i).cloneRange());
    return { kind: 'dom', ranges: ranges };
  }

  function restoreSelection(snap) {
    var document = doc();
    var window = root();
    if (!snap || !document) return;
    if (snap.kind === 'field' && snap.el && document.contains(snap.el)) {
      try {
        snap.el.focus({ preventScroll: true });
        snap.el.setSelectionRange(snap.start, snap.end);
      } catch (_) {}
      return;
    }
    if (snap.kind === 'dom' && window && window.getSelection) {
      var sel = window.getSelection();
      sel.removeAllRanges();
      var i;
      for (i = 0; i < snap.ranges.length; i++) {
        try { sel.addRange(snap.ranges[i]); } catch (_) {}
      }
    }
  }

  function execCommandCopy(value) {
    var document = doc();
    if (!document) return false;
    try {
      var ta = document.createElement('textarea');
      ta.value = value;
      ta.style.cssText = 'position:fixed;top:-1000px;left:-1000px;opacity:0';
      ta.setAttribute('readonly', '');
      document.body.appendChild(ta);
      ta.select();
      ta.setSelectionRange(0, ta.value.length);
      var ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return !!ok;
    } catch (_) {
      return false;
    }
  }

  function copyViaCordova(value) {
    return new Promise(function (resolve) {
      var window = root();
      if (!window || !window.MWA || typeof window.MWA.copyText !== 'function') {
        resolve(false);
        return;
      }
      try {
        window.MWA.copyText(value, function () { resolve(true); }, function () { resolve(false); });
      } catch (_) {
        resolve(false);
      }
    });
  }

  function copyViaShell(value) {
    return new Promise(function (resolve) {
      var window = root();
      if (!window || !window.parent || window.parent === window) {
        resolve(false);
        return;
      }
      var id = 'copy-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
      var settled = false;
      var timer = setTimeout(function () {
        if (settled) return;
        settled = true;
        window.removeEventListener('message', onMsg);
        resolve(false);
      }, 2500);

      function onMsg(ev) {
        if (ev.source !== window.parent) return;
        var d = ev.data;
        if (!d || d.id !== id || d.type !== 'wallet-copy-text-response') return;
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        window.removeEventListener('message', onMsg);
        resolve(!!d.ok);
      }

      window.addEventListener('message', onMsg);
      try {
        window.parent.postMessage({ type: 'wallet-copy-text', id: id, text: value }, '*');
      } catch (_) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        window.removeEventListener('message', onMsg);
        resolve(false);
      }
    });
  }

  async function copyText(text) {
    var value = String(text == null ? '' : text);
    if (!value) return false;
    if (await copyViaCordova(value)) return true;
    if (await copyViaShell(value)) return true;
    try {
      var window = root();
      var navigator = (window && window.navigator) || (typeof globalThis !== 'undefined' ? globalThis.navigator : undefined);
      if (navigator && navigator.clipboard && navigator.clipboard.writeText &&
          (!window || window.isSecureContext)) {
        await navigator.clipboard.writeText(value);
        return true;
      }
    } catch (_) { /* file:// and many WebViews reject this */ }
    return execCommandCopy(value);
  }

  function showCopiedToast(rect, text) {
    var document = doc();
    var window = root();
    if (!document) return;
    var el = document.getElementById('copiedToast');
    if (!el) return;
    el.textContent = text || 'copied';
    var x = (typeof window !== 'undefined' ? window.innerWidth : 320) / 2;
    var y = 18;
    if (rect && (rect.width || rect.height)) {
      x = rect.left + rect.width / 2;
      y = rect.top - 38;
      if (y < 8) y = rect.bottom + 10;
    }
    var maxX = typeof window !== 'undefined' ? window.innerWidth : 320;
    var maxY = typeof window !== 'undefined' ? window.innerHeight : 480;
    if (x < 48) x = 48;
    if (x > maxX - 48) x = maxX - 48;
    if (y < 8) y = 8;
    if (y > maxY - 36) y = maxY - 36;
    el.style.left = x + 'px';
    el.style.top = y + 'px';
    el.classList.add('show');
    clearTimeout(showCopiedToast._timer);
    showCopiedToast._timer = setTimeout(function () { el.classList.remove('show'); }, 1200);
  }

  function selectNode(el) {
    var window = root();
    var document = doc();
    if (!el || !window || !window.getSelection) return;
    try {
      var sel = window.getSelection();
      var r = document.createRange();
      r.selectNodeContents(el);
      sel.removeAllRanges();
      sel.addRange(r);
    } catch (_) {}
  }

  async function copyAddress(addr, rect, fallbackEl) {
    var value = String(addr || '').trim();
    if (!value) return false;
    var ok = await copyText(value);
    if (ok) {
      showCopiedToast(rect, 'copied');
      return true;
    }
    if (fallbackEl) selectNode(fallbackEl);
    showCopiedToast(rect, 'select it');
    return false;
  }

  function bindSelectToCopy(bindRoot) {
    var document = doc();
    if (!document) return function () {};
    var target = bindRoot || document;
    var selectPointerDown = false;
    var selectCopying = false;
    var selectTimer = 0;
    var selectLastText = '';
    var selectLastAt = 0;

    async function copySettledSelection() {
      if (selectCopying) return;
      var text = selectedText();
      if (!text || !String(text).trim()) return;
      var now = Date.now();
      if (text === selectLastText && (now - selectLastAt) < 500) return;
      selectLastText = text;
      selectLastAt = now;
      var rect = selectedRect();
      var snap = snapshotSelection();
      selectCopying = true;
      var ok = false;
      try { ok = await copyText(text); }
      finally { restoreSelection(snap); selectCopying = false; }
      if (ok) showCopiedToast(rect, 'copied');
    }

    function scheduleCopySelection() {
      if (selectPointerDown || selectCopying) return;
      clearTimeout(selectTimer);
      selectTimer = setTimeout(copySettledSelection, 40);
    }

    function onPointerDown(e) {
      if (e.button !== undefined && e.button !== 0) return;
      selectPointerDown = true;
    }
    function onPointerUp(e) {
      if (e.button !== undefined && e.button !== 0) return;
      selectPointerDown = false;
      scheduleCopySelection();
    }
    function onPointerCancel() { selectPointerDown = false; }
    function onSelectionChange() {
      if (selectPointerDown || selectCopying) return;
      scheduleCopySelection();
    }

    target.addEventListener('pointerdown', onPointerDown);
    target.addEventListener('pointerup', onPointerUp);
    target.addEventListener('pointercancel', onPointerCancel);
    document.addEventListener('selectionchange', onSelectionChange);

    return function unbind() {
      target.removeEventListener('pointerdown', onPointerDown);
      target.removeEventListener('pointerup', onPointerUp);
      target.removeEventListener('pointercancel', onPointerCancel);
      document.removeEventListener('selectionchange', onSelectionChange);
      clearTimeout(selectTimer);
    };
  }

  function walletRow(label, addr) {
    var row = document.createElement('div');
    row.className = 'wrow';
    row.title = 'Tap to copy';
    var l = document.createElement('div');
    l.className = 'wlab';
    l.textContent = label;
    var a = document.createElement('div');
    a.className = 'waddr';
    a.textContent = addr;
    a.setAttribute('data-address', addr);
    var c = document.createElement('div');
    c.className = 'wcopy';
    c.textContent = 'copy';
    row.append(l, a, c);
    row.addEventListener('click', async function () {
      var ok = await copyAddress(addr, row.getBoundingClientRect(), a);
      c.textContent = ok ? 'copied' : 'select it';
      setTimeout(function () { c.textContent = 'copy'; }, 1400);
    });
    return row;
  }

  return {
    selectedText: selectedText,
    selectedRect: selectedRect,
    copyText: copyText,
    copyViaCordova: copyViaCordova,
    copyViaShell: copyViaShell,
    execCommandCopy: execCommandCopy,
    showCopiedToast: showCopiedToast,
    copyAddress: copyAddress,
    bindSelectToCopy: bindSelectToCopy,
    selectNode: selectNode,
    walletRow: walletRow
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = OpenZooCopy;
