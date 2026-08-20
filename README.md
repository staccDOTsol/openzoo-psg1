# OpenZoo — Play Solana PSG1

OpenZoo on the [Play Solana](https://playsolana.com) Gen1 handheld: the **grokui** product (threads, chat, wallet), not a thin fly.dev form. Bind is abstract — attach files, a folder, or text, and the app remembers them behind the scenes. Native wallet is **Jupiter Wallet** via [Mobile Wallet Adapter](https://docs.solanamobile.com/getting-started/overview). Same payment path as Seeker. There is no iOS target and no iOS deeplink.

Widget / package id: **`fun.openzoo.psg1`**.

The phone talks to `https://x402-tokens.fly.dev` directly. CORS is live. There is no local proxy hop.

## What ships

| Surface | Role |
|---|---|
| `www/index.html` | Wallet shell. Owns MWA. Never app logic. |
| `www/app/` | grokui-on-a-phone: thread sidebar, chat canvas, wallet overlay |
| `cordova-plugin-mwa` | Native MWA: `authorize`, `signMessage`, `signTransaction` (402), `signAndSendTransaction` (wrap only) |

```
┌────────────────────────────────────────────┐
│ www/index.html  (wallet shell)             │
│  • MWA connect — Jupiter Wallet on PSG1    │
│  ┌──────────────────────────────────────┐  │
│  │ iframe: www/app/                     │  │
│  │  threads / chat / wallet             │  │
│  │  attach files quietly                │  │
│  │  POST https://x402-tokens.fly.dev    │  │
│  └──────────────────────────────────────┘  │
└────────────────────────────────────────────┘
```

Bridge messages:

| direction | type | payload |
|---|---|---|
| shell → app | `wallet-connected` | `{ address, method }` |
| shell → app | `wallet-disconnected` | — |
| app → shell | `wallet-request-info` | late init |
| app → shell | `wallet-disconnect` | exit to shell |
| app → shell | `wallet-sign-transaction` | `{ id, transaction }` → partial-sign only |
| app → shell | `wallet-sign-and-send-transaction` | `{ id, transaction }` → wrap / top-up may send |

`wallet-sign-transaction` calls **`MWA.signTransaction`**. Never `signAndSendTransaction` for x402 — the gateway feePayer must complete settlement. Wrap / top-up is the only send path.

## Payment

1. Rails come from live `GET https://x402.accrue.fund/supported`.
2. `POST https://x402-tokens.fly.dev/v1/chat/completions` (any `Authorization`; payment is the auth).
3. On **402**: keep Solana `exact` rows. Hide drained mint `Bo7xBF7SY8EyUBPUxRP66SFafxoPf2n5uqiLjbxEebx9`. Mint `FXYkwMtfKpA174rp8ixVeiGs5TYGaBsYRrHE3KrR449B` is **wTOKENx2**, never wTOKENx.
4. If the wallet already holds a live twin, pay that rail.
5. Else ez-mode wrap: detect TOKEN (`EVULoNF4…`), USDC, LEOS, or a live twin, and wrap via wrap-nav `FrSERTNCPvTtaDS9AvQp9u1nYGzXDb3kC9MdL8Xxn2NE` using directory `acquire`. wTOKENx2 is **nine accounts**, bump **254** (see `staccDOTsol/openzoo` `lib/wrap.js`). Wrap **may send**.
6. `POST /v1/pay/build` → `MWA.signTransaction` → retry with `X-PAYMENT`. Partial-sign only. Do not rebuild the payment tx.

The UI never shows context ids, bind routes, bind hashes, or wrap-twin homework. Wallet copy talks about USDC / TOKEN / LEOS.

Desktop RUN / WRITE / READ / SERVE are not on this handheld.

## Build the Android APK

```bash
npm install
npx cordova prepare android
npm test
npm run verify:gateway
npm run build
```

Debug APK: `platforms/android/app/build/outputs/apk/debug/app-debug.apk`

`platforms/` and `plugins/` are gitignored.

Release: copy `build.example.json` to `build.json`, then `npm run build:release`.

Consumer PSG1 devices cannot sideload. Ship through [PlayGate](https://playgate.playsolana.com/) or a DevKit.

## Explicit non-goals

- **No iOS.** MWA is Java. No Phantom/Solflare deeplinks.
- **No local proxy hop.** The phone calls the live gateway.
- **No Seeker-store copy** as the primary path. Jupiter Wallet on PSG1 is native.

## License

MIT
