/* Ez-mode wrap via wrap-nav + live /supported acquire directory.
   Users never see twin homework. Wrap txs MAY be sent (MWA.signAndSend).
   402 payment stays partial-sign only. */
'use strict';

var OpenZooWrap = (function (OpenZooCodec) {
  var SUPPORTED_URL = 'https://x402.accrue.fund/supported';
  var WRAP_PROGRAM = 'FrSERTNCPvTtaDS9AvQp9u1nYGzXDb3kC9MdL8Xxn2NE';
  var DRAINED_MINT = 'Bo7xBF7SY8EyUBPUxRP66SFafxoPf2n5uqiLjbxEebx9';
  var WTOKENx2 = 'FXYkwMtfKpA174rp8ixVeiGs5TYGaBsYRrHE3KrR449B';
  var TOKEN_MINT = 'EVULoNF4DeMBN4dGiZiDfpiiTfNZgoCvXWWgaV3epump';
  var USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
  var LEOS_MINT = '5xgsnby6P9zqGK71J7H4yJLxzqPvNbC7rDZxNzjHmj7e';
  var TOKEN_2022 = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';
  var TOKEN_LEGACY = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
  var RPC_URL = 'https://api.mainnet-beta.solana.com';
  var MINIMUM_LIQUIDITY = 1000n;
  var WTOKENx2_BUMP = 254;
  var WTOKENx2_ACCOUNTS = 9;

  var directoryCache = { at: 0, kinds: null };

  function userFacingSymbol(mint, fallback) {
    if (mint === DRAINED_MINT) return null;
    if (mint === WTOKENx2) return 'wTOKENx2';
    if (fallback === 'wTOKENx' && mint === WTOKENx2) return 'wTOKENx2';
    if (fallback === 'wTOKENx') return 'wTOKENx2';
    return fallback || null;
  }

  function hideDrained(list) {
    var out = [];
    var i;
    for (i = 0; i < (list || []).length; i++) {
      var row = list[i];
      var mint = (row && (row.asset || (row.extra && row.extra.asset))) || '';
      if (mint === DRAINED_MINT) continue;
      out.push(row);
    }
    return out;
  }

  function railLabel(row) {
    if (!row) return '';
    var mint = row.asset || (row.extra && row.extra.asset) || '';
    if (mint === DRAINED_MINT) return '';
    var extra = row.extra || {};
    if (mint === WTOKENx2 || extra.symbol === 'wTOKENx2') return 'wTOKENx2';
    if (mint === WTOKENx2) return 'wTOKENx2';
    if (extra.symbol === 'wTOKENx') return mint === WTOKENx2 ? 'wTOKENx2' : 'wTOKENx2';
    return extra.symbol || '';
  }

  async function acquireDirectory(force) {
    if (!force && directoryCache.kinds && Date.now() - directoryCache.at < 300000) {
      return directoryCache.kinds;
    }
    var r = await fetch(SUPPORTED_URL, { signal: AbortSignal.timeout ? AbortSignal.timeout(8000) : undefined });
    if (!r.ok) throw new Error('directory unreachable');
    var body = await r.json();
    if (!body || !Array.isArray(body.kinds)) throw new Error('directory missing kinds');
    directoryCache = { at: Date.now(), kinds: hideDrained(body.kinds) };
    return directoryCache.kinds;
  }

  function solanaKinds(kinds) {
    var out = [];
    var i;
    for (i = 0; i < (kinds || []).length; i++) {
      var k = kinds[i];
      if (!k || !k.network || k.network.indexOf('solana:') !== 0) continue;
      var mint = k.extra && k.extra.asset;
      if (!mint || mint === DRAINED_MINT) continue;
      out.push(k);
    }
    return out;
  }

  function acquireForMint(kinds, wrappedMint) {
    var rows = solanaKinds(kinds);
    var i;
    for (i = 0; i < rows.length; i++) {
      var extra = rows[i].extra || {};
      if (extra.asset !== wrappedMint) continue;
      var acq = extra.acquire;
      if (!acq || acq.method !== 'spl-token-wrap') return null;
      if (!acq.underlying || !acq.underlying.address || !acq.escrow) return null;
      var bump = acq.authorityBump;
      if (wrappedMint === WTOKENx2) bump = WTOKENx2_BUMP;
      return {
        wrapped: wrappedMint,
        symbol: railLabel({ asset: wrappedMint, extra: extra }),
        program: acq.program || WRAP_PROGRAM,
        underlying: acq.underlying.address,
        underlyingSymbol: acq.underlying.symbol || 'token',
        underlyingProgram: acq.underlying.tokenProgram || TOKEN_LEGACY,
        underlyingDecimals: acq.underlying.decimals == null ? 6 : acq.underlying.decimals,
        escrow: acq.escrow,
        mintAuthority: acq.mintAuthority,
        bump: bump,
        wrappedProgram: TOKEN_2022
      };
    }
    return null;
  }

  function findTwinForUnderlying(kinds, underlyingMint) {
    var rows = solanaKinds(kinds);
    var i;
    for (i = 0; i < rows.length; i++) {
      var extra = rows[i].extra || {};
      var acq = extra.acquire;
      if (!acq || acq.method !== 'spl-token-wrap') continue;
      if (acq.underlying && acq.underlying.address === underlyingMint) {
        return acquireForMint(kinds, extra.asset);
      }
    }
    return null;
  }

  function depositForShares(sharesNeeded, reserves, supply) {
    sharesNeeded = BigInt(sharesNeeded);
    reserves = BigInt(reserves);
    supply = BigInt(supply);
    if (supply === 0n || reserves === 0n) return sharesNeeded + MINIMUM_LIQUIDITY;
    var exact = (sharesNeeded * reserves + supply - 1n) / supply;
    return exact + exact / 200n + 2n;
  }

  function wrapKeys(pool, owner, userWrapped, userUnderlying) {
    return [
      { pubkey: pool.escrow, isSigner: false, isWritable: true },
      { pubkey: pool.wrapped, isSigner: false, isWritable: true },
      { pubkey: userWrapped, isSigner: false, isWritable: true },
      { pubkey: pool.mintAuthority, isSigner: false, isWritable: false },
      { pubkey: pool.wrappedProgram, isSigner: false, isWritable: false },
      { pubkey: userUnderlying, isSigner: false, isWritable: true },
      { pubkey: owner, isSigner: true, isWritable: false },
      { pubkey: pool.underlying, isSigner: false, isWritable: false },
      { pubkey: pool.underlyingProgram, isSigner: false, isWritable: false }
    ];
  }

  function wrapIx(pool, owner, userWrapped, userUnderlying, depositRaw) {
    var keys = wrapKeys(pool, owner, userWrapped, userUnderlying);
    if (keys.length !== WTOKENx2_ACCOUNTS && pool.wrapped === WTOKENx2) {
      throw new Error('wTOKENx2 wrap must be nine accounts');
    }
    var bump = pool.wrapped === WTOKENx2 ? WTOKENx2_BUMP : pool.bump;
    if (bump == null) throw new Error('wrap bump missing');
    return {
      programId: pool.program || WRAP_PROGRAM,
      keys: keys,
      data: OpenZooCodec.concat(
        new Uint8Array([1]),
        OpenZooCodec.u64le(depositRaw),
        new Uint8Array([bump])
      ),
      accountCount: keys.length,
      bump: bump
    };
  }

  async function buildWrapInstructions(pool, owner, depositRaw) {
    var userWrapped = await OpenZooCodec.associatedTokenAddress(owner, pool.wrapped, pool.wrappedProgram);
    var userUnderlying = await OpenZooCodec.associatedTokenAddress(owner, pool.underlying, pool.underlyingProgram);
    return {
      userWrapped: userWrapped,
      userUnderlying: userUnderlying,
      ixs: [
        OpenZooCodec.createAtaIdempotentIx(owner, userWrapped, owner, pool.wrapped, pool.wrappedProgram),
        wrapIx(pool, owner, userWrapped, userUnderlying, depositRaw)
      ]
    };
  }

  function looksDropped(err) {
    var msg = (err && err.message) ? String(err.message) : String(err || '');
    var low = msg.toLowerCase();
    var name = err && err.name ? String(err.name).toLowerCase() : '';
    return name === 'typeerror' || name === 'networkerror' ||
      low.indexOf('load failed') >= 0 || low.indexOf('failed to fetch') >= 0 ||
      low.indexOf('networkerror') >= 0 || low.indexOf('typeerror') >= 0;
  }

  async function rpc(method, params, rpcUrl) {
    var last = null;
    var attempt;
    for (attempt = 0; attempt < 4; attempt++) {
      try {
        var res = await fetch(rpcUrl || RPC_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: method, params: params })
        });
        if (!res.ok) throw new Error('RPC HTTP ' + res.status);
        var body = await res.json();
        if (body.error) throw new Error(body.error.message || 'RPC error');
        return body.result;
      } catch (e) {
        last = e;
        if (!looksDropped(e) || attempt === 3) break;
        await new Promise(function (resolve) { setTimeout(resolve, 400 * (attempt + 1)); });
      }
    }
    if (looksDropped(last)) {
      throw new Error('Connection dropped while talking to the zoo. Return to OpenZoo and we will retry — approve in Jupiter Wallet if it is still open.');
    }
    throw last;
  }

  async function poolState(pool, rpcUrl) {
    var esc = await rpc('getTokenAccountBalance', [pool.escrow], rpcUrl).catch(function () {
      return { value: { amount: '0' } };
    });
    var sup = await rpc('getTokenSupply', [pool.wrapped], rpcUrl);
    return {
      reserves: BigInt((esc && esc.value && esc.value.amount) || '0'),
      supply: BigInt((sup && sup.value && sup.value.amount) || '0')
    };
  }

  async function latestBlockhash(rpcUrl) {
    var r = await rpc('getLatestBlockhash', [{ commitment: 'confirmed' }], rpcUrl);
    return r.value.blockhash;
  }

  async function compileWrapTx(pool, owner, depositRaw, rpcUrl) {
    var built = await buildWrapInstructions(pool, owner, depositRaw);
    var bh = await latestBlockhash(rpcUrl);
    var compiled = OpenZooCodec.compileLegacyTx(owner, bh, built.ixs);
    return {
      transaction: compiled.base64,
      userWrapped: built.userWrapped,
      userUnderlying: built.userUnderlying,
      accountCount: built.ixs[1].accountCount,
      bump: built.ixs[1].bump
    };
  }

  function signAndSendViaBridge(txB64) {
    return new Promise(function (resolve, reject) {
      var id = 'wrap-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
      var settled = false;
      var timer = setTimeout(function () {
        if (settled) return;
        settled = true;
        window.removeEventListener('message', onMsg);
        reject(new Error('Wallet send timed out. Approve the top-up in Jupiter Wallet.'));
      }, 120000);

      function finish(fn, val) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        window.removeEventListener('message', onMsg);
        fn(val);
      }

      function onMsg(ev) {
        if (ev.source !== window.parent) return;
        var d = ev.data;
        if (!d || d.id !== id) return;
        if (d.type !== 'wallet-sign-and-send-response') return;
        if (d.error) finish(reject, new Error(d.error));
        else finish(resolve, d.signature);
      }

      window.addEventListener('message', onMsg);
      window.parent.postMessage({
        type: 'wallet-sign-and-send-transaction',
        id: id,
        transaction: txB64
      }, '*');
      window.parent.postMessage({ type: 'wallet-claim-sign', id: id }, '*');
    });
  }

  return {
    SUPPORTED_URL: SUPPORTED_URL,
    WRAP_PROGRAM: WRAP_PROGRAM,
    DRAINED_MINT: DRAINED_MINT,
    WTOKENx2: WTOKENx2,
    TOKEN_MINT: TOKEN_MINT,
    USDC_MINT: USDC_MINT,
    LEOS_MINT: LEOS_MINT,
    TOKEN_2022: TOKEN_2022,
    TOKEN_LEGACY: TOKEN_LEGACY,
    MINIMUM_LIQUIDITY: MINIMUM_LIQUIDITY,
    WTOKENx2_BUMP: WTOKENx2_BUMP,
    WTOKENx2_ACCOUNTS: WTOKENx2_ACCOUNTS,
    userFacingSymbol: userFacingSymbol,
    hideDrained: hideDrained,
    railLabel: railLabel,
    acquireDirectory: acquireDirectory,
    solanaKinds: solanaKinds,
    acquireForMint: acquireForMint,
    findTwinForUnderlying: findTwinForUnderlying,
    depositForShares: depositForShares,
    wrapIx: wrapIx,
    buildWrapInstructions: buildWrapInstructions,
    poolState: poolState,
    compileWrapTx: compileWrapTx,
    signAndSendViaBridge: signAndSendViaBridge,
    rpc: rpc
  };
})(typeof OpenZooCodec !== 'undefined' ? OpenZooCodec : require('./codec.js'));

if (typeof module !== 'undefined' && module.exports) module.exports = OpenZooWrap;
