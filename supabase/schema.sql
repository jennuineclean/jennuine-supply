-- Jennuine Clean — Supply Room schema
-- Run this once in the Supabase dashboard: SQL Editor > New query > paste > Run.

-- 1. Tables -----------------------------------------------------------------
create table if not exists items (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  size        text default '',
  vendor      text default '',
  price       numeric(10,2) default 0,   -- price PER INDIVIDUAL UNIT (pack_price / pack_size), used everywhere in reports
  pack_price  numeric(10,2) default 0,   -- what you actually paid for the whole pack, as it rings up
  pack_size   int default 1,             -- units per pack (8 for an 8-pack of sponges, 1 for a single bottle)
  upc         text default '',
  qty         int default 0,             -- always in INDIVIDUAL units, not packs
  reorder_at  int default 0,
  ordered     boolean default false,     -- true once you've placed the order; cleared automatically on restock
  created_at  timestamptz default now()
);

-- If you already ran the original schema, run these once to add the newer columns
-- without losing data:
-- alter table items add column if not exists pack_price numeric(10,2) default 0;
-- alter table items add column if not exists pack_size int default 1;
-- alter table items add column if not exists ordered boolean default false;
-- update items set pack_price = price, pack_size = 1 where pack_price = 0 and price > 0;

create table if not exists supply_log (
  id          uuid primary key default gen_random_uuid(),
  type        text not null check (type in ('use','purchase')),
  item_id     uuid references items(id) on delete set null,
  name        text not null,
  units       int  not null default 1,
  unit_price  numeric(10,2) not null default 0,
  amount      numeric(10,2) not null default 0,
  ts          timestamptz not null default now()
);

create index if not exists supply_log_ts_idx on supply_log (ts);
create index if not exists supply_log_item_idx on supply_log (item_id);

-- 2. Row level security -----------------------------------------------------
-- Only signed-in users (you and Jenn) can read or write. The data is shared
-- between you both, so any authenticated user gets full access.
alter table items      enable row level security;
alter table supply_log enable row level security;

drop policy if exists "items_authenticated_all" on items;
create policy "items_authenticated_all" on items
  for all to authenticated using (true) with check (true);

drop policy if exists "log_authenticated_all" on supply_log;
create policy "log_authenticated_all" on supply_log
  for all to authenticated using (true) with check (true);

-- 3. Live sync --------------------------------------------------------------
-- Pushes changes to every open device (your phone and Jenn's) in real time.
alter publication supabase_realtime add table items;
alter publication supabase_realtime add table supply_log;
