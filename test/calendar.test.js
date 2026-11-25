import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../lib/store.js';
import { MarketCalendar, bitcoinEvents, dividendEvents, earningsEvents, ethereumEvents, solanaEvents, solanaSchedules } from '../lib/calendar.js';

test('calendar extracts dates from earnings, issuer releases and network schedules', () => {
  const earnings = earningsEvents({ earningsCalendar: [
    { symbol: 'AAPL', date: '2027-01-27', hour: 'amc', quarter: 1, year: 2027 },
    { symbol: 'MSFT', date: '2027-01-28' },
    { symbol: 'AAPL', date: '2027-02-30' },
  ] }, 'AAPL');
  assert.deepEqual(earnings.map(({ date, title, status }) => [date, title, status]), [['2027-01-27', 'Q1 2027', 'estimated']]);

  const dividend = dividendEvents('<rss><channel><item><title>Microsoft declares dividend</title><link>https://news.microsoft.com/source/dividend/</link><description><![CDATA[<p>The board declared a dividend of $0.98 per share. The dividend is payable Dec. 10, 2026. The ex-dividend date will be Nov. 19, 2026.</p>]]></description></item></channel></rss>', 'MSFT');
  assert.deepEqual(dividend.map(({ date, type, amount }) => [date, type, amount]), [
    ['2026-12-10', 'dividend', 0.98], ['2026-11-19', 'exDividend', 0.98],
  ]);

  const ethereum = ethereumEvents('DENEB_FORK_EPOCH: 269568 # mainnet\nGLOAS_FORK_EPOCH: 18446744073709551615\n');
  assert.equal(ethereum[0].at, '2024-03-13T13:55:35.000Z');
  assert.equal(ethereum.length, 1);
  assert.deepEqual(solanaSchedules('* [Beta](v4.5-Release-Schedule)\n* [Stable](v4.4-Release-Schedule)'), ['v4.5-Release-Schedule', 'v4.4-Release-Schedule']);
  const solana = solanaEvents('|Milestone|Target Date|Delivery Date|\n|Mainnet: Upgrade|2026-12-14||\n|Testnet: Upgrade|2026-12-02||\n|Mainnet: Delivered|2026-11-05|2026-11-04|', 'v4.5-Release-Schedule');
  assert.equal(solana.length, 1);
  assert.equal(solana[0].date, '2026-12-14');
  assert.equal(solana[0].status, 'estimated');

  const bitcoin = bitcoinEvents({ items: [{ number: 123, title: 'Release Schedule for v33.0',
    body: '## 2027-02-07 🚧\n- Feature freeze\n\n## 2027-03-30 🚧\n- Tag `v33.0`\n' }] });
  assert.deepEqual(bitcoin.map(event => event.date), ['2027-02-07', '2027-03-30']);
});

test('calendar shares parallel requests and preserves cached dates during upstream errors', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-11-25T10:00:00Z') });
  const store = new Store(':memory:');
  let calls = 0, fail = false;
  const calendar = new MarketCalendar({ store, finnhubEnabled: () => true, finnhub: async () => {
    calls++;
    if (fail) throw new Error('offline');
    return { earningsCalendar: [{ symbol: 'AAPL', date: '2027-01-27' }, { symbol: 'AAPL', date: '2026-11-01' }] };
  } });
  try {
    const [first, second] = await Promise.all([calendar.read([{ ticker: 'AAPL' }]), calendar.read([{ ticker: 'AAPL' }])]);
    assert.equal(calls, 1);
    assert.deepEqual(first, second);
    assert.deepEqual(first.events.map(event => event.date), ['2027-01-27']);
    assert.deepEqual(first.unavailable, [{ ticker: 'AAPL', kind: 'dividend' }]);
    t.mock.timers.tick(6 * 3600_000);
    fail = true;
    const stale = await calendar.read([{ ticker: 'AAPL' }]);
    assert.equal(stale.stale, true);
    assert.deepEqual(stale.events, first.events);
    await calendar.read([{ ticker: 'AAPL' }]);
    assert.equal(calls, 2);
  } finally { store.close(); }
});
