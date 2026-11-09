const $ = id => document.getElementById(id);
const state = { companies: [], ticker: 'AAPL', articles: [], sort: 'important', category: 'all', demo: false, loading: false, error: null, fetchedAt: null, stale: false };
let requestController;
const dateTime = new Intl.DateTimeFormat('ro-RO', { dateStyle: 'medium', timeStyle: 'short' });
$('today').textContent = new Intl.DateTimeFormat('ro-RO', { day: 'numeric', month: 'long', year: 'numeric' }).format(new Date());
function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}
function renderCompanies() {
  const query = $('company-search').value.trim().toLocaleLowerCase('ro');
  const filtered = state.companies.filter(c => `${c.name} ${c.ticker}`.toLocaleLowerCase('ro').includes(query));
  $('companies').replaceChildren();
  for (const company of filtered) {
    const button = element('button', `company-button${company.ticker === state.ticker ? ' selected' : ''}`);
    button.type = 'button';
    button.setAttribute('aria-pressed', String(company.ticker === state.ticker));
    const logo = element('span', 'company-logo', company.symbol);
    const label = element('span', 'company-label');
    label.append(element('strong', '', company.name), element('small', '', company.ticker));
    button.append(logo, label);
    if (company.ticker === state.ticker) button.append(element('span', 'company-arrow', '↗'));
    button.addEventListener('click', () => selectCompany(company.ticker));
    $('companies').append(button);
  }
  if (!filtered.length) $('companies').append(element('p', 'search-empty', 'Nicio companie găsită.'));
}
function selectCompany(ticker) {
  state.ticker = ticker;
  state.category = 'all';
  $('category').value = 'all';
  const company = state.companies.find(c => c.ticker === ticker);
  $('company-title').textContent = company.name;
  $('selected-ticker').textContent = ticker;
  $('selected-logo').textContent = company.symbol;
  $('selected-sector').textContent = `${company.sector} · Statele Unite`;
  renderCompanies();
  loadNews();
}
function makeDemo() {
  const name = state.companies.find(c => c.ticker === state.ticker).name;
  return [
    { title: `${name}: ce urmăresc investitorii în următorul raport financiar`, category: 'Rezultate financiare', score: 9 },
    { title: `Planurile de investiții ale ${name} intră în atenția pieței`, category: 'Tranzacții & strategie', score: 7 },
    { title: `${name} și noile tehnologii: teme de urmărit în lunile următoare`, category: 'Produse & inovație', score: 6 },
    { title: `Schimbările de reglementare care ar putea conta pentru ${name}`, category: 'Reglementări', score: 5 },
    { title: `O privire asupra strategiei pe termen lung a ${name}`, category: 'Companie & piață', score: 4 },
  ].map((article, i) => ({ ...article, id: `demo-${i}`, source: 'Exemplu editorial', publishedAt: null, url: null }));
}
async function loadNews() {
  requestController?.abort();
  requestController = new AbortController();
  const controller = requestController;
  state.loading = true; state.error = null; state.articles = []; state.fetchedAt = null; state.stale = false;
  renderFeed();
  if (state.demo) { state.articles = makeDemo(); state.loading = false; renderFeed(); return; }
  try {
    const response = await fetch(`/api/news?ticker=${encodeURIComponent(state.ticker)}`, { signal: controller.signal });
    if (!response.ok) throw new Error('news');
    const data = await response.json();
    if (controller !== requestController) return;
    state.articles = data.articles; state.fetchedAt = data.fetchedAt; state.stale = data.stale;
  } catch (error) {
    if (error.name === 'AbortError') return;
    state.error = 'news';
  } finally {
    if (controller === requestController) { state.loading = false; renderFeed(); }
  }
}
function emptyState(title, description, actions = []) {
  const container = element('div', 'empty-state');
  container.append(element('div', 'empty-icon', '◎'), element('h3', '', title), element('p', '', description));
  const buttons = element('div');
  for (const [text, action, className] of actions) {
    const button = element('button', className, text); button.type = 'button'; button.addEventListener('click', action); buttons.append(button);
  }
  container.append(buttons);
  return container;
}
function renderFeed() {
  $('refresh').disabled = state.loading;
  $('demo-notice').hidden = !state.demo;
  $('feed').setAttribute('aria-busy', String(state.loading));
  $('feed').replaceChildren();
  $('updated').textContent = state.fetchedAt ? `${state.stale ? 'Sursă indisponibilă. Date din cache · ' : 'Ultima preluare · '}${dateTime.format(new Date(state.fetchedAt))}${state.stale ? ' · Știrile pot fi depășite.' : ' · Cache de 5 minute'}` : '';
  if (state.loading) {
    $('news-status').textContent = 'Se preiau știrile…';
    const grid = element('div', 'news-grid');
    for (let i = 0; i < 3; i++) { const skeleton = element('div', 'skeleton'); skeleton.setAttribute('aria-hidden', 'true'); grid.append(skeleton); }
    $('feed').append(grid); return;
  }
  if (state.error) {
    $('news-status').textContent = 'Sursă indisponibilă';
    const detail = state.error === 'companies' ? 'Lista companiilor nu a putut fi încărcată. Verifică conexiunea și reîncarcă pagina.' : 'Nu putem accesa sursa de știri momentan. Verifică conexiunea sau încearcă din nou mai târziu. Poți explora interfața cu exemple fictive.';
    const actions = state.error === 'companies' ? [['Reîncarcă pagina', () => location.reload(), 'primary-button']] : [['Reîncearcă', loadNews, 'secondary-button'], ['Explorează demonstrația ↗', () => { state.demo = true; loadNews(); }, 'primary-button']];
    $('feed').append(emptyState('Informația bună merită așteptată.', detail, actions)); return;
  }
  const articles = state.articles.filter(a => state.category === 'all' || a.category === state.category).sort((a, b) => state.sort === 'important' ? b.score - a.score : new Date(b.publishedAt) - new Date(a.publishedAt));
  $('news-status').textContent = `${articles.length} ${articles.length === 1 ? 'articol' : 'articole'}${state.demo ? ' · DEMO' : state.stale ? ' · Cache vechi' : ' · Ultimele 7 zile'}`;
  if (!articles.length) {
    $('feed').append(emptyState('Nicio știre pentru moment.', state.category === 'all' ? 'Nu au fost găsite articole relevante pentru această companie. Încearcă altă companie sau revino mai târziu.' : 'Nu există articole pentru subiectul selectat. Alege „Toate subiectele” pentru lista completă.')); return;
  }
  const grid = element('div', 'news-grid');
  articles.forEach((article, index) => {
    const card = element('article', `article${index === 0 ? ' featured' : ''}`);
    const meta = element('div', 'article-meta');
    meta.append(element('span', '', article.category.toLocaleUpperCase('ro')));
    if (index === 0 && state.sort === 'important') meta.append(element('span', 'priority-label', 'ÎN PRIM-PLAN'));
    const heading = element('h3');
    if (article.url && /^https?:\/\//.test(article.url)) {
      const link = element('a', '', article.title); link.href = article.url; link.target = '_blank'; link.rel = 'noopener noreferrer'; heading.append(link);
    } else heading.textContent = article.title;
    const bottom = element('div', 'article-bottom');
    bottom.append(element('span', 'source-dot'), element('span', '', article.source), element('span', '', '·'));
    if (article.publishedAt) { const time = element('time', '', dateTime.format(new Date(article.publishedAt))); time.dateTime = article.publishedAt; bottom.append(time); }
    else bottom.append(element('span', '', 'Exemplu fictiv'));
    if (article.url) { const arrow = element('span', 'article-open', '↗'); arrow.setAttribute('aria-hidden', 'true'); bottom.append(arrow); }
    card.append(meta, heading, bottom); grid.append(card);
  });
  $('feed').append(grid);
}
$('company-search').addEventListener('input', renderCompanies);
$('category').addEventListener('change', event => { state.category = event.target.value; renderFeed(); });
$('refresh').addEventListener('click', loadNews);
$('exit-demo').addEventListener('click', () => { state.demo = false; loadNews(); });
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
try {
  const response = await fetch('/api/companies');
  if (!response.ok) throw new Error('companies');
  state.companies = await response.json();
  $('company-count').textContent = state.companies.length;
  selectCompany(state.ticker);
} catch { state.error = 'companies'; renderFeed(); }
