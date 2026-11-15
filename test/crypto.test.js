import test from 'node:test';
import assert from 'node:assert/strict';
import { cryptoAssets } from '../crypto.js';
import { parseFeed } from '../news.js';
import { Research } from '../lib/research.js';
import { Store } from '../lib/store.js';
import { makeServer } from '../server.js';
const xml = () => `<rss><channel><item><title>Bitcoin regulation update</title><link>https://example.com/btc</link><pubDate>${new Date().toUTCString()}</pubDate><source>Reuters</source></item><item><title>Apple earnings</title><link>https://example.com/apple</link><pubDate>${new Date().toUTCString()}</pubDate></item></channel></rss>`;
test('crypto RSS filters unrelated stories and retains sources and categories', () => {
  const articles = parseFeed(xml(), cryptoAssets[1]);
  assert.equal(articles.length, 1);
  assert.equal(articles[0].source, 'Reuters');
  assert.equal(articles[0].category, 'Reglementări');
});
test('crypto uses five-minute RSS cache even with Finnhub configured, coalesces requests, and marks stale fallback', async () => {
  const store = new Store(':memory:'); let calls = 0;
  const research = new Research({ store, env: { FINNHUB_API_KEY:'test', DATA_PROVIDER_TERMS_ACCEPTED:'true' }, call: async url => {
    calls++; assert.equal(url.hostname, 'news.google.com');
    return { text: xml() };
  } });
  try {
    const [first, second] = await Promise.all([research.news(cryptoAssets[1]), research.news(cryptoAssets[1], 'en')]);
    assert.equal(calls, 1); assert.equal(second.lang, 'en');
    assert.equal(first.articles[0].summary.status, 'no_text');
    assert.deepEqual(first.setup.missing, []);
    store.db.prepare('UPDATE snapshots SET updated = ? WHERE key = ?').run(new Date(Date.now() - 3600000).toISOString(), 'news:BTC');
    const refreshed = await research.news(cryptoAssets[1]);
    assert.equal(calls, 2); assert.equal(refreshed.stale, false);
    store.db.prepare('UPDATE snapshots SET updated = ? WHERE key = ?').run(new Date(Date.now() - 3600000).toISOString(), 'news:BTC');
    research.call = async () => { throw new Error('offline'); };
    assert.equal((await research.news(cryptoAssets[1])).stale, true);
  } finally { await research.stop(); }
});
test('HTTP exposes crypto news but does not route assets into equity research', async () => {
  const server = makeServer({ research: { news: async asset => ({ ticker: asset.ticker, articles: [] }), stop: async () => {} } });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const assets = await (await fetch(`${base}/api/crypto`)).json();
    assert.equal(assets.length, 4); assert.equal(assets[0].query, undefined);
    for (const asset of assets) assert.equal((await (await fetch(`${base}/api/news?ticker=${asset.ticker}`)).json()).ticker, asset.ticker);
    for (const endpoint of ['analysis', 'investors']) assert.equal((await fetch(`${base}/api/${endpoint}?ticker=BTC`)).status, 400);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
