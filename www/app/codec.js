/* Minimal Solana codec for wrap txs. Payment still comes from /v1/pay/build. */
'use strict';

var OpenZooCodec = (function () {
  var B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  var ATA_PROGRAM = 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL';
  var SYSTEM_PROGRAM = '11111111111111111111111111111111';
  var P = (1n << 255n) - 19n;

  function assert(cond, msg) {
    if (!cond) throw new Error(msg || 'codec error');
  }

  function modP(n) {
    n %= P;
    return n < 0n ? n + P : n;
  }

  function powMod(b, e) {
    var r = 1n;
    b = modP(b);
    while (e > 0n) {
      if (e & 1n) r = modP(r * b);
      b = modP(b * b);
      e >>= 1n;
    }
    return r;
  }

  function inv(a) {
    return powMod(a, P - 2n);
  }

  var D = modP(-121665n * inv(121666n));

  function isOnCurve(bytes) {
    if (!bytes || bytes.length !== 32) return false;
    var y = 0n;
    var i;
    for (i = 0; i < 32; i++) y |= BigInt(bytes[i]) << (8n * BigInt(i));
    y &= (1n << 255n) - 1n;
    if (y >= P) return false;
    var y2 = modP(y * y);
    var num = modP(y2 - 1n);
    var den = modP(D * y2 + 1n);
    if (den === 0n) return false;
    var x2 = modP(num * inv(den));
    if (x2 === 0n) return true;
    return powMod(x2, (P - 1n) >> 1n) === 1n;
  }

  function b58decode(str) {
    var bytes = [0];
    var i, j, c, carry;
    for (i = 0; i < str.length; i++) {
      c = B58.indexOf(str[i]);
      if (c < 0) throw new Error('bad base58');
      carry = c;
      for (j = 0; j < bytes.length; j++) {
        carry += bytes[j] * 58;
        bytes[j] = carry & 0xff;
        carry >>= 8;
      }
      while (carry > 0) {
        bytes.push(carry & 0xff);
        carry >>= 8;
      }
    }
    for (i = 0; i < str.length && str[i] === '1'; i++) bytes.push(0);
    return new Uint8Array(bytes.reverse());
  }

  function b58encode(bytes) {
    var digits = [0];
    var i, j, carry;
    for (i = 0; i < bytes.length; i++) {
      carry = bytes[i];
      for (j = 0; j < digits.length; j++) {
        carry += digits[j] << 8;
        digits[j] = carry % 58;
        carry = (carry / 58) | 0;
      }
      while (carry > 0) {
        digits.push(carry % 58);
        carry = (carry / 58) | 0;
      }
    }
    var out = '';
    for (i = 0; i < bytes.length && bytes[i] === 0; i++) out += '1';
    for (i = digits.length - 1; i >= 0; i--) out += B58[digits[i]];
    return out;
  }

  function pubkey(str) {
    var raw = b58decode(str);
    if (raw.length > 32) raw = raw.slice(raw.length - 32);
    if (raw.length < 32) {
      var padded = new Uint8Array(32);
      padded.set(raw, 32 - raw.length);
      raw = padded;
    }
    return raw;
  }

  function concat() {
    var parts = arguments;
    var n = 0;
    var i;
    for (i = 0; i < parts.length; i++) n += parts[i].length;
    var out = new Uint8Array(n);
    var o = 0;
    for (i = 0; i < parts.length; i++) {
      out.set(parts[i], o);
      o += parts[i].length;
    }
    return out;
  }

  function sha256Sync(bytes) {
    if (typeof require === 'function') {
      var nodeCrypto = require('crypto');
      return new Uint8Array(nodeCrypto.createHash('sha256').update(Buffer.from(bytes)).digest());
    }
    throw new Error('sha256Sync needs Node or await sha256');
  }

  async function sha256(bytes) {
    if (typeof crypto !== 'undefined' && crypto.subtle) {
      return new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
    }
    return sha256Sync(bytes);
  }

  var PDA_MARKER = new TextEncoder().encode('ProgramDerivedAddress');

  async function findProgramAddress(seeds, programIdStr) {
    var program = pubkey(programIdStr);
    var bump;
    for (bump = 255; bump >= 0; bump--) {
      var parts = [];
      var i;
      for (i = 0; i < seeds.length; i++) parts.push(seeds[i]);
      parts.push(new Uint8Array([bump]));
      parts.push(program);
      parts.push(PDA_MARKER);
      var hash = await sha256(concat.apply(null, parts));
      if (!isOnCurve(hash)) return { address: b58encode(hash), bytes: hash, bump: bump };
    }
    throw new Error('unable to find program address');
  }

  async function associatedTokenAddress(ownerStr, mintStr, tokenProgramStr) {
    var found = await findProgramAddress(
      [pubkey(ownerStr), pubkey(tokenProgramStr), pubkey(mintStr)],
      ATA_PROGRAM
    );
    return found.address;
  }

  function compactU16(n) {
    if (n < 0x80) return new Uint8Array([n]);
    if (n < 0x4000) return new Uint8Array([(n & 0x7f) | 0x80, n >> 7]);
    return new Uint8Array([(n & 0x7f) | 0x80, ((n >> 7) & 0x7f) | 0x80, n >> 14]);
  }

  function u64le(n) {
    var x = BigInt(n);
    var out = new Uint8Array(8);
    var i;
    for (i = 0; i < 8; i++) {
      out[i] = Number(x & 0xffn);
      x >>= 8n;
    }
    return out;
  }

  function bytesToB64(bytes) {
    if (typeof Buffer !== 'undefined') return Buffer.from(bytes).toString('base64');
    var bin = '';
    var i;
    for (i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin);
  }

  function b64ToBytes(b64) {
    if (typeof Buffer !== 'undefined') return new Uint8Array(Buffer.from(b64, 'base64'));
    var bin = atob(b64);
    var out = new Uint8Array(bin.length);
    var i;
    for (i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  function accountKey(str) {
    return { str: str, bytes: pubkey(str) };
  }

  /**
   * Build a legacy unsigned transaction (one fee-payer signature slot).
   * ixs: [{ programId, keys: [{pubkey, isSigner, isWritable}], data: Uint8Array }]
   */
  function compileLegacyTx(feePayer, recentBlockhash, ixs) {
    var map = Object.create(null);
    function add(str, isSigner, isWritable) {
      var cur = map[str];
      if (!cur) {
        map[str] = { str: str, bytes: pubkey(str), isSigner: !!isSigner, isWritable: !!isWritable };
      } else {
        cur.isSigner = cur.isSigner || !!isSigner;
        cur.isWritable = cur.isWritable || !!isWritable;
      }
    }
    add(feePayer, true, true);
    var i, k, ix;
    for (i = 0; i < ixs.length; i++) {
      ix = ixs[i];
      add(ix.programId, false, false);
      for (k = 0; k < ix.keys.length; k++) {
        add(ix.keys[k].pubkey, ix.keys[k].isSigner, ix.keys[k].isWritable);
      }
    }
    var keys = Object.keys(map).map(function (s) { return map[s]; });
    keys.sort(function (a, b) {
      var rank = function (x) {
        if (x.str === feePayer) return 0;
        if (x.isSigner && x.isWritable) return 1;
        if (x.isSigner) return 2;
        if (x.isWritable) return 3;
        return 4;
      };
      return rank(a) - rank(b);
    });
    var indexOf = Object.create(null);
    for (i = 0; i < keys.length; i++) indexOf[keys[i].str] = i;

    var signed = 0;
    var roSigned = 0;
    var roUnsigned = 0;
    for (i = 0; i < keys.length; i++) {
      if (keys[i].isSigner) {
        signed++;
        if (!keys[i].isWritable) roSigned++;
      } else if (!keys[i].isWritable) roUnsigned++;
    }

    var header = new Uint8Array([signed, roSigned, roUnsigned]);
    var keyBytes = [compactU16(keys.length)];
    for (i = 0; i < keys.length; i++) keyBytes.push(keys[i].bytes);
    var bh = pubkey(recentBlockhash);
    var ixParts = [compactU16(ixs.length)];
    for (i = 0; i < ixs.length; i++) {
      ix = ixs[i];
      var prog = indexOf[ix.programId];
      assert(prog != null, 'missing program');
      ixParts.push(new Uint8Array([prog]));
      ixParts.push(compactU16(ix.keys.length));
      var accs = new Uint8Array(ix.keys.length);
      for (k = 0; k < ix.keys.length; k++) {
        accs[k] = indexOf[ix.keys[k].pubkey];
        assert(accs[k] != null, 'missing account');
      }
      ixParts.push(accs);
      ixParts.push(compactU16(ix.data.length));
      ixParts.push(ix.data);
    }
    var message = concat(header, concat.apply(null, keyBytes), bh, concat.apply(null, ixParts));
    var sigs = new Uint8Array(signed * 64);
    var serialized = concat(compactU16(signed), sigs, message);
    return {
      serialized: serialized,
      base64: bytesToB64(serialized),
      keys: keys.map(function (x) { return x.str; }),
      numRequiredSignatures: signed
    };
  }

  function createAtaIdempotentIx(payer, ata, owner, mint, tokenProgram) {
    return {
      programId: ATA_PROGRAM,
      keys: [
        { pubkey: payer, isSigner: true, isWritable: true },
        { pubkey: ata, isSigner: false, isWritable: true },
        { pubkey: owner, isSigner: false, isWritable: false },
        { pubkey: mint, isSigner: false, isWritable: false },
        { pubkey: SYSTEM_PROGRAM, isSigner: false, isWritable: false },
        { pubkey: tokenProgram, isSigner: false, isWritable: false }
      ],
      data: new Uint8Array([1])
    };
  }

  return {
    ATA_PROGRAM: ATA_PROGRAM,
    SYSTEM_PROGRAM: SYSTEM_PROGRAM,
    b58decode: b58decode,
    b58encode: b58encode,
    pubkey: pubkey,
    concat: concat,
    sha256: sha256,
    sha256Sync: sha256Sync,
    isOnCurve: isOnCurve,
    findProgramAddress: findProgramAddress,
    associatedTokenAddress: associatedTokenAddress,
    compactU16: compactU16,
    u64le: u64le,
    bytesToB64: bytesToB64,
    b64ToBytes: b64ToBytes,
    compileLegacyTx: compileLegacyTx,
    createAtaIdempotentIx: createAtaIdempotentIx
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = OpenZooCodec;
