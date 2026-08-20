'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const OpenZooSpill = require('../www/app/spill.js');
const OpenZooPay = require('../www/app/pay.js');

const ROOT = path.join(__dirname, '..');
const app = fs.readFileSync(path.join(ROOT, 'www/app/app.js'), 'utf8');
const html = fs.readFileSync(path.join(ROOT, 'www/app/index.html'), 'utf8');
const pay = fs.readFileSync(path.join(ROOT, 'www/app/pay.js'), 'utf8');

function thread(n) {
  const msgs = [];
  for (let i = 0; i < n; i++) {
    msgs.push({ role: i % 2 === 0 ? 'user' : 'assistant', content: 'turn ' + i });
  }
  return msgs;
}

test('outgoing chat never pairs x-hrr-context with the full long thread', () => {
  const msgs = thread(131);
  const none = OpenZooSpill.outgoingChat(msgs, null);
  assert.equal(none.contextId, null);
  assert.equal(none.messages.length, 131);

  const spilled = OpenZooSpill.outgoingChat(msgs, 'ctx_01abc');
  assert.equal(spilled.contextId, 'ctx_01abc');
  assert.equal(spilled.messages.length, OpenZooSpill.KEEP_TAIL);
  assert.equal(spilled.messages.length, 3);
  assert.equal(spilled.messages[0].content, 'turn 128');
  assert.equal(spilled.messages[2].content, 'turn 130');
  assert.equal(OpenZooSpill.sendsFullThreadWithContext(spilled.messages, spilled.contextId), false);
  assert.equal(OpenZooSpill.sendsFullThreadWithContext(msgs, 'ctx_01abc'), true);
});

test('first turns send the short thread without a context header', () => {
  const first = OpenZooSpill.outgoingChat(thread(1), null);
  assert.equal(first.contextId, null);
  assert.equal(first.messages.length, 1);

  const fileBound = OpenZooSpill.outgoingChat(thread(1), 'ctx_files');
  assert.equal(fileBound.contextId, 'ctx_files');
  assert.equal(fileBound.messages.length, 1);
});

test('prefix bind covers history before the tail, then only the delta', () => {
  const first = OpenZooSpill.prefixRange(131, 0);
  assert.deepEqual(first, { from: 0, to: 128 });
  const next = OpenZooSpill.prefixRange(133, 128);
  assert.deepEqual(next, { from: 128, to: 130 });
  assert.deepEqual(OpenZooSpill.prefixRange(3, 0), { from: 0, to: 0 });
  const corpus = OpenZooSpill.formatHistory(
    [{ role: 'user', content: 'hi' }, { role: 'assistant', content: 'yo' }],
    'zoo'
  );
  assert.equal(corpus, 'you: hi\nzoo: yo');
});

test('HUD savings is directUsd/spentUsd, never a sum of savesVsDirect', () => {
  assert.equal(OpenZooSpill.hudSavingX(0.21, 0.03), 7);
  assert.equal(OpenZooSpill.hudSavingX(0.10, 0.10), 1);
  assert.equal(OpenZooSpill.hudSavingX(0, 0.03), null);

  const t = { spent: 0, direct: 0, calls: 0 };
  OpenZooSpill.applyReceipt(t, { billedUsd: 0.02, directUsd: 0.10 });
  OpenZooSpill.applyReceipt(t, { billedUsd: 0.03, savesVsDirect: 8 });
  assert.equal(t.calls, 2);
  assert.equal(t.spent, 0.05);
  assert.equal(t.direct, 0.10 + 8 * 0.03);
  assert.equal(t.saved, undefined);
  const x = OpenZooSpill.hudSavingX(t.direct, t.spent);
  assert.ok(x > 1);
  assert.notEqual(x, 8);
  assert.notEqual(x, 8 + 5);
});

test('paidFetch strips x-hrr-context when the body is the full thread', () => {
  const long = {
    'Content-Type': 'application/json',
    'x-hrr-context': 'ctx_nope'
  };
  const stripped = OpenZooPay.stripContextIfFullThread(
    long,
    '/v1/chat/completions',
    JSON.stringify({ model: 'x', messages: thread(20) })
  );
  assert.equal(stripped['x-hrr-context'], undefined);

  const tail = OpenZooPay.stripContextIfFullThread(
    { 'x-hrr-context': 'ctx_ok' },
    '/v1/chat/completions',
    JSON.stringify({ model: 'x', messages: thread(3) })
  );
  assert.equal(tail['x-hrr-context'], 'ctx_ok');
});

test('app wires spill before chat and keeps the x402 pay path', () => {
  assert.match(html, /src="spill\.js"/);
  assert.match(app, /OpenZooSpill\.outgoingChat/);
  assert.match(app, /OpenZooSpill\.applyReceipt/);
  assert.match(app, /payHooks\(\{ contextId: plan\.contextId \}\)/);
  assert.match(app, /messages: plan\.messages/);
  assert.match(app, /hudSavingX/);
  assert.doesNotMatch(app, /t\.saved \+=/);
  assert.doesNotMatch(app, /savesVsDirect > 0/);
  assert.doesNotMatch(app, /messages:\s*t\.messages/);
  assert.doesNotMatch(app, /SPAWN|worktree/i);
  assert.match(app, /OpenZooPay\.paidFetch\('\/v1\/chat\/completions'/);
  assert.match(pay, /X-PAYMENT/);
  assert.match(pay, /signViaBridge/);
  assert.match(pay, /https:\/\/x402-tokens\.fly\.dev/);
});
