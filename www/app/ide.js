/* Cloud code-server + Cline — Agent IDE.
   Origin: https://zoo.openzoo.fun
   Auth: Authorization: Bearer <subscription key> on POST/GET /api/ide/session
   Never ANTHROPIC_API_KEY. Never an open URL. Chat/x402 is a different lane. */
'use strict';

var OpenZooIde = (function (OpenZooSub) {
  var DOOR = 'https://zoo.openzoo.fun';
  var ROUTE = '/api/ide/session';
  var ALLOWED_HOSTS = {
    exact: {
      'zoo.openzoo.fun': true,
      'openzoo.fun': true
    },
    suffix: '.openzoo.fun'
  };

  function doorUrl(path) {
    return DOOR + (path || ROUTE);
  }

  function NoKeyError(message) {
    var err = new Error(message || 'No subscription key — Agent stays closed.');
    err.name = 'NoSubscriptionError';
    return err;
  }

  function OpenUrlError(message) {
    var err = new Error(message || 'Never an open URL — Agent IDE only loads a session from the door.');
    err.name = 'OpenUrlError';
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

  function hostAllowed(host) {
    var h = String(host || '').toLowerCase();
    if (!h) return false;
    if (ALLOWED_HOSTS.exact[h]) return true;
    return h.length > ALLOWED_HOSTS.suffix.length && h.slice(-ALLOWED_HOSTS.suffix.length) === ALLOWED_HOSTS.suffix;
  }

  function assertSessionUrl(raw) {
    var s = String(raw || '').trim();
    if (!s) throw OpenUrlError('IDE session had no url.');
    var u;
    try { u = new URL(s); } catch (_) { throw OpenUrlError('IDE session url was not a URL.'); }
    if (u.protocol !== 'https:') throw OpenUrlError('Never an open URL — Agent IDE must be https.');
    if (u.hostname === 'localhost' || u.hostname === '127.0.0.1' || u.hostname === '0.0.0.0' || u.hostname === '[::1]') {
      throw OpenUrlError('Never an open URL.');
    }
    if (!hostAllowed(u.hostname)) throw OpenUrlError('Never an open URL — Agent IDE host is not OpenZoo.');
    return u.toString();
  }

  function sessionOf(body) {
    if (!body || typeof body !== 'object') return { id: '', url: '', password: '' };
    return {
      id: String(body.id || body.session_id || body.sessionId || '').trim(),
      url: String(body.url || body.href || body.ideUrl || '').trim(),
      password: String(body.password || body.pass || '').trim()
    };
  }

  function publicSession(sess) {
    if (!sess) return null;
    return {
      id: sess.id || '',
      url: sess.url || '',
      hasPassword: !!sess.password
    };
  }

  function embedSrc(sess) {
    var url = assertSessionUrl(sess && sess.url);
    var password = sess && sess.password ? String(sess.password) : '';
    if (!password) return url;
    var u = new URL(url);
    if (u.searchParams.get('password') || u.searchParams.get('token') || u.searchParams.get('key')) {
      return u.toString();
    }
    u.searchParams.set('password', password);
    return u.toString();
  }

  async function ideFetch(method, init) {
    init = init || {};
    var hdrs = headers(init.headers || {});
    var requestInit = {
      method: method || 'GET',
      headers: hdrs
    };
    if (init.body != null) requestInit.body = init.body;
    if (init.signal) requestInit.signal = init.signal;
    var res = await fetch(doorUrl(ROUTE), requestInit);
    if (res.status === 401) {
      var err = NoKeyError('Agent IDE refused the key. Paste a live OpenZoo subscription Bearer.');
      err.status = 401;
      throw err;
    }
    return res;
  }

  async function readJson(res) {
    return res.json().catch(function () { return {}; });
  }

  async function parseSessionResponse(res) {
    var d = await readJson(res);
    var sess = sessionOf(d);
    if (!res.ok) {
      var msg = (d.error && d.error.message) || d.error || d.message || ('Could not open Agent IDE (HTTP ' + res.status + ')');
      var err = new Error(typeof msg === 'string' ? msg : ('HTTP ' + res.status));
      err.status = res.status;
      throw err;
    }
    sess.url = assertSessionUrl(sess.url);
    if (!sess.id) sess.id = 'ide';
    return sess;
  }

  async function getSession(signal) {
    var res = await ideFetch('GET', { signal: signal });
    return parseSessionResponse(res);
  }

  async function createSession(opts) {
    opts = opts || {};
    var res = await ideFetch('POST', {
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        threadId: opts.threadId || opts.id || '',
        name: opts.name || 'agent'
      }),
      signal: opts.signal
    });
    return parseSessionResponse(res);
  }

  async function ensureSession(existing, opts) {
    opts = opts || {};
    try {
      var got = await getSession(opts.signal);
      if (got && got.url) return got;
    } catch (e) {
      if (e && (e.name === 'NoSubscriptionError' || e.status === 401)) throw e;
      if (e && e.name === 'AbortError') throw e;
    }
    return createSession(opts);
  }

  return {
    DOOR: DOOR,
    ROUTE: ROUTE,
    doorUrl: doorUrl,
    headers: headers,
    hostAllowed: hostAllowed,
    assertSessionUrl: assertSessionUrl,
    sessionOf: sessionOf,
    publicSession: publicSession,
    embedSrc: embedSrc,
    ideFetch: ideFetch,
    getSession: getSession,
    createSession: createSession,
    ensureSession: ensureSession
  };
})(typeof OpenZooSub !== 'undefined' ? OpenZooSub : require('./sub.js'));

if (typeof module !== 'undefined' && module.exports) module.exports = OpenZooIde;
