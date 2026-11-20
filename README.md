# My Anime (`my-anime-tizenbrew`)

Standalone, ad-free Anime streaming module for **Samsung Tizen 3.0 TVs (Chromium 47 / UN50MU6100)** running on **TizenBrew**.

Runs **100% inside the TV** with zero PC dependency once installed:
- **On-TV Background Service (`dist/service.js`)**: Runs inside TizenBrew's internal Node.js (`v4.4.3`) on `127.0.0.1:8092`.
  - Fetches anime catalog, search results, episode lists, and streams from `anizone.to` & `*.vid-cdn.xyz` (anchored on **GlobalSign Root CA**, natively trusted by Tizen 3.0 / 2017).
  - Exposes a local WebSocket bridge (`ws://127.0.0.1:8092`) + HTTP RPC fallback (`http://127.0.0.1:8092/rpc`).
  - Runs a local HTTP proxy (`http://127.0.0.1:8092/proxy`) that injects required `Referer`/`Origin` headers, rewrites `.m3u8` master/variant playlists, selects SUB (`ja`) or DUB (`en`) audio tracks, and pipes `.ts` segments & AES-128 `.key` files cleanly with CORS headers.
  - Runs a local subtitle converter (`http://127.0.0.1:8092/sub`) that converts `.srt` / `.ass` tracks into standard **WebVTT (`.vtt`)** on the fly.
  - Persists watch history (`animeId`, `title`, `poster`, `episodeNumber`, `timestamp`, `duration`, `audioMode`) to `/home/owner/share/history.json` on the TV.
- **On-TV Frontend UI (`dist/index.js`)**: Strictly ES5-compatible for Tizen 3.0 / Chromium 47.
  - ES5 polyfills injected at the top (`Object.values`, `Object.entries`, `Array.prototype.includes`, `String.prototype.padStart`, etc.).
  - Full Samsung TV remote D-Pad (`ArrowUp/Down/Left/Right`, `Enter`, `Return/Back`) and media key navigation.
  - Home screen with **Continue Watching** rail (from `history.json`), **New Episode Releases**, **Trending & Popular Anime**, and **Search Bar**.
  - Anime Details & Episode list with **SUB (Japanese) / DUB (English)** toggle and 50-episode chunk pagination.
  - Fullscreen `<video>` player powered by `hls.js@0.14.17`, WebVTT subtitles, automatic watch progress saving every 10 seconds, and an on-screen **Next Episode** button.

## Installation on Samsung TV (via TizenBrew)

1. Open **TizenBrew** on your Samsung TV.
2. Go to **Module Manager** → **Add GitHub**.
3. Enter:
   ```
   AllanCFE/my-anime-tizenbrew
   ```
4. Launch **My Anime** from the TizenBrew Home screen.
