// Run: node --test tests/  (from thong-nokbe/). Bundles src/lib/feeMath.ts with esbuild first.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(mkdtempSync(path.join(tmpdir(), 'feemath-')), 'feeMath.mjs');
execFileSync('npx', ['-y', 'esbuild', path.join(root, 'src/lib/feeMath.ts'), '--format=esm', `--outfile=${out}`, '--log-level=error'], { stdio: 'inherit' });
const F = await import(pathToFileURL(out).href);

let t0 = 1_700_000_000_000;
const pay = (amount, forMonth, extra = {}) => ({ id: `p${t0}`, uid: 'm', kind: 'payment', amount, forMonth, method: 'upi', status: 'confirmed', createdMs: t0++, ...extra });
const steps = [{ from: '2026-01', amount: 800 }];

test('one month paid exactly', () => {
  const m = F.allocate([pay(800, '2026-11')], steps, 0);
  assert.equal(m['2026-11'].status, 'paid');
  assert.equal(F.statusOf(m, '2026-12', steps, 0).status, 'unpaid');
});

test('advance: 3 months in one payment', () => {
  const m = F.allocate([pay(2400, '2026-11')], steps, 0);
  for (const mo of ['2026-11', '2026-12', '2027-01']) assert.equal(m[mo].status, 'paid');
  assert.equal(F.paidThrough(m, '2026-11'), '2027-01');
  assert.equal(F.firstUnpaid(m, '2026-11'), '2027-02');
});

test('partial, then a top-up completes the month', () => {
  const a = pay(400, '2026-11');
  let m = F.allocate([a], steps, 0);
  assert.equal(m['2026-11'].status, 'partial');
  assert.equal(m['2026-11'].paid, 400);
  m = F.allocate([a, pay(400, '2026-11')], steps, 0);
  assert.equal(m['2026-11'].status, 'paid');
});

test('extra money flows to the next month as partial credit', () => {
  const m = F.allocate([pay(1000, '2026-11')], steps, 0);
  assert.equal(m['2026-11'].status, 'paid');
  assert.equal(m['2026-12'].status, 'partial');
  assert.equal(m['2026-12'].paid, 200);
});

test('fee change applies from its month on', () => {
  const s = [{ from: '2026-01', amount: 800 }, { from: '2027-01', amount: 1000 }];
  const m = F.allocate([pay(2600, '2026-11')], s, 0); // 800 + 800 + 1000
  assert.equal(m['2026-11'].status, 'paid');
  assert.equal(m['2026-12'].status, 'paid');
  assert.equal(m['2027-01'].status, 'paid');
  assert.equal(m['2027-01'].fee, 1000);
});

test('reversal cancels part of a payment without deleting it', () => {
  const p = pay(1600, '2026-11');
  const r = { id: 'r1', uid: 'm', kind: 'reversal', amount: 800, forMonth: '2026-11', method: 'cash', status: 'confirmed', reversalOf: p.id, createdMs: t0++ };
  const m = F.allocate([p, r], steps, 0);
  assert.equal(m['2026-11'].status, 'paid');
  assert.equal(F.statusOf(m, '2026-12', steps, 0).status, 'unpaid');
  assert.deepEqual(F.totals([p, r]), { paid: 800, pending: 0 });
});

test('pending (UTR waiting for admin) and rejected entries do not count as paid', () => {
  const m = F.allocate([pay(800, '2026-11', { status: 'pending', method: 'upi-manual' }), pay(800, '2026-12', { status: 'rejected' })], steps, 0);
  assert.equal(F.statusOf(m, '2026-11', steps, 0).status, 'unpaid');
  assert.equal(F.statusOf(m, '2026-12', steps, 0).status, 'unpaid');
  assert.deepEqual(F.totals([pay(800, '2026-11', { status: 'pending' })]), { paid: 0, pending: 800 });
});

test('records from older app versions keep their month paid', () => {
  const legacy = pay(0, '2026-10', { method: 'legacy', fullMonth: true });
  const m = F.allocate([legacy, pay(800, '2026-10')], steps, 0); // a later payment for an already-paid month moves on
  assert.equal(m['2026-10'].status, 'paid');
  assert.equal(m['2026-11'].status, 'paid');
});

test('no fee set: money stays in its month and nothing loops forever', () => {
  const m = F.allocate([pay(500, '2026-11')], [], 0);
  assert.equal(m['2026-11'].paid, 500);
});
