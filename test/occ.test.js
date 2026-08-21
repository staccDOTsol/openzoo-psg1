'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

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
  await assert.rejects(() => OpenZooOcc.createSession({ threadId: 't1', name: 'n' }), { name: 'NoSubscriptionError' });
  await assert.rejects(() => OpenZooOcc.sendMessage('s1', 'hi'), { name: 'NoSubscriptionError' });
  await assert.rejects(() => OpenZooOcc.uploadFile('s1', { name: 'a.txt', content: 'x' }), { name: 'NoSubscriptionError' });
  await assert.rejects(() => OpenZooOcc.stop('s1'), { name: 'NoSubscriptionError' });
});

test('OCC door is zoo.openzoo.fun /occ/* — no /v1/occ or /api/occ', async () => {
  const src = fs.readFileSync(path.join(__dirname, '../www/app/occ.js'), 'utf8');
  assert.match(src, /https:\/\/zoo\.openzoo\.fun/);
  assert.doesNotMatch(src, /\/v1\/occ/);
  assert.doesNotMatch(src, /\/api\/occ/);
  assert.doesNotMatch(src, /x402-tokens\.fly\.dev/);
  assert.doesNotMatch(src, /ANTHROPIC_API_KEY\s*=/);
  assert.doesNotMatch(src, /https:\/\/api\.anthropic\.com/);
  assert.equal(OpenZooOcc.DOOR, 'https://zoo.openzoo.fun');
  assert.equal(OpenZooOcc.ROUTES.sessions, '/occ/sessions');
  assert.equal(OpenZooOcc.ROUTES.messages('occ-1'), '/occ/sessions/occ-1/messages');
  assert.equal(OpenZooOcc.ROUTES.files('occ-1'), '/occ/sessions/occ-1/files');
  assert.equal(OpenZooOcc.ROUTES.stop('occ-1'), '/occ/sessions/occ-1/stop');
});

test('OCC sessions, messages, /goal-as-text, upload, stop; 401 is no Agent', async () => {
  OpenZooSub.saveSubscription({ key: 'ozk_live_testhostedocckey99' });
  const hits = [];
  const prev = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    hits.push({ url: String(url), method: init.method, headers: init.headers, body: init.body });
    const u = String(url);
    if (u === 'https://zoo.openzoo.fun/occ/sessions' && init.method === 'POST') {
      return jsonRes(200, { session_id: 'occ-1', name: 'agent' });
    }
    if (u === 'https://zoo.openzoo.fun/occ/sessions/occ-1/files' && init.method === 'POST') {
      return jsonRes(200, { ok: true, path: 'notes.txt' });
    }
    if (u === 'https://zoo.openzoo.fun/occ/sessions/occ-1/messages' && init.method === 'POST') {
      const body = JSON.parse(init.body);
      return jsonRes(200, { text: body.text === '/goal ship the work' ? 'goal accepted: ship the work' : 'hello from hosted OCC' });
    }
    if (u === 'https://zoo.openzoo.fun/occ/sessions/occ-1/stop' && init.method === 'POST') {
      return jsonRes(200, { ok: true });
    }
    if (u.indexOf('/occ/sessions/blocked') >= 0) {
      return jsonRes(401, { error: 'unauthorized' });
    }
    return jsonRes(404, { error: 'not found' });
  };
  try {
    const sess = await OpenZooOcc.createSession({ threadId: 't-1', name: 'ship' });
    assert.equal(sess.id, 'occ-1');
    assert.equal(hits[0].url, 'https://zoo.openzoo.fun/occ/sessions');
    assert.equal(hits[0].headers.Authorization, 'Bearer ozk_live_testhostedocckey99');
    assert.deepEqual(JSON.parse(hits[0].body), { threadId: 't-1', name: 'ship' });
    assert.equal(OpenZooOcc.sessionIdOf({ session_id: 'occ-1' }), 'occ-1');
    assert.equal(OpenZooOcc.sessionIdOf({ id: 'occ-1' }), 'occ-1');

    const wrote = await OpenZooOcc.uploadFile(sess.id, { name: '../notes.txt', content: 'hey\n' });
    assert.equal(wrote.path, 'notes.txt');
    assert.equal(hits[1].url, 'https://zoo.openzoo.fun/occ/sessions/occ-1/files');
    assert.equal(hits[1].method, 'POST');
    const fileBody = JSON.parse(hits[1].body);
    assert.equal(fileBody.name, 'notes.txt');
    assert.equal(fileBody.encoding, 'base64');
    assert.equal(fileBody.content, OpenZooOcc.toBase64('hey\n'));

    assert.equal(OpenZooOcc.isGoalLine('/goal ship the work'), true);
    const goal = await OpenZooOcc.sendMessage(sess.id, '/goal ship the work');
    assert.match(goal.text, /goal accepted/);
    assert.equal(hits[2].url, 'https://zoo.openzoo.fun/occ/sessions/occ-1/messages');
    assert.deepEqual(JSON.parse(hits[2].body), {
      text: '/goal ship the work',
      message: '/goal ship the work',
      stream: true
    });

    const msg = await OpenZooOcc.sendMessage(sess.id, 'hi');
    assert.equal(msg.text, 'hello from hosted OCC');
    assert.deepEqual(JSON.parse(hits[3].body), { text: 'hi', message: 'hi', stream: true });

    const stopped = await OpenZooOcc.stop(sess.id);
    assert.equal(stopped.ok, true);
    assert.equal(hits[4].url, 'https://zoo.openzoo.fun/occ/sessions/occ-1/stop');
    assert.equal(hits[4].method, 'POST');

    await assert.rejects(() => OpenZooOcc.sendMessage('blocked', 'hi'), { name: 'NoSubscriptionError' });
    assert.equal(OpenZooOcc.safeRelPath('../../etc/passwd'), 'etc/passwd');
    assert.doesNotMatch(JSON.stringify(OpenZooOcc.ROUTES), /ANTHROPIC/);
    for (const hit of hits) {
      assert.doesNotMatch(hit.url, /\/v1\/occ|\/api\/occ/);
    }
  } finally {
    globalThis.fetch = prev;
    OpenZooSub.clearSubscription();
  }
});

test('SSE paints delta/text/output and OpenAI-style choices; status/pty stay silent', async () => {
  const chunks = [
    'data: {"type":"status","text":"thinking"}\n',
    'data: {"type":"pty","output":"\\u001b[0m"}\n',
    'data: {"type":"delta","text":"hel"}\n',
    'data: {"type":"text","text":"lo"}\n',
    'data: {"type":"output","output":" "}\n',
    'data: {"choices":[{"delta":{"content":"world"}}]}\n',
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
  assert.equal(got.text, 'hello world');
  assert.ok(painted.indexOf('hello world') >= 0);
  assert.doesNotMatch(got.text, /thinking/);
});

test('SSE error type throws', async () => {
  const chunks = [
    'data: {"type":"error","error":"OCC exploded"}\n'
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
  await assert.rejects(() => OpenZooOcc.readOccStream(res), /OCC exploded/);
});

test('x402 pay path is still the chat Authorization placeholder, not the OCC key', () => {
  const pay = fs.readFileSync(path.join(__dirname, '../www/app/pay.js'), 'utf8');
  const occ = fs.readFileSync(path.join(__dirname, '../www/app/occ.js'), 'utf8');
  const app = fs.readFileSync(path.join(__dirname, '../www/app/app.js'), 'utf8');
  assert.match(pay, /Bearer openzoo-psg1/);
  assert.match(pay, /X-PAYMENT/);
  assert.match(pay, /\/v1\/pay\/build/);
  assert.doesNotMatch(occ, /X-PAYMENT/);
  assert.doesNotMatch(occ, /ANTHROPIC_API_KEY\s*=/);
  assert.doesNotMatch(occ, /https:\/\/api\.anthropic\.com/);
  assert.match(app, /OpenZooPay\.paidFetch/);
  assert.doesNotMatch(app, /OpenZooOcc\.setGoal/);
});
