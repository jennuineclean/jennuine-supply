import { monthKey, availableMonths } from './util';

export function computeReport(items, log, selectedMonth) {
  const ev = log.filter(e => monthKey(e.ts) === selectedMonth);
  const num = v => Number(v) || 0;

  const spent = ev.filter(e => e.type === 'purchase').reduce((s, e) => s + num(e.amount), 0);
  const used = ev.filter(e => e.type === 'use').reduce((s, e) => s + num(e.amount), 0);
  const usedUnits = ev.filter(e => e.type === 'use').reduce((s, e) => s + num(e.units), 0);
  const diff = spent - used;

  const byVendor = {};
  ev.filter(e => e.type === 'purchase').forEach(e => {
    const it = items.find(i => i.id === e.item_id);
    const v = (it && it.vendor) || 'Other';
    byVendor[v] = (byVendor[v] || 0) + num(e.amount);
  });
  const vendors = Object.entries(byVendor).sort((a, b) => b[1] - a[1]);

  const byItem = {};
  ev.filter(e => e.type === 'use').forEach(e => {
    if (!byItem[e.name]) byItem[e.name] = { cost: 0, units: 0 };
    byItem[e.name].cost += num(e.amount);
    byItem[e.name].units += num(e.units);
  });
  const usedItems = Object.entries(byItem).sort((a, b) => b[1].cost - a[1].cost).slice(0, 8);

  const recent = availableMonths(log).slice(0, 6).reverse();
  const mom = recent.map(m => ({
    m,
    used: log.filter(e => e.type === 'use' && monthKey(e.ts) === m).reduce((s, e) => s + num(e.amount), 0),
  }));

  const low = items.filter(i => i.qty <= i.reorder_at);
  const est = low.reduce((s, it) => s + Math.max(0, (it.reorder_at - it.qty) + 1) * num(it.price), 0);

  return { spent, used, usedUnits, diff, vendors, usedItems, mom, low, est };
}
