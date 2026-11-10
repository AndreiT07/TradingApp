import test from 'node:test';
import assert from 'node:assert/strict';
import { assessFinancials, explainSignal } from '../lib/signals.js';
import { Store } from '../lib/store.js';
import { Research } from '../lib/research.js';
import { companies } from '../companies.js';
const now=Date.now();
const financials=(pe=20,revenue=15,eps=20)=>({price:100,quoteAt:new Date(now).toISOString(),reportingPeriod:new Date(now-60*86400000).toISOString().slice(0,10),metrics:{peTTM:pe,revenueGrowthTTMYoy:revenue,epsGrowthTTMYoy:eps}});
test('screen gives buy, wait and avoid with explicit component scores',()=>{
  const buy=assessFinancials(financials(),now);
  assert.equal(buy.buyDecision,'buy');assert.equal(buy.score,3);
  assert.deepEqual(buy.criteria.map(c=>c.points),[1,1,1]);
  const wait=assessFinancials(financials(50,15,20),now);
  assert.equal(wait.buyDecision,'wait');assert.equal(wait.verdict,'hold');assert.equal(wait.score,1);
  const avoid=assessFinancials(financials(50,-10,-20),now);
  assert.equal(avoid.buyDecision,'avoid');assert.equal(avoid.score,-3);
  assert.match(explainSignal(avoid,'en').rationale,/not an automatic instruction to sell/);
});
test('threshold boundaries match the disclosed methodology',()=>{
  const metrics=assessFinancials(financials(25,10,0),now);
  assert.equal(metrics.buyDecision,'buy');assert.equal(metrics.score,2);
  const neutral=assessFinancials(financials(40,9.99,0),now);
  assert.equal(neutral.buyDecision,'wait');assert.equal(neutral.score,0);
});
test('missing metrics, nonpositive P/E, invalid or old quotes never become a buy signal',()=>{
  for(const value of [null,{...financials(),price:Infinity},financials(0),financials(-1),financials(NaN),{...financials(),metrics:{peTTM:20}},{...financials(),quoteAt:'invalid'},{...financials(),quoteAt:new Date(now-6*86400000).toISOString()},{...financials(),reportingPeriod:'2000-01-01'}]){
    const result=assessFinancials(value,now);assert.equal(result.buyDecision,'insufficient');assert.equal(result.score,null);
  }
});
test('explanations preserve numbers and show the same rules in both languages',()=>{
  const signal=assessFinancials(financials(50,15,20),now);
  const ro=explainSignal(signal,'ro'),en=explainSignal(signal,'en');
  assert.match(ro.rationale,/Așteaptă/);assert.match(en.rationale,/Wait/);
  assert.match(ro.risks.join(' '),/50/);assert.match(en.risks.join(' '),/50/);
  assert.equal(ro.criteria[0].value,en.criteria[0].value);
  assert.match(en.methodology,/score ≥\+2/);
});
test('a live-data-only configuration produces a signal without any AI calls',async()=>{
  const store=new Store(':memory:');let aiCalls=0;
  const env={FINNHUB_API_KEY:'test-key',DATA_PROVIDER_TERMS_ACCEPTED:'true'};
  const facts=financials();
  const service=new Research({store,env,ai:{enabled:false,generate:async()=>{aiCalls++;throw new Error('AI must not be needed');}},call:async url=>({json:()=>new URL(url).pathname.endsWith('/quote')?{c:facts.price,t:now/1000}:{metric:facts.metrics,series:{quarterly:{eps:[{period:facts.reportingPeriod}]}}}})});
  try{
    await service.refreshAnalysis(companies[0]);
    const ro=service.analysis(companies[0],'ro'),en=service.analysis(companies[0],'en');
    assert.equal(ro.buyDecision,'buy');assert.equal(ro.engine,'rules-v1');assert.deepEqual(ro.missing,[]);
    assert.equal(en.buyDecision,'buy');assert.match(ro.rationale,/achiziții/);assert.match(en.rationale,/purchase/);
    assert.equal(aiCalls,0);
  }finally{await service.stop();}
});
test('old AI records can serve a new signal from dated financial evidence without regenerating AI',async()=>{
  const store=new Store(':memory:');
  store.put('analysis:AAPL',{status:'unavailable',financials:financials(),generatedAt:new Date(now).toISOString(),model:'old-model'});
  const service=new Research({store,env:{FINNHUB_API_KEY:'test-key',DATA_PROVIDER_TERMS_ACCEPTED:'true'}});
  try{const result=service.analysis(companies[0],'ro');assert.equal(result.status,'ready');assert.equal(result.buyDecision,'buy');assert.equal(result.model,'rules-v1');}
  finally{await service.stop();}
});
