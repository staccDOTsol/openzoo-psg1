'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const OpenZooPay = require('../www/app/pay.js');
const OpenZooCopy = require('../www/app/copy.js');

const appHtml = fs.readFileSync(path.join(ROOT, 'www/app/index.html'), 'utf8');
const appJs = fs.readFileSync(path.join(ROOT, 'www/app/app.js'), 'utf8');
const appCss = fs.readFileSync(path.join(ROOT, 'www/app/app.css'), 'utf8');
const shell = fs.readFileSync(path.join(ROOT, 'www/index.html'), 'utf8');
const pay = fs.readFileSync(path.join(ROOT, 'www/app/pay.js'), 'utf8');
const wrap = fs.readFileSync(path.join(ROOT, 'www/app/wrap.js'), 'utf8');
const mwaJs = fs.readFileSync(path.join(ROOT, 'cordova-plugin-mwa/www/mwa.js'), 'utf8');
const mwaJava = fs.readFileSync(path.join(ROOT, 'cordova-plugin-mwa/src/android/MWAPlugin.java'), 'utf8');

const NOISE = [
  'Load failed',
  'TypeError: Load failed',
  'TypeError: Failed to fetch',
  'Failed to fetch',
  'NetworkError when attempting to fetch resource.',
  'The Internet connection appears to be offline.',
  'net::ERR_INTERNET_DISCONNECTED',
  'The operation was aborted.'
];

function cspOf(html) {
  const m = html.match(/Content-Security-Policy"\s+content="([^"]+)"/);
  assert.ok(m, 'missing CSP');
  return m[1];
}

function httpsOriginsIn(src) {
  const found = new Set();
  const re = /https:\/\/[a-z0-9.-]+/gi;
  let m;
  while ((m = re.exec(src))) found.add(m[0].replace(/\/$/, ''));
  return [...found];
}

test('humanizePayError never surfaces WebView Load failed / TypeError', () => {
  for (const raw of NOISE) {
    const out = OpenZooPay.humanizePayError(new Error(raw));
    assert.doesNotMatch(out, /Load failed/i);
    assert.doesNotMatch(out, /TypeError/i);
    assert.doesNotMatch(out, /Failed to fetch/i);
    assert.match(out, /retry|Jupiter|zoo/i);
    assert.equal(OpenZooPay.isTransientNetwork(new Error(raw)), true);
  }
  const typed = new Error('x');
  typed.name = 'TypeError';
  typed.message = 'Load failed';
  assert.doesNotMatch(OpenZooPay.humanizePayError(typed), /TypeError|Load failed/);
});

test('persist 402 quote across MWA background and clear after use', () => {
  OpenZooPay.clearPending402();
  assert.equal(OpenZooPay.loadPending402(), null);
  const quote = {
    accepts: [{ scheme: 'exact', network: 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp', asset: 'mint' }]
  };
  OpenZooPay.persistPending402({
    path: '/v1/chat/completions',
    method: 'POST',
    body: '{"model":"x"}',
    quote: quote,
    payer: 'WzMaL78srutrF6CsxEkWuhMaDF5HZA6jNRaEPengqpb'
  });
  const got = OpenZooPay.loadPending402();
  assert.equal(got.path, '/v1/chat/completions');
  assert.equal(got.quote.accepts[0].asset, 'mint');
  assert.equal(got.payer, 'WzMaL78srutrF6CsxEkWuhMaDF5HZA6jNRaEPengqpb');
  OpenZooPay.clearPending402();
  assert.equal(OpenZooPay.loadPending402(), null);
});

test('resume unblocks waiters so pay/build can retry', async () => {
  let n = 0;
  const orig = global.fetch;
  global.fetch = async (url) => {
    n++;
    if (String(url).indexOf('/v1/pay/build') >= 0 && n === 1) {
      const err = new TypeError('Load failed');
      throw err;
    }
    if (String(url).indexOf('/v1/pay/build') >= 0) {
      return {
        ok: true,
        json: async () => ({ transaction: 'dHg=', envelope: { x402Version: 1, payload: {} } })
      };
    }
    throw new Error('unexpected ' + url);
  };
  try {
    setTimeout(() => OpenZooPay.onAppResume(), 20);
    const body = await OpenZooPay.buildPayment({ asset: 'mint' }, 'payer111');
    assert.equal(body.transaction, 'dHg=');
    assert.ok(n >= 2);
  } finally {
    global.fetch = orig;
  }
});

test('copy helper prefers Cordova clipboard then shell then execCommand', async () => {
  const prevMWA = global.window;
  global.window = {
    MWA: {
      copyText: function (text, ok) {
        assert.equal(text, 'So11anaAddr');
        ok();
      }
    },
    parent: null,
    isSecureContext: false
  };
  assert.equal(await OpenZooCopy.copyText('So11anaAddr'), true);
  global.window = prevMWA;
});

test('wallet and shell copy UI: tap, select, toast copied', () => {
  assert.match(appHtml, /id="copiedToast"/);
  assert.match(appHtml, /Tap the address to copy/);
  assert.match(appHtml, /not a local burner/);
  assert.match(appCss, /user-select:\s*all/);
  assert.match(appCss, /\.wcopy/);
  assert.match(appJs, /OpenZooCopy/);
  assert.match(appJs, /bindSelectToCopy/);
  assert.match(appJs, /walletRow|copyAddress/);
  assert.match(shell, /id="copiedToast"/);
  assert.match(shell, /user-select:\s*all/);
  assert.match(shell, /Tap to copy/);
  assert.match(shell, /wallet-copy-text/);
  assert.match(shell, /MWA\.copyText/);
  assert.match(mwaJs, /copyText:\s*function/);
  assert.match(mwaJava, /ClipboardManager/);
  assert.match(mwaJava, /setPrimaryClip/);
});

test('shell forwards pause/resume so 402 survives MWA backgrounding', () => {
  assert.match(shell, /app-resume/);
  assert.match(shell, /app-pause/);
  assert.match(shell, /document\.addEventListener\('resume'/);
  assert.match(appJs, /app-resume/);
  assert.match(appJs, /onAppResume|notifyResume/);
  assert.match(pay, /persistPending402/);
  assert.match(pay, /waitForResumeOr/);
  assert.match(pay, /resumePendingPay/);
});

test('CSP connect-src lists every gateway and RPC the client actually calls', () => {
  const appCsp = cspOf(appHtml);
  const shellCsp = cspOf(shell);
  const needed = [
    'https://x402-tokens.fly.dev',
    'https://x402.accrue.fund',
    'https://api.mainnet-beta.solana.com'
  ];
  for (const host of needed) {
    assert.match(appCsp, new RegExp(host.replace(/\./g, '\\.')));
    assert.match(shellCsp, new RegExp(host.replace(/\./g, '\\.')));
  }
  const called = httpsOriginsIn(pay + '\n' + wrap).filter((u) =>
    u.indexOf('x402') >= 0 || u.indexOf('solana.com') >= 0
  );
  assert.ok(called.length >= 3);
  for (const origin of called) {
    assert.match(appCsp, new RegExp(origin.replace(/\./g, '\\.')));
    assert.match(shellCsp, new RegExp(origin.replace(/\./g, '\\.')));
  }
  assert.doesNotMatch(appCsp, /8402/);
  assert.doesNotMatch(shellCsp, /8402/);
});

test('still Cordova + MWA, no :8402 bounce, no iOS deeplink pay path', () => {
  assert.match(shell, /MWA\.signTransaction/);
  assert.match(shell, /GAME_URL\s*=\s*'app\/index.html'/);
  assert.doesNotMatch(shell, /localhost:8402|127\.0\.0\.1:8402/);
  assert.doesNotMatch(shell, /phantom\.app\/ul|solflare\.com\/ul/i);
  assert.doesNotMatch(appJs, /localhost:8402/);
  const autoJs = fs.readFileSync(path.join(ROOT, 'www/app/auto.js'), 'utf8');
  assert.doesNotMatch(autoJs, /localhost:8402|127\.0\.0\.1:8402|\/v1\/route/);
  assert.match(appHtml, /id="threads"/);
  assert.match(appJs, /silentBind/);
  assert.match(wrap, /WTOKENx2/);
  assert.match(wrap, /authorityBump|WTOKENx2_BUMP/);
});
