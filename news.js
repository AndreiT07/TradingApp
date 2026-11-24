import { XMLParser } from 'fast-xml-parser';
import { createHash } from 'node:crypto';
import { companies } from './companies.js';
import { cryptoAssets } from './crypto.js';
const parser = new XMLParser({ ignoreAttributes: false, processEntities: true, htmlEntities: true });
export const NEWS_WINDOW = 86_400_000;
const escapePattern = text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const subjects = [...companies, ...cryptoAssets.slice(1)].map(({ ticker, keywords, type }) => ({
  ticker,
  type,
  aliases: new RegExp(`\\b(?:${keywords.map(escapePattern).join('|')})\\b`, 'i'),
  symbol: new RegExp(`\\b${escapePattern(ticker)}\\b`),
}));
const cryptoMarket = /\b(?:cryptocurrenc(?:y|ies)|crypto(?:assets?)?|digital assets?|stablecoins?|altcoins?|memecoins?|defi|blockchain|xrp|dogecoin|cardano|litecoin|tether|usdt|usdc|binance|coinbase)\b/i;
const context = /\b(?:as|amid|amidst|after|ahead of|following|against|unlike|compared (?:to|with)|thanks to|despite|while|alongside|in the wake of|driven by|boosted by|lifted by|because of|(?:signal|message|warning) to)\b|;/i;
const comparison = /\b(?:vs\.?|versus|better buy)\b/i;
const comparativeName = /\b[\w.]+[-‑–](?:scale|like|style|sized?)\b/gi;
const audience = /\b(?:sends?|gives?)\b(?=[^.!?]{0,100}\b(?:investors|shareholders)\b[^.!?]{0,80}\b(?:signal|message|warning)\b)/i;
const analystAttribution = /\b(?:AM|asset management|analysts?)\s+(?:says?|sees?|warns?|expects?|forecasts?)\b/i;
const holdingOpinion = /\b(?:owns|holds)\b[^?!]*\.\s*(?:is (?:the stock|it) a (?:buy|sell|hold)|should (?:you|i) (?:buy|sell|hold))\b/i;
const basket = /(?:^(?:\d+|top(?: \d+)?|best|this|another|an?|the (?:\d+|best))|\bthese(?: \d+)?)\s+(?:[\w'-]+\s+){0,6}(?:stocks?|shares?|coins?|tokens?|etfs?)\b/i;
const marketRoundup = /^(?:stock market|wall street|markets?) (?:today|wrap|roundup|recap|sell-off)\b|\binvestment ideas feature highlights\b/i;

export function isRelevantHeadline(title, subject) {
  const headline = title.normalize('NFKC').replace(/\s+/g, ' ').trim();
  if (holdingOpinion.test(headline)) return false;
  const mainClause = headline.split(context, 1)[0];
  const lead = mainClause.split(analystAttribution).at(-1).trim().split(audience, 1)[0].replace(comparativeName, ' ');
  if (basket.test(lead) || comparison.test(lead) || marketRoundup.test(lead)) return false;

  let first = subject.ticker === 'CRYPTO' ? lead.search(cryptoMarket) : -1;
  let focus = first < 0 ? null : 'CRYPTO';
  for (const { ticker, aliases, symbol, type } of subjects) {
    for (const pattern of [aliases, symbol]) {
      const position = lead.search(pattern);
      if (position >= 0 && (first < 0 || position < first)) {
        first = position;
        focus = subject.ticker === 'CRYPTO' && type === 'crypto' ? 'CRYPTO' : ticker;
      }
    }
  }
  return focus === subject.ticker;
}

export function isRecentNews(time, now) {
  return Number.isFinite(time) && time >= now - NEWS_WINDOW && time <= now + 300_000;
}

export function headlineKey(title) {
  return title.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

const rules = [
  { category: 'Rezultate financiare', weight: 6, pattern: /\b(earnings|revenue|profit|quarterly|guidance|results|forecast)\b/i },
  { category: 'Reglementări', weight: 5, pattern: /\b(antitrust|lawsuit|regulat\w*|probe|fda|court|tariff\w*)\b/i },
  { category: 'Tranzacții & strategie', weight: 5, pattern: /\b(acquisit\w*|merger|buyout|deal|invest\w*|partnership)\b/i },
  { category: 'Produse & inovație', weight: 3, pattern: /\b(launch\w*|chip\w*|ai|iphone|product\w*|deliveries)\b/i },
];
export function classify(title) {
  return rules.find(rule => rule.pattern.test(title)) ?? { category: 'Companie & piață', weight: 1 };
}
export function parseFeed(xml, company, now = Date.now(), { sourceName, descriptions = false } = {}) {
  if (xml.length > 2_000_000 || /<!DOCTYPE|<!ENTITY/i.test(xml)) throw new Error('Invalid feed');
  const parsed = parser.parse(xml);
  if (!parsed.rss?.channel) throw new Error('Invalid RSS');
  const items = parsed.rss.channel.item ?? [];
  const seen = new Set();
  return (Array.isArray(items) ? items : [items]).flatMap(item => {
    const rawTitle = typeof item.title === 'string' ? item.title : '';
    const source = typeof item.source === 'string' ? item.source : item.source?.['#text'];
    const title = source && rawTitle.endsWith(` - ${source}`) ? rawTitle.slice(0, -source.length - 3) : rawTitle;
    const publishedAt = Date.parse(item.pubDate);
    let url;
    try { url = new URL(item.link); } catch { return []; }
    if (!title || !isRecentNews(publishedAt, now) || !['https:', 'http:'].includes(url.protocol) || !isRelevantHeadline(title, company)) return [];
    const key = headlineKey(title);
    if (seen.has(key)) return [];
    seen.add(key);
    const { category, weight } = classify(title);
    const description = descriptions && typeof item.description === 'string' ? item.description.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 6000) : '';
    const ageHours = Math.max(0, (now - publishedAt) / 3_600_000);
    return [{ id: createHash('sha256').update(url.href).digest('hex').slice(0, 16), title, source: String(source || sourceName || 'Google News'), url: url.href,
      ...(description ? { description } : {}), publishedAt: new Date(publishedAt).toISOString(), category, score: Number((weight + 3 / (1 + ageHours / 12)).toFixed(3)) }];
  }).sort((a, b) => b.score - a.score).slice(0, 30);
}
