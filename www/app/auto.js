/* OpenZoo Auto — virtual model id for sidecar / gateway routing.
   Clients send model: "openzoo/auto". The gateway classifier picks the
   real model. This module does not classify, shortlist, or pick a catalog id. */
'use strict';

var OpenZooAuto = (function () {
  var AUTO_MODEL = 'openzoo/auto';
  var AUTO_LABEL = 'Auto';

  function isAuto(id) {
    if (id == null) return true;
    var s = String(id).trim();
    return !s || s === AUTO_MODEL;
  }

  function sendModel(id) {
    return isAuto(id) ? AUTO_MODEL : String(id).trim();
  }

  function isPinned(id) {
    return !isAuto(id);
  }

  function catalogWithAuto(models) {
    var rest = (models || []).filter(function (m) {
      return m && m.id && m.id !== AUTO_MODEL;
    });
    return [{ id: AUTO_MODEL }].concat(rest);
  }

  function labelFor(id) {
    if (isAuto(id)) return AUTO_LABEL;
    var s = String(id);
    return s.replace(/^[^/]+\//, '');
  }

  function animalFor(id) {
    if (isAuto(id)) return '🎯';
    if (!id) return '🐾';
    if (id.indexOf('anthropic') === 0) return '🦒';
    if (id.indexOf('openai') === 0) return '🦉';
    if (id.indexOf('deepseek') === 0) return '🐋';
    if (id.indexOf('x-ai') === 0) return '🦊';
    if (id.indexOf('google') === 0) return '🐦';
    if (id.indexOf('meta') === 0) return '🦙';
    if (id.indexOf('mistral') === 0) return '🐈';
    if (id.indexOf('qwen') === 0) return '🐼';
    if (id.indexOf('openzoo') === 0) return '🦓';
    return '🐾';
  }

  function pickerLabel(id) {
    return animalFor(id) + ' ' + labelFor(id);
  }

  function looksLikeDump(value) {
    if (value == null) return true;
    if (typeof value === 'object') return true;
    var s = String(value).trim();
    if (!s) return true;
    if (s.charAt(0) === '{' || s.charAt(0) === '[') return true;
    if (s.length > 96) return true;
    if (/\s/.test(s) || s.indexOf('\n') >= 0) return true;
    return false;
  }

  function compactModelId(value) {
    if (looksLikeDump(value)) return '';
    var s = String(value).trim();
    if (s === AUTO_MODEL) return '';
    return s;
  }

  function compactRoutedModel(payload) {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return '';
    var x = payload.x402 && typeof payload.x402 === 'object' ? payload.x402 : {};
    var candidates = [
      payload.model,
      payload.routed_model,
      payload.routedModel,
      x.model,
      x.routed,
      x.routedModel,
      x.routed_model
    ];
    var i;
    for (i = 0; i < candidates.length; i++) {
      var id = compactModelId(candidates[i]);
      if (id) return id;
    }
    return '';
  }

  function displayRouted(payload, requested) {
    var routed = compactRoutedModel(payload);
    if (routed) return routed;
    if (isPinned(requested)) return compactModelId(requested);
    return '';
  }

  function reasoningMaxTokens(model) {
    var id = sendModel(model);
    if (isAuto(id)) return 16384;
    return /deepseek|grok|thinking|fable|sonnet-5|-r1|reason/i.test(id) ? 16384 : 4096;
  }

  return {
    AUTO_MODEL: AUTO_MODEL,
    AUTO_LABEL: AUTO_LABEL,
    isAuto: isAuto,
    isPinned: isPinned,
    sendModel: sendModel,
    catalogWithAuto: catalogWithAuto,
    labelFor: labelFor,
    animalFor: animalFor,
    pickerLabel: pickerLabel,
    compactModelId: compactModelId,
    compactRoutedModel: compactRoutedModel,
    displayRouted: displayRouted,
    reasoningMaxTokens: reasoningMaxTokens
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = OpenZooAuto;
