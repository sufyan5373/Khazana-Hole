// Runs at build time on Vercel: grabs the latest yt-dlp Linux binary into ./bin
const fs = require('fs'), path = require('path');
(async () => {
  const dir = path.join(__dirname, '..', 'bin'), f = path.join(dir, 'yt-dlp');
  fs.mkdirSync(dir, { recursive: true });
  const asset = process.platform === 'win32' ? 'yt-dlp.exe' : process.platform === 'darwin' ? 'yt-dlp_macos' : 'yt-dlp_linux';
  console.log('Fetching', asset);
  const r = await fetch('https://github.com/yt-dlp/yt-dlp/releases/latest/download/' + asset);
  if (!r.ok) throw Error('yt-dlp download failed: HTTP ' + r.status);
  fs.writeFileSync(f, Buffer.from(await r.arrayBuffer())); fs.chmodSync(f, 0o755);
  console.log('yt-dlp ready,', (fs.statSync(f).size / 1048576).toFixed(1), 'MB');
})().catch(e => { console.error(e); process.exit(1); });
