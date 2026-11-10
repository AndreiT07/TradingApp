// A transparent screening heuristic, not a validated investment strategy.
// It uses no model output, news sentiment, or personal portfolio information.
export function assessFinancials(financials, now = Date.now()) {
  const insufficient = reason => ({ status: 'insufficient', verdict: 'insufficient', buyDecision: 'insufficient', score: null, criteria: [], reason });
  if (!financials || !Number.isFinite(financials.price) || !(financials.price > 0)) return insufficient('insufficient_metrics');
  const quoteAt = Date.parse(financials.quoteAt), period = Date.parse(financials.reportingPeriod);
  if (!Number.isFinite(quoteAt) || !Number.isFinite(period) || quoteAt > now + 300000 || period > now || now - quoteAt > 5 * 86400000 || now - period > 200 * 86400000) return insufficient('stale_financials');
  const metrics = financials.metrics ?? {};
  if (!['peTTM', 'revenueGrowthTTMYoy', 'epsGrowthTTMYoy'].every(key => typeof metrics[key] === 'number' && Number.isFinite(metrics[key])) || metrics.peTTM <= 0) return insufficient('insufficient_metrics');
  const criteria = [
    { id: 'revenue', metric: 'revenueGrowthTTMYoy', value: metrics.revenueGrowthTTMYoy, points: metrics.revenueGrowthTTMYoy >= 10 ? 1 : metrics.revenueGrowthTTMYoy < 0 ? -1 : 0 },
    { id: 'earnings', metric: 'epsGrowthTTMYoy', value: metrics.epsGrowthTTMYoy, points: metrics.epsGrowthTTMYoy >= 10 ? 1 : metrics.epsGrowthTTMYoy < 0 ? -1 : 0 },
    { id: 'valuation', metric: 'peTTM', value: metrics.peTTM, points: metrics.peTTM <= 25 ? 1 : metrics.peTTM > 40 ? -1 : 0 },
  ];
  const score = criteria.reduce((sum, row) => sum + row.points, 0);
  const buyDecision = score >= 2 && metrics.revenueGrowthTTMYoy >= 0 && metrics.epsGrowthTTMYoy >= 0 ? 'buy' : score <= -2 ? 'avoid' : 'wait';
  const verdict = { buy: 'buy', wait: 'hold', avoid: 'sell' }[buyDecision];
  return { status: 'ready', verdict, buyDecision, score, criteria, reason: null };
}
export function explainSignal(signal, lang) {
  const en = lang === 'en';
  const texts = en ? {
    revenue: 'Year-over-year revenue growth', earnings: 'Year-over-year earnings per share growth', valuation: 'Trailing P/E',
    buy: 'The screening rules support considering a purchase: the score is at least +2 and neither revenue nor earnings is declining.',
    wait: 'The screening rules do not give a clear buy signal. Wait and investigate valuation, results and risks further.',
    avoid: 'The screening rules give a negative signal. Avoid a new purchase based on this screen; this is not an automatic instruction to sell existing holdings.',
    insufficient: 'There is not enough recent, comparable data to calculate a signal.',
    risk: 'This heuristic has not been backtested. It omits debt, cash flow, sector differences and your personal circumstances; it does not predict returns.',
    methodology: 'Revenue/EPS growth: +1 at ≥10%, 0 at 0–<10%, −1 below 0%. P/E: +1 at >0–25, 0 at >25–40, −1 above 40. Buy: score ≥+2 with non-declining revenue and EPS; avoid: score ≤−2; otherwise wait.',
  } : {
    revenue: 'Creșterea anuală a veniturilor', earnings: 'Creșterea anuală a profitului pe acțiune', valuation: 'P/E pentru ultimele 12 luni',
    buy: 'Regulile susțin luarea în considerare a unei achiziții: scorul este de cel puțin +2, iar veniturile și profitul pe acțiune nu sunt în scădere.',
    wait: 'Regulile nu dau un semnal clar de cumpărare. Așteaptă și verifică mai atent evaluarea, rezultatele și riscurile.',
    avoid: 'Regulile dau un semnal negativ. Evită o achiziție nouă pe baza acestui filtru; nu este o instrucțiune automată de vânzare a deținerilor existente.',
    insufficient: 'Nu există suficiente date recente și comparabile pentru calcularea semnalului.',
    risk: 'Această euristică nu a fost validată istoric. Nu include datoria, fluxul de numerar, diferențele dintre sectoare sau situația ta personală și nu prezice randamente.',
    methodology: 'Creșterea veniturilor/EPS: +1 la ≥10%, 0 la 0–<10%, −1 sub 0%. P/E: +1 la >0–25, 0 la >25–40, −1 peste 40. Cumpără: scor ≥+2 cu venituri și EPS fără scădere; evită: scor ≤−2; în rest așteaptă.',
  };
  const format = new Intl.NumberFormat(lang === 'en' ? 'en-US' : 'ro-RO', { maximumFractionDigits: 2 });
  const describe = row => `${texts[row.id]}: ${format.format(row.value)}${row.id === 'valuation' ? '×' : '%'} (${row.points > 0 ? '+' : ''}${row.points})`;
  return { rationale: texts[signal.buyDecision], methodology: texts.methodology,
    opportunities: signal.criteria.filter(row => row.points > 0).map(describe),
    risks: [...signal.criteria.filter(row => row.points < 0).map(describe), texts.risk],
    criteria: signal.criteria.map(row => ({ ...row, label: texts[row.id] })) };
}
