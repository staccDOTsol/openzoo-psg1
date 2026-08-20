'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const OpenZooCodec = require('../www/app/codec.js');
const OpenZooWrap = require('../www/app/wrap.js');
const OpenZooPay = require('../www/app/pay.js');

const DRAINED = 'Bo7xBF7SY8EyUBPUxRP66SFafxoPf2n5uqiLjbxEebx9';
const WTOKENx2 = 'FXYkwMtfKpA174rp8ixVeiGs5TYGaBsYRrHE3KrR449B';
const TOKEN = 'EVULoNF4DeMBN4dGiZiDfpiiTfNZgoCvXWWgaV3epump';
const OWNER = 'WzMaL78srutrF6CsxEkWuhMaDF5HZA6jNRaEPengqpb';

const LIVE_KINDS = {
  kinds: [
    {
      scheme: 'exact',
      network: 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp',
      extra: {
        asset: DRAINED,
        symbol: 'wTOKENx',
        acquire: { method: 'spl-token-wrap', underlying: { address: TOKEN }, escrow: 'x' }
      }
    },
    {
      scheme: 'exact',
      network: 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp',
      extra: {
        asset: WTOKENx2,
        symbol: 'wTOKENx2',
        acquire: {
          method: 'spl-token-wrap',
          program: 'FrSERTNCPvTtaDS9AvQp9u1nYGzXDb3kC9MdL8Xxn2NE',
          underlying: {
            address: TOKEN,
            symbol: 'TOKEN',
            decimals: 6,
            tokenProgram: 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb'
          },
          escrow: '2ZFYUDiYbtJ8czCPnd6Wjbeo1Yg1LLJ8JkGPMeuZkKyh',
          mintAuthority: '2SFdjJoRyWfXvXghAjahDgmaZPrAr5WqqCr8KquAtZVM',
          authorityBump: 254
        }
      }
    }
  ]
};

test('hides the drained mint and never labels FXY as wTOKENx', () => {
  const hidden = OpenZooWrap.hideDrained(LIVE_KINDS.kinds);
  assert.equal(hidden.some((k) => (k.extra && k.extra.asset) === DRAINED), false);
  assert.equal(OpenZooWrap.railLabel({ asset: WTOKENx2, extra: { symbol: 'wTOKENx' } }), 'wTOKENx2');
  assert.equal(OpenZooWrap.userFacingSymbol(WTOKENx2, 'wTOKENx'), 'wTOKENx2');
  assert.equal(OpenZooWrap.userFacingSymbol(DRAINED, 'wTOKENx'), null);
  assert.notEqual(OpenZooPay.railSymbol({ asset: WTOKENx2, extra: { symbol: 'wTOKENx' } }), 'wTOKENx');
});

test('wTOKENx2 wrap is nine accounts, tag 1, bump 254', async () => {
  const pool = OpenZooWrap.acquireForMint(LIVE_KINDS.kinds, WTOKENx2);
  assert.ok(pool);
  assert.equal(pool.underlying, TOKEN);
  assert.equal(pool.bump, 254);
  const userWrapped = await OpenZooCodec.associatedTokenAddress(OWNER, pool.wrapped, pool.wrappedProgram);
  const userUnderlying = await OpenZooCodec.associatedTokenAddress(OWNER, pool.underlying, pool.underlyingProgram);
  const ix = OpenZooWrap.wrapIx(pool, OWNER, userWrapped, userUnderlying, 1000n);
  assert.equal(ix.keys.length, 9);
  assert.equal(ix.bump, 254);
  assert.equal(ix.data[0], 1);
  assert.equal(ix.data[ix.data.length - 1], 254);
  assert.equal(ix.data.length, 1 + 8 + 1);
  assert.equal(ix.keys[5].isWritable, true);
  assert.equal(ix.keys[6].isSigner, true);
  assert.equal(ix.keys[6].pubkey, OWNER);
});

test('directory acquire maps TOKEN to wTOKENx2', () => {
  const twin = OpenZooWrap.findTwinForUnderlying(LIVE_KINDS.kinds, TOKEN);
  assert.ok(twin);
  assert.equal(twin.wrapped, WTOKENx2);
  assert.equal(twin.symbol, 'wTOKENx2');
});

test('depositForShares adds genesis lock when supply is empty', () => {
  assert.equal(OpenZooWrap.depositForShares(100n, 0n, 0n), 1100n);
  const withNav = OpenZooWrap.depositForShares(100n, 200n, 200n);
  assert.ok(withNav >= 100n);
});

test('402 rails drop drained mint and keep Solana exact only', () => {
  const rails = OpenZooPay.solanaRails([
    { scheme: 'exact', network: 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp', asset: DRAINED, extra: { symbol: 'wTOKENx' } },
    { scheme: 'exact', network: 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp', asset: WTOKENx2, extra: { symbol: 'wTOKENx' } },
    { scheme: 'exact', network: 'eip155:8453', asset: '0x1', extra: { symbol: 'USDC' } }
  ]);
  assert.equal(rails.length, 1);
  assert.equal(rails[0].asset, WTOKENx2);
  assert.equal(OpenZooPay.railSymbol(rails[0]), 'wTOKENx2');
});

test('pickPayableRail uses live twin holdings, not the first row', () => {
  const rails = [
    { asset: '6ZjjxcoicqM4nniddkuPVwew4PDwY3swbfHsGbCuLuTv', maxAmountRequired: '100', extra: { symbol: 'yUSDCx' } },
    { asset: WTOKENx2, maxAmountRequired: '50', extra: { symbol: 'wTOKENx2' } }
  ];
  const pick = OpenZooPay.pickPayableRail(rails, { [WTOKENx2]: '80' });
  assert.equal(pick.asset, WTOKENx2);
  const wrap = OpenZooPay.pickWrappableRail(rails, { [TOKEN]: '999999' }, LIVE_KINDS.kinds);
  assert.ok(wrap);
  assert.equal(wrap.row.asset, WTOKENx2);
  assert.equal(wrap.pool.bump, 254);
});

test('pickLargestUseful does not skip $10 TOKEN just because twin maxAmountRequired is larger', () => {
  const USDC = OpenZooWrap.USDC_MINT;
  const yUSDCx = '6ZjjxcoicqM4nniddkuPVwew4PDwY3swbfHsGbCuLuTv';
  const kinds = LIVE_KINDS.kinds.concat([{
    scheme: 'exact',
    network: 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp',
    extra: {
      asset: yUSDCx,
      symbol: 'yUSDCx',
      acquire: {
        method: 'spl-token-wrap',
        program: 'FrSERTNCPvTtaDS9AvQp9u1nYGzXDb3kC9MdL8Xxn2NE',
        underlying: { address: USDC, symbol: 'USDC', decimals: 6, tokenProgram: OpenZooWrap.TOKEN_LEGACY },
        escrow: 'escrow-usdc',
        mintAuthority: 'auth-usdc',
        authorityBump: 255
      }
    }
  }]);
  const rails = [
    { asset: yUSDCx, maxAmountRequired: '50000000', extra: { symbol: 'yUSDCx' } },
    { asset: WTOKENx2, maxAmountRequired: '50000000', extra: { symbol: 'wTOKENx2' } }
  ];
  // $10 TOKEN = 10_000_000 raw. Comparing that to 50_000_000 shares would skip it.
  const tenToken = '10000000';
  const wrap = OpenZooPay.pickLargestUseful(rails, { [TOKEN]: tenToken, [USDC]: '1' }, kinds);
  assert.ok(wrap, 'held TOKEN > 0 must be useful even when raw < twin maxAmountRequired');
  assert.equal(wrap.row.asset, WTOKENx2);
  assert.equal(wrap.underlying, 10000000n);
  assert.equal(OpenZooPay.heldName(TOKEN), 'TOKEN');
});

test('pickLargestUseful uses depositForShares when pool state is known', () => {
  const rails = [
    { asset: WTOKENx2, maxAmountRequired: '100', extra: { symbol: 'wTOKENx2' } }
  ];
  const tooSmall = OpenZooPay.pickLargestUseful(
    rails,
    { [TOKEN]: '50' },
    LIVE_KINDS.kinds,
    { [WTOKENx2]: { reserves: 0n, supply: 0n } }
  );
  // genesis lock needs shares + 1000; 50 TOKEN cannot cover 1100
  assert.equal(tooSmall, null);
  const enough = OpenZooPay.pickLargestUseful(
    rails,
    { [TOKEN]: '2000' },
    LIVE_KINDS.kinds,
    { [WTOKENx2]: { reserves: 0n, supply: 0n } }
  );
  assert.ok(enough);
  assert.equal(enough.row.asset, WTOKENx2);
});

test('prompt copy and Load failed stay user-facing', () => {
  assert.equal(OpenZooPay.wrapPromptCopy('TOKEN').body, 'Wrap enough to send this?');
  assert.match(OpenZooPay.wrapPromptCopy('TOKEN').title, /You have TOKEN/);
  assert.match(OpenZooPay.shortSolCopy().body, /SOL/);
  assert.match(OpenZooPay.shortTokensCopy(['TOKEN']).body, /TOKEN/);
  assert.equal(OpenZooPay.looksLoadFailed('Load failed'), true);
  assert.doesNotMatch(OpenZooPay.humanizePayError(new Error('Load failed')), /Load failed/);
  assert.match(OpenZooPay.humanizePayError(new Error('Load failed')), /zoo|retry|Jupiter/i);
  OpenZooPay.clearPending402();
  OpenZooPay.persistPending402({
    path: '/v1/chat/completions',
    step: 'quote',
    quote: { accepts: [{ asset: WTOKENx2 }] }
  });
  const pending = OpenZooPay.loadPending402();
  assert.equal(pending.path, '/v1/chat/completions');
  OpenZooPay.clearPending402();
  assert.equal(OpenZooPay.loadPending402(), null);
});

test('ATA derivation matches known mainnet vectors', async () => {
  const usdc = await OpenZooCodec.associatedTokenAddress(OWNER, OpenZooWrap.USDC_MINT, OpenZooWrap.TOKEN_LEGACY);
  const token = await OpenZooCodec.associatedTokenAddress(OWNER, OpenZooWrap.TOKEN_MINT, OpenZooWrap.TOKEN_2022);
  const wrap = await OpenZooCodec.associatedTokenAddress(OWNER, OpenZooWrap.WTOKENx2, OpenZooWrap.TOKEN_2022);
  assert.equal(usdc, '6Rp8rNgcuPWymJYtxxYDumZ18uAYhbtWsCB5VxGgyZW9');
  assert.equal(token, 'GVJSLT7mTHfSy3vy2Yk6o1EBywu48t7p5RP8bQCByiUH');
  assert.equal(wrap, '9oYTiFzWtXMnjjXzm4NtKRUaWnLmyaDL2hpHxWkMHkGA');
});

test('ATA derivation matches @solana/web3.js when the package is present', async () => {
  let web3;
  try { web3 = require('@solana/web3.js'); } catch (_) { return; }
  const { getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID } = require('@solana/spl-token');
  const owner = new web3.PublicKey(OWNER);
  const usdc = new web3.PublicKey(OpenZooWrap.USDC_MINT);
  const expected = getAssociatedTokenAddressSync(usdc, owner, false, TOKEN_PROGRAM_ID).toBase58();
  const got = await OpenZooCodec.associatedTokenAddress(OWNER, OpenZooWrap.USDC_MINT, OpenZooWrap.TOKEN_LEGACY);
  assert.equal(got, expected);
  const token = new web3.PublicKey(TOKEN);
  const expected2 = getAssociatedTokenAddressSync(token, owner, false, TOKEN_2022_PROGRAM_ID).toBase58();
  const got2 = await OpenZooCodec.associatedTokenAddress(OWNER, TOKEN, OpenZooWrap.TOKEN_2022);
  assert.equal(got2, expected2);
});
