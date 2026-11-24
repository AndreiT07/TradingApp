import { lang, t } from './i18n.js';

const $ = id => document.getElementById(id);
const ranges = { '1d': '1d|15', '1w': '7d|60', '1m': '1m|1D' };
const timestamp = value => new Intl.DateTimeFormat(lang(), { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value));
let activeTicker, period = '1d', data, currentNews = [], request, widgetKey, observer;

const templateLink = (url, name) => {
  if (!/^https?:\/\//i.test(url ?? '')) return null;
  const link = document.createElement('a');
  link.href = url;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  link.textContent = name;
  return link;
};

function draw(canvas, chart) {
  const width = canvas.clientWidth, height = canvas.clientHeight;
  if (!width || !height) return;
  const scale = window.devicePixelRatio || 1;
  canvas.width = width * scale; canvas.height = height * scale;
  const context = canvas.getContext('2d');
  context.scale(scale, scale);
  const values = chart.points.map(point => point.price);
  const low = Math.min(...values), high = Math.max(...values);
  const margin = Math.max((high - low) * 0.08, high * 0.0005);
  const min = low - margin, max = high + margin;
  const left = 8, right = 68, top = 22, bottom = height - 25;
  const x = time => left + ((time - chart.from) / (chart.to - chart.from)) * (width - left - right);
  const y = price => bottom - (price - min) / (max - min) * (bottom - top);
  const format = new Intl.NumberFormat(lang(), { maximumFractionDigits: 2 });
  context.font = '11px system-ui';
  for (let step = 0; step <= 4; step++) {
    const price = min + (max - min) * step / 4;
    context.strokeStyle = '#2d382d'; context.beginPath();
    context.moveTo(left, y(price)); context.lineTo(width - right, y(price)); context.stroke();
    context.fillStyle = '#a9b3a0'; context.fillText(format.format(price), width - right + 6, y(price) + 4);
  }
  context.strokeStyle = '#b4df79'; context.lineWidth = 2; context.lineJoin = 'round'; context.beginPath();
  chart.points.forEach((point, index) => {
    if (index) context.lineTo(x(point.at), y(point.price));
    else context.moveTo(x(point.at), y(point.price));
  });
  context.stroke();
  for (const event of visibleEvents()) {
    context.strokeStyle = '#d4a361'; context.lineWidth = 1; context.beginPath();
    context.moveTo(x(Date.parse(event.eventAt)), bottom + 4);
    context.lineTo(x(Date.parse(event.eventAt)), bottom + 12); context.stroke();
  }
}

function visibleEvents() {
  if (!data) return [];
  const merged = new Map(data.events.map(event => [event.eventId, event]));
  for (const item of currentNews) if (item.eventId) merged.set(item.eventId, item);
  return [...merged.values()]
    .filter(event => Date.parse(event.eventAt) >= data.from && Date.parse(event.eventAt) <= data.to && /^https?:\/\//i.test(event.url ?? ''))
    .sort((a, b) => Date.parse(b.eventAt) - Date.parse(a.eventAt)).slice(0, 40);
}

function renderTimeline() {
  const axis = $('event-axis'), list = $('chart-events');
  axis.replaceChildren(); list.replaceChildren();
  const events = visibleEvents();
  axis.hidden = !events.length;
  $('chart-empty-events').hidden = !data || events.length > 0;
  for (const event of events) {
    const marker = templateLink(event.url, '');
    marker.className = 'event-marker';
    marker.style.left = `${(Date.parse(event.eventAt) - data.from) / (data.to - data.from) * 100}%`;
    marker.title = `${timestamp(event.eventAt)} · ${event.title}`;
    marker.setAttribute('aria-label', marker.title);
    axis.append(marker);
  }
  for (const event of events.slice(0, 10)) {
    const item = document.createElement('li'), time = document.createElement('time');
    time.dateTime = event.eventAt; time.textContent = timestamp(event.eventAt);
    item.append(time, templateLink(event.url, event.title)); list.append(item);
  }
}

function showWidget() {
  const key = `${data.symbol}:${period}:${lang()}`;
  if (widgetKey === key && $('price-widget').firstChild) return;
  widgetKey = key;
  const frame = document.createElement('iframe'), url = new URL('https://www.tradingview-widget.com/embed-widget/symbol-overview/');
  url.searchParams.set('locale', lang());
  url.hash = encodeURIComponent(JSON.stringify({
    'page-uri': location.origin, colorTheme: 'dark', backgroundColor: '#151a15', gridLineColor: '#30362d',
    autosize: true, width: '100%', height: '100%', symbols: [[activeTicker, `${data.symbol}|${period.toUpperCase()}`]],
    dateRanges: [ranges[period]], locale: lang(), hideDateRanges: true, hideSymbolLogo: false,
  }));
  frame.loading = 'lazy';
  frame.title = `${t('priceChart')} · ${activeTicker}`;
  frame.referrerPolicy = 'origin';
  frame.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox');
  frame.src = url.href;
  $('price-widget').replaceChildren(frame);
  const credit = $('tradingview-credit');
  credit.href = `https://www.tradingview.com/symbols/${data.symbol.replace(':', '-')}/`;
}

function renderChart() {
  const pane = $('chart-panel');
  pane.querySelectorAll('[data-period]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.period === period)));
  const canvas = $('price-canvas'), fallback = $('price-widget'), credit = $('tradingview-credit');
  if (!data) {
    canvas.hidden = true; fallback.hidden = true; credit.hidden = true; renderTimeline();
    return;
  }
  const coverage = data.points.at(-1)?.at - data.points[0]?.at;
  const native = data.points.length >= 2 && (period === '1d' || coverage >= (data.to - data.from) * 0.6);
  canvas.hidden = !native; fallback.hidden = native; credit.hidden = native;
  $('chart-status').textContent = native ? t('finnhubRecorded') : t('widgetHistory');
  if (native) draw(canvas, data);
  else showWidget();
  renderTimeline();
}

export function showChart(ticker, articles = []) {
  const panel = $('chart-panel');
  panel.hidden = !ticker;
  request?.abort();
  if (!ticker) { activeTicker = null; data = null; $('price-widget').replaceChildren(); return; }
  activeTicker = ticker; currentNews = articles; data = null;
  renderChart();
  $('chart-status').textContent = t('loading');
  const controller = request = new AbortController();
  fetch(`/api/prices?ticker=${encodeURIComponent(ticker)}&period=${period}`, { signal: controller.signal })
    .then(response => {
      if (!response.ok) throw new Error('chart');
      return response.json();
    })
    .then(chart => {
      if (controller !== request) return;
      data = chart; renderChart();
    })
    .catch(error => {
      if (error.name !== 'AbortError' && controller === request) $('chart-status').textContent = t('chartUnavailable');
    });
}

export function updateChartEvents(ticker, articles) {
  if (ticker !== activeTicker) return;
  currentNews = articles;
  if (data) {
    renderTimeline();
    if (!$('price-canvas').hidden) draw($('price-canvas'), data);
  }
}

export function initChart() {
  $('chart-panel').querySelectorAll('[data-period]').forEach(button => button.addEventListener('click', () => {
    if (button.dataset.period === period || !activeTicker) return;
    period = button.dataset.period; showChart(activeTicker, currentNews);
  }));
  observer = new ResizeObserver(() => {
    if (data && !$('price-canvas').hidden) draw($('price-canvas'), data);
  });
  observer.observe($('price-canvas'));
}
