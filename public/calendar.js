import { lang, t } from './i18n.js';

const $ = id => document.getElementById(id);
let scopeFor, request;
const kindLabel = type => t(`calendar_${type}`);
const dayLabel = date => new Intl.DateTimeFormat(lang(), { dateStyle: 'medium', timeZone: 'UTC' }).format(new Date(`${date}T00:00:00Z`));

function node(tag, text, className) {
  const element = document.createElement(tag);
  if (text) element.textContent = text;
  if (className) element.className = className;
  return element;
}

function renderCalendar(data) {
  const list = $('calendar-events'), coverage = $('calendar-coverage');
  const rows = data.events;
  $('calendar-status').textContent = rows.length
    ? `${dayLabel(data.from)} – ${dayLabel(data.to)}`
    : t('calendarEmpty');
  coverage.replaceChildren();
  const groups = Map.groupBy(data.unavailable, item => item.kind);
  for (const [kind, items] of groups) {
    coverage.append(node('li', `${kindLabel(kind)} · ${items.map(item => item.ticker).join(', ')}`));
  }
  $('calendar-gaps').hidden = !groups.size;
  $('calendar-stale').hidden = !data.stale;
  list.replaceChildren();
  for (const event of rows) {
    const item = node('li', '', 'calendar-item');
    const date = event.at ? new Intl.DateTimeFormat(lang(), { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(event.at))
      : dayLabel(event.date);
    const time = node('time', date);
    time.dateTime = event.at || event.date;
    const detail = node('div');
    detail.append(node('strong', `${event.ticker} · ${kindLabel(event.type)}`));
    if (event.title) detail.append(node('p', event.title));
    const notes = [t(event.status === 'estimated' ? 'calendarEstimated' : 'calendarAnnounced')];
    if (event.hour) notes.push(t(`calendar_${event.hour}`));
    if (event.amount) notes.push(new Intl.NumberFormat(lang(), { style: 'currency', currency: 'USD' }).format(event.amount));
    detail.append(node('small', notes.join(' · '), 'panel-note'));
    const source = node('a', event.source, 'source-link');
    if (/^https:\/\//i.test(event.url)) {
      source.href = event.url; source.target = '_blank'; source.rel = 'noopener noreferrer';
      detail.append(source);
    }
    item.append(time, detail); list.append(item);
  }
}

export function refreshCalendar() {
  request?.abort();
  const ctrl = request = new AbortController();
  if (!$('calendar-panel').open || $('calendar-panel').hidden) return;
  const tickers = scopeFor($('calendar-scope').value);
  $('calendar-events').replaceChildren();
  $('calendar-gaps').hidden = true;
  $('calendar-stale').hidden = true;
  if (!tickers.length) {
    $('calendar-status').textContent = t('calendarNoFavorites');
    return;
  }
  $('calendar-status').textContent = t('loading');
  fetch(`/api/calendar?tickers=${encodeURIComponent(tickers.join(','))}`, { signal: ctrl.signal })
    .then(response => {
      if (!response.ok) throw new Error('calendar');
      return response.json();
    })
    .then(data => { if (request === ctrl) renderCalendar(data); })
    .catch(error => {
      if (request === ctrl && error.name !== 'AbortError') $('calendar-status').textContent = t('calendarUnavailable');
    });
}

export function initCalendar(getTickers) {
  scopeFor = getTickers;
  $('calendar-panel').addEventListener('toggle', refreshCalendar);
  $('calendar-scope').addEventListener('change', refreshCalendar);
}
