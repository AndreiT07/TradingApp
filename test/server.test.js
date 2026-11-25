import test from 'node:test';
import assert from 'node:assert/strict';
import { makeServer } from '../server.js';
test('HTTP app serves UI, company data, health, rejects unknown tickers and paths', async () => {
  const server = makeServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  try {
    const page = await fetch(url);
    assert.equal(page.status, 200);
    assert.match(await page.text(), /Știri de piață/);
    assert.match(page.headers.get('content-security-policy'), /script-src 'self'/);
    const companies = await (await fetch(`${url}/api/companies`)).json();
    assert.equal(companies.length, 10);
    assert.equal(companies[0].ticker, 'AAPL');
    assert.equal(companies[0].query, undefined);
    assert.equal((await (await fetch(`${url}/api/health`)).json()).status, 'ok');
    assert.equal((await fetch(`${url}/api/news?ticker=UNKNOWN`)).status, 400);
    assert.equal((await fetch(`${url}/api/news?lang=fr`)).status, 400);
    assert.equal((await fetch(`${url}/api/news?hide=${'x'.repeat(101)}`)).status, 400);
    assert.equal((await fetch(`${url}/api/calendar?tickers=AAPL,UNKNOWN`)).status, 400);
    assert.equal((await fetch(`${url}/api/prices?period=constructor`)).status, 400);
    assert.equal((await fetch(`${url}/api/prices?ticker=UNKNOWN`)).status, 400);
    const prices = await (await fetch(`${url}/api/prices?ticker=SOL&period=1w`)).json();
    assert.equal(prices.symbol, 'COINBASE:SOLUSD');
    assert.equal(prices.to - prices.from, 7 * 86_400_000);
    assert.ok(Array.isArray(prices.points) && Array.isArray(prices.events));
    assert.equal((await (await fetch(`${url}/api/analysis?lang=en`)).json()).verdict, 'insufficient');
    assert.equal((await (await fetch(`${url}/api/investors`)).json()).status, 'not_configured');
    assert.equal((await fetch(`${url}/.env`)).status, 404);
    assert.equal((await fetch(`${url}/api/companies`, { method: 'POST' })).status, 405);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
