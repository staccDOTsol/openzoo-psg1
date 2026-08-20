/* First-X-back race — same policy as grokui, phone-local chat only.
   Launch Y from the selected band. First X countable answers are judged by a
   cheap classifier. Empty / HTTP / pay / fetch-failed do not count. All-fail
   never ships one model's fetch-failed as the winner. Do not wait on the slowest. */
'use strict';

var OpenZooRace = (function () {
  var RACE_MAX = 4;
  var RACE_MIN_SCORE = 6;
  var DEFAULT_NEED = 2;
  var DEFAULT_N = 4;
  var JUDGE_MODEL = 'deepseek/deepseek-v4-flash';
  var RACE_EVERY_FAILED = '(race: every model failed — no reply)';

  var TIERS = {
    cheap: [
      'deepseek/deepseek-v4-flash',
      'meta-llama/llama-4-scout',
      'z-ai/glm-4.7-flash',
      'bytedance-seed/seed-2.0-mini',
      'meta-llama/llama-4-maverick',
      'z-ai/glm-4.5-air',
      'minimax/minimax-m2.5',
      'z-ai/glm-4.6v',
      'minimax/minimax-m2',
      'inclusionai/ling-3.0-flash'
    ],
    medium: [
      'deepseek/deepseek-v4-pro-0813',
      'z-ai/glm-4.7',
      'google/gemini-3.7-flash',
      'x-ai/grok-4.3',
      'moonshotai/kimi-k2.7-code',
      'z-ai/glm-5',
      'moonshotai/kimi-k2.6',
      'mistralai/mistral-large-2512',
      'bytedance-seed/seed-2.0-code',
      'qwen/qwen3.8-27b'
    ],
    expensive: [
      'anthropic/claude-opus-5',
      'openai/gpt-5.5',
      'anthropic/claude-sonnet-5',
      'x-ai/grok-4.6',
      'moonshotai/kimi-k3',
      'anthropic/claude-opus-4.8',
      'openai/gpt-5.4',
      'qwen/qwen3.8-max',
      'x-ai/grok-4.5'
    ],
    'grok4.6': [
      'x-ai/grok-4.6',
      'x-ai/grok-4.5',
      'x-ai/grok-4.3',
      'x-ai/grok-4.20'
    ]
  };
  var TIER_NAMES = ['cheap', 'medium', 'expensive', 'grok4.6'];

  var RACE_HTTP_NOTE = /^\((?:upstream error|request failed|payment failed|rate limited|stream timed out|stream stalled)/i;
  var RACE_MODEL_FAILED = /^\([^)]+ (?:failed:|returned nothing)/i;
  var RACE_FETCH_FAILED = /^(?:typeerror:\s*)?fetch failed$/i;

  function formatRaceStatus(back, need) {
    var n = Math.max(1, Number(need) || 1);
    var b = Math.min(n, Math.max(0, Number(back) || 0));
    return 'racing ' + b + '/' + n + ' back…';
  }

  function isRaceCountable(textOrArrival) {
    var arrival = textOrArrival && typeof textOrArrival === 'object' && !Array.isArray(textOrArrival)
      ? textOrArrival
      : { text: textOrArrival };
    if (arrival.error) return false;
    var s = String(arrival.text || '').trim();
    if (!s) return false;
    if (RACE_FETCH_FAILED.test(s)) return false;
    if (RACE_HTTP_NOTE.test(s)) return false;
    if (RACE_MODEL_FAILED.test(s)) return false;
    return true;
  }

  function raceLastShip(arrivals) {
    var list = Array.isArray(arrivals) ? arrivals : [];
    var i;
    for (i = list.length - 1; i >= 0; i--) {
      if (isRaceCountable(list[i])) {
        return { model: list[i].model, text: String(list[i].text) };
      }
    }
    return { model: '', text: RACE_EVERY_FAILED, error: true };
  }

  function raceFailKind(arrival) {
    var err = String((arrival && arrival.error) || '');
    var text = String((arrival && arrival.text) || '').trim();
    var s = (err + ' ' + text).trim();
    if (!s) return 'empty body';
    if (/timeout|STREAM_IDLE|aborted|AbortError/i.test(s)) return 'timeout';
    if (/402|payment failed/i.test(s)) return 'pay';
    if (/fetch failed/i.test(s)) return 'fetch failed';
    var http = /HTTP\s+(\d{3})/i.exec(s);
    if (http) return 'HTTP ' + http[1];
    if (err) return 'error';
    if (!isRaceCountable(arrival)) return 'empty body';
    return 'ok';
  }

  function shouldRetryRaceArrival(arrival) {
    if (isRaceCountable(arrival)) return false;
    var k = raceFailKind(arrival);
    return k === 'fetch failed' || k === 'timeout' || k === 'empty body'
      || k === 'error' || /^HTTP 5/.test(k) || k === 'HTTP 000';
  }

  function parseClassifyScore(text) {
    var s = String(text || '');
    var tagged = /SCORE\s*[:=]?\s*(-?\d+(?:\.\d+)?)/i.exec(s);
    var lone = tagged || /\b(10|[0-9])(?:\s*\/\s*10)?\b/.exec(s);
    if (!lone) return 0;
    var n = Number(lone[1]);
    if (!isFinite(n)) return 0;
    return Math.max(0, Math.min(10, n));
  }

  function pickRaceWinner(cands, minScore) {
    var bar = minScore == null ? RACE_MIN_SCORE : minScore;
    var list = Array.isArray(cands) ? cands.filter(Boolean) : [];
    if (!list.length) return { winner: null, reason: 'empty', tied: [] };
    var passing = list.filter(function (c) { return (Number(c.score) || 0) >= bar; });
    if (!passing.length) {
      return { winner: list[list.length - 1], reason: 'fallback-last', tied: [] };
    }
    var max = -Infinity;
    var i;
    for (i = 0; i < passing.length; i++) {
      var sc = Number(passing[i].score) || 0;
      if (sc > max) max = sc;
    }
    var tied = passing.filter(function (c) { return (Number(c.score) || 0) === max; });
    if (tied.length === 1) return { winner: tied[0], reason: 'score', tied: tied };
    return { winner: null, reason: 'tie', tied: tied };
  }

  function createRaceFeed(onDelta, onStatus, need) {
    var live = null;
    var settled = false;
    var back = 0;
    var buf = {};
    var dead = {};
    function paintStatus() {
      if (onStatus) onStatus(formatRaceStatus(back, need));
    }
    return {
      start: function () { paintStatus(); },
      liveModel: function () { return live; },
      onToken: function (model, chunk) {
        if (settled || chunk == null || chunk === '') return;
        buf[model] = (buf[model] || '') + chunk;
        if (!live) {
          live = model;
          if (onDelta) onDelta(chunk, { model: model });
          return;
        }
        if (live === model && onDelta) onDelta(chunk, { model: model });
      },
      onFail: function (model) {
        dead[model] = true;
        if (settled || live !== model) return;
        var next = null;
        var m;
        for (m in buf) {
          if (Object.prototype.hasOwnProperty.call(buf, m) && m !== model && buf[m] && !dead[m]) {
            next = m;
            break;
          }
        }
        if (next) {
          live = next;
          if (onDelta) onDelta(buf[next], { replace: true, model: live });
        } else {
          live = null;
        }
      },
      onBack: function () {
        if (settled || back >= need) return;
        back += 1;
        paintStatus();
      },
      settle: function (winner) {
        settled = true;
        var text = winner && String(winner.text || '').trim()
          ? winner.text
          : RACE_EVERY_FAILED;
        if (winner && winner.model && live === winner.model && !winner.error) return;
        live = (winner && winner.model) || live;
        if (onDelta) onDelta(text, { replace: true, model: winner && winner.model });
      }
    };
  }

  function parseDial(value) {
    var raw = String(value == null ? '' : value).trim();
    if (!raw || raw === '0' || raw === 'off') return { n: 0, need: 1 };
    var parts = raw.split(/\s+/).map(Number).filter(function (x) { return isFinite(x) && x > 0; });
    if (!parts.length) return { n: DEFAULT_N, need: DEFAULT_NEED };
    var a = parts[0];
    var b = parts.length > 1 ? parts[1] : 0;
    var n;
    var need;
    if (parts.length === 1) {
      n = Math.min(RACE_MAX, Math.max(0, a));
      need = 1;
    } else {
      n = Math.max(a, b);
      need = Math.min(a, b);
      n = Math.min(RACE_MAX, n);
      need = Math.max(1, Math.min(need, n));
    }
    if (n < 2) return { n: 0, need: 1 };
    return { n: n, need: need };
  }

  function formatDial(n, need) {
    var plan = typeof n === 'object' && n ? n : { n: n, need: need };
    var count = Number(plan.n) || 0;
    var k = Number(plan.need) || 1;
    if (count < 2) return '0';
    if (k > 1) return k + ' ' + count;
    return String(count);
  }

  function defaultDial() {
    return { n: DEFAULT_N, need: DEFAULT_NEED };
  }

  function normalizeTier(tier) {
    return TIERS[tier] ? tier : 'medium';
  }

  function shuffle(list) {
    var a = list.slice();
    var i;
    for (i = a.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var tmp = a[i];
      a[i] = a[j];
      a[j] = tmp;
    }
    return a;
  }

  function servedSet(catalog) {
    if (!catalog) return null;
    if (catalog instanceof Set) return catalog.size ? catalog : null;
    if (Array.isArray(catalog)) {
      var set = {};
      var i;
      var n = 0;
      for (i = 0; i < catalog.length; i++) {
        if (catalog[i]) {
          set[catalog[i]] = true;
          n++;
        }
      }
      return n ? set : null;
    }
    return null;
  }

  function inCatalog(ids, id) {
    if (!ids) return true;
    if (ids instanceof Set) return ids.has(id);
    return !!ids[id];
  }

  function tierPool(tier, catalog) {
    var want = TIERS[normalizeTier(tier)] || TIERS.medium;
    var ids = servedSet(catalog);
    if (!ids) return want.slice();
    var live = want.filter(function (m) { return inCatalog(ids, m); });
    return live.length ? live : want.slice();
  }

  function tierModels(tier, n, random, catalog) {
    var pool = tierPool(tier, catalog);
    var take = Math.max(1, Math.min(Number(n) || 1, pool.length, RACE_MAX));
    if (!random) return pool.slice(0, take);
    return shuffle(pool).slice(0, take);
  }

  function judgeModel(catalog) {
    var cheap = tierPool('cheap', catalog);
    var i;
    for (i = 0; i < cheap.length; i++) {
      if (cheap[i] === JUDGE_MODEL) return JUDGE_MODEL;
    }
    return cheap[0] || JUDGE_MODEL;
  }

  function raceQuestion(messages) {
    var list = Array.isArray(messages) ? messages : [];
    var i;
    for (i = list.length - 1; i >= 0; i--) {
      if (list[i] && list[i].role === 'user') {
        return typeof list[i].content === 'string' ? list[i].content : '(see candidates)';
      }
    }
    return '(see candidates)';
  }

  function classifyPrompt(messages, cand) {
    return 'Score this answer to one question from 0 to 10.\n\n'
      + 'QUESTION:\n' + String(raceQuestion(messages)).slice(0, 4000) + '\n\n'
      + 'ANSWER:\n' + String((cand && cand.text) || '').slice(0, 6000) + '\n\n'
      + 'Judge on: correctness first, then completeness, then whether it actually did what was asked. '
      + 'Ignore length and confidence of tone.\n'
      + 'Reply with exactly: SCORE <n>';
  }

  function pairwisePrompt(messages, tied) {
    var letters = tied.map(function (_, i) { return String.fromCharCode(65 + i); });
    return 'You are judging answers to one question. Pick the single best one.\n\n'
      + 'QUESTION:\n' + String(raceQuestion(messages)).slice(0, 4000) + '\n\n'
      + tied.map(function (c, i) {
        return 'ANSWER ' + letters[i] + ':\n' + String(c.text || '').slice(0, 6000);
      }).join('\n\n')
      + '\n\nJudge on: correctness first, then completeness, then whether it actually did what was asked. '
      + 'Ignore length and confidence of tone.\n'
      + 'Reply with ONE letter and nothing else: ' + letters.join(' or ') + '.';
  }

  function pickTiedLetter(verdict, tied) {
    var hit = String(verdict || '').toUpperCase().split('').filter(function (ch) {
      var n = ch.charCodeAt(0) - 65;
      return n >= 0 && n < tied.length;
    })[0];
    if (hit) return tied[hit.charCodeAt(0) - 65];
    return tied[tied.length - 1];
  }

  function aborted(signal) {
    return !!(signal && signal.aborted);
  }

  async function brainRace(messages, onDelta, contextId, models, need, maxTokens, onStatus, hooks) {
    hooks = hooks || {};
    var stream = hooks.stream;
    var classify = hooks.classify;
    var pairwise = hooks.pairwise;
    var minScore = hooks.minScore != null ? Number(hooks.minScore) : RACE_MIN_SCORE;
    var list = (models || []).filter(Boolean).slice(0, RACE_MAX);
    if (list.length < 2) {
      if (!list.length) {
        var empty = raceLastShip([]);
        if (onDelta) onDelta(empty.text, { replace: true });
        return empty.text;
      }
      return stream(messages, onDelta, contextId, list[0], maxTokens);
    }
    var want = Math.max(1, Math.min(Number(need) || 1, list.length));
    var feed = createRaceFeed(onDelta, onStatus, want);
    feed.start();

    var done = [];
    var arrivals = [];
    var finished = 0;
    var release;
    var enough = new Promise(function (r) { release = r; });
    var raceAbort = typeof AbortController === 'function' ? new AbortController() : null;
    if (hooks.signal && raceAbort) {
      if (hooks.signal.aborted) raceAbort.abort();
      else hooks.signal.addEventListener('abort', function () { raceAbort.abort(); }, { once: true });
    }
    var signal = raceAbort ? raceAbort.signal : hooks.signal;

    function ship(cand) {
      var out = cand && String(cand.text || '').trim() ? cand : raceLastShip(arrivals);
      feed.settle(out);
      try { if (raceAbort) raceAbort.abort(); } catch (_) {}
      return out.text;
    }

    async function runOne(m) {
      var last = { model: m, text: '', error: 'empty body' };
      var attempt;
      for (attempt = 0; attempt < 2; attempt++) {
        if (aborted(signal) && attempt > 0) break;
        try {
          var text = await stream(messages, function (chunk) {
            feed.onToken(m, chunk);
          }, contextId, m, maxTokens, 0, 0, undefined, signal);
          last = { model: m, text: text == null ? '' : String(text) };
          if (isRaceCountable(last)) {
            arrivals.push(last);
            done.push(last);
            feed.onBack();
            return;
          }
        } catch (e) {
          last = { model: m, text: '', error: (e && e.message) || 'error' };
        }
        if (!shouldRetryRaceArrival(last) || attempt === 1 || aborted(signal)) break;
      }
      arrivals.push(last);
      feed.onFail(m);
    }

    var attempts = list.map(function (m) {
      return Promise.resolve().then(function () { return runOne(m); }).finally(function () {
        finished += 1;
        if (done.length >= want || finished === list.length) release();
      });
    });
    attempts.forEach(function (p) { p.catch(function () {}); });

    await enough;
    var cands = done.slice(0, want);
    if (!cands.length) return ship(raceLastShip(arrivals));
    if (cands.length === 1) return ship(cands[0]);

    if (onStatus) onStatus('judging…');
    var scored = await Promise.all(cands.map(async function (c) {
      var score = 0;
      try { score = Number(await classify(messages, c)) || 0; } catch (_) { score = 0; }
      return { model: c.model, text: c.text, score: score };
    }));

    var picked = pickRaceWinner(scored, minScore);
    if (picked.reason === 'tie' && picked.tied.length > 1) {
      var broken = null;
      try { broken = await pairwise(messages, picked.tied); } catch (_) { broken = null; }
      var usable = broken && String(broken.text || '').trim();
      picked = {
        winner: usable ? broken : picked.tied[picked.tied.length - 1],
        reason: 'tiebreak',
        tied: picked.tied
      };
    }
    return ship(picked.winner || scored[scored.length - 1] || raceLastShip(arrivals));
  }

  function createPayQueue() {
    var tail = Promise.resolve();
    return function enqueue(fn) {
      var run = tail.then(fn, fn);
      tail = run.then(function () {}, function () {});
      return run;
    };
  }

  return {
    TIERS: TIERS,
    TIER_NAMES: TIER_NAMES,
    RACE_MAX: RACE_MAX,
    RACE_MIN_SCORE: RACE_MIN_SCORE,
    DEFAULT_NEED: DEFAULT_NEED,
    DEFAULT_N: DEFAULT_N,
    JUDGE_MODEL: JUDGE_MODEL,
    RACE_EVERY_FAILED: RACE_EVERY_FAILED,
    formatRaceStatus: formatRaceStatus,
    isRaceCountable: isRaceCountable,
    raceLastShip: raceLastShip,
    raceFailKind: raceFailKind,
    shouldRetryRaceArrival: shouldRetryRaceArrival,
    parseClassifyScore: parseClassifyScore,
    pickRaceWinner: pickRaceWinner,
    createRaceFeed: createRaceFeed,
    parseDial: parseDial,
    formatDial: formatDial,
    defaultDial: defaultDial,
    normalizeTier: normalizeTier,
    tierPool: tierPool,
    tierModels: tierModels,
    judgeModel: judgeModel,
    raceQuestion: raceQuestion,
    classifyPrompt: classifyPrompt,
    pairwisePrompt: pairwisePrompt,
    pickTiedLetter: pickTiedLetter,
    brainRace: brainRace,
    createPayQueue: createPayQueue
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = OpenZooRace;
