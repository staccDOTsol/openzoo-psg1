/* OpenZoo subscription Bearer — the Agent pay lane.
   Chat stays x402/MWA. Never log the key. Never ANTHROPIC_API_KEY. */
'use strict';

var OpenZooSub = (function () {
  var STORE_KEY = 'openzoo.psg1.subscription.v1';
  var BILLING_ORIGIN = 'https://zoo.openzoo.fun';
  var SUBSCRIPTIONS_PAGE = BILLING_ORIGIN + '/subscriptions';
  var KEY_PREFIXES = ['ozk_live_', 'oz_live_', 'sk_live_', 'sk_test_'];

  function asKey(v) {
    return String(v || '').trim();
  }

  function looksLikeSubscriptionKey(key) {
    var k = asKey(key);
    if (!k || /\s/.test(k) || k.length < 16) return false;
    if (/^sk-ant-/i.test(k) || /anthropic/i.test(k)) return false;
    var i;
    for (i = 0; i < KEY_PREFIXES.length; i++) {
      if (k.indexOf(KEY_PREFIXES[i]) === 0 && k.length >= KEY_PREFIXES[i].length + 8) return true;
    }
    // Pasted secret that is not a URL and is long enough to be a key.
    return k.length >= 24 && !/^https?:\/\//i.test(k);
  }

  function maskKey(key) {
    var k = asKey(key);
    if (!k) return '';
    if (k.length <= 8) return '••••';
    return k.slice(0, 4) + '…' + k.slice(-4);
  }

  function parseSubscriptionPaste(text) {
    var raw = asKey(text);
    if (!raw) return { error: 'empty' };
    var session = '';
    try {
      if (/^https?:\/\//i.test(raw) || raw.indexOf('session=') >= 0) {
        var url = new URL(raw, BILLING_ORIGIN);
        session = url.searchParams.get('session') || url.searchParams.get('session_id') || '';
      }
    } catch (_) { /* not a URL */ }
    if (!session) {
      var m = /(?:session_id|session)=([A-Za-z0-9_]+)/.exec(raw);
      if (m) session = m[1];
    }
    if (session) return { session: session };
    if (/^https?:\/\//i.test(raw)) return { error: 'no session in URL' };
    if (!looksLikeSubscriptionKey(raw)) return { error: 'not a key' };
    return { key: raw };
  }

  var memoryStore = null;

  function storeGet() {
    try {
      if (typeof localStorage !== 'undefined') return localStorage.getItem(STORE_KEY);
    } catch (_) {}
    return memoryStore;
  }

  function storeSet(json) {
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(STORE_KEY, json);
        return;
      }
    } catch (_) {}
    memoryStore = json;
  }

  function storeClear() {
    try {
      if (typeof localStorage !== 'undefined') localStorage.removeItem(STORE_KEY);
    } catch (_) {}
    memoryStore = null;
  }

  function loadSubscription() {
    try {
      var data = JSON.parse(storeGet() || 'null');
      if (!data || !asKey(data.key)) return null;
      return {
        key: asKey(data.key),
        tier: data.tier || null,
        tierName: data.tierName || null,
        sessionId: data.sessionId || null,
        savedAt: data.savedAt || null
      };
    } catch (_) {
      return null;
    }
  }

  function saveSubscription(rec) {
    var key = asKey(rec && rec.key);
    if (!key) return null;
    var payload = {
      key: key,
      tier: rec.tier ? String(rec.tier) : null,
      tierName: rec.tierName ? String(rec.tierName) : null,
      sessionId: rec.sessionId ? String(rec.sessionId) : null,
      savedAt: Date.now()
    };
    storeSet(JSON.stringify(payload));
    return payload;
  }

  function clearSubscription() {
    storeClear();
  }

  function publicView(sub) {
    var rec = sub === undefined ? loadSubscription() : sub;
    if (!asKey(rec && rec.key)) return { active: false };
    var name = String(rec.tierName || rec.tier || '').trim();
    return {
      active: true,
      tier: rec.tier || null,
      tierName: name || null,
      label: name ? (name + ' · Agent') : 'Subscription key · Agent',
      masked: maskKey(rec.key)
    };
  }

  function authHeaders(extra) {
    var rec = loadSubscription();
    var out = {};
    var k;
    if (extra) for (k in extra) if (Object.prototype.hasOwnProperty.call(extra, k)) out[k] = extra[k];
    if (!rec || !rec.key) return out;
    out.Authorization = 'Bearer ' + rec.key;
    return out;
  }

  function requireKey() {
    var rec = loadSubscription();
    if (rec && rec.key) return rec;
    var err = new Error('Paste an OpenZoo subscription key to use Agent.');
    err.name = 'NoSubscriptionError';
    throw err;
  }

  async function fetchBillingKey(session) {
    var sid = asKey(session);
    if (!sid) return { ok: false, error: 'session required' };
    var r = await fetch(BILLING_ORIGIN + '/api/billing/key?session=' + encodeURIComponent(sid));
    var body = await r.json().catch(function () { return {}; });
    return body && typeof body === 'object' ? body : { ok: false, error: 'empty key response' };
  }

  function ingestBillingKeyResponse(body, extra) {
    extra = extra || {};
    var key = asKey(body && body.key);
    if (!key) {
      if (body && body.pending) return { ok: true, pending: true, saved: false };
      return { ok: false, pending: false, saved: false, error: (body && body.error) || 'no key yet' };
    }
    var rec = saveSubscription({
      key: key,
      tier: (body && (body.tier || body.tierName)) || extra.tier || null,
      tierName: (body && (body.tierName || body.name)) || extra.tierName || null,
      sessionId: extra.sessionId || extra.session || null
    });
    return { ok: true, pending: false, saved: true, view: publicView(rec) };
  }

  async function ingestPaste(text) {
    var parsed = parseSubscriptionPaste(text);
    if (parsed.error) return { ok: false, error: parsed.error };
    if (parsed.key) {
      var rec = saveSubscription({ key: parsed.key });
      return { ok: true, saved: true, view: publicView(rec) };
    }
    var body = await fetchBillingKey(parsed.session);
    return ingestBillingKeyResponse(body, { session: parsed.session });
  }

  return {
    STORE_KEY: STORE_KEY,
    BILLING_ORIGIN: BILLING_ORIGIN,
    SUBSCRIPTIONS_PAGE: SUBSCRIPTIONS_PAGE,
    KEY_PREFIXES: KEY_PREFIXES,
    asKey: asKey,
    looksLikeSubscriptionKey: looksLikeSubscriptionKey,
    maskKey: maskKey,
    parseSubscriptionPaste: parseSubscriptionPaste,
    loadSubscription: loadSubscription,
    saveSubscription: saveSubscription,
    clearSubscription: clearSubscription,
    publicView: publicView,
    authHeaders: authHeaders,
    requireKey: requireKey,
    fetchBillingKey: fetchBillingKey,
    ingestBillingKeyResponse: ingestBillingKeyResponse,
    ingestPaste: ingestPaste
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = OpenZooSub;
