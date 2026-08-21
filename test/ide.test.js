'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const OpenZooSub = require('../www/app/sub.js');
const OpenZooIde = require('../www/app/ide.js');

function jsonRes(status, body, headers) {
  const h = headers || { 'content-type': 'application/json' };
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (k) => h[String(k).toLowerCase()] || h[k] || '' },
    json: async () => body,
    text: async () => JSON.stringify(body),
    body: null
  };
}

test('subscription paste accepts a key and never echoes it in publicView', () => {
  OpenZooSub.clearSubscription();
  assert.equal(OpenZooSub.publicView().active, false);
  assert.equal(OpenZooSub.parseSubscriptionPaste('').error, 'empty');
  assert.equal(OpenZooSub.parseSubscriptionPaste('https://zoo.openzoo.fun/subscriptions').error, 'no session in URL');
  const parsed = OpenZooSub.parseSubscriptionPaste('https://zoo.openzoo.fun/billing/done?session=cs_test_abc');
  assert.equal(parsed.session, 'cs_test_abc');
  const key = 'ozk_live_testagentidekey99';
  const saved = OpenZooSub.saveSubscription({ key: key, tierName: 'Pro' });
  assert.equal(saved.key, key);
  const view = OpenZooSub.publicView();
  assert.equal(view.active, true);
  assert.ok(view.masked.indexOf(key) < 0);
  assert.ok(JSON.stringify(view).indexOf(key) < 0);
  const hdrs = OpenZooSub.authHeaders({ 'Content-Type': 'application/json' });
  assert.equal(hdrs.Authorization, 'Bearer ' + key);
  OpenZooSub.clearSubscription();
  assert.equal(OpenZooSub.publicView().active, false);
});

test('looksLikeSubscriptionKey rejects junk and Anthropic-shaped leftovers', () => {
  assert.equal(OpenZooSub.looksLikeSubscriptionKey('sk-ant-api03-not-ours'), false);
  assert.equal(OpenZooSub.looksLikeSubscriptionKey('short'), false);
  assert.equal(OpenZooSub.looksLikeSubscriptionKey('ozk_live_abcd1234efgh'), true);
});

test('Agent IDE refuses every /ide/session call without a Bearer key', async () => {
  OpenZooSub.clearSubscription();
  await assert.rejects(() => OpenZooIde.getSession(), { name: 'NoSubscriptionError' });
  await assert.rejects(() => OpenZooIde.createSession({ threadId: 't1', name: 'n' }), { name: 'NoSubscriptionError' });
  await assert.rejects(() => OpenZooIde.ensureSession(null, { threadId: 't1' }), { name: 'NoSubscriptionError' });
});

test('IDE door is zoo.openzoo.fun /ide/session — no /occ, no /v1/ide', () => {
  const src = fs.readFileSync(path.join(__dirname, '../www/app/ide.js'), 'utf8');
  assert.match(src, /https:\/\/zoo\.openzoo\.fun/);
  assert.match(src, /\/ide\/session/);
  assert.doesNotMatch(src, /\/occ\//);
  assert.doesNotMatch(src, /\/v1\/ide/);
  assert.doesNotMatch(src, /\/api\/ide/);
  assert.doesNotMatch(src, /x402-tokens\.fly\.dev/);
  assert.doesNotMatch(src, /ANTHROPIC_API_KEY\s*=/);
  assert.doesNotMatch(src, /https:\/\/api\.anthropic\.com/);
  assert.equal(OpenZooIde.DOOR, 'https://zoo.openzoo.fun');
  assert.equal(OpenZooIde.ROUTE, '/ide/session');
  assert.equal(OpenZooIde.doorUrl(), 'https://zoo.openzoo.fun/ide/session');
});

test('POST/GET /ide/session return { url, password?, id }; 401 is no Agent', async () => {
  OpenZooSub.saveSubscription({ key: 'ozk_live_testagentidekey99' });
  const hits = [];
  const prev = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    hits.push({ url: String(url), method: init.method, headers: init.headers, body: init.body });
    const u = String(url);
    assert.equal(u, 'https://zoo.openzoo.fun/ide/session');
    if (init.method === 'GET') {
      return jsonRes(200, {
        id: 'ide-1',
        url: 'https://cs-1.openzoo.fun/?folder=/home/coder',
        password: 'sess-pass'
      });
    }
    if (init.method === 'POST') {
      const body = JSON.parse(init.body);
      return jsonRes(200, {
        session_id: 'ide-2',
        url: 'https://zoo.openzoo.fun/ide/ide-2',
        password: 'created-pass'
      });
    }
    if (init.headers && String(init.headers.Authorization || '').indexOf('blocked') >= 0) {
      return jsonRes(401, { error: 'unauthorized' });
    }
    return jsonRes(404, { error: 'not found' });
  };
  try {
    const got = await OpenZooIde.getSession();
    assert.equal(got.id, 'ide-1');
    assert.equal(got.url, 'https://cs-1.openzoo.fun/?folder=/home/coder');
    assert.equal(got.password, 'sess-pass');
    assert.equal(hits[0].method, 'GET');
    assert.equal(hits[0].headers.Authorization, 'Bearer ozk_live_testagentidekey99');
    assert.doesNotMatch(JSON.stringify(OpenZooIde.publicSession(got)), /sess-pass/);

    const created = await OpenZooIde.createSession({ threadId: 't-1', name: 'ship' });
    assert.equal(created.id, 'ide-2');
    assert.equal(hits[1].method, 'POST');
    assert.deepEqual(JSON.parse(hits[1].body), { threadId: 't-1', name: 'ship' });
    assert.equal(created.url, 'https://zoo.openzoo.fun/ide/ide-2');

    const src = OpenZooIde.embedSrc(got);
    assert.match(src, /password=sess-pass/);
    assert.match(src, /^https:\/\/cs-1\.openzoo\.fun\//);

    OpenZooSub.clearSubscription();
    OpenZooSub.saveSubscription({ key: 'ozk_live_blockedkeyzzzz' });
    globalThis.fetch = async (url, init) => {
      hits.push({ url: String(url), method: init.method, headers: init.headers });
      return jsonRes(401, { error: 'unauthorized' });
    };
    await assert.rejects(() => OpenZooIde.getSession(), { name: 'NoSubscriptionError' });
  } finally {
    globalThis.fetch = prev;
    OpenZooSub.clearSubscription();
  }
});

test('ensureSession GETs first and POSTs if GET is not a live session', async () => {
  OpenZooSub.saveSubscription({ key: 'ozk_live_testagentidekey99' });
  const hits = [];
  const prev = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    hits.push(init.method);
    if (init.method === 'GET') return jsonRes(404, { error: 'none' });
    return jsonRes(200, { id: 'ide-new', url: 'https://zoo.openzoo.fun/ide/fresh' });
  };
  try {
    const sess = await OpenZooIde.ensureSession(null, { threadId: 't', name: 'n' });
    assert.deepEqual(hits, ['GET', 'POST']);
    assert.equal(sess.id, 'ide-new');
    assert.equal(sess.url, 'https://zoo.openzoo.fun/ide/fresh');
  } finally {
    globalThis.fetch = prev;
    OpenZooSub.clearSubscription();
  }
});

test('never an open URL — reject http, off-host, and empty session urls', () => {
  assert.equal(OpenZooIde.hostAllowed('zoo.openzoo.fun'), true);
  assert.equal(OpenZooIde.hostAllowed('cs-9.openzoo.fun'), true);
  assert.equal(OpenZooIde.hostAllowed('example.com'), false);
  assert.equal(OpenZooIde.hostAllowed('localhost'), false);
  assert.throws(() => OpenZooIde.assertSessionUrl(''), { name: 'OpenUrlError' });
  assert.throws(() => OpenZooIde.assertSessionUrl('http://zoo.openzoo.fun/ide'), { name: 'OpenUrlError' });
  assert.throws(() => OpenZooIde.assertSessionUrl('https://example.com/ide'), { name: 'OpenUrlError' });
  assert.throws(() => OpenZooIde.assertSessionUrl('https://localhost/ide'), { name: 'OpenUrlError' });
  assert.equal(
    OpenZooIde.assertSessionUrl('https://zoo.openzoo.fun/ide/abc'),
    'https://zoo.openzoo.fun/ide/abc'
  );
  assert.throws(
    () => OpenZooIde.embedSrc({ url: 'https://evil.example/open', password: 'x' }),
    { name: 'OpenUrlError' }
  );
});

test('x402 pay path is still the chat Authorization placeholder, not the Agent key', () => {
  const pay = fs.readFileSync(path.join(__dirname, '../www/app/pay.js'), 'utf8');
  const ide = fs.readFileSync(path.join(__dirname, '../www/app/ide.js'), 'utf8');
  const app = fs.readFileSync(path.join(__dirname, '../www/app/app.js'), 'utf8');
  assert.match(pay, /Bearer openzoo-psg1/);
  assert.match(pay, /X-PAYMENT/);
  assert.match(pay, /\/v1\/pay\/build/);
  assert.doesNotMatch(ide, /X-PAYMENT/);
  assert.doesNotMatch(ide, /ANTHROPIC_API_KEY\s*=/);
  assert.doesNotMatch(ide, /https:\/\/api\.anthropic\.com/);
  assert.match(app, /OpenZooPay\.paidFetch/);
  assert.match(app, /OpenZooIde\.ensureSession/);
  assert.match(app, /\/ide\/session|openAgentIde|agentFrame/);
  assert.doesNotMatch(app, /OpenZooOcc/);
});
