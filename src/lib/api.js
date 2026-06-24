import { supabase } from '../supabaseClient';

export async function fetchAll() {
  const [itemsRes, logRes] = await Promise.all([
    supabase.from('items').select('*').order('name', { ascending: true }),
    supabase.from('supply_log').select('*').order('ts', { ascending: false }),
  ]);
  return { items: itemsRes.data || [], log: logRes.data || [] };
}

export async function addItem(it) {
  const { data, error } = await supabase.from('items').insert(it).select().single();
  if (error) console.error(error);
  return data;
}
export async function updateItem(id, patch) {
  const { error } = await supabase.from('items').update(patch).eq('id', id);
  if (error) console.error(error);
}
export async function deleteItem(id) {
  const { error } = await supabase.from('items').delete().eq('id', id);
  if (error) console.error(error);
}
export async function addLog(entry) {
  const { error } = await supabase.from('supply_log').insert(entry);
  if (error) console.error(error);
}

export function subscribe(onChange) {
  const ch = supabase
    .channel('supply-room')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'items' }, onChange)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'supply_log' }, onChange)
    .subscribe();
  return () => supabase.removeChannel(ch);
}
