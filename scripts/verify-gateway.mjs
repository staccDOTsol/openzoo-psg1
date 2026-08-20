#!/usr/bin/env node
// Live, no-wallet checks. Does not sign, does not settle, does not print bind ids as product UI.

import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const OpenZooPay = require('../www/app/pay.js');

const GATEWAY = 'https://x402-tokens.fly.dev';
const SUPPORTED = 'https://x402.accrue.fund/supported';
const WTOKENx2 = 'FXYkwMtfKpA174rp8ixVeiGs5TYGaBsYRrHE3KrR449B';
const DRAINED = 'Bo7xBF7SY8EyUBPUxRP66SFafxoPf2n5uqiLjbxEebx9';

async function req(url, init) {
  const res = await fetch(url, init);
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = text; }
  return { res, json };
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

async function main() {
  const dir = await req(SUPPORTED);
  assert(dir.res.ok, '/supported should be public');
  const kinds = (dir.json.kinds || []).filter((k) => String(k.network || '').startsWith('solana:'));
  const assets = kinds.map((k) => k.extra && k.extra.asset);
  assert(assets.includes(WTOKENx2), 'live directory must list wTOKENx2 mint');
  const w2 = kinds.find((k) => k.extra && k.extra.asset === WTOKENx2);
  assert(w2.extra.symbol === 'wTOKENx2', 'FXY mint must be labeled wTOKENx2, not wTOKENx');
  assert(w2.extra.acquire && w2.extra.acquire.method === 'spl-token-wrap', 'wTOKENx2 needs acquire');
  assert(w2.extra.acquire.program === 'FrSERTNCPvTtaDS9AvQp9u1nYGzXDb3kC9MdL8Xxn2NE', 'wrap-nav program');
  assert(w2.extra.acquire.authorityBump === 254, 'wTOKENx2 bump is 254');
  assert(w2.extra.acquire.underlying.address === 'EVULoNF4DeMBN4dGiZiDfpiiTfNZgoCvXWWgaV3epump', 'TOKEN underlying');
  assert(!assets.includes(DRAINED), 'drained mint must stay out of the live directory we claim');
  console.log('supported ok — solana', kinds.map((k) => k.extra.symbol).join(','));

  const stats = await req(GATEWAY + '/v1/stats');
  assert(stats.res.ok, '/v1/stats should be public');
  assert(stats.json && stats.json.today, '/v1/stats missing today');
  console.log('stats ok — today.calls=', stats.json.today.calls);

  const chat = await req(GATEWAY + '/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer verify-psg1' },
    body: JSON.stringify({
      model: 'openai/gpt-4o-mini',
      messages: [{ role: 'user', content: 'ping' }],
      max_tokens: 8
    })
  });
  assert(chat.res.status === 402, 'chat should 402 before payment, got ' + chat.res.status);
  const accepts = chat.json.accepts || [];
  const solana = accepts.filter((r) => r.scheme === 'exact' && String(r.network).startsWith('solana:'));
  const evm = accepts.filter((r) => String(r.network).startsWith('eip155:'));
  assert(solana.length >= 1, 'expected at least one Solana rail');
  const visible = solana.filter((r) => r.asset !== DRAINED);
  assert(visible.every((r) => r.asset !== DRAINED), '402 must not be used as-is if it still offers the drained mint');
  const fxy = visible.find((r) => r.asset === WTOKENx2);
  if (fxy) {
    assert(OpenZooPay.railSymbol(fxy) === 'wTOKENx2', 'client must label FXY as wTOKENx2 even if the 402 still says wTOKENx');
  }
  const shown = visible.map((r) => OpenZooPay.railSymbol(r) || r.asset);
  assert(!shown.includes('wTOKENx'), 'client must not present a wTOKENx label');
  console.log('402 rails — solana', shown.join(','), '| eip155', evm.length);

  const built = await req(GATEWAY + '/v1/pay/build', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      accept: visible[0],
      payer: '11111111111111111111111111111111'
    })
  });
  assert(built.res.ok, 'pay/build failed: ' + JSON.stringify(built.json));
  assert(built.json.transaction && built.json.envelope, 'pay/build missing transaction/envelope');
  console.log('pay/build ok — tx bytes(b64)=', built.json.transaction.length);

  if (evm[0]) {
    const evmBuild = await req(GATEWAY + '/v1/pay/build', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        accept: evm[0],
        payer: '11111111111111111111111111111111'
      })
    });
    assert(!evmBuild.res.ok, 'pay/build must reject EVM rows for this app');
    console.log('pay/build rejects eip155 —', evmBuild.json.error || evmBuild.res.status);
  }

  const bind = await req(GATEWAY + '/v1/hrr/bind', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ corpus: 'verify-gateway psg1' })
  });
  assert(bind.res.ok, 'bind failed: ' + JSON.stringify(bind.json));
  assert(bind.json.object === 'hrr.bind' && /^ctx_/.test(bind.json.context_id), 'bind contract still returns a context');
  console.log('bind contract ok (not shown in UI)');

  const models = await req(GATEWAY + '/v1/models');
  assert(models.res.ok, '/v1/models should be public');
  const kept = (models.json.data || []).filter((m) => m.id && !m.id.startsWith('~') && !m.id.includes(':batch'));
  assert(kept.length > 0, 'expected usable models after ~ / :batch filter');
  console.log('models ok — kept', kept.length);

  console.log('gateway + /supported contracts hold. No settle attempted. No :8402.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
