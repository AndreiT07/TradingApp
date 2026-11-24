const day = 86_400_000;
export const pricePeriods = { '1d': day, '1w': 7 * day, '1m': 30 * day };

const exchanges = {
  AAPL: 'NASDAQ:AAPL', MSFT: 'NASDAQ:MSFT', NVDA: 'NASDAQ:NVDA', GOOGL: 'NASDAQ:GOOGL',
  AMZN: 'NASDAQ:AMZN', META: 'NASDAQ:META', TSLA: 'NASDAQ:TSLA', JPM: 'NYSE:JPM',
  'BRK.B': 'NYSE:BRK.B', LLY: 'NYSE:LLY', CRYPTO: 'CRYPTOCAP:TOTAL',
  BTC: 'COINBASE:BTCUSD', ETH: 'COINBASE:ETHUSD', SOL: 'COINBASE:SOLUSD',
};

export function quoteSymbol(subject) {
  if (subject.ticker === 'CRYPTO') return null;
  return subject.type === 'crypto' ? `COINBASE:${subject.ticker}-USD` : subject.ticker;
}

export function priceHistory(store, subject, period, now = Date.now()) {
  const from = now - pricePeriods[period];
  const points = store.prices(subject.ticker, from).filter(point => point.at <= now);
  const events = store.get(`news-history:${subject.ticker}`)?.data.events ?? [];
  return { ticker: subject.ticker, period, from, to: now, points,
    symbol: exchanges[subject.ticker], events: events.filter(event => Date.parse(event.eventAt) >= from) };
}
