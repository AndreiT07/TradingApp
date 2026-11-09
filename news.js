import { XMLParser } from 'fast-xml-parser';
import { createHash } from 'node:crypto';
const parser = new XMLParser({ ignoreAttributes: false, processEntities: true, htmlEntities: true });
const rules = [
  { category: 'Rezultate financiare', weight: 6, pattern: /\b(earnings|revenue|profit|quarterly|guidance|results|forecast)\b/i },
  { category: 'Reglementări', weight: 5, pattern: /\b(antitrust|lawsuit|regulat\w*|probe|fda|court|tariff\w*)\b/i },
  { category: 'Tranzacții & strategie', weight: 5, pattern: /\b(acquisit\w*|merger|buyout|deal|invest\w*|partnership)\b/i },
  { category: 'Produse & inovație', weight: 3, pattern: /\b(launch\w*|chip\w*|ai|iphone|product\w*|deliveries)\b/i },
];
export function classify(title) {
  return rules.find(rule => rule.pattern.test(title)) ?? { category: 'Companie & piață', weight: 1 };
}
export function parseFeed(xml, company, now = Date.now()) {
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
    if (!title || !Number.isFinite(publishedAt) || publishedAt > now + 300_000 || !['https:', 'http:'].includes(url.protocol)) return [];
    if (!company.keywords.some(word => title.toLowerCase().includes(word))) return [];
    const key = title.toLowerCase().replace(/\W/g, '');
    if (seen.has(key)) return [];
    seen.add(key);
    const { category, weight } = classify(title);
    const ageHours = Math.max(0, (now - publishedAt) / 3_600_000);
    return [{ id: createHash('sha256').update(url.href).digest('hex').slice(0, 16), title, source: String(source || 'Google News'), url: url.href,
      publishedAt: new Date(publishedAt).toISOString(), category, score: Number((weight + 3 / (1 + ageHours / 12)).toFixed(3)) }];
  }).sort((a, b) => b.score - a.score).slice(0, 30);
}
