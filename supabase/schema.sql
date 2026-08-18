-- ============================================================
-- 치지직 체크리스트 오버레이 — Supabase 스키마
-- Supabase 대시보드 > SQL Editor 에 통째로 붙여넣고 RUN
-- (여러 번 실행해도 안전하도록 작성됨)
-- ============================================================

create extension if not exists pgcrypto;

-- ---------- 테이블 ----------

create table if not exists public.lists (
  id         text primary key default encode(gen_random_bytes(6), 'hex'),
  title      text        not null default '체크리스트',
  sort       int         not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.items (
  id         uuid        primary key default gen_random_uuid(),
  list_id    text        not null references public.lists(id) on delete cascade,
  label      text        not null default '',
  done       boolean     not null default false,
  position   int         not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists items_list_position_idx on public.items (list_id, position);

-- ---------- updated_at 자동 갱신 ----------

create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists lists_touch_updated_at on public.lists;
create trigger lists_touch_updated_at
  before update on public.lists
  for each row execute function public.touch_updated_at();

-- ---------- 순서 재정렬 (ID 배열 순서대로 0..n-1 재번호) ----------

create or replace function public.reorder_items(p_list_id text, p_ids uuid[])
returns void language sql security definer set search_path = public as $$
  update public.items i
     set position = x.ord - 1
    from unnest(p_ids) with ordinality as x(id, ord)
   where i.id = x.id and i.list_id = p_list_id;
$$;

revoke execute on function public.reorder_items(text, uuid[]) from anon, authenticated;

-- ============================================================
-- RLS: anon 은 읽기만. 쓰기는 전부 서버(service_role)를 거친다.
-- ============================================================

alter table public.lists enable row level security;
alter table public.items enable row level security;

drop policy if exists "read lists" on public.lists;
create policy "read lists" on public.lists
  for select to anon, authenticated using (true);

drop policy if exists "read items" on public.items;
create policy "read items" on public.items
  for select to anon, authenticated using (true);

-- insert/update/delete 정책이 아예 없으므로 anon 쓰기는 차단된다.
-- 방어 심층화: 권한 자체를 회수해 나중에 실수로 정책을 열어도 막히게 한다.
revoke insert, update, delete on public.lists from anon, authenticated;
revoke insert, update, delete on public.items from anon, authenticated;

-- ============================================================
-- Realtime — 여기서 막히는 경우가 가장 많다
-- ============================================================

-- 이미 publication 에 들어있으면 에러가 나므로 조건부로 추가
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'lists'
  ) then
    alter publication supabase_realtime add table public.lists;
  end if;

  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'items'
  ) then
    alter publication supabase_realtime add table public.items;
  end if;
end $$;

-- RLS 가 켜져 있을 때 DELETE/UPDATE 이벤트가 오버레이에 전달되려면 필수.
-- 빠뜨리면 "체크는 되는데 삭제만 반영이 안 되는" 증상이 생긴다.
alter table public.lists replica identity full;
alter table public.items replica identity full;

-- ---------- 확인용 ----------
-- select tablename from pg_publication_tables where pubname = 'supabase_realtime';
