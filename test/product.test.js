'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'www/app/index.html'), 'utf8');
const css = fs.readFileSync(path.join(ROOT, 'www/app/app.css'), 'utf8');
const app = fs.readFileSync(path.join(ROOT, 'www/app/app.js'), 'utf8');
const pay = fs.readFileSync(path.join(ROOT, 'www/app/pay.js'), 'utf8');
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
  assert.doesNotMatch(app, /['"]Load failed['"]/);
  assert.doesNotMatch(app, /SPAWN|worktree/i);
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
  assert.match(shell, /https:\/\/zoo\.openzoo\.fun/);
  assert.match(shell, /MWA\.copyText/);
  assert.match(shell, /app-resume/);
  assert.doesNotMatch(shell, /ANTHROPIC_API_KEY\s*=/);
});

test('layout is the grokui canvas, not a fly.dev form', () => {
  assert.match(css, /#sidebar/);
  assert.match(css, /#walletOverlay/);
  assert.match(css, /#b8f240/);
  assert.match(html, /id="raceSel"/);
  assert.match(html, /id="tierSel"/);
  assert.match(html, /id="modeSel"/);
  assert.match(html, /id="keyOverlay"/);
  assert.match(readme, /threads/i);
  assert.match(readme, /wTOKENx2/);
  assert.doesNotMatch(readme, /http:\/\/localhost:8402|127\.0\.0\.1:8402/);
});

test('x402 prompts for wrap / short SOL / short tokens and copies the address', () => {
  assert.match(html, /id="payPromptOverlay"/);
  assert.match(html, /id="payPromptAddr"/);
  assert.match(pay, /You have/);
  assert.match(pay, /Wrap enough to send this/);
  assert.match(pay, /pickLargestUseful/);
  assert.match(pay, /depositForShares/);
  assert.match(app, /promptWrap|confirmWrap/);
  assert.match(app, /promptFunds|needFunds/);
  assert.match(app, /copyText|OpenZooCopy/);
  assert.match(app, /Tap to copy/);
  assert.match(app, /onAppResume|resumePendingPay/);
  assert.match(app, /outgoingChat|plan\.messages/);
  assert.doesNotMatch(app, /t\.saved \+= x\.savesVsDirect/);
  assert.doesNotMatch(app, /['"]Load failed['"]/);
  assert.doesNotMatch(html, /Load failed/);
  assert.doesNotMatch(pay, /localhost:8402/);
});

test('dark launch loader covers launchApp blank and dismisses on chrome-ready, not models', () => {
  const body = shell.replace(/^[\s\S]*<body[^>]*>/i, '');
  assert.match(body, /^\s*<div id="oz-boot"/);
  assert.match(shell, /#oz-boot\s*\{[^}]*z-index:\s*10000/);
  assert.match(shell, /#oz-boot\s*\{[^}]*background:\s*#0A080D/);
  assert.match(shell, /id="oz-boot"[^>]*>starting/);
  assert.match(shell, /oz-boot-dots/);
  assert.match(shell, /@keyframes oz-boot-dot/);
  const bootHtml = shell.slice(shell.indexOf('id="oz-boot"'), shell.indexOf('</div>', shell.indexOf('id="oz-boot"')));
  assert.doesNotMatch(bootHtml, /<img|mark\.png|logo/i);
  assert.match(shell, /z-index:9999/);

  assert.match(shell, /function launchApp\s*\(/);
  const launch = shell.slice(shell.indexOf('function launchApp'), shell.indexOf('function disconnect'));
  assert.match(launch, /showBootOverlay\s*\(/);
  const createChunk = launch.slice(launch.indexOf("createElement('iframe')"), launch.indexOf('appendChild(iframe)'));
  assert.doesNotMatch(createChunk, /hideBootOverlay/);
  assert.match(launch, /setTimeout\(hideBootOverlay,\s*50\)/);
  assert.match(launch, /setTimeout\(hideBootOverlay,\s*4000\)/);
  assert.match(shell, /DOMContentLoaded[\s\S]*hideBootOverlay/);
  assert.match(shell, /type === 'openzoo-chrome-ready'[\s\S]*hideBootOverlay/);

  const readyIdx = app.indexOf("type: 'openzoo-chrome-ready'");
  const renderIdx = app.lastIndexOf('render();');
  const loadIdx = app.lastIndexOf('loadModels();');
  assert.ok(readyIdx > 0, 'app posts openzoo-chrome-ready');
  assert.ok(renderIdx > 0 && renderIdx < readyIdx, 'chrome-ready after first render()');
  assert.ok(loadIdx > readyIdx, 'chrome-ready before loadModels() — do not wait on models');
});

test('shell persists 402 across MWA backgrounding via pause/resume', () => {
  assert.match(shell, /app-resume/);
  assert.match(shell, /app-pause/);
  assert.match(shell, /MWA\.copyText/);
  assert.match(pay, /persistPending402/);
  assert.match(pay, /waitForResumeOr/);
  assert.match(pay, /resumePendingPay/);
  assert.doesNotMatch(shell, /['"]Load failed['"]/);
  assert.doesNotMatch(shell, /http:\/\/localhost:8402|127\.0\.0\.1:8402/);
});

test('Agent is cloud code-server + Cline via /ide/session Bearer; chat keeps x402/MWA', () => {
  const ide = fs.readFileSync(path.join(ROOT, 'www/app/ide.js'), 'utf8');
  const sub = fs.readFileSync(path.join(ROOT, 'www/app/sub.js'), 'utf8');
  assert.match(html, /id="modeSel"/);
  assert.match(html, /<option value="agent">agent<\/option>/);
  assert.match(html, /id="keyOverlay"/);
  assert.match(html, /id="agentPane"/);
  assert.match(html, /id="agentFrame"/);
  assert.match(html, /https:\/\/zoo\.openzoo\.fun\/subscriptions/);
  assert.match(html, /https:\/\/zoo\.openzoo\.fun/);
  const csp = (html.match(/Content-Security-Policy"\s+content="([^"]+)"/) || [])[1] || '';
  assert.match(csp, /x402-tokens\.fly\.dev/);
  assert.match(csp, /frame-src/);
  assert.match(csp, /https:\/\/\*\.openzoo\.fun/);
  assert.doesNotMatch(csp, /api\.anthropic\.com/);
  assert.doesNotMatch(html, /id="agentStop"/);
  assert.match(app, /openAgentIde/);
  assert.match(app, /No key → no Agent/);
  assert.match(app, /OpenZooIde\.ensureSession/);
  assert.match(app, /OpenZooIde\.embedSrc/);
  assert.doesNotMatch(app, /OpenZooOcc/);
  assert.doesNotMatch(app, /\/occ\/sessions/);
  assert.match(app, /OpenZooPay\.paidFetch/);
  assert.match(pay, /Authorization': 'Bearer openzoo-psg1'/);
  assert.match(pay, /MWA|signTransaction|\/v1\/pay\/build|X-PAYMENT/);
  assert.match(ide, /https:\/\/zoo\.openzoo\.fun/);
  assert.match(ide, /\/ide\/session/);
  assert.match(ide, /Authorization/);
  assert.match(ide, /Bearer/);
  assert.doesNotMatch(ide, /\/occ\//);
  assert.doesNotMatch(ide, /\/v1\/ide/);
  assert.doesNotMatch(ide, /x402-tokens\.fly\.dev/);
  assert.doesNotMatch(ide, /ANTHROPIC_API_KEY\s*=/);
  assert.doesNotMatch(ide, /node-pty|writeAgentPty/);
  assert.doesNotMatch(app, /ANTHROPIC_API_KEY\s*=/);
  assert.doesNotMatch(app, /node-pty|writeAgentPty/);
  assert.doesNotMatch(sub, /ANTHROPIC_API_KEY\s*=/);
  assert.match(readme, /\/ide\/session/);
  assert.match(readme, /code-server/);
  assert.match(readme, /Cline/);
  assert.doesNotMatch(readme, /\/occ\/sessions/);
  assert.match(readme, /Authorization: Bearer/);
  assert.match(readme, /x402/);
  assert.match(readme, /subscription Bearer/);
});

test('Agent webview is full-bleed on the handheld; chat composer hidden', () => {
  assert.match(html, /viewport-fit=cover/);
  assert.match(shell, /viewport-fit=cover/);
  assert.match(css, /body\.agent-mode #agentFrame/);
  assert.match(css, /body\.agent-mode #agentFrame[\s\S]*inset:\s*0/);
  assert.match(css, /body\.agent-mode #bar/);
  assert.match(css, /display:\s*none\s*!important/);
  assert.match(css, /100dvh/);
  assert.match(css, /max-width:\s*1400px/);
  assert.match(app, /setAgentSurface/);
  assert.match(app, /\$\('bar'\)\.hidden/);
  assert.match(html, /id="agentFrame"/);
  assert.match(app, /OpenZooIde\.ensureSession/);
  assert.match(app, /OpenZooPay\.paidFetch/);
  assert.doesNotMatch(app, /OpenZooOcc/);
});
