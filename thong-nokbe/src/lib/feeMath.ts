/**
 * Pure fee arithmetic (no app or database code, so it is easy to test).
 *
 * Money is never stored as "month X is paid". Instead every payment is a permanent ledger entry
 * (amount + the first month it is for), and the month statuses are WORKED OUT from the ledger:
 *  - a payment fills its first month, and anything left over flows into the next months (advance);
 *  - less than a month's fee leaves that month "partial";
 *  - a reversal (admin correction) cancels part or all of an earlier payment, without deleting it.
 * Because the ledger is only ever added to, history can never be lost or overwritten.
 */

export type LedgerKind = 'payment' | 'reversal';
export type LedgerStatus = 'confirmed' | 'pending' | 'rejected';
export type LedgerMethod = 'upi' | 'upi-manual' | 'cash' | 'gateway' | 'legacy';

export interface LedgerEntry {
  id: string;
  uid: string;
  kind: LedgerKind;
  amount: number; // rupees, > 0
  forMonth: string; // yyyy-mm: the first month this payment is for
  method: LedgerMethod;
  status: LedgerStatus;
  utr?: string | null;
  reversalOf?: string | null; // for kind 'reversal': the payment it cancels (part of)
  note?: string;
  createdMs: number; // when it was recorded
  recordedBy?: string;
  /** Records from older app versions said "this month is paid" without a reliable amount. */
  fullMonth?: boolean;
}

export interface FeeStep {
  from: string; // yyyy-mm
  amount: number;
}

export type MonthStatus = 'paid' | 'partial' | 'unpaid';

export interface MonthInfo {
  fee: number;
  paid: number; // rupees allocated to this month
  status: MonthStatus;
}

export const monthAdd = (m: string, n: number) => {
  const [y, mo] = m.split('-').map(Number);
  const d = new Date(Date.UTC(y, mo - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
};

/** The monthly fee that applies in a month: the latest fee step that started on or before it. */
export function feeFor(month: string, steps: FeeStep[], fallback: number): number {
  let fee: number | null = null;
  for (const s of steps) if (s.from <= month) fee = s.amount; // steps are stored in the order they were set
  if (fee === null) fee = steps.length ? steps[0].amount : fallback;
  return Math.max(0, fee || 0);
}

/** How much of each payment still counts after reversals (never below zero). */
function effectiveAmounts(entries: LedgerEntry[]): Map<string, number> {
  const eff = new Map<string, number>();
  for (const e of entries) if (e.kind === 'payment' && e.status === 'confirmed') eff.set(e.id, e.amount);
  for (const e of entries) {
    if (e.kind !== 'reversal' || e.status !== 'confirmed' || !e.reversalOf) continue;
    const left = eff.get(e.reversalOf);
    if (left !== undefined) eff.set(e.reversalOf, Math.max(0, left - e.amount));
  }
  return eff;
}

/**
 * One member's months: payments in the order they were made, each filling from its own first month
 * forward. Returns month -> { fee, paid, status } for every month touched.
 */
export function allocate(entries: LedgerEntry[], steps: FeeStep[], fallbackFee: number): Record<string, MonthInfo> {
  const eff = effectiveAmounts(entries);
  const paid: Record<string, number> = {};
  const full = new Set<string>();
  const payments = entries.filter((e) => e.kind === 'payment' && e.status === 'confirmed').sort((a, b) => a.createdMs - b.createdMs || a.id.localeCompare(b.id));

  for (const p of payments) {
    let left = eff.get(p.id) ?? 0;
    if (p.fullMonth) {
      if (left > 0 || p.amount === 0) full.add(p.forMonth);
      paid[p.forMonth] = (paid[p.forMonth] ?? 0) + left;
      continue;
    }
    let m = p.forMonth;
    for (let guard = 0; left > 0 && guard < 240; guard++) {
      const fee = feeFor(m, steps, fallbackFee);
      if (fee <= 0) {
        // No fee set for this month: keep the whole amount there.
        paid[m] = (paid[m] ?? 0) + left;
        left = 0;
        break;
      }
      const room = full.has(m) ? 0 : fee - (paid[m] ?? 0);
      if (room > 0) {
        const take = Math.min(room, left);
        paid[m] = (paid[m] ?? 0) + take;
        left -= take;
      }
      if (left > 0) m = monthAdd(m, 1);
    }
  }

  const out: Record<string, MonthInfo> = {};
  for (const m of new Set([...Object.keys(paid), ...full])) out[m] = monthInfo(m, paid[m] ?? 0, full.has(m), steps, fallbackFee);
  return out;
}

function monthInfo(month: string, paid: number, full: boolean, steps: FeeStep[], fallbackFee: number): MonthInfo {
  const fee = feeFor(month, steps, fallbackFee);
  const status: MonthStatus = full || (fee > 0 && paid >= fee) ? 'paid' : paid > 0 ? 'partial' : 'unpaid';
  return { fee, paid, status };
}

/** Status of one month, including months nobody has paid for. */
export function statusOf(months: Record<string, MonthInfo>, month: string, steps: FeeStep[], fallbackFee: number): MonthInfo {
  return months[month] ?? { fee: feeFor(month, steps, fallbackFee), paid: 0, status: 'unpaid' };
}

/** Last month in an unbroken run of fully paid months starting at `from` (null if `from` is not paid). */
export function paidThrough(months: Record<string, MonthInfo>, from: string): string | null {
  let m = from;
  let last: string | null = null;
  for (let i = 0; i < 240 && months[m]?.status === 'paid'; i++) {
    last = m;
    m = monthAdd(m, 1);
  }
  return last;
}

/** First month from `from` onward that is not fully paid — where the next payment should start. */
export function firstUnpaid(months: Record<string, MonthInfo>, from: string): string {
  let m = from;
  for (let i = 0; i < 240 && months[m]?.status === 'paid'; i++) m = monthAdd(m, 1);
  return m;
}

/** All-time totals for one member. */
export function totals(entries: LedgerEntry[]) {
  const eff = effectiveAmounts(entries);
  let paid = 0;
  let pending = 0;
  for (const e of entries) {
    if (e.kind === 'payment' && e.status === 'confirmed') paid += eff.get(e.id) ?? 0;
    if (e.kind === 'payment' && e.status === 'pending') pending += e.amount;
  }
  return { paid, pending };
}
