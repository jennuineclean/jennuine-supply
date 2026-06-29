import { useState, useEffect, useMemo, useRef } from 'react';
import { supabase } from './supabaseClient';
import { fetchAll, addItem, updateItem, deleteItem, addLog, subscribe } from './lib/api';
import { lookupBarcode } from './lib/lookup';
import { computeReport } from './lib/reports';
import { money, money0, isLow, monthKey, monthLabel, monthShort, availableMonths, unitPrice } from './lib/util';
import Scanner from './components/Scanner';
import Login from './components/Login';

const blankAdd = { upc: '', name: '', size: '', vendor: '', packPrice: '', packSize: '1', qty: '', reorder_at: '' };

export default function App() {
  const [session, setSession] = useState(undefined);
  const [items, setItems] = useState([]);
  const [log, setLog] = useState([]);
  const [tab, setTab] = useState('inventory');
  const [toast, setToast] = useState(null);
  const [editing, setEditing] = useState(null);          // draft copy of item being edited
  const [add, setAdd] = useState(blankAdd);
  const [lookupMsg, setLookupMsg] = useState(null);      // { cls, text }
  const [scan, setScan] = useState(null);                // 'use' | 'add' | null
  const [camNote, setCamNote] = useState({ use: '', add: '' });
  const [manualUpc, setManualUpc] = useState('');
  const [selectedMonth, setSelectedMonth] = useState(null);
  const [takeAmounts, setTakeAmounts] = useState({}); // itemId -> chosen take quantity, default 1
  const toastTimer = useRef(null);

  /* ---- auth ---- */
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  /* ---- data + live sync ---- */
  async function loadAll() {
    const r = await fetchAll();
    setItems(r.items);
    setLog(r.log);
  }
  useEffect(() => {
    if (!session) return;
    loadAll();
    const unsub = subscribe(() => loadAll());
    return unsub;
  }, [session]);

  function showToast(msg, reorder = false) {
    setToast({ msg, reorder });
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2800);
  }

  /* ---- actions ---- */
  function getTakeAmt(id) { return takeAmounts[id] || 1; }
  function setTakeAmt(id, n) { setTakeAmounts(a => ({ ...a, [id]: Math.max(1, n) })); }

  async function takeItem(it, n) {
    const amt = Math.max(1, parseInt(n) || 1);
    if (it.qty <= 0) { showToast('That one is already at zero.'); return; }
    const used = Math.min(amt, it.qty);
    const left = it.qty - used;
    await updateItem(it.id, { qty: left });
    await addLog({ type: 'use', item_id: it.id, name: it.name, units: used, unit_price: it.price, amount: +(used * it.price).toFixed(2) });
    await loadAll();
    setTakeAmounts(a => ({ ...a, [it.id]: 1 }));
    const nowLow = left <= it.reorder_at;
    const usedNote = used < amt ? ` (only ${used} were left)` : '';
    showToast(nowLow ? `Used ${used}${usedNote} — ${it.name} is down to ${left}. Added to reorder.` : `Used ${used}${usedNote} — ${it.name}, ${left} left.`, nowLow);
  }

  async function restock(it, packsOrUnits) {
    await updateItem(it.id, { qty: it.qty + packsOrUnits, ordered: false });
    await addLog({ type: 'purchase', item_id: it.id, name: it.name, units: packsOrUnits, unit_price: it.price, amount: +(packsOrUnits * it.price).toFixed(2) });
    await loadAll();
    setEditing(e => (e && e.id === it.id ? { ...e, qty: it.qty + packsOrUnits } : e));
    showToast(`Restocked ${it.name} — ${it.qty + packsOrUnits} on hand.`);
  }

  async function setOrdered(it, ordered) {
    await updateItem(it.id, { ordered });
    await loadAll();
    showToast(ordered ? `Marked ${it.name} as ordered.` : `${it.name} back on the to-order list.`);
  }

  async function saveEdit() {
    const e = editing;
    const packPrice = parseFloat(e.packPrice) || 0;
    const packSize = Math.max(1, parseInt(e.packSize) || 1);
    const patch = {
      name: e.name.trim() || 'Untitled',
      size: e.size.trim(),
      vendor: e.vendor.trim(),
      pack_price: packPrice,
      pack_size: packSize,
      price: unitPrice(packPrice, packSize),
      qty: parseInt(e.qty) || 0,
      reorder_at: parseInt(e.reorder_at) || 0,
      upc: (e.upc || '').trim(),
    };
    await updateItem(e.id, patch);
    await loadAll();
    setEditing(null);
    showToast('Saved.');
  }

  async function removeItem(id) {
    await deleteItem(id);
    await loadAll();
    setEditing(null);
    showToast('Removed.');
  }

  async function addNewItem() {
    const name = add.name.trim();
    if (!name) { showToast('Give it a name first.'); return; }
    const packPrice = parseFloat(add.packPrice) || 0;
    const packSize = Math.max(1, parseInt(add.packSize) || 1);
    const packsOnHand = parseInt(add.qty) || 0;
    const price = unitPrice(packPrice, packSize);
    const unitsOnHand = packsOnHand * packSize;
    const created = await addItem({
      name,
      size: add.size.trim(),
      vendor: add.vendor.trim(),
      pack_price: packPrice,
      pack_size: packSize,
      price,
      upc: add.upc.trim(),
      qty: unitsOnHand,
      reorder_at: parseInt(add.reorder_at) || 0,
    });
    if (created && packsOnHand > 0 && packPrice > 0) {
      await addLog({ type: 'purchase', item_id: created.id, name, units: unitsOnHand, unit_price: price, amount: +(packsOnHand * packPrice).toFixed(2) });
    }
    await loadAll();
    setAdd(blankAdd);
    setLookupMsg(null);
    setTab('inventory');
    showToast(`Added ${name}${packSize > 1 ? ` — ${unitsOnHand} units on hand` : ''}.`);
  }

  /* ---- barcode use / unknown handoff ---- */
  function useByUpc(upc) {
    const v = String(upc).trim();
    const it = items.find(i => i.upc && i.upc === v);
    if (it) { takeItem(it, 1); return; }
    showToast("Not in your supplies yet — let's add it.");
    setAdd({ ...blankAdd, upc: v });
    setTab('add');
    runLookup(v);
  }

  async function runLookup(upcArg) {
    const upc = (upcArg != null ? upcArg : add.upc).trim();
    if (!upc) { setLookupMsg({ cls: 'notfound', text: 'Scan or type a barcode first.' }); return; }
    setLookupMsg({ cls: 'searching', text: 'Looking up barcode…' });
    const r = await lookupBarcode(upc);
    if (r.found) {
      setAdd(a => ({ ...a, upc, name: a.name || r.name, size: a.size || r.size }));
      setLookupMsg({ cls: 'found', text: 'Found it — check the name and size, add your price and counts, then save.' });
    } else {
      setLookupMsg({ cls: 'notfound', text: "Not in the free database (common for cleaning supplies) — just type the details below. Once you save, this barcode is yours." });
    }
  }

  /* ---- scanning ---- */
  function handleScan(ctx, txt) {
    setScan(null);
    if (ctx === 'use') useByUpc(txt);
    else { setAdd(a => ({ ...a, upc: txt })); runLookup(txt); }
  }
  function handleScanError(ctx) {
    setScan(null);
    setCamNote(n => ({ ...n, [ctx]: 'Camera is blocked or unavailable here. Type the barcode and tap Look up, or use Quick pick.' }));
  }
  function goTab(t) { setScan(null); setTab(t); }

  /* ---- derived ---- */
  const low = useMemo(() => items.filter(isLow), [items]);
  const toOrderCount = useMemo(() => items.filter(it => isLow(it) && !it.ordered).length, [items]);
  const invValue = useMemo(() => items.reduce((s, i) => s + i.qty * Number(i.price), 0), [items]);
  const months = useMemo(() => availableMonths(log), [log]);
  const curMonth = selectedMonth && months.includes(selectedMonth) ? selectedMonth : months[0];
  const report = useMemo(() => computeReport(items, log, curMonth), [items, log, curMonth]);

  function exportCsv() {
    const ev = log.filter(e => monthKey(e.ts) === curMonth).sort((a, b) => new Date(a.ts) - new Date(b.ts));
    if (!ev.length) { showToast('Nothing to export for this month.'); return; }
    const rows = [['Date', 'Type', 'Item', 'Units', 'Unit price', 'Amount']];
    ev.forEach(e => {
      const d = new Date(e.ts);
      rows.push([d.toISOString().slice(0, 10), e.type, e.name, e.units, Number(e.unit_price).toFixed(2), Number(e.amount).toFixed(2)]);
    });
    const csv = rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `jennuine-${curMonth}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
    showToast(`Exported ${monthLabel(curMonth)}.`);
  }

  /* ---- gates ---- */
  if (session === undefined) return null;
  if (!session) return <Login />;

  return (
    <div className="app">
      <header>
        <div className="wordmark"><h1>Jennuine Clean</h1><span className="tag">Supply Room</span></div>
        <div className="subtitle">Beautifully thorough — right down to the cupboard.</div>
        <div className="summary">
          <div className="stat"><div className="n">{items.length}</div><div className="l">Items</div></div>
          <div className="stat alert"><div className="n">{low.length}</div><div className="l">Low</div></div>
          <div className="stat"><div className="n">${Math.round(invValue)}</div><div className="l">On hand</div></div>
        </div>
      </header>

      <main>
        {/* INVENTORY */}
        {tab === 'inventory' && (
          <section className="view">
            <div className="section-eyebrow">Everything on hand</div>
            {items.length === 0 ? (
              <Empty title="Nothing here yet" body="Add your first supply from the Add tab — scan a barcode or type it in." />
            ) : (
              [...items].sort((a, b) => (isLow(b) - isLow(a)) || a.name.localeCompare(b.name)).map(it => (
                <div key={it.id} className={'card' + (isLow(it) ? ' low' : '')} onClick={() => setEditing({ ...it, packPrice: String(it.pack_price ?? it.price ?? ''), packSize: String(it.pack_size || 1), qty: String(it.qty), reorder_at: String(it.reorder_at) })}>
                  <div className="body">
                    <div className="name">{it.name} {isLow(it) && <span className="pill">Low</span>}</div>
                    <div className="meta">
                      <span><b>{it.vendor || '—'}</b></span>
                      {it.size && <span>{it.size}</span>}
                      <span>{money(it.price)}/unit</span>
                      {it.pack_size > 1 && <span>{it.pack_size}-pack · {money(it.pack_price)}</span>}
                      <span>Reorder at {it.reorder_at}</span>
                    </div>
                  </div>
                  <div className={'qty' + (isLow(it) ? ' low' : '')}><div className="big">{it.qty}</div><div className="lab">on hand</div></div>
                </div>
              ))
            )}
          </section>
        )}

        {/* TAKE */}
        {tab === 'use' && (
          <section className="view">
            <div className="use-hero">
              <h2>Take an item</h2>
              <p>Scan the barcode on the bottle, or pick from the list. The count drops by one and lands on the reorder list when it runs low. Scan something new and it'll offer to add it.</p>
              {scan === 'use'
                ? <><Scanner regionId="reader" onResult={t => handleScan('use', t)} onError={() => handleScanError('use')} />
                    <div className="row-btns"><button className="btn btn-ghost" onClick={() => setScan(null)}>Stop camera</button></div></>
                : <div className="row-btns"><button className="btn btn-sage" onClick={() => { setCamNote(n => ({ ...n, use: '' })); setScan('use'); }}>Scan barcode</button></div>}
              {camNote.use && <div className="cam-note">{camNote.use}</div>}
              <div className="manual">
                <input inputMode="numeric" placeholder="Or type a barcode number" value={manualUpc} onChange={e => setManualUpc(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && manualUpc.trim()) { useByUpc(manualUpc); setManualUpc(''); } }} />
                <button className="btn btn-sage" style={{ flex: '0 0 auto', padding: '12px 18px' }} onClick={() => { if (manualUpc.trim()) { useByUpc(manualUpc); setManualUpc(''); } }}>Use</button>
              </div>
            </div>
            <div className="quick-label">Quick pick</div>
            {[...items].sort((a, b) => a.name.localeCompare(b.name)).map(it => (
              <div key={it.id} className="quick">
                <div><div className="qn">{it.name}</div><div className="qm">{it.qty} on hand · {money(it.price)}/unit{it.size ? ' · ' + it.size : ''}</div></div>
                <div className="stepper">
                  <button className="step-btn" disabled={it.qty <= 0} onClick={() => setTakeAmt(it.id, getTakeAmt(it.id) - 1)}>&minus;</button>
                  <span className="step-n">{getTakeAmt(it.id)}</span>
                  <button className="step-btn" disabled={it.qty <= 0} onClick={() => setTakeAmt(it.id, getTakeAmt(it.id) + 1)}>+</button>
                  <button className="take" disabled={it.qty <= 0} style={it.qty <= 0 ? { opacity: .4 } : null} onClick={() => takeItem(it, getTakeAmt(it.id))}>Take</button>
                </div>
              </div>
            ))}
          </section>
        )}

        {/* REORDER */}
        {tab === 'reorder' && (() => {
          const toOrder = low.filter(it => !it.ordered);
          const onWay = low.filter(it => it.ordered);
          return (
            <section className="view">
              <div className="section-eyebrow">Needs ordering</div>
              {toOrder.length === 0
                ? <Empty title={onWay.length ? "Nothing left to order" : "All stocked up"} body={onWay.length ? "Everything that's low is already on its way." : "Nothing has dropped to its reorder point. This list fills itself as you take items."} />
                : toOrder.map(it => (
                  <div key={it.id} className="buy">
                    <div className="top">
                      <div><div className="name">{it.name}{it.size ? ' · ' + it.size : ''}</div><div className="where">Buy at <b>{it.vendor || '—'}</b></div></div>
                      <div className="nums"><div className="price">{it.pack_size > 1 ? money(it.pack_price) : money(it.price)}</div><div>{it.pack_size > 1 ? `pack of ${it.pack_size}` : 'last paid'}</div></div>
                    </div>
                    <div className="buy-foot">
                      <span className="where">{it.qty} on hand · reorder point {it.reorder_at}</span>
                      <button className="mark-btn" onClick={() => setOrdered(it, true)}>Mark ordered</button>
                    </div>
                  </div>
                ))}

              {onWay.length > 0 && (
                <>
                  <div className="section-eyebrow" style={{ marginTop: 22 }}>On the way</div>
                  {onWay.map(it => (
                    <div key={it.id} className="buy ordered">
                      <div className="top">
                        <div><div className="name">{it.name}{it.size ? ' · ' + it.size : ''} <span className="pill ordered-pill">Ordered</span></div><div className="where">From <b>{it.vendor || '—'}</b></div></div>
                        <div className="nums"><div className="price">{it.pack_size > 1 ? money(it.pack_price) : money(it.price)}</div><div>{it.pack_size > 1 ? `pack of ${it.pack_size}` : 'last paid'}</div></div>
                      </div>
                      <div className="buy-foot">
                        <span className="where">{it.qty} on hand · restock to clear</span>
                        <button className="mark-btn undo" onClick={() => setOrdered(it, false)}>Undo</button>
                      </div>
                    </div>
                  ))}
                </>
              )}
            </section>
          );
        })()}

        {/* REPORTS */}
        {tab === 'reports' && (
          <section className="view">
            <div className="section-eyebrow">Reports</div>
            <div className="month-pick">
              <select value={curMonth || ''} onChange={e => setSelectedMonth(e.target.value)}>
                {months.map(m => <option key={m} value={m}>{monthLabel(m)}</option>)}
              </select>
              <button className="csv-btn" onClick={exportCsv}>Export</button>
            </div>

            <div className="rep-cards">
              <div className="rep-card"><div className="rn">{money0(report.spent)}</div><div className="rl">Spent</div></div>
              <div className="rep-card used"><div className="rn">{money0(report.used)}</div><div className="rl">Used</div></div>
              <div className="rep-card"><div className="rn">{money0(Math.abs(report.diff))}</div><div className="rl">{report.diff >= 0 ? 'Net stocked' : 'Net drawn'}</div></div>
            </div>

            <div className="read">
              {(report.spent || report.used)
                ? <>In {monthLabel(curMonth)} you spent <b>{money(report.spent)}</b> restocking and used about <b>{money(report.used)}</b> of supplies across your jobs{report.usedUnits ? ` (${report.usedUnits} items)` : ''}. {report.diff >= 0 ? `That means you built up roughly ${money(report.diff)} of stock for later.` : `That means you drew down about ${money(-report.diff)} more than you bought — worth a restock soon.`}</>
                : <>No activity recorded yet for {monthLabel(curMonth)}. As you take and restock items, this fills in.</>}
            </div>

            <div className="rep-block">
              <h3>Where the money went</h3>
              <div className="sub">What you spent restocking this month, by store.</div>
              {report.vendors.length
                ? report.vendors.map(([v, amt]) => <Bar key={v} label={v} pct={Math.max(6, amt / report.vendors[0][1] * 100)} val={money0(amt)} />)
                : <div className="rep-empty">No purchases recorded this month.</div>}
            </div>

            <div className="rep-block">
              <h3>Cost of what you used</h3>
              <div className="sub">The supplies that actually went into the work, by spend.</div>
              {report.usedItems.length
                ? report.usedItems.map(([name, d]) => <Bar key={name} label={name} pct={Math.max(6, d.cost / report.usedItems[0][1].cost * 100)} val={money(d.cost)} sub={`${d.units} used`} />)
                : <div className="rep-empty">Nothing used yet this month.</div>}
            </div>

            <div className="rep-block">
              <h3>Used by month</h3>
              <div className="sub">Cost of supplies consumed, month over month.</div>
              <div className="mchart">
                {report.mom.map(x => {
                  const max = Math.max(1, ...report.mom.map(y => y.used));
                  return (
                    <div key={x.m} className={'mcol' + (x.m === curMonth ? ' cur' : '')}>
                      <div className="mval">{x.used ? money0(x.used) : ''}</div>
                      <div className="mbar" style={{ height: (x.used / max * 100) + '%' }} />
                      <div className="mcap">{monthShort(x.m)}</div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="rep-block">
              <h3>Next restock estimate</h3>
              <div className="sub">Roughly what it'll cost to lift everything that's low back above its reorder point.</div>
              {report.low.length
                ? <div className="rrow" style={{ marginBottom: 4 }}><div className="rlab" style={{ flex: 1 }}>{report.low.length} item{report.low.length > 1 ? 's' : ''} below threshold</div><div className="rval" style={{ minWidth: 64, fontSize: 16 }}>{money0(report.est)}</div></div>
                : <div className="rep-empty">Nothing's low right now — no restock needed.</div>}
            </div>

            <div className="account">
              <span>{session.user.email}</span>
              <button onClick={() => supabase.auth.signOut()}>Sign out</button>
            </div>
          </section>
        )}

        {/* ADD */}
        {tab === 'add' && (
          <section className="view">
            <div className="section-eyebrow">Add a supply</div>
            <div className="form">
              <div className="field">
                <label>Barcode</label>
                <input inputMode="numeric" placeholder="Scan or type the number" value={add.upc} onChange={e => setAdd(a => ({ ...a, upc: e.target.value }))} />
                {scan === 'add' && <Scanner regionId="reader-add" onResult={t => handleScan('add', t)} onError={() => handleScanError('add')} />}
                {camNote.add && <div className="cam-note-add">{camNote.add}</div>}
                <div className="scan-row">
                  {scan === 'add'
                    ? <button className="btn-sm" onClick={() => setScan(null)}>Stop camera</button>
                    : <button className="btn-sm" onClick={() => { setCamNote(n => ({ ...n, add: '' })); setScan('add'); }}>Scan barcode</button>}
                  <button className="btn-sm primary" onClick={() => runLookup()}>Look up</button>
                </div>
              </div>
              {lookupMsg && <div className={'lookup-status ' + lookupMsg.cls} style={{ display: 'block' }}>{lookupMsg.text}</div>}
              <div className="field"><label>What is it</label><input placeholder="e.g. All-purpose cleaner" value={add.name} onChange={e => setAdd(a => ({ ...a, name: e.target.value }))} /></div>
              <div className="field"><label>Size</label><input placeholder="e.g. 32 oz" value={add.size} onChange={e => setAdd(a => ({ ...a, size: e.target.value }))} /></div>
              <div className="field"><label>Where you buy it</label><input placeholder="e.g. Costco" value={add.vendor} onChange={e => setAdd(a => ({ ...a, vendor: e.target.value }))} /></div>
              <div className="two">
                <div className="field"><label>Pack price</label><input inputMode="decimal" placeholder="e.g. 19.99" value={add.packPrice} onChange={e => setAdd(a => ({ ...a, packPrice: e.target.value }))} /></div>
                <div className="field"><label>Units per pack</label><input inputMode="numeric" placeholder="1 if sold individually" value={add.packSize} onChange={e => setAdd(a => ({ ...a, packSize: e.target.value }))} /></div>
              </div>
              {(parseFloat(add.packPrice) > 0) && (
                <div className="hint" style={{ marginTop: -8 }}>That's {money(unitPrice(add.packPrice, add.packSize))} per individual unit.</div>
              )}
              <div className="field"><label>Packs on hand now</label><input inputMode="numeric" placeholder="e.g. 1" value={add.qty} onChange={e => setAdd(a => ({ ...a, qty: e.target.value }))} /></div>
              {(parseInt(add.qty) > 0 && parseInt(add.packSize) > 1) && (
                <div className="hint" style={{ marginTop: -8 }}>That's {parseInt(add.qty) * Math.max(1, parseInt(add.packSize) || 1)} individual units on hand.</div>
              )}
              <div className="field"><label>Reorder at (individual units)</label><input inputMode="numeric" placeholder="3" value={add.reorder_at} onChange={e => setAdd(a => ({ ...a, reorder_at: e.target.value }))} /></div>
              <div className="hint">Enter the price exactly as it rings up for the whole pack — an 8-pack of sponges might be $19.99 for 8 units. The app does the per-unit math for your reports, and Take pulls one sponge at a time, not one pack.</div>
              <button className="btn btn-sage" style={{ width: '100%', marginTop: 16 }} onClick={addNewItem}>Add to supply room</button>
            </div>
          </section>
        )}
      </main>

      <nav>
        <Tab id="inventory" cur={tab} go={goTab} label="Supplies" icon={<path d="M3 7l9-4 9 4v10l-9 4-9-4V7z M3 7l9 4 9-4M12 11v10" />} />
        <Tab id="use" cur={tab} go={goTab} label="Take" icon={<path d="M3 5v14M7 5v14M11 5v14M15 5v14M19 5v14" />} />
        <Tab id="reorder" cur={tab} go={goTab} label="Reorder" badge={toOrderCount} icon={<><path d="M6 6h15l-1.5 9h-12z" /><circle cx="9" cy="20" r="1.4" /><circle cx="18" cy="20" r="1.4" /><path d="M6 6L5 3H3" /></>} />
        <Tab id="reports" cur={tab} go={goTab} label="Reports" icon={<path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />} />
        <Tab id="add" cur={tab} go={goTab} label="Add" icon={<><circle cx="12" cy="12" r="9" /><path d="M12 8v8M8 12h8" /></>} />
      </nav>

      {/* edit sheet */}
      <div className={'scrim' + (editing ? ' show' : '')} onClick={() => setEditing(null)} />
      <div className={'sheet' + (editing ? ' show' : '')}>
        <div className="grab" />
        {editing && (
          <div>
            <h2>{editing.name}</h2>
            <div className="restock">
              <button onClick={() => restock(items.find(i => i.id === editing.id), 1 * Math.max(1, parseInt(editing.packSize) || 1))}>+1 pack</button>
              <button onClick={() => restock(items.find(i => i.id === editing.id), 5 * Math.max(1, parseInt(editing.packSize) || 1))}>+5 packs</button>
              <button onClick={() => restock(items.find(i => i.id === editing.id), 1)}>+1 unit</button>
            </div>
            <div className="field"><label>Name</label><input value={editing.name} onChange={e => setEditing({ ...editing, name: e.target.value })} /></div>
            <div className="two">
              <div className="field"><label>Size</label><input value={editing.size || ''} onChange={e => setEditing({ ...editing, size: e.target.value })} /></div>
              <div className="field"><label>Where you buy it</label><input value={editing.vendor || ''} onChange={e => setEditing({ ...editing, vendor: e.target.value })} /></div>
            </div>
            <div className="two">
              <div className="field"><label>Pack price</label><input inputMode="decimal" value={editing.packPrice} onChange={e => setEditing({ ...editing, packPrice: e.target.value })} /></div>
              <div className="field"><label>Units per pack</label><input inputMode="numeric" value={editing.packSize} onChange={e => setEditing({ ...editing, packSize: e.target.value })} /></div>
            </div>
            {(parseFloat(editing.packPrice) > 0) && (
              <div className="hint" style={{ marginTop: -8, marginBottom: 14 }}>That's {money(unitPrice(editing.packPrice, editing.packSize))} per individual unit.</div>
            )}
            <div className="two">
              <div className="field"><label>On hand (individual units)</label><input inputMode="numeric" value={editing.qty} onChange={e => setEditing({ ...editing, qty: e.target.value })} /></div>
              <div className="field"><label>Reorder at</label><input inputMode="numeric" value={editing.reorder_at} onChange={e => setEditing({ ...editing, reorder_at: e.target.value })} /></div>
            </div>
            <div className="field"><label>Barcode</label><input inputMode="numeric" value={editing.upc || ''} onChange={e => setEditing({ ...editing, upc: e.target.value })} /></div>
            <div className="hint">"+1 pack" / "+5 packs" log a purchase at the pack price and add the right number of individual units. Editing "On hand" directly is a count correction — it won't show as spending.</div>
            <div className="sheet-actions">
              <button className="danger" onClick={() => removeItem(editing.id)}>Remove</button>
              <button className="btn btn-sage" onClick={saveEdit}>Save changes</button>
            </div>
          </div>
        )}
      </div>

      <div className={'toast' + (toast ? ' show' : '') + (toast && toast.reorder ? ' reorder' : '')}>{toast ? toast.msg : ''}</div>
    </div>
  );
}

function Tab({ id, cur, go, label, icon, badge }) {
  return (
    <button className={'tab' + (cur === id ? ' active' : '')} onClick={() => go(id)}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">{icon}</svg>
      <span>{label}{badge ? <span className="badge">{badge}</span> : null}</span>
    </button>
  );
}

function Bar({ label, pct, val, sub }) {
  return (
    <div className="rrow">
      <div className="rlab">{label}</div>
      <div className="rbar"><span style={{ width: pct + '%' }} /></div>
      <div className="rval">{val}{sub && <small>{sub}</small>}</div>
    </div>
  );
}

function Empty({ title, body }) {
  return (
    <div className="empty">
      <svg className="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M3 7l9-4 9 4v10l-9 4-9-4V7z" /><path d="M3 7l9 4 9-4M12 11v10" /></svg>
      <h3>{title}</h3><p>{body}</p>
    </div>
  );
}
