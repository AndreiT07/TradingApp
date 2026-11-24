import test from 'node:test';
import assert from 'node:assert/strict';
import { parseFeed, classify, isRelevantHeadline } from '../news.js';
import { companies } from '../companies.js';
import { cryptoAssets } from '../crypto.js';
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
  const articles = parseFeed(feed(item('Apple company news') + item('Apple quarterly earnings', 'https://example.com/earnings', 'Sun, 08 Nov 2026 13:00:00 GMT')), companies[0], now);
  assert.equal(articles[0].category, 'Rezultate financiare');
});
test('handles an empty feed and rejects non-RSS and XML entity declarations', () => {
  assert.deepEqual(parseFeed('<rss><channel><title>News</title></channel></rss>', companies[0], now), []);
  assert.throws(() => parseFeed('<html>blocked</html>', companies[0], now));
  assert.throws(() => parseFeed('<!DOCTYPE rss [<!ENTITY x "value">]><rss/>', companies[0], now));
});
test('classifies regulatory coverage', () => assert.equal(classify('Google antitrust ruling').category, 'Reglementări'));
test('an executive appointment ranks above routine recent stories', () => {
  const nvidia = companies.find(company => company.ticker === 'NVDA');
  const articles = parseFeed(feed(item('Nvidia shares rise') + item('NVIDIA reinstates Jensen Huang as CEO',
    'https://example.com/board', 'Sun, 08 Nov 2026 13:00:00 GMT')), nvidia, now);
  assert.equal(articles[0].title, 'NVIDIA reinstates Jensen Huang as CEO');
});
test('recognizes the focus of headlines across all tracked companies and crypto lists', () => {
  const examples = {
    AAPL: 'iPhone sales rise in Europe',
    MSFT: 'Azure expands cloud capacity',
    NVDA: 'NVIDIA Board Reinstates Jensen Huang as CEO',
    GOOGL: 'Google appeals antitrust ruling',
    AMZN: 'AWS introduces new cloud service',
    META: 'Instagram rolls out new privacy controls',
    TSLA: 'Tesla reports vehicle deliveries',
    JPM: 'JPM posts quarterly results',
    'BRK.B': 'BRK.B reports operating earnings',
    LLY: 'Eli Lilly publishes clinical trial results',
    CRYPTO: 'US Senate advances stablecoin legislation',
    BTC: 'Bitcoin funds record inflows',
    ETH: 'Ethereum developers schedule an upgrade',
    SOL: 'Solana network activity grows',
  };
  for (const subject of [...companies, ...cryptoAssets]) {
    assert.ok(isRelevantHeadline(examples[subject.ticker], subject), subject.ticker);
    assert.equal(isRelevantHeadline('Disney Stops Reporting Streaming Profit', subject), false, subject.ticker);
  }
  const [apple] = companies;
  const bitcoin = cryptoAssets[1];
  assert.equal(isRelevantHeadline('Dell earnings rise as Apple faces supply issues', apple), false);
  assert.equal(isRelevantHeadline('Apple vs. Broadcom: Comparing Revenue Trends', apple), false);
  assert.equal(isRelevantHeadline('3 stocks to buy now, including Apple', apple), false);
  assert.equal(isRelevantHeadline('GTA 6 sends Apple stock investors an unmistakable signal', apple), false);
  assert.equal(isRelevantHeadline('GTA 6 debut sends a strong signal to Apple stock investors', apple), false);
  assert.equal(isRelevantHeadline('SpaceX could hit Microsoft-scale revenue in 2027', companies[1]), false);
  assert.equal(isRelevantHeadline('Why Is Palantir Stock Up Today? AI Rally Follows Nvidia CEO Return', companies[2]), false);
  assert.equal(isRelevantHeadline('Berkshire has owned these 2 consumer stocks for decades', companies[8]), false);
  assert.equal(isRelevantHeadline('Berkshire Hathaway owns 22.6% of American Express. Is the stock a buy?', companies[8]), false);
  assert.ok(isRelevantHeadline('Berkshire Hathaway owns a larger stake in American Express', companies[8]));
  assert.equal(isRelevantHeadline('JPMorgan AM says AI borrowing binge is holding back bond rally', companies[7]), false);
  assert.ok(isRelevantHeadline('JPMorgan analysts say Apple is set for stronger iPhone sales', apple));
  assert.ok(isRelevantHeadline('Apple rises after JPMorgan analysts say demand is improving', apple));
  assert.equal(isRelevantHeadline('Ethereum jumps while Bitcoin stalls', bitcoin), false);
  assert.equal(isRelevantHeadline('Ethereum outpaces Bitcoin', bitcoin), false);
  assert.ok(isRelevantHeadline('Bitcoin drops following Ethereum rally', bitcoin));
});
