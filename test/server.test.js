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
    assert.equal((await fetch(`${url}/.env`)).status, 404);
    assert.equal((await fetch(`${url}/api/companies`, { method: 'POST' })).status, 405);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
