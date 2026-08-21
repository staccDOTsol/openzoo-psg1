/* Hosted OCC + upload — same door as iOS/Android.
   Origin: https://zoo.openzoo.fun
   Auth: Authorization: Bearer <subscription key>
   Never ANTHROPIC_API_KEY. Never an open OCC URL. Chat/x402 is a different lane. */
'use strict';

var OpenZooOcc = (function (OpenZooSub) {
  var DOOR = 'https://zoo.openzoo.fun';
  var ROUTES = {
    sessions: '/occ/sessions',
    messages: function (id) { return '/occ/sessions/' + encodeURIComponent(id) + '/messages'; },
    files: function (id) { return '/occ/sessions/' + encodeURIComponent(id) + '/files'; },
    stop: function (id) { return '/occ/sessions/' + encodeURIComponent(id) + '/stop'; }
  };

  function doorUrl(path) {
    return DOOR + path;
  }

  function sessionIdOf(body) {
    if (!body || typeof body !== 'object') return '';
    return String(body.id || body.session_id || body.sessionId || '').trim();
  }

  function safeRelPath(name) {
    var raw = String(name || 'upload.bin').replace(/\\/g, '/').replace(/^\/+/, '');
    var parts = raw.split('/').filter(function (p) {
      return p && p !== '.' && p !== '..';
    });
    return parts.join('/') || 'upload.bin';
  }

  function isGoalLine(text) {
    return /^\/goal\b/i.test(String(text || '').trim());
  }

  function NoKeyError(message) {
    var err = new Error(message || 'No subscription key — Agent stays closed.');
    err.name = 'NoSubscriptionError';
    return err;
  }

  function headers(extra) {
    var rec;
    try { rec = OpenZooSub.requireKey(); } catch (e) { throw NoKeyError(e && e.message); }
    var out = OpenZooSub.authHeaders(extra || {});
    if (!out.Authorization) throw NoKeyError();
    void rec;
    return out;
  }

  function toBase64(value) {
    if (value == null) return '';
    if (typeof Buffer !== 'undefined') {
      if (typeof value === 'string') return Buffer.from(value, 'utf8').toString('base64');
      var buf = value instanceof ArrayBuffer ? Buffer.from(new Uint8Array(value)) : Buffer.from(value);
      return buf.toString('base64');
    }
    if (typeof value === 'string') {
      return btoa(unescape(encodeURIComponent(value)));
    }
    var bytes = value instanceof ArrayBuffer ? new Uint8Array(value) : value;
    var bin = '';
    var i;
    for (i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin);
  }

  async function occFetch(path, init) {
    init = init || {};
    var hdrs = headers(init.headers || {});
    var requestInit = {
      method: init.method || 'POST',
      headers: hdrs
    };
    if (init.body != null) requestInit.body = init.body;
    if (init.signal) requestInit.signal = init.signal;
    var res = await fetch(doorUrl(path), requestInit);
    if (res.status === 401) {
      var err = NoKeyError('Hosted OCC refused the key. Paste a live OpenZoo subscription Bearer.');
      err.status = 401;
      throw err;
    }
    return res;
  }

  async function readJson(res) {
    return res.json().catch(function () { return {}; });
  }

  function eventText(ev) {
    if (!ev || typeof ev !== 'object') return '';
    if (ev.choices && ev.choices[0] && ev.choices[0].delta && ev.choices[0].delta.content) {
      return String(ev.choices[0].delta.content);
    }
    if (ev.type === 'status' || ev.type === 'pty') return '';
    if (typeof ev.text === 'string') return ev.text;
    if (typeof ev.output === 'string') return ev.output;
    if (typeof ev.delta === 'string') return ev.delta;
    if (ev.delta && typeof ev.delta.text === 'string') return ev.delta.text;
    if (typeof ev.content === 'string') return ev.content;
    return '';
  }

  function applySseEvent(ev, acc) {
    if (!ev || typeof ev !== 'object') return acc;
    if (ev.type === 'error') {
      acc.error = String(ev.error || ev.message || 'OCC error');
      return acc;
    }
    if (ev.type === 'done') {
      acc.done = true;
      var doneText = eventText(ev);
      if (doneText) acc.text = acc.text || doneText;
      return acc;
    }
    if (ev.type === 'status' || ev.type === 'pty') {
      acc.status = ev.text || ev.output || ev.status || acc.status;
      return acc;
    }
    var chunk = eventText(ev);
    if (chunk) acc.text += chunk;
    return acc;
  }

  async function readOccStream(res, onDelta) {
    var ctype = (res.headers && res.headers.get && res.headers.get('content-type') || '').toLowerCase();
    if (ctype.indexOf('text/event-stream') >= 0 && res.body && res.body.getReader) {
      var reader = res.body.getReader();
      var dec = new TextDecoder();
      var buf = '';
      var acc = { text: '', done: false, error: null, status: '' };
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
          if (!data || data === '[DONE]') {
            if (data === '[DONE]') acc.done = true;
            continue;
          }
          try { applySseEvent(JSON.parse(data), acc); } catch (_) {
            acc.text += data;
          }
          if (onDelta && acc.text) onDelta(acc.text, acc);
          if (acc.error) throw new Error(acc.error);
        }
      }
      if (onDelta && acc.text) onDelta(acc.text, acc);
      return acc;
    }
    var json = await readJson(res);
    if (!res.ok) {
      var msg = (json.error && json.error.message) || json.error || json.message || ('HTTP ' + res.status);
      throw new Error(typeof msg === 'string' ? msg : ('HTTP ' + res.status));
    }
    var text = json.text || json.output || (json.message && json.message.content) || '';
    if (onDelta && text) onDelta(text);
    return { text: text, done: true, error: null, json: json };
  }

  async function createSession(opts) {
    opts = opts || {};
    var res = await occFetch(ROUTES.sessions, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        threadId: opts.threadId || opts.id || '',
        name: opts.name || 'agent'
      })
    });
    var d = await readJson(res);
    var id = sessionIdOf(d);
    if (!res.ok || !id) {
      throw new Error((d.error && d.error.message) || d.error || ('Could not open OCC session (HTTP ' + res.status + ')'));
    }
    return { id: id, name: d.name || opts.name || 'agent' };
  }

  async function ensureSession(existing, opts) {
    if (existing && existing.id) return existing;
    return createSession(opts || {});
  }

  async function sendMessage(sessionId, text, onDelta, signal) {
    var line = String(text || '');
    var res = await occFetch(ROUTES.messages(sessionId), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: line, message: line, stream: true }),
      signal: signal
    });
    return readOccStream(res, onDelta);
  }

  async function uploadFile(sessionId, file) {
    var rel = safeRelPath(file && (file.path || file.name));
    var raw = file && (file.content != null ? file.content : file.bytes);
    if (raw == null && !(file && (file.blob || file.file))) {
      throw new Error('nothing to upload for ' + rel);
    }
    var res;
    if (typeof FormData !== 'undefined' && file && (file.blob || file.file || file.form)) {
      var fd = new FormData();
      fd.append('file', file.blob || file.file || file.form, rel);
      res = await occFetch(ROUTES.files(sessionId), { method: 'POST', body: fd });
    } else {
      res = await occFetch(ROUTES.files(sessionId), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: rel,
          content: toBase64(raw),
          encoding: 'base64'
        })
      });
    }
    var d = await readJson(res);
    if (!res.ok) {
      throw new Error((d.error && d.error.message) || d.error || ('upload failed (HTTP ' + res.status + ')'));
    }
    return { ok: true, path: d.path || d.name || rel, name: rel };
  }

  async function uploadAll(sessionId, files) {
    var list = Array.isArray(files) ? files : [];
    var wrote = [];
    var i;
    for (i = 0; i < list.length; i++) {
      wrote.push(await uploadFile(sessionId, list[i]));
    }
    return wrote;
  }

  async function stop(sessionId) {
    var res = await occFetch(ROUTES.stop(sessionId), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}'
    });
    var d = await readJson(res);
    if (!res.ok) {
      throw new Error((d.error && d.error.message) || d.error || ('stop failed (HTTP ' + res.status + ')'));
    }
    return { ok: true };
  }

  return {
    DOOR: DOOR,
    ROUTES: ROUTES,
    doorUrl: doorUrl,
    sessionIdOf: sessionIdOf,
    safeRelPath: safeRelPath,
    isGoalLine: isGoalLine,
    toBase64: toBase64,
    headers: headers,
    occFetch: occFetch,
    eventText: eventText,
    applySseEvent: applySseEvent,
    readOccStream: readOccStream,
    createSession: createSession,
    ensureSession: ensureSession,
    sendMessage: sendMessage,
    uploadFile: uploadFile,
    uploadAll: uploadAll,
    stop: stop
  };
})(typeof OpenZooSub !== 'undefined' ? OpenZooSub : require('./sub.js'));

if (typeof module !== 'undefined' && module.exports) module.exports = OpenZooOcc;
