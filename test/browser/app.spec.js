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
