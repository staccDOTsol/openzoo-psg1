<img width="400" height="400" alt="CordovaSeeker" src="https://storage.proofnetwork.lol/cordova_seeker_true_transparent.png" />

# CordovaSeeker — open-source Seeker game template

> **Disclaimer:** This is an independent community project. It is **not** affiliated with,
> endorsed by, or officially related to Solana Mobile, the Solana Seeker, or the Solana
> Foundation in any way. "Seeker" is referenced only to describe device compatibility.

Build games for the [Solana Seeker](https://solanamobile.com/) phone with **plain web tech** —
no Unity, no React Native, no official Solana Mobile SDK wrappers. Just:

- **Apache Cordova** — wraps your HTML/JS game in a native Android APK
- **`cordova-plugin-mwa`** (included, ~300 lines of Java) — a minimal native
  [Mobile Wallet Adapter](https://docs.solanamobile.com/getting-started/overview) client:
  `authorize`, `signMessage`, `signTransaction`, `signAndSendTransaction`
- A **wallet shell** (`www/index.html`) that handles MWA connect + message signing, then
  runs your game in an iframe and talks to it over `postMessage`
- A demo **clicker game** (`www/game/`) that works fully offline

## How it works

```
┌─────────────────────────────────┐
│ www/index.html  (wallet shell)  │
│  • MWA native connect (Seeker)  │
│  ┌───────────────────────────┐  │
│  │ iframe: www/game/         │  │
│  │  your game — receives     │  │
│  │  wallet events via        │  │
│  │  postMessage              │  │
│  └───────────────────────────┘  │
└─────────────────────────────────┘
```

The shell owns all wallet state; the game never touches keys. Messages:

| direction | type | payload |
|---|---|---|
| shell → game | `wallet-connected` | `{ address, method }` |
| shell → game | `wallet-disconnected` | — |
| game → shell | `wallet-request-info` | ask for wallet info (late init) |
| game → shell | `wallet-disconnect` | exit back to the shell |
| game → shell | `wallet-sign-message` | `{ id, message }` → `wallet-sign-response` |

To ship a hosted game instead of a bundled one, point `GAME_URL` in `www/index.html`
at your https URL (and add it to the CSP `frame-src` + `config.xml`).

## Quick start

```bash
npm install -g cordova
npm install
cordova platform add android
cordova run android        # device or emulator
```

Requirements: Android SDK + JDK 17 (`cordova requirements android` to verify).

## Release builds

1. Create your own keystore:
   `keytool -genkey -v -keystore release.keystore -alias your-alias -keyalg RSA -keysize 2048 -validity 10000`
2. `cp build.json.example build.json` and fill in your passwords.
   **`build.json` and `*.keystore` are gitignored — never commit them.**
3. `npm run build:release`

## Make it yours

- `package.json` + `config.xml` — app id, name
- `cordova-plugin-mwa/src/android/MWAPlugin.java` — `IDENTITY_URI` / `IDENTITY_NAME`
  constants shown in the wallet approval dialog (and the Java package if you rename the app id)
- `www/index.html` — branding
- `www/game/` — replace the clicker with your game
- `res/icon/android/` — app icons

## License

MIT

<!-- hypertribe:sponsors:start -->
## Sponsors

[![CordovaSeeker Sponsors](https://api.tribe.run/tokens/HsHCt9JjeGgX3nTpBHh1Vkex267hq9iGNtr8dgxqkpqz/sponsors.svg)](https://tribe.run/token/HsHCt9JjeGgX3nTpBHh1Vkex267hq9iGNtr8dgxqkpqz)

Become a sponsor on [Tribe.run](https://tribe.run/token/HsHCt9JjeGgX3nTpBHh1Vkex267hq9iGNtr8dgxqkpqz).
<!-- hypertribe:sponsors:end -->
