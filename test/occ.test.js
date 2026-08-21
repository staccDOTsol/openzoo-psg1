'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const OpenZooSub = require('../www/app/sub.js');
const OpenZooOcc = require('../www/app/occ.js');

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
  const key = 'ozk_live_testhostedocckey99';
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

test('hosted OCC refuses every call without a Bearer key', async () => {
  OpenZooSub.clearSubscription();
  await assert.rejects(() => OpenZooOcc.createSession(), { name: 'NoSubscriptionError' });
  await assert.rejects(() => OpenZooOcc.sendMessage('s1', 'hi'), { name: 'NoSubscriptionError' });
  await assert.rejects(() => OpenZooOcc.setGoal('s1', 'ship it'), { name: 'NoSubscriptionError' });
  await assert.rejects(() => OpenZooOcc.uploadFile('s1', { name: 'a.txt', content: 'x' }), { name: 'NoSubscriptionError' });
});

test('OCC routes, /goal, upload-to-cwd, and stream; 401 is no Agent', async () => {
  OpenZooSub.saveSubscription({ key: 'ozk_live_testhostedocckey99' });
  const hits = [];
  const prev = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    hits.push({ url: String(url), method: init.method, headers: init.headers, body: init.body });
    const u = String(url);
    if (u.endsWith('/v1/occ/sessions') && init.method === 'POST') {
      return jsonRes(200, { id: 'occ-1', cwd: '.' });
    }
    if (u.indexOf('/v1/occ/sessions/occ-1/files?path=notes.txt') >= 0) {
      return jsonRes(200, { ok: true, path: 'notes.txt', bytes: 4, cwd: '.' });
    }
    if (u.indexOf('/v1/occ/sessions/occ-1/goal') >= 0) {
      return jsonRes(200, { text: 'goal accepted: ship the work', output: 'goal accepted: ship the work' });
    }
    if (u.indexOf('/v1/occ/sessions/occ-1/messages') >= 0) {
      return jsonRes(200, { text: 'hello from hosted OCC' });
    }
    if (u.indexOf('/v1/occ/sessions/blocked') >= 0) {
      return jsonRes(401, { error: 'unauthorized' });
    }
    return jsonRes(404, { error: 'not found' });
  };
  try {
    const sess = await OpenZooOcc.createSession();
    assert.equal(sess.id, 'occ-1');
    assert.match(hits[0].url, /https:\/\/x402-tokens\.fly\.dev\/v1\/occ\/sessions$/);
    assert.equal(hits[0].headers.Authorization, 'Bearer ozk_live_testhostedocckey99');

    const wrote = await OpenZooOcc.uploadFile(sess.id, { name: '../notes.txt', content: 'hey\n' });
    assert.equal(wrote.path, 'notes.txt');
    assert.match(hits[1].url, /files\?path=notes\.txt/);
    assert.equal(hits[1].method, 'PUT');

    assert.equal(OpenZooOcc.isGoalLine('/goal ship the work'), true);
    assert.equal(OpenZooOcc.goalText('/goal ship the work'), 'ship the work');
    const goal = await OpenZooOcc.setGoal(sess.id, OpenZooOcc.goalText('/goal ship the work'));
    assert.match(goal.text, /goal accepted/);
    assert.match(hits[2].url, /\/goal$/);

    const msg = await OpenZooOcc.sendMessage(sess.id, 'hi');
    assert.equal(msg.text, 'hello from hosted OCC');
    assert.match(hits[3].url, /\/messages$/);

    await assert.rejects(() => OpenZooOcc.sendMessage('blocked', 'hi'), { name: 'NoSubscriptionError' });
    assert.equal(OpenZooOcc.safeRelPath('../../etc/passwd'), 'etc/passwd');
    assert.doesNotMatch(JSON.stringify(OpenZooOcc.ROUTES), /ANTHROPIC/);
    assert.equal(OpenZooOcc.PUBLIC_DOOR, 'https://openzoo.fun');
  } finally {
    globalThis.fetch = prev;
    OpenZooSub.clearSubscription();
  }
});

test('SSE delta stream paints text', async () => {
  const chunks = [
    'data: {"type":"delta","text":"hel"}\n',
    'data: {"type":"delta","text":"lo"}\n',
    'data: {"type":"done"}\n'
  ];
  let i = 0;
  const res = {
    ok: true,
    status: 200,
    headers: { get: () => 'text/event-stream' },
    body: {
      getReader: () => ({
        read: async () => {
          if (i >= chunks.length) return { done: true, value: undefined };
          const enc = new TextEncoder().encode(chunks[i++]);
          return { done: false, value: enc };
        }
      })
    },
    json: async () => ({})
  };
  const painted = [];
  const got = await OpenZooOcc.readOccStream(res, function (full) { painted.push(full); });
  assert.equal(got.text, 'hello');
  assert.ok(painted.indexOf('hello') >= 0);
});

test('x402 pay path is still the chat Authorization placeholder, not the OCC key', () => {
  const fs = require('fs');
  const path = require('path');
  const pay = fs.readFileSync(path.join(__dirname, '../www/app/pay.js'), 'utf8');
  const occ = fs.readFileSync(path.join(__dirname, '../www/app/occ.js'), 'utf8');
  assert.match(pay, /Bearer openzoo-psg1/);
  assert.match(pay, /X-PAYMENT/);
  assert.match(pay, /\/v1\/pay\/build/);
  assert.doesNotMatch(occ, /X-PAYMENT/);
  assert.doesNotMatch(occ, /ANTHROPIC_API_KEY\s*=/);
  assert.doesNotMatch(occ, /https:\/\/api\.anthropic\.com/);
});
