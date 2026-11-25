import { request, EnvHttpProxyAgent } from 'undici';
const dispatcher = new EnvHttpProxyAgent();
// All upstream URLs are constructed by server adapters, never from browser input.
const hosts = new Set(['www.coindesk.com', 'cointelegraph.com', 'decrypt.co', 'news.google.com', 'nvidianews.nvidia.com', 'finnhub.io', 'data.sec.gov', 'www.sec.gov', 'news.microsoft.com', 'raw.githubusercontent.com', 'api.github.com']);
export async function upstream(url, { headers = {}, maxBytes = 2_000_000 } = {}) {
  const target = new URL(url);
  if (target.protocol !== 'https:' || !hosts.has(target.hostname) || target.port) throw new Error('INVALID_UPSTREAM');
  const response = await request(target, { dispatcher, headers, signal: AbortSignal.timeout(25_000), maxRedirections: 0 });
  if (response.statusCode !== 200) {
    response.body.on('error', () => {}); response.body.destroy();
    const error = new Error(`UPSTREAM_${response.statusCode}`);
    error.status = response.statusCode;
    throw error;
  }
  const chunks = []; let bytes = 0;
  for await (const chunk of response.body) {
    bytes += chunk.length;
    if (bytes > maxBytes) { response.body.on('error', () => {}); response.body.destroy(); throw new Error('UPSTREAM_TOO_LARGE'); }
    chunks.push(chunk);
  }
  const text = Buffer.concat(chunks).toString('utf8');
  return { text, json: () => JSON.parse(text) };
}
export function safeLink(value) {
  try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) ? url.href : null; } catch { return null; }
}
