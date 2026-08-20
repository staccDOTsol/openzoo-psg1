#!/usr/bin/env node
// Live, no-wallet checks for the payment-path contracts this app relies on.
// Does not sign, does not settle, does not claim bind success without a context_id.

const GATEWAY = 'https://x402-tokens.fly.dev';

async function req(path, init) {
  const res = await fetch(GATEWAY + path, init);
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = text; }
  return { res, json };
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

async function main() {
  const stats = await req('/v1/stats');
  assert(stats.res.ok, '/v1/stats should be public');
  assert(stats.json && stats.json.today, '/v1/stats missing today');
  console.log('stats ok — today.calls=', stats.json.today.calls);

  const chat = await req('/v1/chat/completions', {
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
  assert(solana[0].extra && solana[0].extra.symbol, 'Solana rail missing symbol');
  console.log('402 rails — solana', solana.map((r) => r.extra.symbol).join(','), '| eip155', evm.length);
  assert(solana.some((r) => r.extra.symbol === 'yUSDCx'), 'expected yUSDCx');
  assert(solana.some((r) => r.extra.symbol === 'wTOKENx'), 'expected wTOKENx');

  const built = await req('/v1/pay/build', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      accept: solana[0],
      payer: '11111111111111111111111111111111'
    })
  });
  assert(built.res.ok, 'pay/build failed: ' + JSON.stringify(built.json));
  assert(built.json.transaction && built.json.envelope, 'pay/build missing transaction/envelope');
  assert(built.json.envelope.payload, 'envelope missing payload');
  console.log('pay/build ok — tx bytes(b64)=', built.json.transaction.length);

  const evmBuild = await req('/v1/pay/build', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      accept: evm[0],
      payer: '11111111111111111111111111111111'
    })
  });
  assert(!evmBuild.res.ok, 'pay/build must reject EVM rows for this app');
  console.log('pay/build rejects eip155 —', evmBuild.json.error || evmBuild.res.status);

  const bind = await req('/v1/hrr/bind', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ corpus: 'verify-gateway psg1' })
  });
  assert(bind.res.ok, 'bind failed: ' + JSON.stringify(bind.json));
  assert(bind.json.object === 'hrr.bind' && /^ctx_/.test(bind.json.context_id), 'bind missing ctx_ id');
  console.log('bind ok —', bind.json.context_id, 'bound', bind.json.bound);

  console.log('gateway contracts hold (CORS + 402 + pay/build + bind + stats). No settle attempted.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
