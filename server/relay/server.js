// Minimal fetch relay: GET /?key=KEY&url=https://... → fetches the URL from this server's IP and returns the body.
// Used by the site build when a publisher blocks GitHub's datacenter IP range (Substack, Reddit, ...).
import { createServer } from 'node:http';

const PORT = Number(process.env.PORT) || 8080;
const KEY = process.env.RELAY_KEY || '';
const TIMEOUT = Number(process.env.RELAY_TIMEOUT_MS) || 20000;
const MAX_BYTES = 5 * 1024 * 1024;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';

function isPrivateHost(host) {
  return /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|0\.|\[?::1\]?$|\[?fc|\[?fd)/i.test(host);
}

createServer(async (req, res) => {
  const u = new URL(req.url, 'http://relay');
  if (u.pathname === '/healthz') { res.writeHead(200); return res.end('ok'); }
  if (req.method !== 'GET') { res.writeHead(405); return res.end(); }
  if (!KEY || u.searchParams.get('key') !== KEY) { res.writeHead(401); return res.end('bad key'); }
  let target;
  try { target = new URL(u.searchParams.get('url') || ''); } catch { res.writeHead(400); return res.end('bad url'); }
  if (!/^https?:$/.test(target.protocol) || isPrivateHost(target.hostname)) { res.writeHead(400); return res.end('refused'); }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT);
  try {
    const upstream = await fetch(target, {
      signal: controller.signal, redirect: 'follow',
      headers: { 'User-Agent': UA, Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9, text/html;q=0.8, */*;q=0.7', 'Accept-Language': 'en-US,en;q=0.9' },
    });
    const buf = Buffer.from(await upstream.arrayBuffer());
    if (buf.length > MAX_BYTES) { res.writeHead(502); return res.end('too large'); }
    res.writeHead(upstream.status, { 'Content-Type': upstream.headers.get('content-type') || 'application/octet-stream', 'Cache-Control': 'no-store', 'X-Relay-Status': String(upstream.status) });
    res.end(buf);
  } catch (err) {
    res.writeHead(504, { 'Content-Type': 'text/plain' });
    res.end(err.name === 'AbortError' ? 'upstream timeout' : String(err.message || err));
  } finally {
    clearTimeout(timer);
  }
}).listen(PORT, () => console.log(`relay listening on ${PORT}`));
