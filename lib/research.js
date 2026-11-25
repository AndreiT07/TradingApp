import { createHash } from 'node:crypto';
import { cryptoAssets } from '../crypto.js';
import { companies } from '../companies.js';
import { NEWS_WINDOW, headlineKey, isRecentNews, isRelevantHeadline, parseFeed, rankNews } from '../news.js';
import { Store } from './store.js';
import { SEC, funds, securities, compareHolding } from './sec.js';
import { upstream, safeLink } from './http.js';
import { assessFinancials, explainSignal } from './signals.js';
import { missingConfiguration, providerFailure } from './diagnostics.js';
import { articleType, groupNews, publisherKey } from './news-events.js';
import { priceHistory, pricePeriods, quoteSymbol } from './prices.js';
import { MarketCalendar } from './calendar.js';
const DAY = 86_400_000;
const NEWS_REFRESH_INTERVAL = 3_600_000;
const NVIDIA_RELEASES_KEY = 'press-releases:v2:NVDA';
const fresh = (row, age) => row && Date.now() - Date.parse(row.updatedAt) < age;
const noFilter = { hidden: new Set(), officialOnly: false };
const allowedSource = (article, filter) => !filter.hidden.has(publisherKey(article.source))
  && (!filter.officialOnly || articleType(article) === 'official');
const plain = text => String(text ?? '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
const escapedText = { '&amp;': '&', '&apos;': "'", '&quot;': '"', '&nbsp;': ' ', '&lt;': '<', '&gt;': '>' };
function publicArticle({ description, ...article }) {
  const text = article.provider === 'google_rss' || typeof description !== 'string' ? ''
    : plain(description).replace(/&(?:amp|apos|quot|nbsp|lt|gt);/g, entity => escapedText[entity]).replace(/\s+/g, ' ').trim();
  const limit = 240;
  const cut = text.lastIndexOf(' ', limit - 1);
  const sourceExcerpt = text.length > limit ? `${text.slice(0, cut > 0 ? cut : limit - 1)}…` : text || null;
  return { ...article, originalTitle: article.title, sourceExcerpt };
}
export function normalizeNews(items, company, now = Date.now()) {
  if (!Array.isArray(items)) throw new Error('INVALID_NEWS');
  const seen = new Set();
  return items.flatMap(item => {
    const title = plain(item.headline).slice(0, 500), url = safeLink(item.url), time = Number(item.datetime) * 1000;
    const source = plain(item.source).slice(0, 100) || 'Finnhub';
    const key = `${headlineKey(title)}:${source.toLowerCase()}`;
    if (!title || !url || !isRecentNews(time, now) || !isRelevantHeadline(title, company) || seen.has(key)) return [];
    seen.add(key);
    const id = createHash('sha256').update(JSON.stringify(url)).digest('hex').slice(0, 16);
    return [{ id, title, source, url,
      publishedAt: new Date(time).toISOString(), description: plain(item.summary).slice(0, 6000),
      ...rankNews(title, time, now), provider: 'finnhub' }];
  }).sort((a, b) => b.score - a.score).slice(0, 60);
}
export function financialEvidence(quote, financials, now = Date.now()) {
  const periods = Object.values(financials?.series?.quarterly ?? {}).flatMap(series => Array.isArray(series) ? series.map(item => item.period) : []).filter(p => /^\d{4}-\d{2}-\d{2}$/.test(p)).sort();
  const period = periods.at(-1);
  const metrics = Object.fromEntries(['peTTM', 'revenueGrowthTTMYoy', 'epsGrowthTTMYoy', 'netProfitMarginTTM', 'roeTTM', 'dividendYieldIndicatedAnnual'].flatMap(key => typeof financials?.metric?.[key] === 'number' && Number.isFinite(financials.metric[key]) ? [[key, financials.metric[key]]] : []));
  const quoteAt = Number(quote?.t) * 1000;
  if (!(quote?.c > 0) || !Number.isFinite(quoteAt) || quoteAt > now + 300_000 || now - quoteAt > 5 * DAY || !period || now - Date.parse(period) > 200 * DAY || Date.parse(period) > now || Object.keys(metrics).length < 3) return null;
  return { price: quote.c, quoteAt: new Date(quoteAt).toISOString(), reportingPeriod: period, metrics };
}
export class Research {
  constructor({ store = new Store(), env = process.env, call = upstream, sec } = {}) {
    this.store = store; this.env = env; this.call = call;
    this.sec = sec ?? new SEC(store, { env, call });
    this.calendarService = new MarketCalendar({ store, call, finnhub: (path, params) => this.finnhub(path, params),
      finnhubEnabled: () => this.finnhubEnabled });
    this.pending = new Map(); this.failures = new Map(); this.running = false; this.stopping = false;
  }
  get finnhubEnabled() { return Boolean(this.env.FINNHUB_API_KEY?.trim() && this.env.DATA_PROVIDER_TERMS_ACCEPTED === 'true'); }
  async finnhub(path, params) {
    const url = new URL(`https://finnhub.io/api/v1/${path}`);
    url.search = new URLSearchParams(params);
    const result = (await this.call(url, { headers: { 'X-Finnhub-Token': this.env.FINNHUB_API_KEY } })).json();
    if (result?.error) { const error = new Error('DATA_PROVIDER_ERROR'); error.status = 403; throw error; }
    return result;
  }
  async news(company, lang = 'ro', filter = noFilter) {
    const [primary, releases] = await Promise.allSettled([
      this.newsSnapshot(company), company.ticker === 'NVDA' ? this.nvidiaReleases(company) : null,
    ]);
    const official = releases.value?.data.articles.length ? releases.value : null;
    if (primary.status === 'rejected' && !official) throw primary.reason;
    const candidates = primary.value?.data.articles ?? [];
    const needsAlternatives = !filter.officialOnly && filter.hidden.size && candidates.some(article => !allowedSource(article, filter))
      && groupNews(candidates.filter(article => allowedSource(article, filter)), company).length < 10;
    const extra = needsAlternatives && candidates.some(article => article.provider === 'finnhub')
      ? await this.rssNews(company, null, company.type === 'crypto').catch(() => null) : null;
    return this.newsResponse(primary.value, lang, company, official, extra, filter);
  }
  async nvidiaReleases(company) {
    if (!this.pending.has(NVIDIA_RELEASES_KEY)) {
      const refresh = this.due(NVIDIA_RELEASES_KEY, NEWS_REFRESH_INTERVAL, async () => {
        const response = await this.call(new URL('https://nvidianews.nvidia.com/cats/press_release.xml'));
        const articles = parseFeed(response.text, company, Date.now(), { sourceName: 'NVIDIA Newsroom', descriptions: true })
          .map(article => ({ ...article, provider: 'nvidia_rss' }));
        this.store.put(NVIDIA_RELEASES_KEY, { articles, fetchedAt: new Date().toISOString() });
      }).finally(() => this.pending.delete(NVIDIA_RELEASES_KEY));
      this.pending.set(NVIDIA_RELEASES_KEY, refresh);
    }
    await this.pending.get(NVIDIA_RELEASES_KEY);
    return this.cachedNews(NVIDIA_RELEASES_KEY, company);
  }
  cachedNews(key, company) {
    const row = this.store.get(key);
    if (!row) return null;
    const now = Date.now();
    const articles = row.data.articles.flatMap(article => {
      const publishedAt = Date.parse(article.publishedAt);
      if (!isRecentNews(publishedAt, now) || !isRelevantHeadline(article.title, company)) return [];
      return [{ ...article, ...rankNews(article.title, publishedAt, now) }];
    });
    return { ...row, data: { ...row.data, articles } };
  }
  hasPrimaryNews(company, row) {
    return row?.data.articles.length && (fresh(row, NEWS_REFRESH_INTERVAL)
      || (this.finnhubEnabled && company.type !== 'crypto' && row.data.articles.some(article => article.provider === 'finnhub')));
  }
  async newsSnapshot(company) {
    const primary = this.cachedNews(`news:${company.ticker}`, company);
    if (this.hasPrimaryNews(company, primary)) return primary;
    return this.rssNews(company, primary);
  }
  async rssNews(company, primary = null, searchOnly = false) {
    const rssKey = `${searchOnly ? 'rss-search' : 'rss-news'}:${company.ticker}`;
    const fallback = this.cachedNews(rssKey, company);
    if (fresh(fallback, NEWS_REFRESH_INTERVAL)) return fallback;
    const previous = fallback?.data.articles.length ? fallback : primary ?? fallback;
    if (!this.pending.has(rssKey)) {
      const job = (async () => {
        if ((this.failures.get(rssKey) ?? 0) > Date.now() - 60_000) {
          if (previous) return previous;
          throw new Error('NEWS_UNAVAILABLE');
        }
        try {
          const url = new URL('https://news.google.com/rss/search');
          url.search = new URLSearchParams({ q: `${company.query} when:1d`, hl: 'en-US', gl: 'US', ceid: 'US:en' });
          let articles;
          if (company.type === 'crypto' && !searchOnly) {
            const feeds = [
              ['CoinDesk', 'coindesk_rss', 'https://www.coindesk.com/arc/outboundfeeds/rss'],
              ['Cointelegraph', 'cointelegraph_rss', 'https://cointelegraph.com/rss'],
              ['Decrypt', 'decrypt_rss', 'https://decrypt.co/feed'],
            ];
            for (const [sourceName, provider, feedUrl] of feeds) {
              try {
                const feed = await this.call(new URL(feedUrl), { headers: { 'User-Agent': 'TradingApp/0.1 RSS reader', Accept: 'application/rss+xml, application/xml, text/xml' } });
                const matches = parseFeed(feed.text, company, Date.now(), { sourceName, descriptions: true });
                if (!matches.length) continue;
                articles = matches.map(article => ({ ...article, provider }));
                break;
              } catch { /* Try the next feed when a source is unavailable. */ }
            }
          }
          if (!articles?.length) {
            const response = await this.call(url);
            articles = parseFeed(response.text, company).map(a => ({ ...a, provider: 'google_rss' }));
          }
          this.store.put(rssKey, { ticker: company.ticker, articles, fetchedAt: new Date().toISOString() });
          return this.store.get(rssKey);
        } catch {
          this.failures.set(rssKey, Date.now());
          if (previous) return previous;
          throw new Error('NEWS_UNAVAILABLE');
        }
      })().finally(() => this.pending.delete(rssKey));
      this.pending.set(rssKey, job);
    }
    return this.pending.get(rssKey);
  }
  newsResponse(row, lang, company, releases, extra, filter) {
    const articles = row?.data.articles ?? [];
    const official = releases?.data.articles ?? [];
    const candidates = [...official, ...articles, ...(extra?.data.articles ?? [])];
    const merged = groupNews(candidates.filter(article => allowedSource(article, filter)), company).slice(0, 10);
    const sources = new Map();
    for (const article of candidates) {
      const key = publisherKey(article.source);
      if (key && !sources.has(key)) sources.set(key, { key, name: key === 'yahoo' ? 'Yahoo' : article.source });
    }
    const latest = [row, releases, extra].filter(Boolean).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
    return { ...row?.data, ticker: company.ticker, articles: merged.map(publicArticle),
      availableSources: [...sources.values()].sort((a, b) => a.name.localeCompare(b.name)),
      fetchedAt: latest.data.fetchedAt, cached: true, setup: { missing: company.type === 'crypto' ? [] : missingConfiguration(this.env) },
      stale: !fresh(latest, NEWS_REFRESH_INTERVAL), lang };
  }
  calendar(subjects) {
    return this.calendarService.read(subjects);
  }
  prices(subject, period) {
    return priceHistory(this.store, subject, period);
  }
  investors(company) {
    const row = this.store.get(`investors:${company.ticker}`);
    return row ? { ...row.data, stale: !fresh(row, 2 * DAY) } : { status: this.sec.enabled ? 'pending' : 'not_configured', funds: [], insiders: [], fetchedAt: null, stale: false };
  }
  analysis(company, lang) {
    const row = this.store.get(`analysis:${company.ticker}`);
    const missing = missingConfiguration(this.env);
    const base = { engine: 'rules-v1', missing, horizonMonths: [6, 12] };
    if (!row) {
      const failure = (this.store.get(`attempt:signal-v1:${company.ticker}`) ?? this.store.get(`attempt:analysis:${company.ticker}`))?.data;
      return { ...base, status: missing.length ? 'not_configured' : failure?.status === 'failed' ? 'unavailable' : 'pending',
        reason: failure?.reason ?? null, verdict: 'insufficient', buyDecision: 'insufficient' };
    }
    const data = row.data;
    const signal = assessFinancials(data.financials);
    const stale = !fresh(row, 2 * DAY) || signal.reason === 'stale_financials';
    const effective = stale ? { ...signal, verdict: 'insufficient', buyDecision: 'insufficient', score: null } : signal;
    return { ...base, status: missing.length && !data.financials ? 'not_configured' : stale ? 'stale' : effective.status,
      ...explainSignal(effective, lang), verdict: effective.verdict, buyDecision: effective.buyDecision,
      score: effective.score, reason: data.reason ?? effective.reason, generatedAt: data.generatedAt ?? null,
      model: 'rules-v1', evidence: (data.evidence ?? []).filter(item => item.kind === 'financials'), financials: data.financials ?? null, stale };
  }
  start() {
    this.timer = setInterval(() => this.tick().catch(() => console.warn('Background refresh failed')), 60_000); this.timer.unref();
    this.initial = setTimeout(() => this.tick().catch(() => console.warn('Background refresh failed')), 1000); this.initial.unref();
  }
  async due(key, interval, work) {
    const attempt = this.store.get(`attempt:${key}`);
    const retryAfter = attempt && (!attempt.data.status || attempt.data.status === 'failed') ? 5 * 60_000 : interval;
    if (fresh(attempt, retryAfter)) return;
    this.store.put(`attempt:${key}`, { status: 'running' });
    try { await work(); this.store.put(`attempt:${key}`, { status: 'complete' }); }
    catch (error) {
      const reason = providerFailure(error);
      this.store.put(`attempt:${key}`, { status: 'failed', reason });
      console.warn(`Background refresh unavailable: ${key} (${reason})`);
    }
  }
  async tick() {
    if (this.running || this.stopping) return;
    this.running = true;
    this.active = this.refresh().finally(() => { this.running = false; });
    await this.active;
  }
  async refresh() {
    const results = await Promise.allSettled([this.refreshResearch(), this.refreshNews(), this.refreshPrices()]);
    const failed = results.find(result => result.status === 'rejected');
    if (failed) throw failed.reason;
  }
  async refreshResearch() {
    if (this.finnhubEnabled) {
      for (const company of companies) {
        if (this.stopping) return;
        await this.due(`signal-v1:${company.ticker}`, DAY, () => this.refreshAnalysis(company));
      }
    }
    if (!this.stopping && this.sec.enabled) await this.due('investors', DAY, () => this.refreshInvestors());
  }
  async refreshNews() {
    if (this.finnhubEnabled) {
      for (const company of companies) {
        if (this.stopping) return;
        await this.due(`news:${company.ticker}`, NEWS_REFRESH_INTERVAL, async () => {
          const today = new Date().toISOString().slice(0, 10), from = new Date(Date.now() - NEWS_WINDOW).toISOString().slice(0, 10);
          const items = await this.finnhub('company-news', { symbol: company.ticker, from, to: today });
          this.store.put(`news:${company.ticker}`, { ticker: company.ticker, articles: normalizeNews(items, company), fetchedAt: new Date().toISOString() });
        });
      }
      if (this.stopping) return;
      await this.due('crypto:finnhub', NEWS_REFRESH_INTERVAL, async () => {
        const items = await this.finnhub('news', { category: 'crypto' });
        for (const asset of cryptoAssets) {
          const articles = normalizeNews(items, asset);
          this.store.put(`news:${asset.ticker}`, { ticker: asset.ticker, articles, fetchedAt: new Date().toISOString() });
        }
      });
    }
    if (!this.stopping) await Promise.allSettled([...companies, ...cryptoAssets].map(async subject => {
      const news = await this.news(subject);
      const key = `news-history:${subject.ticker}`;
      const previous = this.store.get(key)?.data;
      if (previous?.fetchedAt === news.fetchedAt) return;
      const events = new Map((previous?.events ?? []).map(event => [event.eventId, event]));
      for (const { eventId, eventAt, title, url, topic } of news.articles) {
        events.set(eventId, { eventId, eventAt, title, url, topic });
      }
      const cutoff = Date.now() - pricePeriods['1m'];
      const recent = [...events.values()].filter(event => Date.parse(event.eventAt) >= cutoff)
        .sort((a, b) => Date.parse(b.eventAt) - Date.parse(a.eventAt)).slice(0, 300);
      this.store.put(key, { fetchedAt: news.fetchedAt, events: recent });
    }));
  }
  async refreshPrices() {
    if (!this.finnhubEnabled) return;
    for (const subject of [...companies, ...cryptoAssets]) {
      if (this.stopping) return;
      const symbol = quoteSymbol(subject);
      if (!symbol) continue;
      await this.due(`prices:${subject.ticker}`, NEWS_REFRESH_INTERVAL, async () => {
        const quote = await this.finnhub('quote', { symbol });
        const now = Date.now();
        const at = quote.t * 1000;
        if (Number.isSafeInteger(at) && at > now - pricePeriods['1m'] && at <= now + 300_000
          && Number.isFinite(quote.c) && quote.c > 0) {
          this.store.putPrice(subject.ticker, at, quote.c, now - pricePeriods['1m']);
        }
      });
    }
  }
  async refreshInvestors() {
    const fundData = [];
    for (const fund of funds) {
      try { fundData.push({ ...fund, reports: await this.sec.fundReports(fund) }); }
      catch { fundData.push({ ...fund, reports: [], status: 'unavailable' }); }
      if (this.stopping) return;
    }
    for (const company of companies) {
      if (this.stopping) return;
      const cusip = securities[company.ticker][1], fundRows = [];
      for (const fund of fundData) {
        const [current, previous] = fund.reports;
        if (!current) { fundRows.push({ name: fund.name, status: 'unavailable' }); continue; }
        let splits = null;
        if (previous && this.finnhubEnabled) {
          try {
            const entries = await this.finnhub('stock/split', { symbol: company.ticker, from: previous.period, to: current.period });
            if (Array.isArray(entries)) splits = entries.filter(s => s.date > previous.period && s.date <= current.period);
          } catch { /* Display raw snapshots without inferring direction. */ }
        }
        const result = previous ? compareHolding(previous.holdings[cusip] ?? 0, current.holdings[cusip] ?? 0, splits) : { shares: current.holdings[cusip] ?? 0, change: 'unverified', delta: null };
        fundRows.push({ name: fund.name, status: Date.now() - Date.parse(current.period) > 200 * DAY ? 'stale' : 'ready', ...result,
          period: current.period, previousPeriod: previous?.period ?? null, filedAt: current.filedAt, filingUrl: current.url, previousFilingUrl: previous?.url ?? null });
      }
      let insiderData = { transactions: [], otherCount: 0 }, insiderStatus = 'ready';
      try { insiderData = await this.sec.insiders(company); } catch { insiderStatus = 'unavailable'; }
      const previous = this.store.get(`investors:${company.ticker}`);
      if (fundRows.every(f => f.status === 'unavailable') && insiderStatus === 'unavailable') {
        if (!previous) this.store.put(`investors:${company.ticker}`, { status: 'unavailable', funds: [], insiders: [], fetchedAt: null });
        continue;
      }
      this.store.put(`investors:${company.ticker}`, { status: 'ready', funds: fundRows,
        insiders: insiderData.transactions, insiderStatus, otherCount: insiderData.otherCount,
        reportsChecked: insiderData.reportsChecked, fetchedAt: new Date().toISOString() });
    }
  }
  async refreshAnalysis(company) {
    const quote = await this.finnhub('quote', { symbol: company.ticker });
    const metrics = await this.finnhub('stock/metric', { symbol: company.ticker, metric: 'all' });
    const financials = financialEvidence(quote, metrics);
    if (!financials) { this.store.put(`analysis:${company.ticker}`, { status: 'insufficient', generatedAt: new Date().toISOString() }); return; }
    const signal = assessFinancials(financials);
    this.store.put(`analysis:${company.ticker}`, { status: signal.status, signal, financials,
      generatedAt: new Date().toISOString(), model: 'rules-v1', evidence: [
        { id: 'financials', source: 'Finnhub', url: 'https://finnhub.io/', date: financials.reportingPeriod, kind: 'financials' },
      ] });
  }
  async stop() {
    if (this.stopPromise) return this.stopPromise;
    this.stopPromise = this.finishStop();
    return this.stopPromise;
  }
  async finishStop() {
    this.stopping = true; clearInterval(this.timer); clearTimeout(this.initial);
    await this.active;
    await Promise.allSettled([...this.pending.values(), ...this.calendarService.pending.values()]);
    this.store.close();
  }
}
