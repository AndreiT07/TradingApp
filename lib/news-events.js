import { createHash } from 'node:crypto';
import { headlineKey } from '../news.js';

const leadership = /\b(?:ceo|chief executive|board chair|jensen huang)\b/i;
const transitions = [
  ['return', /\b(?:reinstat\w*|return\w*|is back|rejoin\w*)\b/i],
  ['departure', /\b(?:resign\w*|steps? down|departure|oust\w*|fired)\b/i],
  ['appointment', /\b(?:appoint\w*|names|named|new ceo)\b/i],
];
const topics = [
  ['earnings', /\b(?:earnings|revenue|quarterly results|guidance|eps)\b/i],
  ['deals', /\b(?:merger|acqui(?:re|res|red|sition)|buyout|partnership|deal)\b/i],
  ['regulation', /\b(?:regulat\w*|antitrust|lawsuit|court|sec|cftc|tariffs?|fda|legislation)\b/i],
  ['security', /\b(?:hack\w*|breach|exploit\w*|vulnerabilit\w*|security incident)\b/i],
  ['network', /\b(?:upgrade|hard fork|mainnet|network outage|fork)\b/i],
];
const opinion = /\b(?:should (?:you|i)|my top|i(?:’|')d buy|stocks? to buy|is it worth|time to (?:buy|sell|book profits)|price prediction|opinion|investment ideas)\b/i;
const official = new Set(['nvidianews.nvidia.com', 'investor.nvidia.com', 'sec.gov', 'www.sec.gov', 'blog.ethereum.org', 'solana.com']);
const stopWords = new Set('a an and are as at be by for from has in is it of on or says said that the their this to was were what will with why'.split(' '));

export function publisherKey(source) {
  const key = String(source ?? '').normalize('NFKC').toLowerCase().trim().replace(/\s+/g, ' ');
  return /^yahoo!?(?: finance| news)?!?$/.test(key) ? 'yahoo' : key;
}

export function articleType(article) {
  try { if (official.has(new URL(article.url).hostname)) return 'official'; } catch { /* Unparseable links have no verified provenance. */ }
  return opinion.test(article.title) ? 'opinion' : 'news';
}

function describeArticle(article, subject) {
  const transition = leadership.test(article.title) ? transitions.find(([, pattern]) => pattern.test(article.title)) : null;
  const topic = transition ? 'leadership' : topics.find(([, pattern]) => pattern.test(article.title))?.[0] ?? 'other';
  const networkUpgrade = subject.type === 'crypto' && /\b(?:upgrade|hard fork)\b/i.test(article.title);
  const signature = subject.ticker === 'CRYPTO' ? null
    : transition ? `leadership:${transition[0]}` : networkUpgrade ? 'network:upgrade' : null;
  const type = articleType(article);
  const score = article.score + (type === 'official' ? 1.5 : type === 'opinion' ? -2 : 0);
  const key = headlineKey(article.title);
  const tokens = new Set(key.split(' ').filter(word => word.length > 2 && !stopWords.has(word)));
  return { ...article, score, type, topic, signature, key, tokens };
}

function sameEvent(a, b) {
  if (a.key === b.key || (a.signature && a.signature === b.signature)) return true;
  if (a.signature && b.signature) return false;
  const shared = [...a.tokens].filter(word => b.tokens.has(word)).length;
  return shared >= 4 && shared / Math.max(a.tokens.size, b.tokens.size) >= 0.67;
}

const date = article => Date.parse(article.publishedAt);
const rank = (a, b) => b.score - a.score || date(b) - date(a);
const id = value => createHash('sha256').update(value).digest('hex').slice(0, 20);

export function groupNews(articles, subject) {
  const seen = new Set();
  const groups = [];
  for (const article of articles.map(item => describeArticle(item, subject)).sort(rank)) {
    if (seen.has(article.url)) continue;
    seen.add(article.url);
    const match = groups.find(group => group.some(member => sameEvent(article, member)));
    if (match) match.push(article);
    else groups.push([article]);
  }
  return groups.map(group => {
    const representative = group.find(article => article.type === 'official') ?? group[0];
    const first = group.reduce((a, b) => date(a) <= date(b) ? a : b);
    const sourceNames = new Set([publisherKey(representative.source)]);
    const coverage = [];
    for (const item of group) {
      const source = publisherKey(item.source);
      if (sourceNames.has(source)) continue;
      sourceNames.add(source);
      const { title, url, publishedAt, type } = item;
      coverage.push({ title, url, source: item.source, publishedAt, type });
    }
    const { signature: representativeSignature, key, tokens, ...publicFields } = representative;
    const signature = representativeSignature ?? group.find(item => item.signature)?.signature;
    return { ...publicFields, score: group[0].score,
      eventId: id(`${subject.ticker}:${signature ? `${signature}:${first.publishedAt.slice(0, 10)}` : first.url}`),
      eventAt: first.publishedAt, coverage: coverage.slice(0, 8) };
  }).sort(rank);
}
