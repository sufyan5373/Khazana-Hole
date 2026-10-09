# Khazana Hole — Vercel edition

The original `khazana-hole.js` is a long-running server (in-memory jobs, downloads yt-dlp at runtime).
Vercel functions are stateless and short-lived, so this version is split up:

- `public/index.html` — the same UI (calls `/api/download`)
- `api/download.js` — one request = one download; streams the file straight back
- `lib/core.js` — SSRF guard + yt-dlp / ffmpeg logic from the original
- `scripts/fetch-ytdlp.js` — runs at build time and bundles the latest yt-dlp Linux binary
- `ffmpeg-static` (npm) — bundled ffmpeg for mp3 and video/audio merging

## Deploy
    npm i -g vercel
    cd khazana-hole-vercel
    vercel          # preview
    vercel --prod

Or push to GitHub and import the repo in the Vercel dashboard (vercel.json already has the settings).

## Env vars (Project > Settings > Environment Variables), all optional
- `ACCESS_KEY`  password the page asks for once. Strongly recommended, otherwise anyone can use your quota.
- `YT_COOKIES`  contents of a Netscape cookies.txt. YouTube/Instagram often block datacenter IPs ("confirm you're not a bot"); logged-in cookies help.
- `MAX_FILESIZE` (default 200M), `MAX_SECONDS` (default 270), `YTDLP_ARGS` (extra yt-dlp flags)

## Limits
- Function time is set to 300s in vercel.json; if your plan rejects that, lower it (e.g. 60) and set MAX_SECONDS below it.
- /tmp is ~512 MB, so downloads are capped at 200 MB by default (4K usually won't fit).
- The browser buffers the stream before saving, so very large files use browser memory.

## Local test
    npm install && node scripts/fetch-ytdlp.js && node dev.js    # http://localhost:3000
