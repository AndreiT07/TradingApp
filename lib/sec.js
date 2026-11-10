import { XMLParser } from 'fast-xml-parser';
import { upstream, safeLink } from './http.js';
const parser = new XMLParser({ ignoreAttributes: false, removeNSPrefix: true, processEntities: false });
const array = value => value == null ? [] : Array.isArray(value) ? value : [value];
const number = value => value === '' || value == null ? null : Number.isFinite(Number(value)) ? Number(value) : null;
const value = node => node?.value ?? node;
export const securities = {
  AAPL: ['320193', '037833100'], MSFT: ['789019', '594918104'], NVDA: ['1045810', '67066G104'],
  GOOGL: ['1652044', '02079K305'], AMZN: ['1018724', '023135106'], META: ['1326801', '30303M102'],
  TSLA: ['1318605', '88160R101'], JPM: ['19617', '46625H100'], 'BRK.B': ['1067983', '084670702'], LLY: ['59478', '532457108'],
};
export const funds = [
  { name: 'Berkshire Hathaway', cik: '1067983' },
  { name: 'Pershing Square Capital Management', cik: '1336528' },
  { name: 'Bridgewater Associates', cik: '1350694' },
];
function xml(text) {
  if (/<!DOCTYPE|<!ENTITY/i.test(text)) throw new Error('UNSAFE_XML');
  return parser.parse(text);
}
export function parseHoldings(text) {
  const data = xml(text).informationTable;
  if (!data) throw new Error('NO_HOLDINGS_TABLE');
  const holdings = {};
  for (const row of array(data.infoTable)) {
    if (row.putCall || row.shrsOrPrnAmt?.sshPrnamtType !== 'SH') continue;
    const cusip = String(row.cusip ?? '').padStart(9, '0');
    const shares = number(row.shrsOrPrnAmt?.sshPrnamt);
    if (shares == null || shares < 0) throw new Error('INVALID_SHARES');
    holdings[cusip] = (holdings[cusip] ?? 0) + shares;
  }
  return holdings;
}
export function compareHolding(previous, current, splits) {
  // Missing corporate-action data means no directional inference.
  if (!Array.isArray(splits)) return { change: 'unverified', delta: null, previousShares: previous, shares: current };
  let factor = 1;
  for (const split of splits) {
    const from = number(split.fromFactor), to = number(split.toFactor);
    if (!(from > 0 && to > 0)) return { change: 'unverified', delta: null, previousShares: previous, shares: current };
    factor *= to / from;
  }
  const delta = current - previous * factor;
  return { previousShares: previous, shares: current, splitFactor: factor, delta,
    change: Math.abs(delta) < 0.01 ? 'unchanged' : previous === 0 ? 'new' : current === 0 ? 'closed' : delta > 0 ? 'increased' : 'reduced' };
}
export function parseInsiders(text, filing) {
  const doc = xml(text).ownershipDocument;
  if (!doc) throw new Error('NO_OWNERSHIP_REPORT');
  const owners = array(doc.reportingOwner).map(owner => ({ name: String(owner.reportingOwnerId?.rptOwnerName ?? ''), cik: String(owner.reportingOwnerId?.rptOwnerCik ?? '') }));
  const transactions = array(doc.nonDerivativeTable?.nonDerivativeTransaction).map((row, index) => {
    const code = String(row.transactionCoding?.transactionCode ?? '');
    return { id: `${filing.accession}:${index}`, owners, code,
      action: code === 'P' ? 'purchase' : code === 'S' ? 'sale' : 'other',
      date: String(value(row.transactionDate) ?? ''), shares: number(value(row.transactionAmounts?.transactionShares)),
      price: number(value(row.transactionAmounts?.transactionPricePerShare)), security: String(value(row.securityTitle) ?? ''),
      filedAt: filing.filedAt, filingUrl: filing.url, amended: filing.form === '4/A',
      reportingPeriod: String(doc.periodOfReport ?? ''), footnotes: array(doc.footnotes?.footnote).map(n => typeof n === 'string' ? n : n['#text'] ?? '').join(' ').slice(0, 3000),
    };
  });
  return { transactions, otherCount: array(doc.derivativeTable?.derivativeTransaction).length, owners, issuerCik: String(doc.issuer?.issuerCik ?? '') };
}
export class SEC {
  constructor(store, { env = process.env, call = upstream, pause = ms => new Promise(resolve => setTimeout(resolve, ms)) } = {}) {
    this.store = store; this.env = env; this.call = call; this.pause = pause; this.queue = Promise.resolve();
  }
  get enabled() { return Boolean(this.env.SEC_USER_AGENT && /[^\s@]+@[^\s@]+\.[^\s@]+/.test(this.env.SEC_USER_AGENT)); }
  async get(url, text = false) {
    const cached = this.store.get(`sec-url:${url}`);
    if (cached && Date.now() - Date.parse(cached.updatedAt) < 86_400_000) return cached.data;
    const job = this.queue.catch(() => {}).then(async () => {
      await this.pause(250); // At most four SEC requests/second, shared by all adapters.
      const response = await this.call(url, { headers: { 'User-Agent': this.env.SEC_USER_AGENT, Accept: 'application/json,application/xml,text/xml' }, maxBytes: 20_000_000 });
      const data = text ? response.text : response.json();
      this.store.put(`sec-url:${url}`, data); return data;
    });
    this.queue = job;
    return job;
  }
  async filings(cik, accepted) {
    const data = await this.get(`https://data.sec.gov/submissions/CIK${cik.padStart(10, '0')}.json`);
    const recent = data.filings?.recent;
    if (!recent || !Array.isArray(recent.form)) throw new Error('INVALID_FILINGS');
    return recent.form.flatMap((form, i) => {
      const accession = recent.accessionNumber[i], document = recent.primaryDocument[i];
      if (!accepted.includes(form) || !/^\d{10}-\d{2}-\d{6}$/.test(accession) || !/^[a-zA-Z0-9_.-]+(?:\/[a-zA-Z0-9_.-]+)*$/.test(document) || document.split('/').some(part => part === '..' || part === '.')) return [];
      const base = `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${accession.replaceAll('-', '')}/`;
      return [{ form, accession, reportDate: recent.reportDate[i], filedAt: recent.filingDate[i], base, url: base + document, rawUrl: base + document.split('/').at(-1) }];
    });
  }
  async table(filing) {
    const index = await this.get(`${filing.base}index.json`);
    const candidates = array(index.directory?.item).filter(item => /\.xml$/i.test(item.name) && /^[a-zA-Z0-9_.-]+$/.test(item.name) && !item.name.startsWith('primary_doc'));
    for (const item of candidates.slice(0, 8)) {
      try { return parseHoldings(await this.get(filing.base + item.name, true)); } catch (error) { if (error.message !== 'NO_HOLDINGS_TABLE') throw error; }
    }
    throw new Error('NO_HOLDINGS_TABLE');
  }
  async fundReports(fund) {
    const filings = await this.filings(fund.cik, ['13F-HR', '13F-HR/A']);
    const periods = [...new Set(filings.map(f => f.reportDate).filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d)))].sort().reverse().slice(0, 2);
    const reports = [];
    for (const period of periods) {
      const group = filings.filter(f => f.reportDate === period).sort((a, b) => a.filedAt.localeCompare(b.filedAt) || a.accession.localeCompare(b.accession));
      let holdings = null, latest = null;
      for (const filing of group) {
        const primary = xml(await this.get(filing.rawUrl ?? filing.url, true));
        const amendment = primary.edgarSubmission?.formData?.coverPage?.amendmentInfo?.amendmentType;
        const table = await this.table(filing);
        if (filing.form === '13F-HR' || amendment === 'RESTATEMENT') holdings = table;
        else if (amendment === 'NEW HOLDINGS' && holdings) {
          // An amendment adds omitted rows; overlapping securities are ambiguous.
          if (Object.keys(table).some(key => key in holdings)) throw new Error('AMBIGUOUS_AMENDMENT');
          holdings = { ...holdings, ...table };
        } else throw new Error('UNSUPPORTED_AMENDMENT');
        latest = filing;
      }
      if (holdings && latest) reports.push({ period, holdings, filedAt: latest.filedAt, url: latest.url });
    }
    return reports;
  }
  async insiders(company) {
    const filings = (await this.filings(securities[company.ticker][0], ['4', '4/A'])).slice(0, 12);
    const transactions = []; let otherCount = 0;
    for (const filing of filings) {
      const report = parseInsiders(await this.get(filing.rawUrl ?? filing.url, true), filing);
      // A company's submissions may also include filings where it is an owner of another issuer.
      if (Number(report.issuerCik) !== Number(securities[company.ticker][0])) continue;
      transactions.push(...report.transactions); otherCount += report.otherCount;
    }
    // Preserve originals and amendments, explicitly flag possible overlap; never sum them as net trading.
    const amendedPeriods = new Set(transactions.filter(t => t.amended).map(t => `${t.reportingPeriod}:${t.owners.map(o => o.cik).sort().join(',')}`));
    for (const t of transactions) t.hasAmendment = !t.amended && amendedPeriods.has(`${t.reportingPeriod}:${t.owners.map(o => o.cik).sort().join(',')}`);
    return { transactions: transactions.filter(t => safeLink(t.filingUrl)).slice(0, 60), otherCount, reportsChecked: filings.length };
  }
}
