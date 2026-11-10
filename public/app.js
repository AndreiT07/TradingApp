import { t, lang, setLanguage, categoryKeys, sectorKeys } from './i18n.js';
const $ = id => document.getElementById(id);
const state = { companies: [], ticker: 'AAPL', articles: [], sort: 'important', category: 'all', demo: false, loading: false, error: null, fetchedAt: null, stale: false, setup: null, investors: null, analysis: null };
let requestController, researchController;
const dateTime = value => new Intl.DateTimeFormat(lang() === 'ro' ? 'ro-RO' : 'en-US', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
const number = value => value == null ? '—' : new Intl.NumberFormat(lang(), { maximumFractionDigits: 2 }).format(value);
function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}
function applyLanguage() {
  setLanguage(lang());
  document.title = t('pageTitle');
  document.querySelectorAll('[data-i18n]').forEach(node => { node.textContent = t(node.dataset.i18n); });
  $('language').value = lang(); $('language').setAttribute('aria-label', t('language'));
  $('company-search').placeholder = t('search'); $('company-search').setAttribute('aria-label', t('searchLabel'));
  document.querySelector('.brand').setAttribute('aria-label', t('home'));
  document.querySelector('.tabs').setAttribute('aria-label', t('ordering'));
  document.querySelector('.ranking-info').title = t('priorityTitle');
  document.querySelectorAll('#category option').forEach(option => {
    if (option.value === 'all') option.textContent = t('allSubjects');
    else { option.value = option.dataset.original ?? option.value; option.dataset.original = option.value; option.textContent = t(categoryKeys[option.value]); }
  });
  $('today').textContent = new Intl.DateTimeFormat(lang() === 'ro' ? 'ro-RO' : 'en-US', { day: 'numeric', month: 'long', year: 'numeric' }).format(new Date());
  renderCompanies(); renderCompany();
}
function renderCompany() {
  const company = state.companies.find(c => c.ticker === state.ticker);
  if (!company) return;
  $('company-title').textContent = company.name; $('selected-ticker').textContent = company.ticker;
  $('selected-logo').textContent = company.symbol;
  $('selected-sector').textContent = `${t(sectorKeys[company.sector])} · ${t('country')}`;
}
function renderCompanies() {
  const query = $('company-search').value.trim().toLocaleLowerCase(lang());
  const filtered = state.companies.filter(c => `${c.name} ${c.ticker}`.toLocaleLowerCase(lang()).includes(query));
  $('companies').replaceChildren();
  for (const company of filtered) {
    const button = element('button', `company-button${company.ticker === state.ticker ? ' selected' : ''}`);
    button.type = 'button'; button.setAttribute('aria-pressed', String(company.ticker === state.ticker));
    const logo = element('span', 'company-logo', company.symbol), label = element('span', 'company-label');
    label.append(element('strong', '', company.name), element('small', '', company.ticker));
    button.append(logo, label);
    if (company.ticker === state.ticker) button.append(element('span', 'company-arrow', '↗'));
    button.addEventListener('click', () => selectCompany(company.ticker)); $('companies').append(button);
  }
  if (!filtered.length) $('companies').append(element('p', 'search-empty', t('noCompany')));
}
function selectCompany(ticker) {
  state.ticker = ticker; state.category = 'all'; $('category').value = 'all';
  renderCompany(); renderCompanies(); loadNews(); loadResearch();
}
function makeDemo() {
  const name = state.companies.find(c => c.ticker === state.ticker)?.name ?? state.ticker;
  const titles = lang() === 'ro' ? [
    `${name}: ce urmăresc investitorii în următorul raport financiar`, `Planurile de investiții ale ${name} intră în atenția pieței`,
    `${name} și noile tehnologii: teme de urmărit în lunile următoare`, `Schimbările de reglementare care ar putea conta pentru ${name}`, `O privire asupra strategiei pe termen lung a ${name}`,
  ] : [
    `${name}: what investors may watch in the next earnings report`, `${name}'s investment plans come into focus`,
    `${name} and new technology: themes to watch`, `Regulatory changes that could matter for ${name}`, `A look at ${name}'s long-term strategy`,
  ];
  return titles.map((title, i) => ({ id: `demo-${i}`, title, category: ['Rezultate financiare','Tranzacții & strategie','Produse & inovație','Reglementări','Companie & piață'][i], score: 9 - i,
    source: t('exampleSource'), publishedAt: null, url: null, summary: { status: 'ready', text: t('exampleSummary') } }));
}
async function loadNews() {
  requestController?.abort(); const controller = requestController = new AbortController();
  state.loading = true; state.error = null; state.articles = []; state.fetchedAt = null; state.stale = false; renderFeed();
  if (state.demo) { state.articles = makeDemo(); state.loading = false; renderFeed(); return; }
  try {
    const response = await fetch(`/api/news?ticker=${encodeURIComponent(state.ticker)}&lang=${lang()}`, { signal: controller.signal });
    if (!response.ok) throw new Error('news');
    const data = await response.json(); if (controller !== requestController) return;
    state.articles = data.articles; state.fetchedAt = data.fetchedAt; state.stale = data.stale; state.setup = data.setup;
  } catch (error) { if (error.name === 'AbortError') return; state.error = 'news'; }
  finally { if (controller === requestController) { state.loading = false; renderFeed(); } }
}
async function loadResearch() {
  researchController?.abort(); const controller = researchController = new AbortController();
  state.investors = null; state.analysis = null; renderResearch();
  if (state.demo) {
    state.investors = { status: 'demo', funds: [], insiders: [] };
    state.analysis = { status: 'demo', verdict: 'insufficient', rationale: t('exampleRationale'), opportunities: [t('exampleOpportunity')], risks: [t('exampleRisk')] };
    renderResearch(); return;
  }
  await Promise.all(['investors', 'analysis'].map(async key => {
    try {
      const response = await fetch(`/api/${key}?ticker=${encodeURIComponent(state.ticker)}&lang=${lang()}`, { signal: controller.signal });
      if (!response.ok) throw new Error('unavailable');
      const data = await response.json(); if (controller !== researchController) return;
      state[key] = data;
    } catch (error) { if (error.name === 'AbortError') return; state[key] = { status: 'unavailable' }; }
    if (controller === researchController) renderResearch();
  }));
}
function emptyState(title, description, actions = []) {
  const container = element('div', 'empty-state');
  container.append(element('div', 'empty-icon', '◎'), element('h3', '', title), element('p', '', description));
  const buttons = element('div');
  for (const [text, action, className] of actions) { const button = element('button', className, text); button.type = 'button'; button.addEventListener('click', action); buttons.append(button); }
  container.append(buttons); return container;
}
function renderFeed() {
  const missing = state.setup?.missing ?? [];
  $('setup-notice').hidden = state.demo || !missing.length;
  $('setup-explanation').textContent = `${t('setupIntro')} ${t('setupFile')}: ${missing.join(', ')}.`;
  $('refresh').disabled = state.loading; $('demo-notice').hidden = !state.demo;
  $('feed').setAttribute('aria-busy', String(state.loading)); $('feed').replaceChildren();
  $('updated').textContent = state.fetchedAt ? `${state.stale ? t('staleCache') + ' · ' : ''}${t('fetched')} · ${dateTime(state.fetchedAt)} · ${t('cache')}` : '';
  if (state.loading) {
    $('news-status').textContent = t('fetching'); const grid = element('div', 'news-grid');
    for (let i = 0; i < 3; i++) { const skeleton = element('div', 'skeleton'); skeleton.setAttribute('aria-hidden', 'true'); grid.append(skeleton); }
    $('feed').append(grid); return;
  }
  if (state.error) {
    $('news-status').textContent = t('unavailable');
    const actions = state.error === 'companies' ? [[t('reload'), () => location.reload(), 'primary-button']] : [[t('retry'), loadNews, 'secondary-button'], [t('demo'), () => { state.demo = true; loadNews(); loadResearch(); }, 'primary-button']];
    $('feed').append(emptyState(t('unavailableTitle'), t(state.error === 'companies' ? 'companiesError' : 'newsError'), actions)); return;
  }
  const articles = state.articles.filter(a => state.category === 'all' || a.category === state.category).sort((a, b) => state.sort === 'important' ? b.score - a.score : new Date(b.publishedAt) - new Date(a.publishedAt));
  $('news-status').textContent = `${articles.length} ${t(articles.length === 1 ? 'article' : 'articles')}${state.demo ? ' · DEMO' : ' · ' + t('lastWeek')}`;
  if (!articles.length) { $('feed').append(emptyState(t('empty'), t(state.category === 'all' ? 'emptyCompany' : 'emptyCategory'))); return; }
  const grid = element('div', 'news-grid');
  articles.forEach((article, index) => {
    const card = element('article', `article${index === 0 ? ' featured' : ''}`), meta = element('div', 'article-meta');
    meta.append(element('span', '', t(categoryKeys[article.category] ?? 'market').toLocaleUpperCase(lang())));
    if (index === 0 && state.sort === 'important') meta.append(element('span', 'priority-label', t('focus')));
    const heading = element('h3');
    if (article.url && /^https?:\/\//.test(article.url)) { const link = element('a', '', article.title); link.href = article.url; link.target = '_blank'; link.rel = 'noopener noreferrer'; heading.append(link); }
    else heading.textContent = article.title;
    const summary = element('div', 'article-summary');
    if (article.summary?.status === 'ready' && article.summary.text) {
      summary.append(element('span', 'summary-label', t('summary')), element('p', '', article.summary.text), element('small', '', state.demo ? t('example') : t('summaryBasis')));
    } else {
      const key = { pending:'summaryPending', not_configured:'summaryConfig', budget_limited:'summaryBudget', no_text:'noText' }[article.summary?.status] ?? 'summaryError';
      summary.append(element('p', 'summary-missing', article.summary?.reason ? t(article.summary.reason) : t(key)));
    }
    if (article.originalTitle && article.originalTitle !== article.title) summary.append(element('small', 'original-headline', `${t('originalTitle')}: ${article.originalTitle}`));
    else if (!state.demo && !article.titleTranslated) summary.append(element('small', '', t('originalLanguage')));
    const bottom = element('div', 'article-bottom');
    bottom.append(element('span', 'source-dot'), element('span', '', article.source), element('span', '', '·'));
    if (article.publishedAt) { const time = element('time', '', dateTime(article.publishedAt)); time.dateTime = article.publishedAt; bottom.append(time); }
    else bottom.append(element('span', '', t('example')));
    if (article.url) { const arrow = element('span', 'article-open', '↗'); arrow.setAttribute('aria-hidden', 'true'); bottom.append(arrow); }
    card.append(meta, heading, summary, bottom); grid.append(card);
  });
  $('feed').append(grid);
}
function link(url, text = t('source')) {
  if (!url || !/^https?:\/\//.test(url)) return element('span', '', '—');
  const anchor = element('a', 'source-link', text); anchor.href = url; anchor.target = '_blank'; anchor.rel = 'noopener noreferrer'; return anchor;
}
function statusMessage(data) {
  if (data?.status === 'not_configured' && data.missing?.length) return `${t(data.engine === 'rules-v1' ? 'signalSetupIntro' : 'setupIntro')} ${t('setupFile')}: ${data.missing.join(', ')}.`;
  if (data?.reason && data.status === 'unavailable') return t(data.reason);
  return t(!data ? 'loading' : ({ not_configured:'notConfigured', pending:'pending', unavailable:'sourceError', stale:'stale', budget_limited:'analysisBudget', demo:'example' }[data.status] ?? 'noAnalysis'));
}
function renderResearch() {
  const investors = $('investors'), analysis = $('analysis'); investors.replaceChildren(); analysis.replaceChildren();
  const data = state.investors;
  if (!data || data.status !== 'ready') investors.append(element('p', 'panel-state', statusMessage(data)));
  if (data?.stale) investors.append(element('p', 'data-warning', t('stale')));
  if (data?.funds?.length) {
    investors.append(element('h4', '', t('funds')));
    for (const fund of data.funds) {
      const row = element('div', 'investor-row'); row.append(element('strong', '', fund.name));
      if (fund.status === 'unavailable') row.append(element('p', 'panel-note', t('sourceError')));
      else {
        if (fund.status === 'stale') row.append(element('p', 'data-warning', t('stale')));
        row.append(element('p', '', `${number(fund.shares)} ${t('shares')} · ${t('period')}: ${fund.period}`));
        if (fund.previousPeriod) row.append(element('p', 'panel-note', `${t('previous')}: ${number(fund.previousShares)} · ${fund.previousPeriod}`));
        row.append(element('p', 'panel-note', t(fund.change ?? 'unverified')));
        if (fund.splitFactor && fund.splitFactor !== 1) row.append(element('p', 'panel-note', `${t('split')}: ${number(fund.splitFactor)}`));
        row.append(element('small', '', `${t('filed')}: ${fund.filedAt} · `), link(fund.filingUrl));
      }
      investors.append(row);
    }
  }
  if (data?.status === 'ready') {
    investors.append(element('h4', '', t('insiders')));
    if (data.insiderStatus === 'unavailable') investors.append(element('p', 'panel-note', t('sourceError')));
    else if (!data.insiders?.length) investors.append(element('p', 'panel-note', t('noInsiders')));
    for (const insider of data.insiders ?? []) {
      const row = element('div', 'investor-row');
      row.append(element('strong', '', insider.owners.map(o => o.name).join(', ')), element('p', '', `${t(insider.action)} (${insider.code}) · ${number(insider.shares)} ${t('shares')}`), element('small', '', `${insider.date} · ${t('filed')}: ${insider.filedAt} · `), link(insider.filingUrl));
      if (insider.amended || insider.hasAmendment) row.append(element('p', 'data-warning', t(insider.amended ? 'amendment' : 'hasAmendment')));
      investors.append(row);
    }
    if (data.otherCount) investors.append(element('p', 'panel-note', `${t('derivativeNote')}: ${data.otherCount}`));
    if (data.fetchedAt) investors.append(element('p', 'panel-note', `${t('fetched')}: ${dateTime(data.fetchedAt)}`));
  }
  const research = state.analysis;
  const shortStatus = !research || research.status === 'pending' ? 'preparing' : research.status === 'not_configured' ? 'setupRequired' : research.status === 'unavailable' ? 'unavailable' : research.buyDecision ?? research.verdict ?? 'insufficient';
  $('analysis-shortcut').textContent = `${t(research?.engine === 'rules-v1' ? 'buySignal' : 'analysis')}: ${t(shortStatus)} →`;
  $('analysis-shortcut').title = t('horizon');
  if (research?.stale || research?.status === 'stale') analysis.append(element('p', 'data-warning', t('stale')));
  analysis.append(element('span', `verdict verdict-${research?.verdict ?? 'insufficient'}`, t(research?.buyDecision ?? research?.verdict ?? 'insufficient')));
  if (research?.rationale) {
    analysis.append(element('p', 'analysis-rationale', research.rationale));
    for (const key of ['opportunities', 'risks']) {
      if (!research[key]?.length) continue;
      analysis.append(element('h4', '', t(key))); const list = element('ul');
      for (const text of research[key] ?? []) list.append(element('li', '', text)); analysis.append(list);
    }
  } else analysis.append(element('p', 'panel-state', statusMessage(research)));
  if (research?.criteria?.length) {
    analysis.append(element('p', 'signal-score', `${t('score')}: ${research.score > 0 ? '+' : ''}${research.score ?? '—'}`));
    const table = element('table', 'signal-criteria'), head = element('thead'), tr = element('tr');
    for (const key of ['indicator', 'metricValue', 'points']) tr.append(element('th', '', t(key)));
    head.append(tr); table.append(head); const body = element('tbody');
    for (const criterion of research.criteria) {
      const row = element('tr');
      row.append(element('td', '', criterion.label), element('td', '', `${number(criterion.value)}${criterion.id === 'valuation' ? '×' : '%'}`), element('td', '', `${criterion.points > 0 ? '+' : ''}${criterion.points}`)); body.append(row);
    }
    table.append(body); analysis.append(table);
  }
  if (research?.methodology) {
    const details = element('details', 'signal-method'), summary = element('summary', '', t('methodology'));
    details.append(summary, element('p', 'panel-note', research.methodology)); analysis.append(details);
  }
  if (research?.financials) {
    const facts = research.financials;
    analysis.append(element('h4', '', t('financials')), element('p', 'panel-note', `${t('price')}: ${number(facts.price)}`), element('p', 'panel-note', `${t('quoteDate')}: ${dateTime(facts.quoteAt)}`), element('p', 'panel-note', `${t('reportPeriod')}: ${facts.reportingPeriod}`));
  }
  if (research?.evidence?.length) {
    analysis.append(element('h4', '', t('evidence'))); const list = element('ul');
    for (const item of research.evidence) { const row = element('li'); row.append(link(item.url, `${item.source} · ${item.date}`)); list.append(row); } analysis.append(list);
  }
  if (research?.generatedAt) analysis.append(element('p', 'panel-note', `${t('generated')}: ${dateTime(research.generatedAt)} · ${research.engine === 'rules-v1' ? t('rulesEngine') : research.model ?? '—'}`));
}
$('company-search').addEventListener('input', renderCompanies);
$('category').addEventListener('change', event => { state.category = event.target.value; renderFeed(); });
$('refresh').addEventListener('click', () => { loadNews(); loadResearch(); });
$('exit-demo').addEventListener('click', () => { state.demo = false; loadNews(); loadResearch(); });
$('language').addEventListener('change', event => {
  setLanguage(event.target.value); applyLanguage();
  if (state.error === 'companies') { renderFeed(); renderResearch(); } else { loadNews(); loadResearch(); }
});
for (const [id, sort] of [['sort-important', 'important'], ['sort-recent', 'recent']]) {
  $(id).addEventListener('click', () => {
    state.sort = sort;
    for (const tab of ['sort-important', 'sort-recent']) { $(tab).classList.toggle('active', tab === id); $(tab).setAttribute('aria-pressed', String(tab === id)); }
    renderFeed();
  });
}
document.addEventListener('keydown', event => {
  if (event.key === '/' && !['INPUT', 'SELECT', 'TEXTAREA'].includes(document.activeElement.tagName)) { event.preventDefault(); $('company-search').focus(); }
});
applyLanguage(); renderResearch();
try {
  const response = await fetch('/api/companies'); if (!response.ok) throw new Error('companies');
  state.companies = await response.json(); $('company-count').textContent = state.companies.length; selectCompany(state.ticker);
} catch { state.error = 'companies'; renderFeed(); }

// Read-only polling makes completed background work visible without invoking AI from the browser.
setInterval(() => {
  const pending = state.analysis?.status === 'pending' || state.investors?.status === 'pending' || state.articles.some(article => article.summary?.status === 'pending');
  if (pending && !document.hidden && !state.demo && !state.loading) { loadNews(); loadResearch(); }
}, 15000);
