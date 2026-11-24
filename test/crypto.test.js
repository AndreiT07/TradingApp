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
    calls++; assert.equal(url.hostname, 'www.coindesk.com');
    return { text: xml() };
  } });
  try {
    const [first, second] = await Promise.all([research.news(cryptoAssets[1]), research.news(cryptoAssets[1], 'en')]);
    assert.equal(calls, 1); assert.equal(second.lang, 'en');
    assert.equal(first.articles[0].summary.status, 'no_text');
    assert.deepEqual(first.setup.missing, []);
    store.db.prepare('UPDATE snapshots SET updated = ? WHERE key = ?').run(new Date(Date.now() - 3600000).toISOString(), 'rss-news:BTC');
    const refreshed = await research.news(cryptoAssets[1]);
    assert.equal(calls, 2); assert.equal(refreshed.stale, false);
    store.db.prepare('UPDATE snapshots SET updated = ? WHERE key = ?').run(new Date(Date.now() - 3600000).toISOString(), 'rss-news:BTC');
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

const describedFeed = () => xml().replace('<source>Reuters</source>', '<description><![CDATA[<p>Bitcoin rules &amp; market context.</p>]]></description>');
test('descriptive RSS supplies sanitized excerpts without treating Google descriptions as article text', () => {
  const [article] = parseFeed(describedFeed(), cryptoAssets[1], Date.now(), { sourceName: 'CoinDesk', descriptions: true });
  assert.equal(article.source, 'CoinDesk');
  assert.equal(article.description, 'Bitcoin rules &amp; market context.');
  assert.equal(parseFeed(describedFeed(), cryptoAssets[1])[0].description, undefined);
});
test('crypto background summaries run without Finnhub, reads never invoke AI, and cached bilingual results are reused', async () => {
  const store = new Store(':memory:'); let generated = 0;
  const research = new Research({ store, env: {}, call: async () => ({ text: describedFeed() }), ai: { enabled: true, generate: async () => {
    generated++;
    return { status: 'ready', content: { ro: { title: 'Reguli Bitcoin', text: 'Context despre reguli.' }, en: { title: 'Bitcoin rules', text: 'Context about rules.' } } };
  } } });
  try {
    const asset = cryptoAssets[1];
    const pending = await research.news(asset);
    assert.equal(generated, 0); assert.ok(pending.articles[0].sourceExcerpt);
    assert.equal(pending.articles[0].summary.status, 'pending');
    await research.refresh();
    const ready = await research.news(asset);
    assert.equal(ready.articles[0].summary.text, 'Context despre reguli.');
    assert.equal((await research.news(asset, 'en')).articles[0].summary.text, 'Context about rules.');
    const count = generated; await research.refresh(); assert.equal(generated, count);
  } finally { await research.stop(); }
});
test('failed descriptive source falls back to Google headlines without invented descriptions', async () => {
  const research = new Research({ store: new Store(':memory:'), env: {}, call: async url => {
    if (url.hostname !== 'news.google.com') throw new Error('offline');
    return { text: xml() };
  } });
  try {
    const result = await research.news(cryptoAssets[1]);
    assert.equal(result.articles[0].provider, 'google_rss');
    assert.equal(result.articles[0].summary.status, 'no_text');
    assert.equal(result.articles[0].sourceExcerpt, null);
  } finally { await research.stop(); }
});
