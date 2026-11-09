import test from 'node:test';
import assert from 'node:assert/strict';
import { parseFeed, classify } from '../news.js';
import { companies } from '../companies.js';
const now = Date.parse('2026-11-09T12:00:00Z');
const item = (title, link = 'https://example.com/article', pubDate = 'Mon, 09 Nov 2026 10:00:00 GMT') => `<item><title>${title}</title><link>${link}</link><pubDate>${pubDate}</pubDate><source url="https://example.com">Reuters</source></item>`;
const feed = content => `<rss version="2.0"><channel>${content}</channel></rss>`;
test('RSS articles include source, date, safe URL, and priority category', () => {
  const [article] = parseFeed(feed(item('Apple earnings &amp; revenue grow - Reuters')), companies[0], now);
  assert.equal(article.title, 'Apple earnings & revenue grow');
  assert.equal(article.source, 'Reuters');
  assert.equal(article.category, 'Rezultate financiare');
  assert.equal(article.publishedAt, '2026-11-09T10:00:00.000Z');
  assert.equal(article.url, 'https://example.com/article');
});
test('deduplicates titles and rejects unrelated stories, invalid links and invalid or future dates', () => {
  const articles = parseFeed(feed(item('Apple earnings') + item('Apple earnings', 'https://other.example') + item('Tesla earnings') + item('Apple news', 'javascript:alert(1)') + item('Apple old', 'https://example.com/a', 'invalid') + item('Apple future', 'https://example.com/b', 'Mon, 09 Nov 2026 15:00:00 GMT')), companies[0], now);
  assert.equal(articles.length, 1);
});
test('ranks financial results ahead of routine recent company coverage', () => {
  const articles = parseFeed(feed(item('Apple company news') + item('Apple quarterly earnings', 'https://example.com/earnings', 'Sun, 08 Nov 2026 10:00:00 GMT')), companies[0], now);
  assert.equal(articles[0].category, 'Rezultate financiare');
});
test('handles an empty feed and rejects non-RSS and XML entity declarations', () => {
  assert.deepEqual(parseFeed('<rss><channel><title>News</title></channel></rss>', companies[0], now), []);
  assert.throws(() => parseFeed('<html>blocked</html>', companies[0], now));
  assert.throws(() => parseFeed('<!DOCTYPE rss [<!ENTITY x "value">]><rss/>', companies[0], now));
});
test('classifies regulatory coverage', () => assert.equal(classify('Google antitrust ruling').category, 'Reglementări'));
