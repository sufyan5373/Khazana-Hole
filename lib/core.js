// Khazana Hole — core logic for the Vercel function (stateless: one request = one download).
const fs = require('fs'), os = require('os'), path = require('path'), net = require('net');
const dns = require('dns').promises, { spawn } = require('child_process');
const TMP = os.tmpdir();
const MAX_SECONDS = +process.env.MAX_SECONDS || 270;      // keep below the function's maxDuration
const MAX_FILESIZE = process.env.MAX_FILESIZE || '200M';  // /tmp on Vercel is ~512 MB; merging needs ~2x

// ---------- binaries (copied to /tmp on cold start so they're executable) ----------
function stage(src, name) {
  const dst = path.join(TMP, name);
  if (!fs.existsSync(dst)) { fs.copyFileSync(src, dst); fs.chmodSync(dst, 0o755); }
  return dst;
}
let YT = null, FF = null;
function bins() {
  if (!YT) {
    const local = path.join(__dirname, '..', 'bin', 'yt-dlp');
    YT = fs.existsSync(local) ? stage(local, 'yt-dlp') : null;
    try { FF = stage(require('ffmpeg-static'), 'ffmpeg'); } catch { FF = null; }
  }
  return { YT, FF };
}

// ---------- safety: block localhost / LAN targets ----------
function priv(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return a === 10 || a === 127 || a === 0 || a >= 224 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
  }
  const l = ip.toLowerCase(); if (l.startsWith('::ffff:')) return priv(l.slice(7));
  return l === '::1' || l === '::' || /^f[cd]/.test(l) || /^fe[89ab]/.test(l);
}
async function safe(u) {
  const x = new URL(u);
  if (!/^https?:$/.test(x.protocol)) throw Error('Only http(s) links');
  const a = await dns.lookup(x.hostname, { all: true });
  if (!a.length || a.some(i => priv(i.address))) throw Error('Blocked address');
  return x;
}
async function open(u) {
  for (let i = 0; i < 6; i++) {
    const x = await safe(u);
    const r = await fetch(x, { redirect: 'manual', headers: { 'user-agent': 'Mozilla/5.0 KhazanaHole' } });
    const loc = r.headers.get('location');
    if (r.status >= 300 && r.status < 400 && loc) { r.body && r.body.cancel(); u = new URL(loc, x).href; continue; }
    return { r, url: u };
  }
  throw Error('Too many redirects');
}
const isHtml = r => (r.headers.get('content-type') || '').includes('text/html');
const EXT = { 'text/html': '.html', 'application/pdf': '.pdf', 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'video/mp4': '.mp4', 'audio/mpeg': '.mp3', 'application/zip': '.zip', 'application/json': '.json', 'text/plain': '.txt' };
function fname(r, u) {
  const cd = r.headers.get('content-disposition') || '';
  const m = /filename\*=UTF-8''([^;]+)/i.exec(cd) || /filename="?([^";]+)"?/i.exec(cd);
  let n = ''; try { n = decodeURIComponent(m ? m[1] : new URL(u).pathname.split('/').pop() || ''); } catch { }
  n = n.replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').trim();
  if (!n || /^\.+$/.test(n)) n = 'khazana-' + Date.now();
  if (!path.extname(n)) n += EXT[(r.headers.get('content-type') || '').split(';')[0]] || (isHtml(r) ? '.html' : '');
  return n;
}

// ---------- yt-dlp ----------
function ytdlp(dir, url, mode, q) {
  const { YT, FF } = bins();
  if (!YT) return Promise.reject(Error('yt-dlp binary missing from deployment'));
  return new Promise((res, rej) => {
    const H = +q || 1080;
    const a = ['--no-playlist', '--no-warnings', '--windows-filenames', '--no-progress', '--socket-timeout', '20', '--retries', '2',
      '--max-filesize', MAX_FILESIZE, '--cache-dir', path.join(TMP, 'yt-cache'),
      '--js-runtimes', 'node:' + process.execPath, '--remote-components', 'ejs:github',
      '-o', path.join(dir, '%(title).80B.%(ext)s')];
    if (FF) a.push('--ffmpeg-location', FF);
    if (process.env.YT_COOKIES) { // paste a Netscape-format cookies.txt into this env var (helps with YouTube/Instagram bot checks)
      const cf = path.join(TMP, 'cookies.txt'); fs.writeFileSync(cf, process.env.YT_COOKIES); a.push('--cookies', cf);
    }
    if (mode === 'image') { /* default format: photo posts */ }
    else if (mode === 'audio') a.push(...(FF ? ['-x', '--audio-format', 'mp3'] : ['-f', 'ba/b']));
    else if (FF) a.push('-f', `bv*[height<=${H}]+ba/b[height<=${H}]/bv*+ba/b`, '-S', H > 1080 ? 'res,vcodec:vp9,acodec:m4a' : 'vcodec:h264,res,acodec:m4a', '--merge-output-format', 'mp4');
    else a.push('-f', 'b/best');
    if (process.env.YTDLP_ARGS) a.push(...process.env.YTDLP_ARGS.split(/\s+/).filter(Boolean)); // optional extra yt-dlp flags
    a.push(url);
    const p = spawn(YT, a, { env: { ...process.env, HOME: TMP, TMPDIR: TMP } });
    let err = ''; p.stderr.on('data', d => { err += d; if (err.length > 20000) err = err.slice(-10000); });
    const timer = setTimeout(() => { p.kill('SIGKILL'); }, MAX_SECONDS * 1000);
    let killed = false; p.on('close', (code, sig) => { killed = sig === 'SIGKILL'; });
    p.on('error', e => { clearTimeout(timer); rej(e); });
    p.on('close', code => {
      clearTimeout(timer);
      const fl = fs.readdirSync(dir).filter(f => !/\.(part|ytdl|temp)$/.test(f)).map(f => ({ f, s: fs.statSync(path.join(dir, f)).size })).sort((x, y) => y.s - x.s);
      if (code === 0 && fl.length) return res({ file: path.join(dir, fl[0].f), name: fl[0].f, size: fl[0].s });
      if (killed) return rej(Error('Took too long for a serverless function — try a lower quality or a shorter video'));
      rej(Error((err.split('\n').filter(l => /ERROR/.test(l)).pop() || 'yt-dlp failed').replace(/^ERROR:\s*/, '').slice(0, 300)));
    });
  });
}

// ---------- resolve a link into something streamable ----------
// returns { remote: Response, name } for pass-through streaming, or { file, name, size } for a file in /tmp
async function resolve(dir, link, mode, q) {
  await safe(link);
  let r = null, url = link;
  try { ({ r, url } = await open(link)); } catch (e) { if (/^(Blocked|Only)/.test(e.message)) throw e; }
  if (r && r.ok && !isHtml(r)) return { remote: r, name: fname(r, url) };
  r && r.body && r.body.cancel();
  const page = async () => { const o = await open(url); return { remote: o.r, name: fname(o.r, o.url) }; };
  if (mode === 'image') {
    if (!/(^|\.)(youtube\.com|youtu\.be)$/i.test(new URL(url).hostname)) { try { return await ytdlp(dir, url, mode, q); } catch { } }
    const o = await open(url), h = await o.r.text();
    const m = /<meta[^>]+(?:property|name)=["'](?:og:image(?::secure_url)?|twitter:image)["'][^>]*content=["']([^"']+)/i.exec(h) || /<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["'](?:og:image|twitter:image)["']/i.exec(h);
    if (!m) throw Error('No image found on that page');
    const i = await open(new URL(m[1].replace(/&amp;/g, '&'), o.url).href);
    if (!i.r.ok) throw Error('Image returned ' + i.r.status);
    return { remote: i.r, name: fname(i.r, i.url) };
  }
  try { return await ytdlp(dir, url, mode, q); }
  catch (e) { if (r && r.ok) return await page(); throw e; }
}
module.exports = { resolve, ytdlp };
