'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'www/app/index.html'), 'utf8');
const css = fs.readFileSync(path.join(ROOT, 'www/app/app.css'), 'utf8');
const app = fs.readFileSync(path.join(ROOT, 'www/app/app.js'), 'utf8');
const shell = fs.readFileSync(path.join(ROOT, 'www/index.html'), 'utf8');
const readme = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8');

function visibleHtml(src) {
  return src.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '');
}

test('markup is threads + chat + wallet, not a bind homework page', () => {
  const vis = visibleHtml(html);
  assert.match(html, /id="threads"/);
  assert.match(html, /id="walletOverlay"/);
  assert.match(html, /id="log"/);
  assert.match(html, /Attach files/);
  assert.match(html, /Attach folder/);
  assert.match(html, /Add text/);
  assert.doesNotMatch(vis, /context_id|context id|\/v1\/hrr\/bind|\/v1\/bind/i);
  assert.doesNotMatch(vis, /wTOKENx(?!2)/);
  assert.doesNotMatch(vis, /Bo7xBF7SY8EyUBPUxRP66SFafxoPf2n5uqiLjbxEebx9/);
  assert.doesNotMatch(vis, /NAV-wrapped|Token-2022|wrap-twin|bind hashes/i);
});

test('app never surfaces bind plumbing or drained mint to the user', () => {
  assert.match(app, /silentBind/);
  assert.match(app, /files attached/);
  assert.doesNotMatch(app, /ctxChip|bind it|binding…/);
  assert.doesNotMatch(app, /Need yUSDCx or wTOKENx/);
  assert.doesNotMatch(app, /Bo7xBF7SY8EyUBPUxRP66SFafxoPf2n5uqiLjbxEebx9/);
  assert.doesNotMatch(app, /localhost:8402/);
});

test('shell keeps MWA, adds wrap send, and does not bounce :8402', () => {
  assert.match(shell, /MWA\.signTransaction/);
  assert.match(shell, /wallet-sign-and-send-transaction/);
  assert.match(shell, /signAndSendTransaction/);
  assert.match(shell, /GAME_URL\s*=\s*'app\/index\.html'/);
  assert.doesNotMatch(shell, /http:\/\/localhost:8402|127\.0\.0\.1:8402/);
  assert.doesNotMatch(shell, /phantom\.app\/ul|solflare\.com\/ul/i);
  assert.match(shell, /https:\/\/x402\.accrue\.fund/);
  assert.match(shell, /https:\/\/x402-tokens\.fly\.dev/);
  assert.match(shell, /https:\/\/api\.mainnet-beta\.solana\.com/);
  assert.match(shell, /MWA\.copyText/);
  assert.match(shell, /app-resume/);
});

test('layout is the grokui canvas, not a fly.dev form', () => {
  assert.match(css, /#sidebar/);
  assert.match(css, /#walletOverlay/);
  assert.match(css, /#b8f240/);
  assert.match(readme, /threads/i);
  assert.match(readme, /wTOKENx2/);
  assert.doesNotMatch(readme, /http:\/\/localhost:8402|127\.0\.0\.1:8402/);
});
