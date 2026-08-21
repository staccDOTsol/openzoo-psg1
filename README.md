# OpenZoo — Play Solana PSG1

OpenZoo on the [Play Solana](https://playsolana.com) Gen1 handheld: the **grokui** product (threads, chat, wallet), not a thin fly.dev form. Bind is abstract — attach files, a folder, or text, and the app remembers them behind the scenes. Native wallet is **Jupiter Wallet** via [Mobile Wallet Adapter](https://docs.solanamobile.com/getting-started/overview). Same payment path as Seeker. There is no iOS target and no iOS deeplink.

Widget / package id: **`fun.openzoo.psg1`**.

The phone talks to `https://x402-tokens.fly.dev` directly for **chat / x402**. CORS is live. There is no local proxy hop. `connect-src` allows that gateway, `https://x402.accrue.fund` (live `/supported`), `https://api.mainnet-beta.solana.com` (the RPC wrap/balances actually call), and `https://zoo.openzoo.fun` (Agent `/ide/session` + subscription key ingest). Never `api.anthropic.com`. Never `ANTHROPIC_API_KEY`. Never an open URL.

Wallet addresses are selectable. Tap an address (or select text) to copy it; a **copied** toast confirms. Copy uses the Android clipboard via the Cordova MWA plugin — `navigator.clipboard` is not a secure-context API in this WebView. This handheld pays from Jupiter Wallet, not a local burner.

A 402 is written to `sessionStorage` before Jupiter opens. When MWA backgrounds the app, in-flight `fetch` can throw WebView `Load failed` / `TypeError` — those are never shown. On `resume`, pay/build runs again with a fresh blockhash.

## What ships

| Surface | Role |
|---|---|
| `www/index.html` | Wallet shell. Owns MWA. Never app logic. |
| `www/app/` | grokui-on-a-phone: threads, **chat** (x402), **Agent** (cloud code-server + Cline) |
| `cordova-plugin-mwa` | Native MWA: `authorize`, `signMessage`, `signTransaction` (402), `signAndSendTransaction` (wrap only) |

```
┌────────────────────────────────────────────┐
│ www/index.html  (wallet shell)             │
│  • MWA connect — Jupiter Wallet on PSG1    │
│  ┌──────────────────────────────────────┐  │
│  │ iframe: www/app/                     │  │
│  │  threads / chat / Agent              │  │
│  │  chat: x402 + MWA                    │  │
│  │  Agent: /ide/session → IDE webview   │  │
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
| app → shell | `wallet-copy-text` | `{ id, text }` → Android clipboard |
| shell → app | `app-pause` / `app-resume` | MWA background / return — retry pay/build |

`wallet-sign-transaction` calls **`MWA.signTransaction`**. Never `signAndSendTransaction` for x402 — the gateway feePayer must complete settlement. Wrap / top-up is the only send path.

## Payment

1. Rails come from live `GET https://x402.accrue.fund/supported`.
2. `POST https://x402-tokens.fly.dev/v1/chat/completions` (any `Authorization`; payment is the auth).
3. On **402**: keep Solana `exact` rows. Hide drained mint `Bo7xBF7SY8EyUBPUxRP66SFafxoPf2n5uqiLjbxEebx9`. Mint `FXYkwMtfKpA174rp8ixVeiGs5TYGaBsYRrHE3KrR449B` is **wTOKENx2**, never wTOKENx.
4. If the wallet already holds a live twin, pay that rail.
5. Else ez-mode wrap: `pickLargestUseful` gates on **held > 0** / `depositForShares`. It must not compare TOKEN raw to the twin's `maxAmountRequired` — ~$10 TOKEN (`EVULoNF4…`) is enough to wrap into wTOKENx2. Prompt: *You have TOKEN. Wrap enough to send this?* Then wrap, confirm, pay. Short SOL or short tokens: say which to send, show a **copyable address**, toast on tap. Persist the 402 across MWA backgrounding. Wrap via wrap-nav `FrSERTNCPvTtaDS9AvQp9u1nYGzXDb3kC9MdL8Xxn2NE` using directory `acquire`. wTOKENx2 is **nine accounts**, bump **254**. Wrap **may send**.
6. `POST /v1/pay/build` → `MWA.signTransaction` → retry with `X-PAYMENT`. Partial-sign only. Do not rebuild the payment tx.

The wallet address is tap-to-copy. Errors stay human — never a raw "Load failed".

The UI never shows context ids, bind routes, bind hashes, or wrap-twin homework. Wallet copy talks about USDC / TOKEN / LEOS.

Desktop RUN / WRITE / READ / SERVE are not on this handheld. Agent is **not** an open PTY and **not** hosted OCC — it is a cloud **code-server + Cline** session loaded in a webview.

## Agent (cloud code-server + Cline)

Chat stays the x402 / Jupiter Wallet pay path. Do not strip it.

**Agent = cloud code-server + Cline**, gated on `Authorization: Bearer <subscription key>` on `POST`/`GET` `/ide/session`. No key → no Agent. The key is pasted from [zoo.openzoo.fun/subscriptions](https://zoo.openzoo.fun/subscriptions) (or the billing success URL). It is never an Anthropic API key. Chat still uses the x402/MWA wallet lane; Agent uses the subscription Bearer, not a wallet token. Never an open URL — the webview only loads an `https` OpenZoo host returned by `/ide/session`.

Door (one path set only): `https://zoo.openzoo.fun`

| Method | Path | Body |
|---|---|---|
| `POST` | `/ide/session` | `{ threadId, name }` → `{ url, password?, id }` |
| `GET` | `/ide/session` | → `{ url, password?, id }` |

A request without `Authorization: Bearer <key>` is 401 — no Agent. Never `ANTHROPIC_API_KEY`. Never an open URL. The `{ url, password? }` is loaded in the Agent webview (`#agentFrame`). On the PSG1 handheld that webview is **full-bleed**: `viewport-fit=cover`, `#agentFrame` fills Agent mode, no desktop VS Code chrome letterbox. The Chat composer (`#bar`) is hidden in Agent mode. Chat still pays x402. `frame-src` allows only `https://zoo.openzoo.fun` and `https://*.openzoo.fun`.

Chat (unchanged x402 lane):

| Method | Route | Auth |
|---|---|---|
| `POST` | `/v1/chat/completions` | any `Authorization` + `X-PAYMENT` after 402 |
| `POST` | `/v1/hrr/bind` | same x402 loop (silent attach) |
| `POST` | `/v1/pay/build` | none — unsigned tx for MWA |
| `GET` | `/v1/models` | same x402 loop if quoted |

Key ingest (not Agent IDE):

| Method | Route |
|---|---|
| `GET` | `https://zoo.openzoo.fun/api/billing/tiers` |
| `GET` | `https://zoo.openzoo.fun/api/billing/key?session=` |
| page | `https://zoo.openzoo.fun/subscriptions` |

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
