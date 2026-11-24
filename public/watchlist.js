export const alertTopics = ['earnings', 'leadership', 'deals', 'regulation', 'network', 'security'];
const storageKey = 'tradingapp.watchlist';
let session = { favorites: {}, topics: {}, alerts: [], seen: [], viewedAt: 0 };

export function watchState() {
  try {
    const stored = JSON.parse(localStorage.getItem(storageKey));
    if (stored && Array.isArray(stored.alerts) && Array.isArray(stored.seen) && stored.favorites && stored.topics) session = stored;
  } catch { /* The current view still works when storage is unavailable. */ }
  return session;
}

function save(state) {
  session = state;
  try { localStorage.setItem(storageKey, JSON.stringify(state)); } catch { /* Keep the session state. */ }
}

export function toggleFavorite(ticker) {
  const state = watchState();
  if (Object.hasOwn(state.favorites, ticker)) delete state.favorites[ticker];
  else state.favorites[ticker] = Date.now();
  save(state);
}

export function changeAlertTopic(topic, enabled) {
  if (!alertTopics.includes(topic)) return;
  const state = watchState();
  if (enabled) state.topics[topic] = Date.now();
  else delete state.topics[topic];
  save(state);
}

export function readAlerts() {
  const state = watchState();
  state.viewedAt = Date.now();
  save(state);
}

export function addAlerts(ticker, articles) {
  const state = watchState();
  if (!Object.hasOwn(state.favorites, ticker)) return;
  const seen = new Set(state.seen);
  const incoming = [];
  for (const { eventId, eventAt, title, topic, url, coverage = [] } of articles) {
    if (!eventId || !Object.hasOwn(state.topics, topic)) continue;
    const at = Date.parse(eventAt);
    if (!Number.isFinite(at) || at < Math.max(state.favorites[ticker], state.topics[topic])) continue;
    const keys = [eventId, url, ...coverage.map(item => item.url)].filter(Boolean).map(value => `${ticker}:${value}`);
    if (keys.some(key => seen.has(key))) continue;
    keys.forEach(key => seen.add(key));
    incoming.push({ ticker, title, url, topic, eventAt, receivedAt: Date.now() });
  }
  if (!incoming.length) return;
  state.alerts = [...incoming, ...state.alerts].sort((a, b) => Date.parse(b.eventAt) - Date.parse(a.eventAt)).slice(0, 30);
  state.seen = [...seen].slice(-500);
  save(state);
}
