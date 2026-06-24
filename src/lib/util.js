export const money  = n => '$' + Number(n || 0).toFixed(2);
export const money0 = n => '$' + Math.round(Number(n || 0));
export const isLow  = it => it.qty <= it.reorder_at;

// Per-unit price, derived from what was actually paid for the whole pack.
// pack_size defaults to 1 so single items (a single bottle) work unchanged.
export function unitPrice(packPrice, packSize) {
  const pp = Number(packPrice) || 0;
  const ps = Math.max(1, parseInt(packSize) || 1);
  return +(pp / ps).toFixed(4);
}

export const monthKey = ts => {
  const d = new Date(ts);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
};
export const monthLabel = k => {
  const p = k.split('-');
  return new Date(+p[0], +p[1] - 1, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
};
export const monthShort = k => {
  const p = k.split('-');
  return new Date(+p[0], +p[1] - 1, 1).toLocaleDateString('en-US', { month: 'short' });
};
export function availableMonths(log) {
  const s = new Set(log.map(e => monthKey(e.ts)));
  s.add(monthKey(Date.now()));
  return [...s].sort().reverse();
}
