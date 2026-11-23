import { cryptoAssets } from '../crypto.js';
import { companies } from '../companies.js';
import { classify, parseFeed } from '../news.js';
import { Store } from './store.js';
import { AI, hash } from './ai.js';
import { SEC, funds, securities, compareHolding } from './sec.js';
import { upstream, safeLink } from './http.js';
import { assessFinancials, explainSignal } from './signals.js';
import { missingConfiguration, providerFailure } from './diagnostics.js';
const DAY = 86_400_000;
const RSS_CACHE_AGE = 5 * 60_000;
const NVIDIA_RELEASES_KEY = 'press-releases:NVDA';
const fresh = (row, age) => row && Date.now() - Date.parse(row.updatedAt) < age;
const plain = text => String(text ?? '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
export function normalizeNews(items, company, now = Date.now()) {
  if (!Array.isArray(items)) throw new Error('INVALID_NEWS');
  const seen = new Set();
  return items.flatMap(item => {
    const title = plain(item.headline).slice(0, 500), url = safeLink(item.url), time = Number(item.datetime) * 1000;
    const key = title.toLowerCase();
    if (!title || !url || !Number.isFinite(time) || time > now + 300_000 || time < now - 7 * DAY || seen.has(key)) return [];
    seen.add(key);
    const { category, weight } = classify(title);
    return [{ id: hash(url).slice(0, 16), title, source: plain(item.source).slice(0, 100) || 'Finnhub', url,
      publishedAt: new Date(time).toISOString(), description: plain(item.summary).slice(0, 6000), category,
      score: weight + 3 / (1 + Math.max(0, now - time) / 43_200_000), provider: 'finnhub' }];
  }).sort((a, b) => b.score - a.score).slice(0, 30);
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
  constructor({ store = new Store(), env = process.env, call = upstream, ai, sec } = {}) {
    this.store = store; this.env = env; this.call = call;
    this.ai = ai ?? new AI(store, { env, call }); this.sec = sec ?? new SEC(store, { env, call });
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
  summary(article) {
    const key = `summary:${article.id}:${hash({ title: article.title, description: article.description })}`;
    return this.store.get(key)?.data ?? { status: article.description ? (this.ai.enabled ? 'pending' : 'not_configured') : 'no_text' };
  }
  localize(article, lang) {
    const summary = this.summary(article);
    const translated = summary.status === 'ready' ? summary.content[lang] : null;
    const { description, ...safe } = article;
    return { ...safe, originalTitle: article.title, title: translated?.title ?? article.title,
      titleTranslated: Boolean(translated), sourceExcerpt: article.provider?.endsWith('_rss') && article.provider !== 'google_rss' ? article.description ?? null : null, summary: { status: summary.status, text: translated?.text ?? null, basis: 'source_description', generatedAt: summary.generatedAt ?? null, reason: summary.reason ?? null } };
  }
  async news(company, lang = 'ro') {
    if (company.ticker !== 'NVDA') return this.newsResponse(await this.newsSnapshot(company), lang, company);

    const [primary, releases] = await Promise.allSettled([this.newsSnapshot(company), this.nvidiaReleases(company)]);
    const cutoff = Date.now() - 7 * DAY;
    const officialArticles = releases.value?.data.articles.filter(article => Date.parse(article.publishedAt) >= cutoff) ?? [];
    if (primary.status === 'rejected' && !officialArticles.length) throw primary.reason;
    return this.newsResponse(primary.value, lang, company, officialArticles.length ? { ...releases.value, articles: officialArticles } : null);
  }
  async nvidiaReleases(company) {
    if (!this.pending.has(NVIDIA_RELEASES_KEY)) {
      const refresh = this.due(NVIDIA_RELEASES_KEY, RSS_CACHE_AGE, async () => {
        const response = await this.call(new URL('https://nvidianews.nvidia.com/cats/press_release.xml'));
        const articles = parseFeed(response.text, company, Date.now(), { sourceName: 'NVIDIA Newsroom' })
          .map(article => ({ ...article, provider: 'nvidia_rss' }));
        this.store.put(NVIDIA_RELEASES_KEY, { articles, fetchedAt: new Date().toISOString() });
      }).finally(() => this.pending.delete(NVIDIA_RELEASES_KEY));
      this.pending.set(NVIDIA_RELEASES_KEY, refresh);
    }
    await this.pending.get(NVIDIA_RELEASES_KEY);
    return this.store.get(NVIDIA_RELEASES_KEY);
  }
  async newsSnapshot(company) {
    const row = this.store.get(`news:${company.ticker}`);
    if (row && (fresh(row, RSS_CACHE_AGE) || (this.finnhubEnabled && company.type !== 'crypto'))) return row;
    if (!this.pending.has(company.ticker)) {
      const job = (async () => {
        if ((this.failures.get(company.ticker) ?? 0) > Date.now() - 60_000) throw new Error('NEWS_UNAVAILABLE');
        try {
          const url = new URL('https://news.google.com/rss/search');
          url.search = new URLSearchParams({ q: `${company.query} when:7d`, hl: 'en-US', gl: 'US', ceid: 'US:en' });
          let articles;
          if (company.type === 'crypto') {
            const feeds = [
              ['CoinDesk', 'coindesk_rss', 'https://www.coindesk.com/arc/outboundfeeds/rss'],
              ['Cointelegraph', 'cointelegraph_rss', 'https://cointelegraph.com/rss'],
              ['Decrypt', 'decrypt_rss', 'https://decrypt.co/feed'],
            ];
            for (const [sourceName, provider, feedUrl] of feeds) {
              try {
                const feed = await this.call(new URL(feedUrl), { headers: { 'User-Agent': 'TradingApp/0.1 RSS reader', Accept: 'application/rss+xml, application/xml, text/xml' } });
                const matches = parseFeed(feed.text, company, Date.now(), { sourceName, descriptions: true });
                if (!matches.length || (provider !== 'coindesk_rss' && !matches.some(article => article.description))) continue;
                articles = matches.map(article => ({ ...article, provider }));
                break;
              } catch { /* Try the next feed when a source is unavailable. */ }
            }
          }
          if (!articles?.length) {
            const response = await this.call(url);
            articles = parseFeed(response.text, company).map(a => ({ ...a, provider: 'google_rss' }));
          }
          this.store.put(`news:${company.ticker}`, { ticker: company.ticker, articles, fetchedAt: new Date().toISOString() });
          return this.store.get(`news:${company.ticker}`);
        } catch { this.failures.set(company.ticker, Date.now()); if (row) return row; throw new Error('NEWS_UNAVAILABLE'); }
      })().finally(() => this.pending.delete(company.ticker));
      this.pending.set(company.ticker, job);
    }
    return this.pending.get(company.ticker);
  }
  newsResponse(row, lang, company, releases) {
    const primaryAge = this.finnhubEnabled && company.type !== 'crypto' ? 6 * 3_600_000 : RSS_CACHE_AGE;
    const articles = row?.data.articles ?? [];
    const official = releases?.articles ?? [];
    const titles = new Set(official.map(article => article.title.toLowerCase()));
    const urls = new Set(official.map(article => article.url));
    const merged = [...official, ...articles.filter(article => !titles.has(article.title.toLowerCase()) && !urls.has(article.url))];
    const latest = releases && (!row || releases.updatedAt > row.updatedAt) ? releases : row;
    return { ...row?.data, ticker: company.ticker, articles: merged.map(article => this.localize(article, lang)),
      fetchedAt: latest.data.fetchedAt, cached: true, setup: { missing: company.type === 'crypto' ? [] : missingConfiguration(this.env) },
      stale: !fresh(row, primaryAge) && !fresh(releases, RSS_CACHE_AGE), lang };
  }
  investors(company) {
    const row = this.store.get(`investors:${company.ticker}`);
    return row ? { ...row.data, stale: !fresh(row, 2 * DAY) } : { status: this.sec.enabled ? 'pending' : 'not_configured', funds: [], insiders: [], fetchedAt: null, stale: false };
  }
  analysis(company, lang) {
    const row = this.store.get(`analysis:${company.ticker}`);
    const missing = missingConfiguration(this.env).filter(key => !key.startsWith('AI_'));
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
    if (this.finnhubEnabled) {
      for (const company of companies) {
        if (this.stopping) return;
        await this.due(`signal-v1:${company.ticker}`, DAY, () => this.refreshAnalysis(company));
      }
    }
    if (this.finnhubEnabled) {
      for (const company of companies) {
        if (this.stopping) return;
        await this.due(`news:${company.ticker}`, 6 * 3_600_000, async () => {
          const today = new Date().toISOString().slice(0, 10), from = new Date(Date.now() - 7 * DAY).toISOString().slice(0, 10);
          const items = await this.finnhub('company-news', { symbol: company.ticker, from, to: today });
          this.store.put(`news:${company.ticker}`, { ticker: company.ticker, articles: normalizeNews(items, company), fetchedAt: new Date().toISOString() });
        });
        await this.refreshSummaries(company);
      }
    }
    if (this.finnhubEnabled) {
      await this.due('crypto:finnhub', 5 * 60_000, async () => {
        const items = await this.finnhub('news', { category: 'crypto' });
        for (const asset of cryptoAssets) {
          const matches = asset.ticker === 'CRYPTO' ? items : items.filter(item => {
            const words = new Set(plain(`${item.headline ?? ''} ${item.related ?? ''} ${item.summary ?? ''}`).toLowerCase().match(/[a-z0-9]+/g));
            return asset.keywords.some(keyword => words.has(keyword));
          });
          const articles = normalizeNews(matches, asset);
          if (articles.length) this.store.put(`news:${asset.ticker}`, { ticker: asset.ticker, articles, fetchedAt: new Date().toISOString() });
        }
      });
    }
    for (const asset of cryptoAssets) {
      if (this.stopping) return;
      await this.due(`crypto-news:${asset.ticker}`, 5 * 60_000, () => this.news(asset));
      await this.refreshSummaries(asset);
    }
    if (this.sec.enabled) await this.due('investors', DAY, () => this.refreshInvestors());
  }
  async refreshSummaries(company) {
    const articles = this.store.get(`news:${company.ticker}`)?.data.articles ?? [];
    for (const article of articles.filter(a => a.description).slice(0, 3)) {
      if (this.stopping) return;
      const key = `summary:${article.id}:${hash({ title: article.title, description: article.description })}`;
      if (this.store.get(key)?.data.status === 'ready') continue;
      const result = await this.ai.generate('summary', company.ticker, { company: company.name, title: article.title, description: article.description, source: article.source });
      const previous = this.store.get(key)?.data;
      this.store.put(key, result.status === 'budget_limited' && previous?.reason ? previous : result);
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
    await this.active; await Promise.allSettled([...this.pending.values()]); this.store.close();
  }
}
