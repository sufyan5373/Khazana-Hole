const fs = require('fs'), os = require('os'), path = require('path');
const { Readable } = require('stream'), { pipeline } = require('stream/promises');
const { resolve } = require('../lib/core');

const json = (res, c, o) => { res.statusCode = c; res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(o)); };

module.exports = async (req, res) => {
  const u = new URL(req.url, 'http://x'), q = u.searchParams;
  // optional password gate: set ACCESS_KEY in Vercel env vars to stop strangers using your quota
  if (process.env.ACCESS_KEY && req.headers['x-key'] !== process.env.ACCESS_KEY) return json(res, 401, { error: 'Access key required' });
  let link = (q.get('url') || '').trim(); if (!link) return json(res, 400, { error: 'No link' });
  if (!/^[a-z]+:\/\//i.test(link)) link = 'https://' + link;
  const mode = ['audio', 'image'].includes(q.get('mode')) ? q.get('mode') : 'video';
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kh-'));
  const clean = () => fs.rm(dir, { recursive: true, force: true }, () => { });
  try {
    const out = await resolve(dir, link, mode, q.get('q') || '1080');
    const h = { 'content-type': 'application/octet-stream', 'cache-control': 'no-store',
      'content-disposition': `attachment; filename="${out.name.replace(/[^\x20-\x7e]/g, '_').replace(/"/g, '')}"; filename*=UTF-8''${encodeURIComponent(out.name)}` };
    if (out.file) {
      h['content-length'] = out.size; res.writeHead(200, h);
      await pipeline(fs.createReadStream(out.file), res);
    } else {
      const len = +out.remote.headers.get('content-length') || 0;
      if (len && !out.remote.headers.get('content-encoding')) h['content-length'] = len;
      res.writeHead(200, h);
      await pipeline(Readable.fromWeb(out.remote.body), res);
    }
  } catch (e) {
    if (!res.headersSent) json(res, /^(Blocked|Only|No link)/.test(e.message) ? 400 : 502, { error: e.message });
    else res.destroy();
  } finally { clean(); }
};
