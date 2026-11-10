import { test, expect } from '@playwright/test';
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
  await expect(page.locator('article').first()).toContainText('quarterly earnings');
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

test('switches the whole interface and summaries to English and persists the preference', async ({ page }) => {
  await page.route('**/api/news?*', route => {
    const url = new URL(route.request().url()), english = url.searchParams.get('lang') === 'en';
    const result = data(url.searchParams.get('ticker'));
    result.articles[0] = { ...result.articles[0], title: english ? 'Apple quarterly results' : 'Rezultatele trimestriale Apple', originalTitle:'Apple quarterly results', titleTranslated:true, summary:{status:'ready', text:english?'Revenue increased in the reported quarter.':'Veniturile au crescut în trimestrul raportat.'} };
    return route.fulfill({json:result});
  });
  await page.goto('/');
  await expect(page.getByText('Veniturile au crescut în trimestrul raportat.')).toBeVisible();
  await page.getByLabel('Limba interfeței').selectOption('en');
  await expect(page.getByRole('button',{name:'Most important',exact:true})).toBeVisible();
  await expect(page.getByText('Revenue increased in the reported quarter.')).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('lang','en');
  await page.getByLabel('Topic',{exact:true}).selectOption('Rezultate financiare');
  await expect(page.locator('article')).toHaveCount(1);
  await page.reload();
  await expect(page.getByLabel('Interface language')).toHaveValue('en');
  await expect(page.getByRole('button',{name:'Most recent',exact:true})).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
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

test('missing summaries and credentials are explicit; demo switches language without live-looking claims', async ({ page }) => {
  await page.route('**/api/news?*',route=>route.fulfill({json:{...data('AAPL'),articles:[{...data('AAPL').articles[0],summary:{status:'no_text'}}]}}));
  await page.goto('/');
  await expect(page.getByText('Rezumat indisponibil: sursa oferă doar titlul.')).toBeVisible();
  await expect(page.locator('#investors')).toContainText('Sursa nu este configurată încă pe server.');
  await expect(page.locator('#analysis .verdict')).toHaveText('Date insuficiente');
  await page.route('**/api/news?*',route=>route.fulfill({status:503,json:{error:'unavailable'}}));
  await page.getByRole('button',{name:'Actualizează'}).click();
  await page.getByRole('button',{name:'Explorează demonstrația'}).click();
  await page.getByLabel('Limba interfeței').selectOption('en');
  await expect(page.locator('#demo-notice')).toContainText('DEMO MODE');
  await expect(page.locator('article').first()).toContainText('fictional summary example');
  await expect(page.locator('#analysis')).toContainText('not an actual recommendation');
  await expect(page.locator('article a')).toHaveCount(0);
});

test('explains missing configuration and provider failures in the selected language',async({page})=>{
  await page.route('**/api/news?*',route=>route.fulfill({json:{...data('AAPL'),setup:{missing:['FINNHUB_API_KEY','AI_API_KEY']}}}));
  await page.route('**/api/analysis?*',route=>route.fulfill({json:{status:'unavailable',verdict:'insufficient',reason:'provider_auth'}}));
  await page.goto('/');
  await expect(page.locator('#setup-notice')).toBeVisible();
  await page.locator('#setup-notice summary').click();
  await expect(page.locator('#setup-explanation')).toContainText('FINNHUB_API_KEY');
  await expect(page.locator('#analysis')).toContainText('Furnizorul nu acceptă cheia API');
  await page.getByLabel('Limba interfeței').selectOption('en');
  await expect(page.locator('#analysis')).toContainText('The provider rejected the API key');
});

test('buy signal and the calculation are visible without an AI configuration',async({page})=>{
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
