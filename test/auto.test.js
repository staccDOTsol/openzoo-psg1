'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const OpenZooAuto = require('../www/app/auto.js');

const ROOT = path.join(__dirname, '..');
const app = fs.readFileSync(path.join(ROOT, 'www/app/app.js'), 'utf8');
const html = fs.readFileSync(path.join(ROOT, 'www/app/index.html'), 'utf8');
const autoSrc = fs.readFileSync(path.join(ROOT, 'www/app/auto.js'), 'utf8');
const pay = fs.readFileSync(path.join(ROOT, 'www/app/pay.js'), 'utf8');
const shell = fs.readFileSync(path.join(ROOT, 'www/index.html'), 'utf8');

test('empty / missing / Auto all send openzoo/auto', () => {
  assert.equal(OpenZooAuto.AUTO_MODEL, 'openzoo/auto');
  assert.equal(OpenZooAuto.sendModel(null), 'openzoo/auto');
  assert.equal(OpenZooAuto.sendModel(undefined), 'openzoo/auto');
  assert.equal(OpenZooAuto.sendModel(''), 'openzoo/auto');
  assert.equal(OpenZooAuto.sendModel('openzoo/auto'), 'openzoo/auto');
  assert.equal(OpenZooAuto.sendModel('  openzoo/auto  '), 'openzoo/auto');
  assert.equal(OpenZooAuto.isAuto(null), true);
  assert.equal(OpenZooAuto.isAuto(''), true);
  assert.equal(OpenZooAuto.isAuto('openzoo/auto'), true);
  assert.equal(OpenZooAuto.isPinned('openzoo/auto'), false);
});

test('picker can pin a real catalog model', () => {
  assert.equal(OpenZooAuto.sendModel('google/gemini-3.7-flash'), 'google/gemini-3.7-flash');
  assert.equal(OpenZooAuto.sendModel('x-ai/grok-4.6'), 'x-ai/grok-4.6');
  assert.equal(OpenZooAuto.isPinned('deepseek/deepseek-v4-pro-0813'), true);
  assert.equal(OpenZooAuto.isAuto('deepseek/deepseek-v4-pro-0813'), false);
});

test('catalog always leads with Auto and does not duplicate it', () => {
  const withAuto = OpenZooAuto.catalogWithAuto([
    { id: 'openzoo/auto' },
    { id: 'google/gemini-3.7-flash' },
    { id: '~hidden' }
  ]);
  assert.equal(withAuto[0].id, 'openzoo/auto');
  assert.equal(withAuto.filter((m) => m.id === 'openzoo/auto').length, 1);
  assert.ok(withAuto.some((m) => m.id === 'google/gemini-3.7-flash'));
  assert.equal(OpenZooAuto.pickerLabel('openzoo/auto'), '🎯 Auto');
});

test('routed model is a compact id from the response, never invented', () => {
  assert.equal(OpenZooAuto.compactRoutedModel({ model: 'deepseek/deepseek-v4-flash' }), 'deepseek/deepseek-v4-flash');
  assert.equal(OpenZooAuto.compactRoutedModel({ model: 'openzoo/auto' }), '');
  assert.equal(OpenZooAuto.compactRoutedModel({ x402: { model: 'x-ai/grok-4.6' } }), 'x-ai/grok-4.6');
  assert.equal(OpenZooAuto.compactRoutedModel({ model: { id: 'google/gemini-3.7-flash' } }), '');
  assert.equal(OpenZooAuto.compactRoutedModel({ model: JSON.stringify({ model: 'x-ai/grok-4.6' }) }), '');
  assert.equal(OpenZooAuto.displayRouted({ model: 'openzoo/auto' }, 'openzoo/auto'), '');
  assert.equal(OpenZooAuto.displayRouted({}, 'openzoo/auto'), '');
  assert.equal(OpenZooAuto.displayRouted({ model: 'x-ai/grok-4.3' }, 'openzoo/auto'), 'x-ai/grok-4.3');
  assert.equal(OpenZooAuto.displayRouted({}, 'google/gemini-3.7-flash'), 'google/gemini-3.7-flash');
});

test('Auto uses the reasoning token floor; pin keeps the existing heuristic', () => {
  assert.equal(OpenZooAuto.reasoningMaxTokens('openzoo/auto'), 16384);
  assert.equal(OpenZooAuto.reasoningMaxTokens(null), 16384);
  assert.equal(OpenZooAuto.reasoningMaxTokens('google/gemini-3.7-flash'), 4096);
  assert.equal(OpenZooAuto.reasoningMaxTokens('deepseek/deepseek-v4-pro'), 16384);
});

test('PSG1 grokui defaults to Auto and posts the virtual id', () => {
  assert.match(html, /src="auto\.js"/);
  assert.match(html, /data-component="model-picker"/);
  assert.match(html, /🎯 Auto/);
  assert.match(app, /OpenZooAuto/);
  assert.match(app, /sendModel/);
  assert.match(app, /catalogWithAuto/);
  assert.match(app, /displayRouted/);
  assert.match(app, /openzoo\/auto/);
  assert.match(app, /model:\s*sendId/);
  assert.match(app, /racePlan\.n >= 2 && !autoOn/);
  assert.match(app, /newThread[\s\S]*openzoo\/auto/);
  assert.doesNotMatch(app, /gpt-4o-mini/);
  assert.doesNotMatch(app, /gemini-2\.5-flash/);
  assert.doesNotMatch(app, /shortlist\s*\(/);
  assert.doesNotMatch(app, /\/v1\/route/);
  assert.doesNotMatch(app, /classifyTask|routeAuto\(/);
  assert.doesNotMatch(app, /SCORE this prompt|cheapest model that can/);
});

test('Auto helper never classifies, never shortlists, never bounces :8402', () => {
  assert.doesNotMatch(autoSrc, /function shortlist|shortlist\s*\(/);
  assert.doesNotMatch(autoSrc, /\/v1\/route/);
  assert.doesNotMatch(autoSrc, /8402/);
  assert.doesNotMatch(autoSrc, /localhost|127\.0\.0\.1/);
  assert.doesNotMatch(autoSrc, /function classify|routeAuto\(|SCORE this prompt/);
  assert.doesNotMatch(autoSrc, /ling-3|llama-4|nemotron|nvidia\/nemo/);
  assert.doesNotMatch(app, /localhost:8402|127\.0\.0\.1:8402/);
  assert.doesNotMatch(html, /localhost:8402|127\.0\.0\.1:8402/);
});

test('x402 / MWA pay path is unchanged and Auto does not own payment', () => {
  assert.match(app, /OpenZooPay\.paidFetch\('\/v1\/chat\/completions'/);
  assert.match(pay, /X-PAYMENT/);
  assert.match(pay, /signViaBridge/);
  assert.match(pay, /https:\/\/x402-tokens\.fly\.dev/);
  assert.match(shell, /MWA\.signTransaction/);
  assert.doesNotMatch(autoSrc, /X-PAYMENT|signAndSendTransaction|Play Billing|StoreKit|stripe/i);
  assert.doesNotMatch(app, /signAndSendTransaction/);
});
