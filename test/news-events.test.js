import test from 'node:test';
import assert from 'node:assert/strict';
import { companies } from '../companies.js';
import { cryptoAssets } from '../crypto.js';
import { groupNews } from '../lib/news-events.js';

function item(title, url, score, source, publishedAt = '2026-11-24T10:15:00Z') {
  return { title, url, score, source, publishedAt };
}

test('a leadership event prefers the company announcement and keeps other publishers', () => {
  const nvidia = companies.find(company => company.ticker === 'NVDA');
  const official = item('NVIDIA Board Reinstates Jensen Huang as CEO', 'https://nvidianews.nvidia.com/ceo', 6, 'NVIDIA');
  const report = item('Jensen Huang is back at Nvidia', 'https://example.com/return', 8, 'Reuters');
  const departure = item('Jensen Huang resigns as CEO', 'https://example.com/ceo', 7, 'Reuters');
  const pick = item('Nvidia: my top stock to buy', 'https://example.com/opinion', 7, 'Yahoo');
  const grouped = groupNews([pick, report, departure, official], nvidia);
  assert.equal(grouped.length, 3);
  assert.equal(grouped[0].title, official.title);
  assert.equal(grouped[0].type, 'official');
  assert.equal(grouped[0].topic, 'leadership');
  assert.equal(grouped[0].coverage[0].source, 'Reuters');
  assert.equal(grouped[2].type, 'opinion');
  assert.equal(grouped[0].eventId, groupNews([report], nvidia)[0].eventId);
});

test('crypto groups coverage of an upgrade and keeps a security incident separate', () => {
  const sol = cryptoAssets.find(asset => asset.ticker === 'SOL');
  const grouped = groupNews([
    item('Solana confirms network upgrade next week', 'https://solana.com/news/upgrade', 5, 'Solana'),
    item('Solana prepares for major upgrade', 'https://example.com/upgrade', 5, 'CoinDesk'),
    item('Solana wallet reports a security incident', 'https://example.com/wallet', 5, 'Decrypt'),
  ], sol);
  assert.equal(grouped.length, 2);
  assert.equal(grouped[0].topic, 'network');
  assert.equal(grouped[0].coverage[0].source, 'CoinDesk');
  assert.equal(grouped[1].topic, 'security');
});
