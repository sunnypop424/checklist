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

-- ⚠ 함수는 생성 시 PUBLIC 에 EXECUTE 가 자동으로 붙는다. anon/authenticated 만
--   revoke 하면 PUBLIC 을 통해 그대로 상속되어 아무 효과가 없다 (proacl 의 '=X/postgres').
--   security definer 함수라 뚫리면 anon 이 남의 리스트 순서를 바꿀 수 있다.
revoke all on function public.reorder_items(text, uuid[]) from public, anon, authenticated;
grant execute on function public.reorder_items(text, uuid[]) to service_role;

-- ============================================================
-- 팰월드 트래커 연동 (docs/팰월드_트래커_기획서.md 2장)
-- 트래커는 별도 오버레이를 갖지 않는다. 계산 결과를 여기 lists/items 로
-- 밀어넣으면 기존 /o/[id] 가 /o/pal 로 그대로 렌더한다.
-- ============================================================

-- 이 목록을 사람이 만들었는가(manual), 트래커가 만들었는가(pal)
alter table public.lists add column if not exists source text not null default 'manual';

-- 트래커가 생성한 항목의 안정적인 식별자 ('farm:hunt_fire' 등).
-- uuid 는 sync 때마다 바뀌면 안 되므로 ref 로 매칭한다.
-- 손으로 만든 항목은 ref = null 이고 여러 개 존재할 수 있어 부분 인덱스를 쓴다.
alter table public.items add column if not exists ref text;
create unique index if not exists items_list_ref_idx
  on public.items (list_id, ref) where ref is not null;

-- ---------- 트래커 → 체크리스트 sync ----------
-- p_items = [{ref, label, done, position}, ...]
--
-- ⚠ 전체 삭제 후 재삽입으로 바꾸지 말 것. Realtime 이 삭제 이벤트를 먼저
--    흘려보내서 방송 중 오버레이가 한 번 빈 화면으로 깜빡인다. 반드시 diff.
create or replace function public.pal_sync_list(p_items jsonb)
returns void language plpgsql security definer set search_path = public as $$
begin
  -- title 은 덮어쓰지 않는다 — /control 에서 이름을 바꿔 쓸 수 있어야 한다
  insert into public.lists (id, title, source)
       values ('pal', '팰월드 4거점', 'pal')
  on conflict (id) do update set source = 'pal';

  -- 이번 목록에 없는 항목 제거.
  -- ref is null 도 지운다 — 이 목록에 손으로 넣은 항목은 다음 sync 때 어차피 유실되므로
  -- 남겨두면 "지워지지 않는 유령 항목"이 된다.
  delete from public.items i
   where i.list_id = 'pal'
     and (
       i.ref is null
       or not exists (
         select 1
           from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) x
          where x->>'ref' = i.ref
       )
     );

  -- 있는 건 갱신, 없는 건 삽입
  insert into public.items (list_id, ref, label, done, position)
  select 'pal',
         x->>'ref',
         x->>'label',
         coalesce((x->>'done')::boolean, false),
         coalesce((x->>'position')::int, (ord - 1)::int)
    from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) with ordinality as t(x, ord)
   where x->>'ref' is not null
  on conflict (list_id, ref) where ref is not null
  do update set label    = excluded.label,
                done     = excluded.done,
                position = excluded.position;
end;
$$;

-- PUBLIC 부터 회수해야 한다 (위 reorder_items 주석 참고)
revoke all on function public.pal_sync_list(jsonb) from public, anon, authenticated;
grant execute on function public.pal_sync_list(jsonb) to service_role;

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
