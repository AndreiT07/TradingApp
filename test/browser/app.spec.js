import { test, expect } from '@playwright/test';
test.beforeEach(async ({ page }) => {
  await page.route('https://www.tradingview-widget.com/**', route => route.fulfill({ body: 'Test chart', contentType: 'text/html' }));
});
const data = ticker => ({ ticker, fetchedAt: '2026-11-09T12:00:00Z', stale: false, articles: [
  { id: 'earnings', title: `${ticker} quarterly earnings outlook`, category: 'Rezultate financiare', source: 'Reuters', publishedAt: '2026-11-09T09:00:00Z', url: 'https://example.com/earnings', score: 9 },
  { id: 'products', title: `${ticker} product launch`, category: 'Produse & inovație', source: 'Associated Press', publishedAt: '2026-11-09T11:00:00Z', url: 'https://example.com/product', score: 5 },
] });
test('loads news, changes company, searches, sorts, and filters without overflow', async ({ page }) => {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.route('**/api/news?*', route => route.fulfill({ json: data(new URL(route.request().url()).searchParams.get('ticker')) }));
  await page.goto('/');
  await expect(page.locator('article')).toHaveCount(2);
  await expect(page.getByRole('button', { name: 'Cele mai importante' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('article').first()).toContainText('quarterly earnings');
  await expect(page.locator('#news-status')).toContainText('Ultimele 24 de ore');
  await page.getByRole('button', { name: 'Cele mai recente' }).click();
  await expect(page.locator('article').first()).toContainText('product launch');
  await page.getByLabel('Subiect', { exact: true }).selectOption('Rezultate financiare');
  await expect(page.locator('article')).toHaveCount(1);
  await page.getByLabel('Caută o companie').fill('nvda');
  await expect(page.locator('.company-button')).toHaveCount(1);
  await page.locator('.company-button').click();
  await expect(page.getByRole('heading', { name: 'NVIDIA', exact: true })).toBeVisible();
  await expect(page.locator('article')).toHaveCount(2);
  await expect(page.locator('article').first()).toContainText('NVDA');
  const link = page.locator('article a').first();
  await expect(link).toHaveAttribute('target', '_blank');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect(errors).toEqual([]);
});
test('shows real failure, demo is opt-in and clearly labeled, can return to live', async ({ page }) => {
  await page.route('**/api/news?*', route => route.fulfill({ status: 503, json: { error: 'NEWS_UNAVAILABLE' } }));
  await page.goto('/');
  await expect(page.getByText('Sursă indisponibilă', { exact: true })).toBeVisible();
  await expect(page.locator('article')).toHaveCount(0);
  await page.getByRole('button', { name: 'Explorează demonstrația' }).click();
  await expect(page.locator('#demo-notice')).toBeVisible();
  await expect(page.locator('article')).toHaveCount(5);
  await expect(page.locator('article a')).toHaveCount(0);
  await page.screenshot({ path: `test-results/demo-${test.info().project.name}.png`, fullPage: true });
  await page.getByRole('button', { name: 'Revino la știri live' }).click();
  await expect(page.getByText('Sursă indisponibilă', { exact: true })).toBeVisible();
});
test('treats untrusted titles as text and supports empty category', async ({ page }) => {
  await page.route('**/api/news?*', route => route.fulfill({ json: { ...data('AAPL'), articles: [{ ...data('AAPL').articles[0], title: '<img src=x onerror=alert(1)> Apple earnings' }] } }));
  await page.goto('/');
  await expect(page.locator('article h3')).toHaveText('<img src=x onerror=alert(1)> Apple earnings');
  await expect(page.locator('article img')).toHaveCount(0);
  await page.getByLabel('Subiect', { exact: true }).selectOption('Reglementări');
  await expect(page.getByText('Nicio știre pentru moment.')).toBeVisible();
});

test('shows an explicit empty state when there are no directly relevant articles', async ({ page }) => {
  await page.route('**/api/news?*', route => route.fulfill({ json: { ...data('AAPL'), articles: [] } }));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Nicio știre relevantă pentru moment.' })).toBeVisible();
  await expect(page.locator('article')).toHaveCount(0);
  await page.getByLabel('Limba interfeței').selectOption('en');
  await expect(page.getByRole('heading', { name: 'No relevant news at the moment.' })).toBeVisible();
});

test('switches interface language and keeps the original headline and excerpt', async ({ page }) => {
  const result = data('AAPL');
  result.articles[0].sourceExcerpt = 'Revenue increased in the reported quarter.';
  await page.route('**/api/news?*', route => route.fulfill({ json: result }));
  await page.goto('/');
  await expect(page.getByText('Fragment din sursă')).toBeVisible();
  await expect(page.getByText('Revenue increased in the reported quarter.')).toBeVisible();
  await page.getByLabel('Limba interfeței').selectOption('en');
  await expect(page.getByRole('button', { name: 'Most important', exact: true })).toBeVisible();
  await expect(page.getByText('Source excerpt', { exact: true })).toBeVisible();
  await expect(page.locator('article').first()).toContainText('AAPL quarterly earnings outlook');
  await expect(page.getByText('Revenue increased in the reported quarter.')).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await page.getByLabel('Topic', { exact: true }).selectOption('Rezultate financiare');
  await expect(page.locator('article')).toHaveCount(1);
  await page.reload();
  await expect(page.getByLabel('Interface language')).toHaveValue('en');
  await expect(page.getByRole('button', { name: 'Most recent', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('shows sourced investor filings, amendment warnings and grounded company research', async ({ page }) => {
  await page.route('**/api/news?*',route=>route.fulfill({json:data('AAPL')}));
  await page.route('**/api/investors?*',route=>route.fulfill({json:{status:'ready',funds:[{name:'Example Fund',status:'ready',shares:100,previousShares:80,period:'2026-09-30',previousPeriod:'2026-06-30',change:'increased',filedAt:'2026-11-01',filingUrl:'https://www.sec.gov/example'}],insiders:[{owners:[{name:'Example Officer'}],action:'purchase',code:'P',shares:10,date:'2026-11-01',filedAt:'2026-11-02',filingUrl:'https://www.sec.gov/form4',amended:true}],otherCount:2}}));
  await page.route('**/api/analysis?*',route=>route.fulfill({json:{status:'ready',verdict:'hold',rationale:'Evaluarea limitează potențialul.',opportunities:['Venituri în creștere'],risks:['Concurență'],evidence:[{source:'SEC',date:'2026-09-30',url:'https://www.sec.gov/example'}],generatedAt:'2026-11-09T12:00:00Z'}}));
  await page.goto('/');
  await expect(page.getByText('Example Fund',{exact:true})).toBeVisible();
  await expect(page.getByText('Deținere raportată crescută')).toBeVisible();
  await expect(page.getByText('Raportare rectificativă; verifică originalul.')).toBeVisible();
  await expect(page.locator('#analysis .verdict')).toHaveText('Păstrează');
  await expect(page.locator('#analysis-shortcut')).toContainText('Păstrează');
  await expect(page.getByText('Evaluarea limitează potențialul.')).toBeVisible();
  await expect(page.locator('#analysis a')).toHaveAttribute('href','https://www.sec.gov/example');
  await page.screenshot({path:`test-results/research-${test.info().project.name}.png`,fullPage:true});
});

test('headline-only stories stay visible and demo switches language', async ({ page }) => {
  await page.route('**/api/news?*',route=>route.fulfill({json:{...data('AAPL'),articles:[{...data('AAPL').articles[0]}]}}));
  await page.goto('/');
  await expect(page.locator('article h3')).toHaveText('AAPL quarterly earnings outlook');
  await expect(page.locator('article .article-excerpt')).toHaveCount(0);
  await expect(page.locator('#investors')).toContainText('Sursa nu este configurată încă pe server.');
  await expect(page.locator('#analysis .verdict')).toHaveText('Date insuficiente');
  await page.route('**/api/news?*',route=>route.fulfill({status:503,json:{error:'unavailable'}}));
  await page.getByRole('button',{name:'Actualizează'}).click();
  await page.getByRole('button',{name:'Explorează demonstrația'}).click();
  await page.getByLabel('Limba interfeței').selectOption('en');
  await expect(page.locator('#demo-notice')).toContainText('DEMO MODE');
  await expect(page.locator('article').first()).toContainText('Apple: what investors may watch');
  await expect(page.locator('#analysis')).toContainText('not an actual recommendation');
  await expect(page.locator('article a')).toHaveCount(0);
});

test('explains missing configuration and provider failures in the selected language',async({page})=>{
  await page.route('**/api/news?*',route=>route.fulfill({json:{...data('AAPL'),setup:{missing:['FINNHUB_API_KEY']}}}));
  await page.route('**/api/analysis?*',route=>route.fulfill({json:{status:'unavailable',verdict:'insufficient',reason:'provider_auth'}}));
  await page.goto('/');
  await expect(page.locator('#setup-notice')).toBeVisible();
  await page.locator('#setup-notice summary').click();
  await expect(page.locator('#setup-explanation')).toContainText('FINNHUB_API_KEY');
  await expect(page.locator('#analysis')).toContainText('Furnizorul nu acceptă cheia API');
  await page.getByLabel('Limba interfeței').selectOption('en');
  await expect(page.locator('#analysis')).toContainText('The provider rejected the API key');
});

test('buy signal and the calculation are visible',async({page})=>{
  await page.route('**/api/news?*',route=>route.fulfill({json:data('AAPL')}));
  await page.route('**/api/analysis?*',route=>route.fulfill({json:{status:'ready',engine:'rules-v1',verdict:'buy',buyDecision:'buy',score:3,rationale:'Regulile susțin o achiziție.',criteria:[{id:'revenue',label:'Creșterea veniturilor',value:15,points:1},{id:'earnings',label:'Creșterea EPS',value:20,points:1},{id:'valuation',label:'P/E',value:20,points:1}],methodology:'Cumpără la scor de cel puțin +2.',risks:['Euristica nu a fost validată istoric.'],opportunities:[]}}));
  await page.goto('/');
  await expect(page.locator('#analysis-shortcut')).toHaveText('Semnal de cumpărare: Cumpără →');
  await page.locator('#analysis-shortcut').click();
  await expect(page.locator('#analysis .verdict')).toHaveText('Cumpără');
  await expect(page.locator('.signal-score')).toHaveText('Scor: +3');
  await expect(page.locator('.signal-criteria tbody tr')).toHaveCount(3);
  await page.getByText('Cum se calculează',{exact:true}).click();
  await expect(page.getByText('Cumpără la scor de cel puțin +2.')).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});

test('completed background signals appear automatically after an initial pending state',async({page})=>{
  await page.clock.install();let requests=0;
  await page.route('**/api/news?*',route=>route.fulfill({json:data('AAPL')}));
  await page.route('**/api/analysis?*',route=>route.fulfill({json:++requests===1?{status:'pending',engine:'rules-v1',verdict:'insufficient',buyDecision:'insufficient'}:{status:'ready',engine:'rules-v1',verdict:'hold',buyDecision:'wait',rationale:'Semnale mixte.'}}));
  await page.goto('/');
  await expect(page.locator('#analysis-shortcut')).toContainText('În pregătire');
  await page.clock.fastForward(15000);
  await expect(page.locator('#analysis-shortcut')).toContainText('Așteaptă');
  await expect(page.locator('#analysis .verdict')).toHaveText('Așteaptă');
});

test('crypto selection loads news, hides equity research, switches languages and returns to companies', async ({ page }) => {
  const researchCalls = [];
  page.on('request', request => {
    if (/\/api\/(analysis|investors).*ticker=(BTC|ETH|SOL|CRYPTO)/.test(request.url())) researchCalls.push(request.url());
  });
  await page.route('**/api/news?*', route => {
    const result = data(new URL(route.request().url()).searchParams.get('ticker'));
    return route.fulfill({ json: result });
  });
  await page.goto('/');
  await page.getByRole('button', { name: /Bitcoin/ }).click();
  await expect(page.getByRole('heading', { name: 'Bitcoin', exact: true })).toBeVisible();
  await expect(page.locator('article').first()).toContainText('BTC');
  await expect(page.locator('.research-section')).toBeHidden();
  await expect(page.locator('#analysis-shortcut')).toBeHidden();
  await expect(page.locator('#setup-notice')).toBeHidden();
  await page.getByLabel('Limba interfeței').selectOption('en');
  await expect(page.locator('#selected-sector')).toHaveText('Crypto · Global');
  await expect(page.locator('.research-section')).toBeHidden();
  await page.getByRole('button', { name: /Apple/ }).click();
  await expect(page.locator('.research-section')).toBeVisible();
  expect(researchCalls).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('crypto source description is shown and untrusted markup is rendered as text', async ({ page }) => {
  await page.route('**/api/news?*', route => route.fulfill({ json: { ...data('BTC'), articles: [{ ...data('BTC').articles[0], sourceExcerpt: 'Bitcoin source context <img src=x onerror=alert(1)>' }] } }));
  await page.goto('/');
  await page.getByRole('button', { name: /Bitcoin/ }).click();
  await expect(page.getByText('Fragment din sursă')).toBeVisible();
  await expect(page.getByText('Bitcoin source context <img src=x onerror=alert(1)>')).toBeVisible();
  await expect(page.locator('article img')).toHaveCount(0);
  await page.getByLabel('Limba interfeței').selectOption('en');
  await expect(page.getByText('Source excerpt')).toBeVisible();
});

test('crypto favorites, alerts, grouped sources and chart event markers work together', async ({ page }) => {
  await page.clock.install();
  let news = [];
  await page.route('**/api/news?*', route => {
    const ticker = new URL(route.request().url()).searchParams.get('ticker');
    return route.fulfill({ json: ticker === 'BTC' ? { ...data(ticker), articles: news } : data(ticker) });
  });
  await page.route('**/api/prices?*', route => {
    const url = new URL(route.request().url()), ticker = url.searchParams.get('ticker'), period = url.searchParams.get('period');
    const to = Date.now() + 10_000, from = to - 86_400_000;
    const points = ticker === 'BTC' && period === '1d' ? [{ at: to - 3_600_000, price: 80000 }, { at: to - 1800_000, price: 80500 }] : [];
    return route.fulfill({ json: { ticker, period, from, to, points, symbol: ticker === 'BTC' ? 'COINBASE:BTCUSD' : 'NASDAQ:AAPL', events: [] } });
  });
  await page.goto('/');
  await page.getByRole('button', { name: /Bitcoin/ }).click();
  await expect(page.locator('#price-canvas')).toBeVisible();
  await page.getByRole('button', { name: 'Favorit', exact: true }).click();
  await expect(page.locator('#favorite-assets').getByRole('button', { name: 'Bitcoin' })).toBeVisible();
  await page.locator('#alerts-panel summary').click();
  await page.getByRole('checkbox', { name: 'Actualizări de rețea' }).check();
  await page.locator('#alerts-panel summary').click();
  await page.clock.fastForward(2000);
  const eventAt = await page.evaluate(() => new Date().toISOString());
  news = [{ ...data('BTC').articles[0], title: 'Bitcoin network upgrade', publishedAt: eventAt, eventAt,
    eventId: 'btc-upgrade', topic: 'network', type: 'official', coverage: [{ source: 'CoinDesk', url: 'https://example.com/coverage' }] }];
  await page.getByRole('button', { name: 'Actualizează', exact: true }).click();
  await expect(page.locator('#alert-count')).toHaveText('1');
  await expect(page.locator('article')).toHaveCount(1);
  await expect(page.getByText('Comunicat oficial', { exact: true })).toBeVisible();
  await page.getByText('Alte surse (1)', { exact: true }).click();
  await expect(page.getByRole('link', { name: 'CoinDesk' })).toHaveAttribute('href', 'https://example.com/coverage');
  await expect(page.locator('#event-axis a').first()).toHaveAttribute('href', 'https://example.com/earnings');
  await page.getByRole('button', { name: '1 lună' }).click();
  await expect(page.locator('#price-widget iframe')).toHaveAttribute('src', /COINBASE%3ABTCUSD%7C1M/);
  await page.locator('#alerts-panel summary').click();
  await expect(page.locator('#alert-list')).toContainText('Bitcoin network upgrade');
  await page.reload();
  await expect(page.locator('#favorite-assets').getByRole('button', { name: 'Bitcoin' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('the publisher filter hides Yahoo, supports official releases, and persists after reload', async ({ page }) => {
  await page.route('**/api/news?*', route => {
    const query = new URL(route.request().url()).searchParams;
    const feed = data('AAPL');
    feed.availableSources = [{ key: 'yahoo', name: 'Yahoo' }, { key: 'reuters', name: 'Reuters' }];
    feed.articles[0].source = 'Yahoo';
    feed.articles[1].source = 'Reuters';
    if (query.getAll('hide').includes('yahoo')) feed.articles.shift();
    if (query.get('officialOnly') === '1') feed.articles = [];
    return route.fulfill({ json: feed });
  });
  await page.goto('/');
  await expect(page.locator('article')).toHaveCount(2);
  await page.locator('#publisher-filter > summary').click();
  await page.getByRole('checkbox', { name: 'Ascunde Yahoo' }).check();
  await expect(page.locator('article')).toHaveCount(1);
  await expect(page.locator('article')).toContainText('Reuters');
  await page.getByRole('checkbox', { name: 'Doar comunicate oficiale' }).check();
  await expect(page.getByText('Nicio știre nu corespunde filtrelor de publicație.')).toBeVisible();
  await page.getByRole('button', { name: 'Resetează filtrele' }).click();
  await expect(page.locator('article')).toHaveCount(2);
  await page.getByRole('checkbox', { name: 'Ascunde Yahoo' }).check();
  await expect(page.locator('article')).toHaveCount(1);
  await page.reload();
  await expect(page.locator('article')).toHaveCount(1);
  await expect(page.locator('#hide-yahoo')).toBeChecked();
});

test('calendar shows selected stocks and events for favorite crypto assets', async ({ page }) => {
  await page.route('**/api/news?*', route => route.fulfill({ json: data('AAPL') }));
  await page.route('**/api/calendar?*', route => {
    const tickers = new URL(route.request().url()).searchParams.get('tickers').split(',');
    const events = tickers.map(ticker => ({ ticker, date: '2027-01-27', type: ticker === 'AAPL' ? 'earnings' : 'network',
      status: 'estimated', source: ticker === 'AAPL' ? 'Finnhub' : 'Bitcoin Core', url: 'https://example.com/calendar' }));
    return route.fulfill({ json: { from: '2026-11-25', to: '2027-02-23', events, unavailable: [], stale: false } });
  });
  await page.goto('/');
  await page.locator('#calendar-panel > summary').click();
  await expect(page.locator('#calendar-events')).toContainText('AAPL · Rezultate financiare');
  await expect(page.locator('#calendar-events')).toContainText('Dată estimată');
  await page.locator('#calendar-scope').selectOption('favorites');
  await expect(page.locator('#calendar-status')).toHaveText('Adaugă un favorit pentru a-i vedea calendarul.');
  await page.locator('#crypto-assets').getByRole('button', { name: /Bitcoin/ }).click();
  await page.getByRole('button', { name: 'Favorit', exact: true }).click();
  await expect(page.locator('#calendar-events')).toContainText('BTC · Actualizare de rețea');
  await expect(page.getByRole('link', { name: 'Bitcoin Core' })).toHaveAttribute('href', 'https://example.com/calendar');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
