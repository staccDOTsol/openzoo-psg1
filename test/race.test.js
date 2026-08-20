'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const OpenZooRace = require('../www/app/race.js');

const ROOT = path.join(__dirname, '..');
const app = fs.readFileSync(path.join(ROOT, 'www/app/app.js'), 'utf8');
const html = fs.readFileSync(path.join(ROOT, 'www/app/index.html'), 'utf8');
const pay = fs.readFileSync(path.join(ROOT, 'www/app/pay.js'), 'utf8');
const raceSrc = fs.readFileSync(path.join(ROOT, 'www/app/race.js'), 'utf8');

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function scriptedStream(spec) {
  return async function stream(_messages, onDelta, _ctx, model) {
    const s = spec[model];
    if (!s) throw new Error('unexpected model ' + model);
    if (s.err) {
      await sleep(s.at || 0);
      throw s.err;
    }
    const chunks = s.chunks || (s.text ? [s.text] : []);
    const start = Date.now();
    const tokenAt = s.tokenAt != null ? s.tokenAt : Math.max(0, (s.at || 0) - 20);
    await sleep(tokenAt);
    for (const c of chunks) onDelta(c);
    const left = Math.max(0, (s.at || 0) - (Date.now() - start));
    await sleep(left);
    return s.empty ? '' : (s.text ?? chunks.join(''));
  };
}

test('default dial is first 2 of 4 and grok4.6 is a band', () => {
  assert.deepEqual(OpenZooRace.defaultDial(), { n: 4, need: 2 });
  assert.deepEqual(OpenZooRace.parseDial('2 4'), { n: 4, need: 2 });
  assert.deepEqual(OpenZooRace.parseDial('0'), { n: 0, need: 1 });
  assert.equal(OpenZooRace.formatDial(4, 2), '2 4');
  assert.deepEqual(OpenZooRace.TIER_NAMES, ['cheap', 'medium', 'expensive', 'grok4.6']);
  assert.deepEqual(OpenZooRace.TIERS['grok4.6'], [
    'x-ai/grok-4.6',
    'x-ai/grok-4.5',
    'x-ai/grok-4.3',
    'x-ai/grok-4.20'
  ]);
  const band = OpenZooRace.tierModels('grok4.6', 4, false);
  assert.equal(band.length, 4);
  assert.ok(band.every((id) => id.indexOf('x-ai/grok-4.') === 0));
});

test('empty / HTTP / pay / fetch-failed are not countable', () => {
  assert.equal(OpenZooRace.isRaceCountable(''), false);
  assert.equal(OpenZooRace.isRaceCountable('fetch failed'), false);
  assert.equal(OpenZooRace.isRaceCountable('TypeError: fetch failed'), false);
  assert.equal(OpenZooRace.isRaceCountable({ text: 'ok', error: 'fetch failed' }), false);
  assert.equal(OpenZooRace.isRaceCountable('(upstream error — HTTP 503, try again)'), false);
  assert.equal(OpenZooRace.isRaceCountable('(payment failed)'), false);
  assert.equal(OpenZooRace.isRaceCountable({ text: '', error: 'HTTP 502' }), false);
  assert.equal(OpenZooRace.isRaceCountable('a real answer'), true);
});

test('all-fail never ships a single model fetch-failed as the winner', () => {
  const ship = OpenZooRace.raceLastShip([
    { model: 'mistralai/mistral-large-2512', text: '', error: 'fetch failed' },
    { model: 'bytedance-seed/seed-2.0-code', text: 'fetch failed' }
  ]);
  assert.equal(ship.text, OpenZooRace.RACE_EVERY_FAILED);
  assert.equal(ship.error, true);
  assert.doesNotMatch(ship.text, /mistral|seed-2.0|failed: fetch failed/);
});

test('race forwards onDelta before a winner exists', async () => {
  let resolved = false;
  const deltas = [];
  const p = OpenZooRace.brainRace(
    [{ role: 'user', content: 'q' }],
    (d) => { if (!resolved && d) deltas.push(d); },
    null,
    ['fast', 'slow'],
    2,
    undefined,
    () => {},
    {
      stream: scriptedStream({
        fast: { chunks: ['Hel', 'lo'], text: 'Hello', at: 40, tokenAt: 5 },
        slow: { chunks: ['Bye'], text: 'Bye', at: 80, tokenAt: 60 }
      }),
      classify: async (_m, c) => (c.model === 'slow' ? 9 : 3)
    }
  );
  await sleep(20);
  assert.ok(deltas.length > 0, 'tokens must land before both racers finish');
  assert.ok(deltas.join('').includes('Hel'));
  const text = await p;
  resolved = true;
  assert.equal(text, 'Bye');
});

test('status updates as racers finish: racing n/X back…', async () => {
  const statuses = [];
  await OpenZooRace.brainRace(
    [{ role: 'user', content: 'q' }],
    () => {},
    null,
    ['a', 'b', 'c'],
    2,
    undefined,
    (s) => statuses.push(s),
    {
      stream: scriptedStream({
        a: { text: 'one', at: 15 },
        b: { text: 'two', at: 35 },
        c: { text: 'three', at: 200 }
      }),
      classify: async (_m, c) => (c.model === 'b' ? 9 : 7)
    }
  );
  assert.ok(statuses.includes('racing 0/2 back…'));
  assert.ok(statuses.includes('racing 1/2 back…'));
  assert.ok(statuses.includes('racing 2/2 back…'));
  assert.equal(statuses.filter((s) => s === 'racing 3/2 back…').length, 0);
});

test('best 2 of 4: first two real answers are judged; a slow 4th does not enter', async () => {
  const classified = [];
  let lateStarted = false;
  const t0 = Date.now();
  const text = await OpenZooRace.brainRace(
    [{ role: 'user', content: 'q' }],
    () => {},
    null,
    ['empty', 'a', 'b', 'late'],
    2,
    undefined,
    () => {},
    {
      stream: async (_messages, onDelta, _ctx, model) => {
        if (model === 'empty') {
          await sleep(5);
          return '';
        }
        if (model === 'a') {
          await sleep(15);
          onDelta('first');
          return 'first';
        }
        if (model === 'b') {
          await sleep(30);
          onDelta('second');
          return 'second';
        }
        lateStarted = true;
        await sleep(250);
        onDelta('third');
        return 'third-should-not-win';
      },
      classify: async (_m, c) => {
        classified.push(c.model);
        return c.model === 'b' ? 9 : 8;
      }
    }
  );
  assert.deepEqual(classified.slice().sort(), ['a', 'b']);
  assert.equal(text, 'second');
  assert.ok(lateStarted, 'the 4th is still launched');
  assert.ok(Date.now() - t0 < 150, 'must ship when X are in, not wait for N');
});

test('a low-score first-back does not win just by being fast', async () => {
  const text = await OpenZooRace.brainRace(
    [{ role: 'user', content: 'q' }],
    () => {},
    null,
    ['fast', 'good'],
    2,
    undefined,
    () => {},
    {
      stream: scriptedStream({
        fast: { text: 'meh', at: 10 },
        good: { text: 'solid', at: 25 }
      }),
      classify: async (_m, c) => (c.model === 'fast' ? 2 : 9)
    }
  );
  assert.equal(text, 'solid');
});

test('zero-pass classifier still ships the last of the X', async () => {
  const classified = [];
  const text = await OpenZooRace.brainRace(
    [{ role: 'user', content: 'q' }],
    () => {},
    null,
    ['a', 'b', 'c'],
    2,
    undefined,
    () => {},
    {
      stream: scriptedStream({
        a: { text: 'first-back', at: 10 },
        b: { text: 'last-of-x', at: 25 },
        c: { text: 'late-high', at: 200 }
      }),
      classify: async (_m, c) => {
        classified.push(c.text);
        return 1;
      },
      minScore: 6
    }
  );
  assert.deepEqual(classified.slice().sort(), ['first-back', 'last-of-x']);
  assert.equal(text, 'last-of-x');
});

test('if X never fills, one race-level error — not the last model name', async () => {
  const deltas = [];
  const text = await OpenZooRace.brainRace(
    [{ role: 'user', content: 'q' }],
    (d, meta) => deltas.push({ d, meta }),
    null,
    ['boom', 'blank', 'last'],
    2,
    undefined,
    () => {},
    {
      stream: scriptedStream({
        boom: { err: new Error('HTTP 502'), at: 5 },
        blank: { empty: true, text: '', at: 15 },
        last: { text: '(upstream error — HTTP 503, try again)', at: 30 }
      }),
      classify: async () => { throw new Error('classify must not run when X never fills'); }
    }
  );
  assert.equal(text, '(race: every model failed — no reply)');
  assert.doesNotMatch(text, /boom|blank|last failed|HTTP 503/);
  assert.ok(deltas.some((x) => String(x.d).includes('every model failed')));
});

test('fetch-failed racer is dropped; two real answers still classify', async () => {
  const classified = [];
  const text = await OpenZooRace.brainRace(
    [{ role: 'user', content: 'q' }],
    () => {},
    null,
    [
      'mistralai/mistral-large-2512',
      'bytedance-seed/seed-2.0-code',
      'deepseek/deepseek-v4-pro-0813',
      'z-ai/glm-4.7'
    ],
    2,
    undefined,
    () => {},
    {
      stream: scriptedStream({
        'mistralai/mistral-large-2512': {
          err: Object.assign(new TypeError('fetch failed'), { name: 'TypeError' }),
          at: 5
        },
        'bytedance-seed/seed-2.0-code': { text: 'real-seed-answer', at: 25 },
        'deepseek/deepseek-v4-pro-0813': { text: 'real-deepseek-answer', at: 40 },
        'z-ai/glm-4.7': { text: 'late-should-not-enter', at: 200 }
      }),
      classify: async (_m, c) => {
        classified.push(c.text);
        return c.text === 'real-deepseek-answer' ? 9 : 7;
      }
    }
  );
  assert.equal(text, 'real-deepseek-answer');
  assert.doesNotMatch(text, /failed: fetch failed/);
  assert.doesNotMatch(text, /mistral-large-2512|seed-2.0-code failed/);
  assert.deepEqual(classified.slice().sort(), ['real-deepseek-answer', 'real-seed-answer']);
});

test('resolved fetch-failed text is not countable toward X', async () => {
  const classified = [];
  const text = await OpenZooRace.brainRace(
    [{ role: 'user', content: 'q' }],
    () => {},
    null,
    [
      'mistralai/mistral-large-2512',
      'bytedance-seed/seed-2.0-code',
      'deepseek/deepseek-v4-pro-0813',
      'z-ai/glm-4.7'
    ],
    2,
    undefined,
    () => {},
    {
      stream: scriptedStream({
        'mistralai/mistral-large-2512': { text: 'fetch failed', at: 5 },
        'bytedance-seed/seed-2.0-code': { empty: true, text: '', at: 8 },
        'deepseek/deepseek-v4-pro-0813': { text: 'ok-one', at: 25 },
        'z-ai/glm-4.7': { text: 'ok-two', at: 40 }
      }),
      classify: async (_m, c) => {
        classified.push(c.text);
        return c.text === 'ok-two' ? 9 : 7;
      }
    }
  );
  assert.equal(text, 'ok-two');
  assert.doesNotMatch(text, /failed: fetch failed|fetch failed/);
  assert.deepEqual(classified.slice().sort(), ['ok-one', 'ok-two']);
});

test('every racer fetch-failed → race-level failure, not a model name', async () => {
  const text = await OpenZooRace.brainRace(
    [{ role: 'user', content: 'q' }],
    () => {},
    null,
    [
      'mistralai/mistral-large-2512',
      'bytedance-seed/seed-2.0-code',
      'deepseek/deepseek-v4-pro-0813',
      'z-ai/glm-4.7'
    ],
    2,
    undefined,
    () => {},
    {
      stream: scriptedStream({
        'mistralai/mistral-large-2512': { err: new TypeError('fetch failed'), at: 4 },
        'bytedance-seed/seed-2.0-code': { err: new TypeError('fetch failed'), at: 8 },
        'deepseek/deepseek-v4-pro-0813': { err: new TypeError('fetch failed'), at: 12 },
        'z-ai/glm-4.7': { err: new TypeError('fetch failed'), at: 16 }
      }),
      classify: async () => { throw new Error('classify must not run when every racer failed'); }
    }
  );
  assert.equal(text, '(race: every model failed — no reply)');
  assert.doesNotMatch(text, /mistral-large-2512|seed-2.0-code|deepseek|glm-4\.7/);
  assert.doesNotMatch(text, /failed: fetch failed/);
});

test('malformed judge / equally bad scores ship the last finished candidate', async () => {
  const text = await OpenZooRace.brainRace(
    [{ role: 'user', content: 'q' }],
    () => {},
    null,
    ['a', 'b'],
    2,
    undefined,
    () => {},
    {
      stream: scriptedStream({
        a: { text: 'first', at: 10 },
        b: { text: 'last-finished', at: 25 }
      }),
      classify: async () => 8,
      pairwise: async () => ({ text: '' })
    }
  );
  assert.equal(text, 'last-finished');
});

test('empty/5xx/pay do not count toward X', async () => {
  const classified = [];
  const text = await OpenZooRace.brainRace(
    [{ role: 'user', content: 'q' }],
    () => {},
    null,
    ['boom', 'blank', 'pay', 'real1', 'real2'],
    2,
    undefined,
    () => {},
    {
      stream: scriptedStream({
        boom: { err: new Error('5xx'), at: 5 },
        blank: { empty: true, text: '', at: 8 },
        pay: { err: new Error('payment failed'), at: 9 },
        real1: { text: 'ok-one', at: 20 },
        real2: { text: 'ok-two', at: 35 }
      }),
      classify: async (_m, c) => {
        classified.push(c.text);
        return c.text === 'ok-two' ? 9 : 7;
      }
    }
  );
  assert.deepEqual(classified.slice().sort(), ['ok-one', 'ok-two']);
  assert.equal(text, 'ok-two');
});

test('fetch-failed racer is retried once and can still fill X', async () => {
  const tries = {};
  const classified = [];
  const text = await OpenZooRace.brainRace(
    [{ role: 'user', content: 'q' }],
    () => {},
    null,
    ['flaky', 'good'],
    2,
    undefined,
    () => {},
    {
      stream: async (_messages, onDelta, _ctx, model) => {
        tries[model] = (tries[model] || 0) + 1;
        if (model === 'flaky' && tries[model] === 1) {
          await sleep(5);
          throw new TypeError('fetch failed');
        }
        await sleep(10);
        onDelta(model + '-ok');
        return model + '-ok';
      },
      classify: async (_m, c) => {
        classified.push(c.model);
        return c.model === 'flaky' ? 9 : 7;
      }
    }
  );
  assert.equal(tries.flaky, 2);
  assert.equal(tries.good, 1);
  assert.equal(text, 'flaky-ok');
  assert.deepEqual(classified.slice().sort(), ['flaky', 'good']);
});

test('createRaceFeed streams the live model and swaps once if someone else wins', () => {
  const deltas = [];
  const statuses = [];
  const feed = OpenZooRace.createRaceFeed(
    (d, meta) => deltas.push({ d, meta }),
    (s) => statuses.push(s),
    2
  );
  feed.start();
  feed.onToken('a', 'Hel');
  feed.onToken('a', 'lo');
  feed.onToken('b', 'Bye');
  feed.onBack();
  feed.onBack();
  feed.settle({ model: 'b', text: 'Bye' });
  assert.ok(statuses.includes('racing 0/2 back…'));
  assert.ok(statuses.includes('racing 2/2 back…'));
  assert.equal(deltas[0].d, 'Hel');
  assert.equal(deltas[1].d, 'lo');
  assert.ok(deltas.some((x) => x.meta && x.meta.replace && x.d === 'Bye'));
});

test('app wires race dial + live status and keeps the x402 pay path', () => {
  assert.match(html, /src="race\.js"/);
  assert.match(html, /id="raceSel"/);
  assert.match(html, /id="tierSel"/);
  assert.match(html, /best 2 of 4/);
  assert.match(html, /grok4\.6/);
  assert.match(app, /OpenZooRace\.brainRace/);
  assert.match(app, /formatRaceStatus|racing /);
  assert.match(app, /tierModels/);
  assert.match(app, /OpenZooPay\.paidFetch\('\/v1\/chat\/completions'/);
  assert.match(app, /readSseOrJson/);
  assert.match(app, /payHooks\(\{ contextId: plan\.contextId \}\)/);
  assert.match(pay, /X-PAYMENT/);
  assert.match(pay, /signViaBridge/);
  assert.match(pay, /https:\/\/x402-tokens\.fly\.dev/);
  assert.doesNotMatch(app, /SPAWN|worktree|podagent/i);
  assert.doesNotMatch(raceSrc, /SPAWN|worktree|podagent/i);
  assert.doesNotMatch(raceSrc, /wallet\.json|secret|privateKey/i);
});
