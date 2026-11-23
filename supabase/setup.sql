-- Contract Register: Supabase database setup
-- Run this whole file once in Supabase: SQL Editor > New query > paste > Run.
-- It is safe to run again: it only creates what is missing.

-- 1. People and their roles ---------------------------------------------------
create table if not exists public.profiles (
  id uuid primary key references auth.users on delete cascade,
  email text not null,
  full_name text not null default '',
  role text not null default 'viewer' check (role in ('admin', 'editor', 'viewer')),
  created_at timestamptz not null default now()
);

-- The role of whoever is signed in (used by every security rule below).
create or replace function public.my_role() returns text
language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = auth.uid()
$$;

-- Every new login gets a profile. The very first person becomes the administrator;
-- everyone after starts as view-only until the administrator changes it in the app.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, full_name, role)
  values (
    new.id,
    coalesce(new.email, ''),
    coalesce(new.raw_user_meta_data ->> 'full_name', ''),
    case when exists (select 1 from public.profiles) then 'viewer' else 'admin' end
  )
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- People who already had a login before this script ran get a profile too;
-- if there is no administrator yet, the oldest login becomes one.
insert into public.profiles (id, email, role)
select u.id, coalesce(u.email, ''), 'viewer' from auth.users u
on conflict (id) do nothing;
update public.profiles set role = 'admin'
where id = (select u.id from auth.users u order by u.created_at limit 1)
  and not exists (select 1 from public.profiles where role = 'admin');

-- Keeps at least one administrator at all times.
create or replace function public.keep_one_admin() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if old.role = 'admin' and new.role <> 'admin'
     and (select count(*) from public.profiles where role = 'admin' and id <> old.id) = 0 then
    raise exception 'At least one administrator is required';
  end if;
  return new;
end $$;

drop trigger if exists profiles_keep_admin on public.profiles;
create trigger profiles_keep_admin
  before update on public.profiles
  for each row execute function public.keep_one_admin();

alter table public.profiles enable row level security;
drop policy if exists "profiles readable by members" on public.profiles;
create policy "profiles readable by members" on public.profiles
  for select to authenticated using (public.my_role() is not null);
drop policy if exists "admin manages profiles" on public.profiles;
create policy "admin manages profiles" on public.profiles
  for update to authenticated
  using (public.my_role() = 'admin') with check (public.my_role() = 'admin');

-- 2. Contracts ----------------------------------------------------------------
-- Each contract is one row; "doc" holds its details, every version and its change log.
create table if not exists public.contracts (
  id text primary key,
  doc jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid()
);

alter table public.contracts enable row level security;
drop policy if exists "members read contracts" on public.contracts;
create policy "members read contracts" on public.contracts
  for select to authenticated using (public.my_role() is not null);
drop policy if exists "editors add contracts" on public.contracts;
create policy "editors add contracts" on public.contracts
  for insert to authenticated with check (public.my_role() in ('admin', 'editor'));
drop policy if exists "editors change contracts" on public.contracts;
create policy "editors change contracts" on public.contracts
  for update to authenticated
  using (public.my_role() in ('admin', 'editor'))
  with check (public.my_role() in ('admin', 'editor'));
drop policy if exists "admin deletes contracts" on public.contracts;
create policy "admin deletes contracts" on public.contracts
  for delete to authenticated using (public.my_role() = 'admin');

-- 3. Safety net: a copy of every saved state of every contract ------------------
-- Even if someone overwrites or deletes a contract, the administrator can recover it.
create table if not exists public.contract_history (
  id bigserial primary key,
  contract_id text not null,
  action text not null,
  doc jsonb,
  changed_at timestamptz not null default now(),
  changed_by uuid
);

create or replace function public.log_contract_change() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'DELETE' then
    insert into public.contract_history (contract_id, action, doc, changed_by)
    values (old.id, 'deleted', old.doc, auth.uid());
    return old;
  end if;
  insert into public.contract_history (contract_id, action, doc, changed_by)
  values (new.id, lower(tg_op), new.doc, auth.uid());
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end $$;

drop trigger if exists contracts_history on public.contracts;
create trigger contracts_history
  before insert or update or delete on public.contracts
  for each row execute function public.log_contract_change();

alter table public.contract_history enable row level security;
drop policy if exists "admin reads history" on public.contract_history;
create policy "admin reads history" on public.contract_history
  for select to authenticated using (public.my_role() = 'admin');

-- 4. Settings (service families) ---------------------------------------------
create table if not exists public.settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.settings enable row level security;
drop policy if exists "members read settings" on public.settings;
create policy "members read settings" on public.settings
  for select to authenticated using (public.my_role() is not null);
drop policy if exists "admin writes settings" on public.settings;
create policy "admin writes settings" on public.settings
  for all to authenticated
  using (public.my_role() = 'admin') with check (public.my_role() = 'admin');

-- 5. Signed contracts and amendments (PDF files) -------------------------------
insert into storage.buckets (id, name, public, file_size_limit)
values ('documents', 'documents', false, 20971520)
on conflict (id) do nothing;

drop policy if exists "members read documents" on storage.objects;
create policy "members read documents" on storage.objects
  for select to authenticated
  using (bucket_id = 'documents' and public.my_role() is not null);
drop policy if exists "editors upload documents" on storage.objects;
create policy "editors upload documents" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'documents' and public.my_role() in ('admin', 'editor'));
drop policy if exists "admin deletes documents" on storage.objects;
create policy "admin deletes documents" on storage.objects
  for delete to authenticated
  using (bucket_id = 'documents' and public.my_role() = 'admin');

-- 6. Live updates: everyone sees changes as soon as they are saved ---------------
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'contracts') then
    alter publication supabase_realtime add table public.contracts;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'settings') then
    alter publication supabase_realtime add table public.settings;
  end if;
end $$;
