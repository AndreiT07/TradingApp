import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { companies } from './companies.js';
import { Research } from './lib/research.js';
const assets = { '/': ['index.html', 'text/html; charset=utf-8'], '/app.js': ['app.js', 'text/javascript; charset=utf-8'], '/styles.css': ['styles.css', 'text/css; charset=utf-8'], '/i18n.js': ['i18n.js', 'text/javascript; charset=utf-8'] };
function json(res, status, data) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(data));
}
export function makeServer({ research } = {}) {
  const service = research ?? new Research();
  const server = createServer(async (req, res) => {
    res.setHeader('x-content-type-options', 'nosniff');
    res.setHeader('referrer-policy', 'strict-origin-when-cross-origin');
    res.setHeader('content-security-policy', "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
    if (!['GET', 'HEAD'].includes(req.method)) { res.setHeader('allow', 'GET, HEAD'); return json(res, 405, { error: 'METHOD_NOT_ALLOWED' }); }
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/api/health') return json(res, 200, { status: 'ok' });
    if (url.pathname === '/api/companies') return json(res, 200, companies.map(({ query, keywords, ...company }) => company));
    if (['/api/news', '/api/investors', '/api/analysis'].includes(url.pathname)) {
      const lang = url.searchParams.get('lang') || 'ro';
      if (!['ro', 'en'].includes(lang)) return json(res, 400, { error: 'INVALID_LANGUAGE' });
      const ticker = url.searchParams.get('ticker') || 'AAPL';
      const company = companies.find(c => c.ticker === ticker);
      if (!company) return json(res, 400, { error: 'UNKNOWN_COMPANY', message: 'Companie necunoscută.' });
      try { return json(res, 200, await (url.pathname === '/api/news' ? service.news(company, lang) : url.pathname === '/api/investors' ? service.investors(company) : service.analysis(company, lang))); }
      catch { return json(res, 503, { error: 'NEWS_UNAVAILABLE', message: 'Sursa de știri nu poate fi accesată momentan. Încearcă din nou mai târziu.' }); }
    }
    const asset = assets[url.pathname];
    if (!asset) return json(res, 404, { error: 'NOT_FOUND' });
    try { res.writeHead(200, { 'content-type': asset[1] }); res.end(await readFile(new URL(`./public/${asset[0]}`, import.meta.url))); }
    catch { res.end(); }
  });
  server.on('close', () => { service.stop().catch(() => {}); });
  return server;
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const port = Number(process.env.PORT || 3000);
  const research = new Research();
  const server = makeServer({ research });
  server.listen(port, process.env.HOST || '0.0.0.0', () => { console.log(`TradingApp listening on port ${port}`); research.start(); });
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, async () => {
    const timeout = setTimeout(() => process.exit(1), 30000); timeout.unref();
    server.close(); await research.stop(); clearTimeout(timeout);
  });
}
