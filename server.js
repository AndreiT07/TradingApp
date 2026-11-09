import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { request, EnvHttpProxyAgent } from 'undici';
import { companies } from './companies.js';
import { parseFeed } from './news.js';

const dispatcher = new EnvHttpProxyAgent();
const cache = new Map();
const TTL = 5 * 60_000;
const pending = new Map();
const assets = { '/': ['index.html', 'text/html; charset=utf-8'], '/app.js': ['app.js', 'text/javascript; charset=utf-8'], '/styles.css': ['styles.css', 'text/css; charset=utf-8'] };
function json(res, status, data) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(data));
}
async function getNews(company) {
  const existing = cache.get(company.ticker);
  if (existing && Date.now() - existing.timestamp < TTL) return { ...existing.data, cached: true };
  if (pending.has(company.ticker)) return pending.get(company.ticker);
  const job = (async () => {
    try {
      const url = new URL('https://news.google.com/rss/search');
      url.search = new URLSearchParams({ q: `${company.query} when:7d`, hl: 'en-US', gl: 'US', ceid: 'US:en' });
      const response = await request(url, { dispatcher, signal: AbortSignal.timeout(12_000), maxRedirections: 0,
        headers: { 'user-agent': 'TradingApp/0.1 RSS reader', accept: 'application/rss+xml, application/xml, text/xml' } });
      if (response.statusCode !== 200) { await response.body.dump(); throw new Error(`Feed status ${response.statusCode}`); }
      const chunks = [];
      let bytes = 0;
      for await (const chunk of response.body) {
        bytes += chunk.length;
        chunks.push(chunk);
        if (bytes > 2_000_000) { response.body.destroy(); throw new Error('Feed too large'); }
      }
      const data = { ticker: company.ticker, articles: parseFeed(Buffer.concat(chunks).toString('utf8'), company), fetchedAt: new Date().toISOString(), stale: false, cached: false };
      cache.set(company.ticker, { timestamp: Date.now(), data });
      return data;
    } catch {
      if (existing) return { ...existing.data, cached: true, stale: true };
      throw new Error('NEWS_UNAVAILABLE');
    } finally { pending.delete(company.ticker); }
  })();
  pending.set(company.ticker, job);
  return job;
}
export function makeServer() {
  return createServer(async (req, res) => {
    res.setHeader('x-content-type-options', 'nosniff');
    res.setHeader('referrer-policy', 'strict-origin-when-cross-origin');
    res.setHeader('content-security-policy', "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
    if (!['GET', 'HEAD'].includes(req.method)) { res.setHeader('allow', 'GET, HEAD'); return json(res, 405, { error: 'METHOD_NOT_ALLOWED' }); }
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/api/health') return json(res, 200, { status: 'ok' });
    if (url.pathname === '/api/companies') return json(res, 200, companies.map(({ query, keywords, ...company }) => company));
    if (url.pathname === '/api/news') {
      const ticker = url.searchParams.get('ticker') || 'AAPL';
      const company = companies.find(c => c.ticker === ticker);
      if (!company) return json(res, 400, { error: 'UNKNOWN_COMPANY', message: 'Companie necunoscută.' });
      try { return json(res, 200, await getNews(company)); }
      catch { return json(res, 503, { error: 'NEWS_UNAVAILABLE', message: 'Sursa de știri nu poate fi accesată momentan. Încearcă din nou mai târziu.' }); }
    }
    const asset = assets[url.pathname];
    if (!asset) return json(res, 404, { error: 'NOT_FOUND' });
    try { res.writeHead(200, { 'content-type': asset[1] }); res.end(await readFile(new URL(`./public/${asset[0]}`, import.meta.url))); }
    catch { res.end(); }
  });
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const port = Number(process.env.PORT || 3000);
  makeServer().listen(port, process.env.HOST || '0.0.0.0', () => console.log(`TradingApp listening on port ${port}`));
}
