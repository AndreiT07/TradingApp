import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../lib/store.js';
import { createHash } from 'node:crypto';
import { Research, financialEvidence, normalizeNews } from '../lib/research.js';
import { parseHoldings, parseInsiders, compareHolding, SEC } from '../lib/sec.js';
import { companies } from '../companies.js';
const marketEnv = { FINNHUB_API_KEY: 'test-only-key', DATA_PROVIDER_TERMS_ACCEPTED: 'true' };
const response = value => ({ json: () => value });

test('cached snapshots survive reopening SQLite', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tradingapp-store-')), path = join(dir, 'data.sqlite');
  let store = new Store(path);
  try {
    store.put('cached', { ready: true });
    store.close();
    store = new Store(path);
    assert.equal(store.get('cached').data.ready, true);
  } finally { store.close(); rmSync(dir, { recursive: true }); }
});
test('normalizes provider news and excludes unrelated, malformed, duplicate and old articles before the cap', () => {
  const now=Date.now(), article={headline:'Apple earnings',url:'https://example.com/a',datetime:now/1000,summary:'<p>Revenue rose.</p>',source:'Source'};
  const unrelated = Array.from({ length: 30 }, (_, i) => ({
    ...article, headline: `Dell quarterly earnings update ${i}`, url: `https://example.com/dell-${i}`, related: 'AAPL', summary: 'Apple was mentioned.',
  }));
  const items = normalizeNews([...unrelated, { ...article, headline: 'iPhone rollout' }, { ...article, headline: 'iPhone rollout' },
    { ...article, headline: 'Apple unsafe', url: 'javascript:alert(1)' },
    { ...article, headline: 'Apple old', datetime: now / 1000 - 25 * 3600 }], companies[0], now);
  assert.equal(items.length,1); assert.equal(items[0].description,'Revenue rose.');
  assert.equal(items[0].title, 'iPhone rollout');
});
test('a legacy Finnhub snapshot with no relevant headlines falls back to cached, filtered RSS', async () => {
  const store = new Store(':memory:');
  const [apple] = companies;
  const published = new Date();
  const dell = { id: 'dell', title: 'Dell gears up to report Q3 earnings', provider: 'finnhub', publishedAt: published.toISOString() };
  store.put('news:AAPL', { articles: [dell], fetchedAt: published.toISOString() });
  let rssCalls = 0;
  const rssItem = title => `<item><title>${title}</title><link>https://example.com/${title.split(' ')[0]}</link><pubDate>${published.toUTCString()}</pubDate></item>`;
  const service = new Research({
    store,
    env: { FINNHUB_API_KEY: 'test-only-key', DATA_PROVIDER_TERMS_ACCEPTED: 'true' },
    call: async requested => {
      assert.equal(requested.hostname, 'news.google.com');
      rssCalls++;
      return { text: `<rss><channel>${rssItem('Dell earnings')}${requested.searchParams.get('q').includes('Apple') ? rssItem('iPhone sales rise') : ''}</channel></rss>` };
    },
  });
  try {
    const [ro, en] = await Promise.all([service.news(apple), service.news(apple, 'en')]);
    assert.deepEqual(ro.articles.map(article => [article.title, article.provider]), [['iPhone sales rise', 'google_rss']]);
    assert.equal(en.articles.length, 1);
    assert.equal(rssCalls, 1);
    assert.deepEqual(store.get('news:AAPL').data.articles, [dell]);
    await service.news(apple);
    assert.equal(rssCalls, 1);
    const microsoft = companies.find(company => company.ticker === 'MSFT');
    const empty = await service.news(microsoft);
    assert.deepEqual(empty.articles, []);
    assert.equal(empty.stale, false);
    await service.news(microsoft);
    assert.equal(rssCalls, 2);
  } finally {
    await service.stop();
  }
});
test('Nvidia releases provide source descriptions alongside cached Finnhub news', async () => {
  const store = new Store(':memory:');
  const company = companies.find(company => company.ticker === 'NVDA');
  const title = 'NVIDIA Board Reinstates Jensen Huang as CEO';
  const url = 'https://nvidianews.nvidia.com/news/huang-reinstated';
  const publishedAt = new Date();
  const finnHubFetchedAt = new Date(publishedAt.getTime() - 60 * 60_000).toISOString();
  store.put('news:NVDA', { fetchedAt: finnHubFetchedAt, articles: [
    { id: 'duplicate', title, url: 'https://example.com/syndicated', provider: 'finnhub', publishedAt: publishedAt.toISOString() },
    { id: 'unrelated', title: 'Disney Stops Reporting Streaming Profit. Should You Worry?', url: 'https://example.com/disney', provider: 'finnhub', publishedAt: publishedAt.toISOString() },
    { id: 'other', title: 'NVIDIA earnings', url: 'https://example.com/earnings', provider: 'finnhub', publishedAt: finnHubFetchedAt, score: 1 },
  ] }, finnHubFetchedAt);
  let rssCalls = 0;
  const service = new Research({
    store,
    env: { FINNHUB_API_KEY: 'test-only-key', DATA_PROVIDER_TERMS_ACCEPTED: 'true' },
    call: async requested => {
      assert.equal(requested.href, 'https://nvidianews.nvidia.com/cats/press_release.xml');
      rssCalls++;
      return { text: `<rss><channel><item><title>${title}</title><link>${url}</link><pubDate>${publishedAt.toUTCString()}</pubDate><description>NVIDIA announced the decision.</description></item></channel></rss>` };
    },
  });
  try {
    const [ro, en] = await Promise.all([service.news(company), service.news(company, 'en')]);
    assert.deepEqual(ro.articles.map(article => article.provider), ['nvidia_rss', 'finnhub']);
    assert.equal(ro.articles[0].title, title);
    assert.equal(ro.articles[0].url, url);
    assert.equal(ro.articles[0].sourceExcerpt, 'NVIDIA announced the decision.');
    assert.equal(en.articles[0].source, 'NVIDIA Newsroom');
    assert.ok(ro.fetchedAt > finnHubFetchedAt);
    assert.equal(ro.stale, false);
    await service.news(company);
    assert.equal(rssCalls, 1);
  } finally {
    await service.stop();
  }
});
test('financial evidence requires recent quotes, reporting dates and enough numeric metrics', () => {
  const now=Date.now(), quote={c:100,t:now/1000}, period=new Date(now-40*86400000).toISOString().slice(0,10);
  const financials={metric:{peTTM:20,revenueGrowthTTMYoy:5,epsGrowthTTMYoy:3},series:{quarterly:{eps:[{period}]}}};
  assert.equal(financialEvidence(quote,financials,now).price,100);
  assert.equal(financialEvidence({...quote,t:(now-6*86400000)/1000},financials,now),null);
  assert.equal(financialEvidence(quote,{...financials,series:{}},now),null);
});
const holdings = (shares=10) => `<informationTable xmlns="http://www.sec.gov/edgar/document/thirteenf/informationtable"><infoTable><cusip>037833100</cusip><shrsOrPrnAmt><sshPrnamt>${shares}</sshPrnamt><sshPrnamtType>SH</sshPrnamtType></shrsOrPrnAmt></infoTable></informationTable>`;
test('SEC holdings aggregate common shares, reject entity declarations and adjust splits', () => {
  assert.equal(parseHoldings(holdings())['037833100'],10);
  assert.throws(()=>parseHoldings('<!DOCTYPE x>'+holdings()));
  assert.equal(compareHolding(10,40,[{fromFactor:1,toFactor:4}]).change,'unchanged');
  assert.equal(compareHolding(10,40,null).change,'unverified');
  assert.equal(compareHolding(10,5,[]).change,'reduced');
  assert.equal(compareHolding(0,5,[]).change,'new');
});
test('SEC restatements supersede originals and ambiguous amendments are rejected', async () => {
  const store=new Store(':memory:'); const sec=new SEC(store,{env:{SEC_USER_AGENT:'TradingApp test@example.com'}});
  const filings=[{form:'13F-HR',reportDate:'2026-09-30',filedAt:'2026-10-01',url:'base',accession:'1'},{form:'13F-HR/A',reportDate:'2026-09-30',filedAt:'2026-10-02',url:'amended',accession:'2'}];
  sec.filings=async()=>filings;
  sec.get=async()=>'<edgarSubmission><formData><coverPage><amendmentInfo><amendmentType>RESTATEMENT</amendmentType></amendmentInfo></coverPage></formData></edgarSubmission>';
  sec.table=async filing=>({'037833100':filing.url==='base'?10:20});
  try {
    const reports=await sec.fundReports({cik:'1'}); assert.equal(reports[0].holdings['037833100'],20); assert.equal(reports[0].url,'amended');
    sec.get=async()=>'<edgarSubmission><formData><coverPage><amendmentInfo><amendmentType>NEW HOLDINGS</amendmentType></amendmentInfo></coverPage></formData></edgarSubmission>';
    await assert.rejects(sec.fundReports({cik:'1'}),/AMBIGUOUS_AMENDMENT/);
  } finally {store.close();}
});
test('Form 4 distinguishes purchases, sales, other operations and derivatives', () => {
  const tx=code=>`<nonDerivativeTransaction><securityTitle><value>Common Stock</value></securityTitle><transactionDate><value>2026-11-01</value></transactionDate><transactionCoding><transactionCode>${code}</transactionCode></transactionCoding><transactionAmounts><transactionShares><value>100</value></transactionShares><transactionPricePerShare><value>2</value></transactionPricePerShare></transactionAmounts></nonDerivativeTransaction>`;
  const doc=`<ownershipDocument><reportingOwner><reportingOwnerId><rptOwnerName>Example Owner</rptOwnerName><rptOwnerCik>123</rptOwnerCik></reportingOwnerId></reportingOwner><nonDerivativeTable>${tx('P')}${tx('S')}${tx('A')}</nonDerivativeTable><derivativeTable><derivativeTransaction/></derivativeTable></ownershipDocument>`;
  const data=parseInsiders(doc,{accession:'a',form:'4/A',url:'https://www.sec.gov/test',filedAt:'2026-11-02'});
  assert.deepEqual(data.transactions.map(t=>t.action),['purchase','sale','other']);
  assert.equal(data.otherCount,1);assert.equal(data.transactions[0].amended,true);assert.equal(data.transactions[0].owners[0].name,'Example Owner');
});
test('cached news returns up to ten ranked stories from the last day and ignores previous AI output', async () => {
  const store = new Store(':memory:');
  const now = Date.now();
  const publishedAt = new Date(now).toISOString();
  const description = '<p>Revenue rose. </p>' + 'Apple published quarterly results. '.repeat(20);
  const articles = Array.from({ length: 12 }, (_, score) => ({
    id: String(score), title: `Apple quarterly results ${score}`, description, score,
    url: `https://example.com/${score}`, provider: 'finnhub', publishedAt: new Date(now - (11 - score) * 60_000).toISOString(),
  }));
  articles.push({ ...articles[0], title: 'Old Apple earnings', score: 100, publishedAt: new Date(now - 25 * 3600_000).toISOString() });
  const newest = articles[11];
  const oldHash = createHash('sha256').update(JSON.stringify({ title: newest.title, description })).digest('hex');
  store.put(`summary:${newest.id}:${oldHash}`, { status: 'ready', content: { ro: { title: 'Old translation', text: 'Old generated text' } } });
  store.put('news:AAPL', { articles, fetchedAt: publishedAt });
  const service = new Research({ store, env: { ...marketEnv, AI_API_KEY: 'old-key' }, call: async () => assert.fail('Cached reads should not call a provider') });
  try {
    const ro = await service.news(companies[0], 'ro');
    const en = await service.news(companies[0], 'en');
    const displayedText = articles => articles.map(({ title, sourceExcerpt }) => [title, sourceExcerpt]);
    assert.deepEqual(displayedText(ro.articles), displayedText(en.articles));
    assert.deepEqual(ro.articles.map(article => Number(article.id)), [11, 10, 9, 8, 7, 6, 5, 4, 3, 2]);
    const [first] = ro.articles;
    assert.equal(first.title, newest.title);
    assert.equal(first.summary, undefined);
    assert.equal(first.description, undefined);
    assert.ok(first.sourceExcerpt.length <= 240);
    assert.match(first.sourceExcerpt, /^Revenue rose\. Apple published/);
    assert.match(first.sourceExcerpt, /…$/);
    assert.ok(description.replace(/<[^>]*>/g, '').startsWith(first.sourceExcerpt.slice(0, -1)));
  } finally { await service.stop(); }
});

test('the worker refreshes Finnhub and the official RSS each hour and financial data stays daily', async () => {
  const store = new Store(':memory:');
  let equity = 0, crypto = 0, releases = 0, financial = 0;
  const now = Date.now();
  const period = new Date(now - 40 * 86400_000).toISOString().slice(0, 10);
  const service = new Research({ store, env: marketEnv, call: async url => {
    if (url.hostname === 'nvidianews.nvidia.com') {
      releases++;
      return { text: '<rss><channel><title>NVIDIA Newsroom</title></channel></rss>' };
    }
    assert.equal(url.hostname, 'finnhub.io');
    const found = ticker => ({ headline: `${ticker} earnings update`, url: `https://example.com/${ticker}`, datetime: now / 1000, summary: 'Reported results.' });
    if (url.pathname.endsWith('/company-news')) {
      equity++;
      return response([found(url.searchParams.get('symbol'))]);
    }
    if (url.pathname.endsWith('/news')) {
      crypto++;
      return response(['Bitcoin', 'Ethereum', 'Solana'].map(found));
    }
    financial++;
    if (url.pathname.endsWith('/quote')) return response({ c: 100, t: now / 1000 });
    return response({ metric: { peTTM: 20, revenueGrowthTTMYoy: 5, epsGrowthTTMYoy: 3 }, series: { quarterly: { eps: [{ period }] } } });
  } });
  try {
    await service.tick();
    assert.deepEqual([equity, crypto, releases, financial], [10, 1, 1, 33]);
    assert.equal(service.prices(companies[0], '1d').points[0].price, 100);
    assert.equal(service.prices(companies[0], '1d').events.length, 1);
    const newsAttempts = ['attempt:news:AAPL', 'attempt:crypto:finnhub', 'attempt:press-releases:v2:NVDA', 'attempt:prices:AAPL'];
    for (const name of newsAttempts) {
      store.put(name, { status: 'complete' }, new Date(now - 30 * 60_000).toISOString());
    }
    await service.tick();
    assert.deepEqual([equity, crypto, releases, financial], [10, 1, 1, 33]);

    for (const name of newsAttempts) {
      store.put(name, { status: 'complete' }, new Date(now - 61 * 60_000).toISOString());
    }
    await service.tick();
    assert.deepEqual([equity, crypto, releases, financial], [11, 2, 2, 34]);
    assert.equal(service.prices(companies[0], '1d').points.length, 1);
    assert.equal(service.analysis(companies[0], 'en').status, 'ready');
  } finally { await service.stop(); }
});

test('SEC submissions accept XSL-prefixed documents but fetch underlying raw XML, rejecting path traversal', async () => {
  const store=new Store(':memory:');const seen=[];
  const sec=new SEC(store,{env:{SEC_USER_AGENT:'TradingApp test@example.com'},pause:async()=>{},call:async url=>{
    seen.push(url);
    if(url.includes('submissions')) return response({filings:{recent:{form:['4','4'],accessionNumber:['0000320193-26-000001','0000320193-26-000002'],primaryDocument:['xslF345X05/form4.xml','../bad.xml'],reportDate:['2026-11-01','2026-11-01'],filingDate:['2026-11-02','2026-11-02']}}});
    return {text:'<ownershipDocument><issuer><issuerCik>320193</issuerCik></issuer><periodOfReport>2026-11-01</periodOfReport></ownershipDocument>'};
  }});
  try {
    const filings=await sec.filings('320193',['4']);assert.equal(filings.length,1);
    assert.equal(filings[0].rawUrl,'https://www.sec.gov/Archives/edgar/data/320193/000032019326000001/form4.xml');
    await sec.insiders(companies[0]);
    assert.ok(seen.some(url=>url.endsWith('/000032019326000001/form4.xml')));
    assert.ok(!seen.some(url=>url.includes('/xslF345X05/')));
  } finally {store.close();}
});

test('insider adapter excludes filings in which the selected company owns another issuer', async () => {
  const store=new Store(':memory:');const sec=new SEC(store);
  sec.filings=async()=>[{form:'4',accession:'test',url:'https://www.sec.gov/example'}];
  sec.get=async()=>'<ownershipDocument><issuer><issuerCik>789019</issuerCik></issuer><nonDerivativeTable><nonDerivativeTransaction><transactionCoding><transactionCode>P</transactionCode></transactionCoding></nonDerivativeTransaction></nonDerivativeTable></ownershipDocument>';
  try { assert.equal((await sec.insiders(companies[0])).transactions.length,0); } finally {store.close();}
});

test('configuration diagnostics expose missing names without exposing values', async () => {
  const store=new Store(':memory:');
  const service=new Research({store,env:{FINNHUB_API_KEY:'do-not-expose-this-secret'}});
  try {
    const result=service.analysis(companies[0],'ro');
    assert.equal(result.status,'not_configured');
    assert.deepEqual(result.missing, ['DATA_PROVIDER_TERMS_ACCEPTED']);
    assert.equal(JSON.stringify(result).includes('do-not-expose-this-secret'),false);
  } finally {await service.stop();}
});

test('market-data failures are surfaced instead of leaving analysis permanently pending', async () => {
  const store=new Store(':memory:');
  const configured=marketEnv;
  const service=new Research({store,env:configured,call:async()=>{const error=new Error('sensitive provider message');error.status=403;throw error;}});
  try {
    await service.due('analysis:AAPL',86400000,()=>service.refreshAnalysis(companies[0]));
    const result=service.analysis(companies[0],'ro');
    assert.equal(result.status,'unavailable');assert.equal(result.reason,'provider_access');
    assert.equal(JSON.stringify(result).includes('sensitive provider message'),false);
    const prior=store.get('attempt:analysis:AAPL');
    store.put('attempt:analysis:AAPL',prior.data,new Date(Date.now()-6*60000).toISOString());
    let retried=false;await service.due('analysis:AAPL',86400000,async()=>{retried=true;});
    assert.equal(retried,true);
  } finally {await service.stop();}
});
