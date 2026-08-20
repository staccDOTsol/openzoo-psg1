/* Chat-history spill — same contract as `npx openzoo claude`.
   Bind the transcript prefix, then POST a short tail + x-hrr-context.
   Never send that header with the full growing messages array.
   History only. No SPAWN, no worktrees, no tool-file binding. */
'use strict';

var OpenZooSpill = (function () {
  /** Claude CLI + openzoo proxy forwards ~3 of a long thread. */
  var KEEP_TAIL = 3;

  function keepTail() {
    return KEEP_TAIL;
  }

  function formatHistory(messages, name) {
    var who = name || 'openzoo';
    return (messages || []).map(function (h) {
      return (h.role === 'user' ? 'you' : who) + ': ' + (h.content || '');
    }).join('\n');
  }

  /**
   * Prefix that can be bound before this call. Tail stays in the POST.
   * `boundCount` is how many leading messages are already on the context.
   */
  function prefixRange(messageCount, boundCount, tail) {
    var keep = tail == null ? KEEP_TAIL : tail;
    var n = Number(messageCount) || 0;
    var from = Math.max(0, Number(boundCount) || 0);
    var cut = Math.max(0, n - keep);
    if (cut <= from) return { from: from, to: from };
    return { from: from, to: cut };
  }

  /**
   * What /v1/chat/completions should receive.
   * contextId set  → messages is a short tail, never the full long thread.
   * contextId empty → messages is the whole thread and the header stays off.
   */
  function outgoingChat(messages, contextId) {
    var list = Array.isArray(messages) ? messages : [];
    if (!contextId) {
      return { messages: list.slice(), contextId: null };
    }
    var tail = list.length > KEEP_TAIL ? list.slice(-KEEP_TAIL) : list.slice();
    return { messages: tail, contextId: contextId };
  }

  function sendsFullThreadWithContext(messages, contextId) {
    if (!contextId) return false;
    var list = Array.isArray(messages) ? messages : [];
    return list.length > KEEP_TAIL;
  }

  /**
   * HUD savings is the session multiple: sum(directUsd) / sum(spentUsd).
   * Never sum per-call savesVsDirect (that value is already a multiple).
   */
  function hudSavingX(directUsd, spentUsd) {
    var spent = Number(spentUsd);
    var direct = Number(directUsd);
    if (!(spent > 0) || !Number.isFinite(direct) || direct <= 0) return null;
    return Number((direct / spent).toFixed(4));
  }

  /** Reconstruct this-call direct dollars. savesVsDirect is a ratio, not $. */
  function receiptDirectUsd(x) {
    x = x || {};
    if (typeof x.directUsd === 'number' && Number.isFinite(x.directUsd)) return x.directUsd;
    if (typeof x.savesVsDirect === 'number' && typeof x.billedUsd === 'number') {
      return x.savesVsDirect * x.billedUsd;
    }
    return null;
  }

  function applyReceipt(thread, x) {
    x = x || {};
    thread.calls = (thread.calls || 0) + 1;
    if (typeof x.billedUsd === 'number') {
      thread.spent = (thread.spent || 0) + x.billedUsd;
    }
    var direct = receiptDirectUsd(x);
    if (direct != null) thread.direct = (thread.direct || 0) + direct;
    return hudSavingX(thread.direct, thread.spent);
  }

  return {
    KEEP_TAIL: KEEP_TAIL,
    keepTail: keepTail,
    formatHistory: formatHistory,
    prefixRange: prefixRange,
    outgoingChat: outgoingChat,
    sendsFullThreadWithContext: sendsFullThreadWithContext,
    hudSavingX: hudSavingX,
    receiptDirectUsd: receiptDirectUsd,
    applyReceipt: applyReceipt
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = OpenZooSpill;
