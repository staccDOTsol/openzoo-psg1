/* Hosted OCC + file upload. Subscription Bearer only.
   Not a PTY. Never ANTHROPIC_API_KEY. Chat/x402 is a different lane. */
'use strict';

var OpenZooOcc = (function (OpenZooSub) {
  var DOOR = 'https://x402-tokens.fly.dev';
  var PUBLIC_DOOR = 'https://openzoo.fun';
  var ROUTES = {
    sessions: '/v1/occ/sessions',
    session: function (id) { return '/v1/occ/sessions/' + encodeURIComponent(id); },
    messages: function (id) { return '/v1/occ/sessions/' + encodeURIComponent(id) + '/messages'; },
    goal: function (id) { return '/v1/occ/sessions/' + encodeURIComponent(id) + '/goal'; },
    files: function (id, rel) {
      var path = '/v1/occ/sessions/' + encodeURIComponent(id) + '/files';
      if (rel) path += '?path=' + encodeURIComponent(rel);
      return path;
    }
  };

  function doorUrl(path) {
    return DOOR + path;
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

  function goalText(text) {
    var m = /^\/goal\s+([\s\S]+)/i.exec(String(text || '').trim());
    return m ? m[1].trim() : '';
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

  async function occFetch(path, init) {
    init = init || {};
    var hdrs = headers(init.headers || {});
    var requestInit = {
      method: init.method || 'GET',
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

  function applySseEvent(ev, acc) {
    if (!ev || typeof ev !== 'object') return acc;
    if (ev.type === 'delta' && ev.text) acc.text += String(ev.text);
    else if (ev.type === 'done') {
      if (ev.text) acc.text = String(ev.text);
      acc.done = true;
    } else if (ev.type === 'error') {
      acc.error = String(ev.error || ev.message || 'OCC error');
    } else if (typeof ev.text === 'string' && ev.type !== 'start') {
      acc.text += ev.text;
    } else if (ev.delta && ev.delta.text) {
      acc.text += String(ev.delta.text);
    } else if (ev.choices && ev.choices[0] && ev.choices[0].delta && ev.choices[0].delta.content) {
      acc.text += String(ev.choices[0].delta.content);
    }
    return acc;
  }

  async function readOccStream(res, onDelta) {
    var ctype = (res.headers && res.headers.get && res.headers.get('content-type') || '').toLowerCase();
    if (ctype.indexOf('text/event-stream') >= 0 && res.body && res.body.getReader) {
      var reader = res.body.getReader();
      var dec = new TextDecoder();
      var buf = '';
      var acc = { text: '', done: false, error: null };
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
          try { applySseEvent(JSON.parse(data), acc); } catch (_) {
            acc.text += data;
          }
          if (onDelta && acc.text) onDelta(acc.text);
          if (acc.error) throw new Error(acc.error);
        }
      }
      if (onDelta && acc.text) onDelta(acc.text);
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
      body: JSON.stringify({ cwd: opts.cwd || '.' })
    });
    var d = await readJson(res);
    if (!res.ok || !d.id) {
      throw new Error((d.error && d.error.message) || d.error || ('Could not open OCC session (HTTP ' + res.status + ')'));
    }
    return { id: d.id, cwd: d.cwd || '.' };
  }

  async function ensureSession(existing) {
    if (existing && existing.id) return existing;
    return createSession();
  }

  async function sendMessage(sessionId, text, onDelta, signal) {
    var res = await occFetch(ROUTES.messages(sessionId), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: String(text || ''), stream: true }),
      signal: signal
    });
    return readOccStream(res, onDelta);
  }

  async function setGoal(sessionId, goal, onDelta, signal) {
    var job = String(goal || '').trim();
    if (!job) throw new Error('Usage: /goal <job>');
    var res = await occFetch(ROUTES.goal(sessionId), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ goal: job, stream: true }),
      signal: signal
    });
    return readOccStream(res, onDelta);
  }

  async function uploadFile(sessionId, file) {
    var rel = safeRelPath(file && (file.path || file.name));
    var body = file && (file.bytes != null ? file.bytes : file.content);
    if (body == null) throw new Error('nothing to upload for ' + rel);
    if (typeof body === 'string') {
      body = new TextEncoder().encode(body);
    }
    var res = await occFetch(ROUTES.files(sessionId, rel), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: body
    });
    var d = await readJson(res);
    if (!res.ok) {
      throw new Error((d.error && d.error.message) || d.error || ('upload failed (HTTP ' + res.status + ')'));
    }
    return {
      ok: true,
      path: d.path || rel,
      bytes: typeof d.bytes === 'number' ? d.bytes : (body.byteLength || body.length || 0),
      cwd: d.cwd || '.'
    };
  }

  async function listFiles(sessionId) {
    var res = await occFetch(ROUTES.files(sessionId), { method: 'GET' });
    var d = await readJson(res);
    return { cwd: d.cwd || '.', files: Array.isArray(d.files) ? d.files : [] };
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

  return {
    DOOR: DOOR,
    PUBLIC_DOOR: PUBLIC_DOOR,
    ROUTES: ROUTES,
    doorUrl: doorUrl,
    safeRelPath: safeRelPath,
    isGoalLine: isGoalLine,
    goalText: goalText,
    headers: headers,
    occFetch: occFetch,
    applySseEvent: applySseEvent,
    readOccStream: readOccStream,
    createSession: createSession,
    ensureSession: ensureSession,
    sendMessage: sendMessage,
    setGoal: setGoal,
    uploadFile: uploadFile,
    uploadAll: uploadAll,
    listFiles: listFiles
  };
})(typeof OpenZooSub !== 'undefined' ? OpenZooSub : require('./sub.js'));

if (typeof module !== 'undefined' && module.exports) module.exports = OpenZooOcc;
