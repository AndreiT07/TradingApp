import { rssItems } from '../news.js';
import { safeLink } from './http.js';

const DAY = 86_400_000;
const MAX_AGE = 6 * 3_600_000;
const RETRY = 5 * 60_000;
const day = at => new Date(at).toISOString().slice(0, 10);
const nvidia = 'https://nvidianews.nvidia.com/cats/press_release.xml';
const microsoft = 'https://news.microsoft.com/source/?s=quarterly+dividend&feed=rss2';
const ethConfig = 'https://raw.githubusercontent.com/ethereum/consensus-specs/master/configs/mainnet.yaml';
const agave = 'https://raw.githubusercontent.com/wiki/anza-xyz/agave/';
const bitcoinIssues = 'https://api.github.com/search/issues?q=repo%3Abitcoin%2Fbitcoin%20is%3Aissue%20is%3Aopen%20in%3Atitle%20%22Release%20Schedule%22&sort=created&order=desc&per_page=3';
const userAgent = { 'User-Agent': 'TradingApp calendar' };
const rssHeaders = { ...userAgent, Accept: 'application/rss+xml, application/xml, text/xml' };

function validDay(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && day(Date.parse(value)) === value;
}

export function earningsEvents(data, ticker) {
  if (!Array.isArray(data?.earningsCalendar)) throw new Error('INVALID_EARNINGS_CALENDAR');
  return data.earningsCalendar.flatMap(item => {
    if (item.symbol !== ticker || !validDay(item.date)) return [];
    const period = [1, 2, 3, 4].includes(item.quarter) && Number.isInteger(item.year) ? `Q${item.quarter} ${item.year}` : '';
    return [{ ticker, date: item.date, type: 'earnings', title: period, status: 'estimated', hour: ['amc', 'bmo'].includes(item.hour) ? item.hour : null,
      source: 'Finnhub', url: 'https://finnhub.io/docs/api/earnings-calendar' }];
  });
}

const dateText = '(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\\.? \\d{1,2}, \\d{4}';
const paymentDate = new RegExp(`\\b(?:dividend (?:is |will be )?(?:payable|paid)(?: on)?|dividend of \\$[0-9.]+ per share on) (${dateText})`, 'i');
const exDate = new RegExp(`\\bex-dividend date (?:is|will be) (${dateText})`, 'i');

export function dividendEvents(xml, ticker) {
  const host = ticker === 'NVDA' ? 'nvidianews.nvidia.com' : 'news.microsoft.com';
  const source = ticker === 'NVDA' ? 'NVIDIA Newsroom' : 'Microsoft Source';
  return rssItems(xml).flatMap(item => {
    const url = safeLink(item.link);
    if (!url || new URL(url).hostname !== host || !/dividend|(?:quarterly|financial) results/i.test(item.title ?? '')) return [];
    const text = [item['content:encoded'], item.content, item.description].filter(value => typeof value === 'string').join(' ')
      .replace(/<[^>]*>/g, ' ').replace(/&(?:nbsp|#160);/g, ' ').replace(/\s+/g, ' ');
    const amount = Number(text.match(/\bdividend of \$([\d.]+) per share\b/i)?.[1]) || null;
    return [[paymentDate, 'dividend'], [exDate, 'exDividend']].flatMap(([pattern, type]) => {
      const at = Date.parse(`${text.match(pattern)?.[1]} GMT`);
      return Number.isFinite(at) ? [{ ticker, date: day(at), type, amount, status: 'announced', source, url }] : [];
    });
  });
}

export function ethereumEvents(config) {
  const matches = [...config.matchAll(/^([A-Z][A-Z0-9]+)_FORK_EPOCH:\s*(\d+)\b/gm)];
  if (!matches.length) throw new Error('INVALID_ETHEREUM_CALENDAR');
  return matches.flatMap(([, fork, value]) => {
    const epoch = Number(value);
    // Mainnet genesis at 1606824023 UTC. Each epoch contains 32 twelve-second slots.
    const at = (1_606_824_023 + epoch * 32 * 12) * 1000;
    if (!Number.isSafeInteger(at) || epoch <= 0) return [];
    return [{ ticker: 'ETH', date: day(at), at: new Date(at).toISOString(), type: 'network', title: fork,
      status: 'announced', source: 'Ethereum Consensus Specs', url: 'https://github.com/ethereum/consensus-specs/blob/master/configs/mainnet.yaml' }];
  });
}

export function solanaSchedules(sidebar) {
  return [...new Set([...sidebar.matchAll(/\]\((v\d+\.\d+-Release-Schedule)\)/g)].map(match => match[1]))].slice(0, 2);
}

export function solanaEvents(markdown, schedule) {
  if (!/\b(?:Target Date|Scheduled Date)\b/i.test(markdown)) throw new Error('INVALID_SOLANA_CALENDAR');
  return markdown.split('\n').flatMap(row => {
    const [, title, date, delivered] = row.split('|').map(part => part.trim());
    if (!title || !/\bmainnet\b/i.test(title) || !validDay(date) || delivered) return [];
    return [{ ticker: 'SOL', date, type: 'network', title: title.replace(/\*|\x60/g, '').slice(0, 160), status: 'estimated',
      source: 'Anza · Agave', url: `https://github.com/anza-xyz/agave/wiki/${schedule}` }];
  });
}

export function bitcoinEvents(data) {
  if (!Array.isArray(data?.items)) throw new Error('INVALID_BITCOIN_CALENDAR');
  return data.items.flatMap(issue => {
    if (!Number.isSafeInteger(issue.number) || typeof issue.body !== 'string' || !/^Release Schedule for v\d+\.\d+/i.test(issue.title)) return [];
    const sections = issue.body.split(/^##\s+(\d{4}-\d{2}-\d{2})[^\n]*\n/gm).slice(1);
    return sections.flatMap((date, index) => {
      if (index % 2 || !validDay(date)) return [];
      const item = sections[index + 1].split('\n').find(line => /^-\s+(?:Feature freeze|Start RC cycle|Tag\s+\x60?v\d)/i.test(line));
      if (!item) return [];
      const title = `Bitcoin Core · ${item.replace(/^-\s+|\x60/g, '').trim().slice(0, 135)}`;
      return [{ ticker: 'BTC', date, type: 'network', title, status: 'estimated', source: 'Bitcoin Core',
        url: `https://github.com/bitcoin/bitcoin/issues/${issue.number}` }];
    });
  });
}

export class MarketCalendar {
  constructor({ store, call, finnhub, finnhubEnabled }) {
    this.store = store; this.call = call; this.finnhub = finnhub; this.finnhubEnabled = finnhubEnabled;
    this.pending = new Map(); this.failedAt = new Map();
  }

  async snapshot(ticker, kind, load) {
    const key = `calendar:${ticker}:${kind}`;
    const row = this.store.get(key);
    const result = (events, unavailable = false) => ({ ticker, kind, events, unavailable, stale: unavailable && !!row });
    if (row && Date.now() - Date.parse(row.updatedAt) < MAX_AGE) return result(row.data.events);
    if (!load || Date.now() - (this.failedAt.get(key) ?? 0) < RETRY) return result(row?.data.events ?? [], true);
    if (!this.pending.has(key)) {
      const request = (async () => {
        try {
          const events = await load();
          this.store.put(key, { events });
          this.failedAt.delete(key);
          return result(events);
        } catch {
          this.failedAt.set(key, Date.now());
          return result(row?.data.events ?? [], true);
        }
      })().finally(() => this.pending.delete(key));
      this.pending.set(key, request);
    }
    return this.pending.get(key);
  }

  async network(ticker) {
    if (ticker === 'ETH') return ethereumEvents((await this.call(ethConfig)).text);
    if (ticker === 'BTC') return bitcoinEvents((await this.call(bitcoinIssues, { headers: userAgent })).json());
    const schedules = solanaSchedules((await this.call(`${agave}_Sidebar.md`)).text);
    if (!schedules.length) throw new Error('INVALID_SOLANA_SCHEDULES');
    const responses = await Promise.all(schedules.map(async schedule =>
      solanaEvents((await this.call(`${agave}${schedule}.md`)).text, schedule)));
    return responses.flat();
  }

  async read(subjects) {
    const now = Date.now();
    const from = day(now), to = day(now + 90 * DAY);
    const tickers = new Map(subjects.map(subject => [subject.ticker, subject.type === 'crypto']));
    if (tickers.delete('CRYPTO')) for (const ticker of ['BTC', 'ETH', 'SOL']) tickers.set(ticker, true);
    const tasks = [];
    for (const [ticker, isCrypto] of tickers) {
      if (isCrypto) {
        tasks.push(this.snapshot(ticker, 'network', () => this.network(ticker)));
        continue;
      }
      tasks.push(this.snapshot(ticker, 'earnings', this.finnhubEnabled() ? async () =>
        earningsEvents(await this.finnhub('calendar/earnings', { symbol: ticker, from, to }), ticker) : null));
      const press = ticker === 'MSFT' ? microsoft : ticker === 'NVDA' ? nvidia : null;
      tasks.push(this.snapshot(ticker, 'dividend', press ? async () => dividendEvents((await this.call(press, { headers: rssHeaders })).text, ticker) : null));
    }
    const results = await Promise.all(tasks);
    const events = new Map();
    for (const result of results) for (const event of result.events) {
      if (event.date < from || event.date > to) continue;
      const key = `${event.ticker}:${event.type}:${event.date}:${event.type === 'network' ? event.title : ''}`;
      if (!events.has(key)) events.set(key, event);
    }
    return { from, to, events: [...events.values()].sort((a, b) => a.date.localeCompare(b.date) || a.ticker.localeCompare(b.ticker)),
      unavailable: results.filter(result => result.unavailable).map(({ ticker, kind }) => ({ ticker, kind })),
      stale: results.some(result => result.stale) };
  }
}
