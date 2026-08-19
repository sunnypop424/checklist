-- ============================================================
-- 팰월드 4거점 트래커 — Supabase 스키마
--   npm run db:setup 이 schema.sql 다음에 이 파일을 실행한다.
--   (여러 번 실행해도 안전하도록 작성됨)
--
-- 주의: 테이블 이름은 전부 pal_ 접두사. 접두사 없는 items/lists 는
--   체크리스트 오버레이의 테이블이라 이름이 겹치면 그쪽이 깨진다.
-- ============================================================

-- ---------- 획득처 (파밍 작업의 단위) ----------

create table if not exists public.pal_farm_sources (
  id        text primary key,
  name      text not null,
  method    text not null default 'manual',  -- auto | manual
  place     text,
  sort      int  not null default 0,
  note      text,
  -- 이 시설을 1대라도 지어야 자동 획득이 시작된다.
  -- 미완성이면 파밍 작업 대신 그 건설 작업을 최상단에 띄운다.
  requires_structure text
);

-- ---------- 게임 데이터 ----------

create table if not exists public.pal_items (
  id        text primary key,
  name      text not null,
  category  text not null,   -- ore|ingot|part|organ|wood|relic|misc
  source_id text references public.pal_farm_sources(id),  -- 최하위 재료만
  sort      int  not null default 0,
  note      text
);

create table if not exists public.pal_recipes (
  output_id text references public.pal_items(id) on delete cascade,
  input_id  text references public.pal_items(id) on delete cascade,
  qty       numeric not null,
  yield     numeric not null default 1,  -- 산출량. 불확실하면 여기서 보정
  tier      int not null default 1,      -- 1 가공 / 2 제련 / 3 조립 / 4 최종 부품
  primary key (output_id, input_id)
);

create table if not exists public.pal_bases (
  id        int primary key,
  name      text not null,
  role      text,
  weight    numeric not null default 1,
  pal_slots int not null default 20,
  note      text
);

create table if not exists public.pal_structures (
  id           text primary key,
  name         text not null,
  base_id      int references public.pal_bases(id),
  count        int not null default 1,
  power        int,
  req_aptitude jsonb,
  unlock_score numeric not null default 0,
  build_order  int,
  note         text
);

-- pal_farm_sources.requires_structure 의 FK 는 생성 순서 때문에 여기서 건다
alter table public.pal_farm_sources
  drop constraint if exists pal_farm_sources_requires_structure_fkey;
alter table public.pal_farm_sources
  add constraint pal_farm_sources_requires_structure_fkey
  foreign key (requires_structure) references public.pal_structures(id) on delete set null;

create table if not exists public.pal_structure_costs (
  structure_id text references public.pal_structures(id) on delete cascade,
  item_id      text references public.pal_items(id) on delete cascade,
  qty          numeric not null,   -- 1대당 수량
  primary key (structure_id, item_id)
);

-- 이 건축물이 있어야 저 아이템을 만들 수 있다
create table if not exists public.pal_structure_unlocks (
  structure_id text references public.pal_structures(id) on delete cascade,
  item_id      text references public.pal_items(id) on delete cascade,
  primary key (structure_id, item_id)
);

create table if not exists public.pal_pals (
  id        text primary key,
  name      text not null,
  aptitudes jsonb not null default '{}'::jsonb,
  nocturnal boolean not null default false,
  foreman   text,          -- 작업반장 적성 (배치만 해도 +1)
  partner   text,
  source    text,
  -- 잡는 게 아니라 배합으로 얻는 팰. 이 부모들을 먼저 확보해야 한다.
  breed_from text[] not null default '{}',
  breed_note text
);
alter table public.pal_pals add column if not exists breed_from text[] not null default '{}';
alter table public.pal_pals add column if not exists breed_note text;

create table if not exists public.pal_assignments (
  id      bigserial primary key,
  base_id int references public.pal_bases(id) on delete cascade,
  role    text not null,
  count   int  not null default 1,
  pal_ids text[] not null default '{}',
  sort    int  not null default 0,
  note    text
);
create unique index if not exists pal_assignments_base_role_idx
  on public.pal_assignments (base_id, role);

-- ---------- 사용자 상태 ----------

-- 반복해서 입력하는 건 사실상 이 테이블 하나다
create table if not exists public.pal_inventory (
  item_id    text primary key references public.pal_items(id) on delete cascade,
  qty        numeric not null default 0,
  updated_at timestamptz not null default now()
);

-- 파밍·제작 완료는 재고로 판정하므로 여기 안 들어온다. 건설 진행도 전용.
--
-- done boolean 이 아니라 built int 인 이유: 침대 20개·상자 8개처럼 여러 대를
-- 짓는 항목이 대부분이라, 1대라도 지었는지(=자동 획득처 해금)와 전부 지었는지를
-- 구분해야 한다. 기획서 6장의 done boolean 을 이걸로 대체한다.
create table if not exists public.pal_checklist (
  id         bigserial primary key,
  kind       text not null,               -- build | pal
  ref_id     text not null,
  built      int  not null default 0,     -- build: 지은 개수 / pal: 0 또는 1
  updated_at timestamptz not null default now(),
  unique (kind, ref_id)
);

create table if not exists public.pal_settings (
  id     int primary key default 1,
  config jsonb not null default '{}'::jsonb,
  constraint pal_settings_single_row check (id = 1)
);
-- 기본값은 집중 모드 5줄. 획득처가 12개라 전부 띄우면 방송 화면이 목록으로 가득 찬다.
insert into public.pal_settings (id, config)
values (1, '{"showTotals":true,"limit":5,"autoSync":true,"mode":"focus"}'::jsonb)
  on conflict (id) do nothing;

-- ============================================================
-- RLS — 정책을 하나도 만들지 않는다 = anon 전면 차단 (읽기까지).
-- 방송에 공개되는 건 pal_sync_list 로 내보낸 items.label 뿐이다.
-- ============================================================

alter table public.pal_farm_sources      enable row level security;
alter table public.pal_items             enable row level security;
alter table public.pal_recipes           enable row level security;
alter table public.pal_bases             enable row level security;
alter table public.pal_structures        enable row level security;
alter table public.pal_structure_costs   enable row level security;
alter table public.pal_structure_unlocks enable row level security;
alter table public.pal_pals              enable row level security;
alter table public.pal_assignments        enable row level security;
alter table public.pal_inventory         enable row level security;
alter table public.pal_checklist         enable row level security;
alter table public.pal_settings          enable row level security;

-- 방어 심층화: 정책을 실수로 열어도 막히도록 권한 자체를 회수한다.
do $$
declare t text;
begin
  foreach t in array array[
    'pal_farm_sources','pal_items','pal_recipes','pal_bases','pal_structures',
    'pal_structure_costs','pal_structure_unlocks','pal_pals','pal_assignments',
    'pal_inventory','pal_checklist','pal_settings'
  ] loop
    execute format('revoke all on public.%I from anon, authenticated', t);
  end loop;
end $$;

-- ============================================================
-- 시드 — 출처: docs/팰월드_1.0_4거점_설계도.md
-- 전부 on conflict do update (idempotent). 사용자가 /pal 데이터 탭에서
-- 고친 값도 db:setup 을 다시 돌리면 시드 값으로 되돌아간다.
-- ============================================================

-- ---------- 거점 (설계도 3장 / 기획서 8장 weight) ----------

insert into public.pal_bases (id, name, role, weight, pal_slots, note) values
  (1, '① 메인',      '제련 + 제작 + 무기·탄약', 2.5, 20, '전력 약 14,000/초. 넓은 평지 (광맥 불필요)'),
  (2, '② 자원',      '물질 생성기 + 석탄',      3.0, 20, '전력 약 3,200/초. 석탄 광맥 (-170,-215 추천)'),
  (3, '③ 농사',      '재배기 + 목장 + 부엌',    1.5, 20, '평지, 물가'),
  (4, '④ 배합·원유', '배합기 + 고압 원유',      2.0, 20, '전력 약 9,600/초. 유전 3포인트 또는 평지')
on conflict (id) do update set
  name = excluded.name, role = excluded.role, weight = excluded.weight,
  pal_slots = excluded.pal_slots, note = excluded.note;

-- ---------- 건축물 ----------
-- 공통 세트(설계도 4장)는 4거점 전부에 들어가므로 cross join 으로 4벌 만든다.
-- id 규칙: <key>_b<거점번호>

insert into public.pal_structures (id, name, base_id, count, unlock_score, build_order, note)
select t.key || '_b' || b.id, t.name, b.id, t.cnt, t.score, t.ord, t.note
  from public.pal_bases b
  cross join (values
    ('bed',         '고대 문명 팰 침대', 20, 1, 6, 'SAN 0.5/s, 회복 +100%'),
    ('hotspring',   '고대 문명 온천',     2, 1, 6, 'SAN +2.00/s'),
    ('watchtower',  '고대 문명 감시대',   1, 1, 6, 'SAN 억제 15'),
    ('clinic',      '고대 문명 진료소',   1, 1, 6, '제약 팰 1'),
    ('guildchest',  '길드 상자',          1, 2, 4, '거점 간 물자 이동을 해결한다 (설계도 14장)'),
    ('capacitor',   '축전기',             2, 2, 5, '용량 100만'),
    ('coldfeedbox', '보냉 먹이 상자',     1, 1, 5, '냉각 팰 1'),
    ('feedbox',     '먹이 상자',          2, 1, 5, null),
    ('palbox',      '팰 상자',            1, 1, 1, null)
  ) as t(key, name, cnt, score, ord, note)
on conflict (id) do update set
  name = excluded.name, base_id = excluded.base_id, count = excluded.count,
  unlock_score = excluded.unlock_score, build_order = excluded.build_order, note = excluded.note;

-- 고압형 원유 추출기 → 일반형으로 교체했다.
-- insert 는 on conflict do update 라 옛 행을 지우지 않는다. 남겨두면 계산에 계속 잡힌다.
delete from public.pal_structures where id = 'oil_extractor_hp_b4';

-- 거점별 고유 건축물 (설계도 16-4)

insert into public.pal_structures (id, name, base_id, count, unlock_score, build_order, note) values
  -- ① 메인
  ('furnace_b1',            '고대 문명 화로',        1, 2, 10, 1, '팰키사이트·솔라이트 주괴 라인. 여기부터 모든 게 시작된다.'),
  ('workbench_b1',          '고대 문명 작업대',      1, 2,  5, 3, '팰키사이트 티어 장비 전용. 수작업6 1 + 제약6 1'),
  ('factory_b1',            '고도 문명 작업 공장',   1, 1,  6, 3, '컴퓨터·AI 코어 제작. 수작업 4마리'),
  ('weaponfactory_b1',      '고도 문명 무기 공장',   1, 1,  2, 3, '무기·탄약 대량 생산. 수작업 4마리'),
  ('powerplant_b1',         '고대 문명 발전기',      1, 1,  8, 1, null),
  ('hqbox_b1',              '고도 문명 상자',        1, 8,  1, 5, null),
  ('bigkitchen_b1',         '대형 부엌',             1, 1,  3, 5, null),
  -- ② 자원
  ('matter_generator_b2',   '고대 문명 물질 생성기', 2, 5,  9, 2, '기술 78. 광물 12종 자동화. 1대만 지어도 파밍이 통째로 풀린다.'),
  ('powerplant_b2',         '고대 문명 발전기',      2, 1,  8, 2, null),
  ('hqbox_b2',              '고도 문명 상자',        2, 8,  1, 5, null),
  ('bigkitchen_b2',         '대형 부엌',             2, 1,  3, 5, null),
  -- ③ 농사
  ('plantation_b3',         '고대 문명 재배기',      3, 4,  3, 5, '기술 78'),
  ('kitchen_b3',            '고대 문명 부엌',        3, 1,  2, 5, '기술 70. 상시 가동이 아니라 1대면 충분'),
  ('ranch_b3',              '가축 목장',             3, 4,  2, 5, '양털 자동 생산'),
  ('mill_b3',               '제분기',                3, 1,  1, 5, null),
  ('powerplant_b3',         '고대 문명 발전기',      3, 1,  8, 5, null),
  -- ④ 배합·원유
  ('breeding_b4',           '고대 문명 배합기',      4, 3,  4, 4, '기술 76, 슬롯 10. AI 코어 150개가 여기 들어간다.'),
  ('oil_extractor_b4',      '원유 추출기',           4, 4,  7, 4, '기술 50 해제. 지상 원유 매장지(유정) 위에만 설치 가능. 팰 금속 주괴 125 + 전자기판 25.'),
  ('powerplant_b4',         '고대 문명 발전기',      4, 2,  8, 4, null),
  ('bigkitchen_b4',         '대형 부엌',             4, 1,  3, 5, null)
on conflict (id) do update set
  name = excluded.name, base_id = excluded.base_id, count = excluded.count,
  unlock_score = excluded.unlock_score, build_order = excluded.build_order, note = excluded.note;

-- ---------- 획득처 (설계도 16-2 의 A~E 분류) ----------

insert into public.pal_farm_sources (id, name, method, place, sort, note, requires_structure) values
  ('generator',   '물질 생성기',       'auto',   '거점② 자원', 10, '생성기 5대를 품목 고정으로 나눠 돌린다. 가동 중 품목 변경은 속도가 급락한다.', 'matter_generator_b2'),
  ('oil',         '원유 추출기',       'auto',   '거점④ 배합·원유', 20, '유전 위 일반형 4대', 'oil_extractor_b4'),
  ('ranch',       '가축 목장',         'auto',   '거점③ 농사', 30, null, 'ranch_b3'),
  ('hunt_fire',   '화염 팰 사냥',      'manual', '화산 지대', 40, '최대 병목. 발화 기관 요구량이 가장 크다.', null),
  ('hunt_elec',   '번개 팰 사냥',      'manual', null, 50, null, null),
  ('hunt_oil',    '기름 드롭 팰 사냥', 'manual', '그린모스 등', 60, null, null),
  ('hunt_poison', '독 팰 사냥',        'manual', null, 70, null, null),
  ('hunt_water',  '물 팰 사냥',        'manual', null, 80, null, null),
  ('hunt_ice',    '얼음 팰 사냥',      'manual', null, 90, null, null),
  ('butcher',     '팰 해체',           'manual', null,100, null, null),
  ('worldtree',   '세계수 원정',       'manual', '세계수',110, '성수는 1.0.3 에서 필드 보스 20~30개 확정 드롭. 보스 100회면 채워진다. 고대 문명의 코어도 여기서 나온다.', null),
  ('relic',       '유물·던전',         'manual', null,120, null, null)
on conflict (id) do update set
  name = excluded.name, method = excluded.method, place = excluded.place,
  sort = excluded.sort, note = excluded.note,
  requires_structure = excluded.requires_structure;

-- ---------- 아이템 ----------
-- 최하위 재료 (source_id 있음)

insert into public.pal_items (id, name, category, source_id, sort, note) values
  ('metal_ore',      '금속 광석',        'ore',   'generator',  10, null),
  ('coal',           '석탄',             'ore',   'generator',  20, '물질 생성기로 생산 가능 → 석탄 채굴장은 짓지 않는다'),
  ('stone',          '돌',               'ore',   'generator',  30, null),
  ('pure_quartz',    '순수한 석영',      'ore',   'generator',  40, null),
  ('solite_ore',     '솔라이트 광석',    'ore',   'generator',  50, '솔라이트 주괴와 팰키사이트 주괴 양쪽에 들어가 수요가 두 갈래로 갈린다'),
  ('sulfur',         '유황',             'ore',   'generator',  60, null),
  ('wood',           '목재',             'wood',  'generator',  70, '상인 구매가 더 싸다. 벌목 팰은 키울 가치가 낮다.'),
  ('chromite',       '크로마이트',       'ore',   'generator',  80, null),
  ('hexo_quartz',    '헥소 석영',        'ore',   'generator',  90, null),
  ('paldium',        '팰지움 파편',      'ore',   'generator', 100, '물질 생성기 직접 생산 기준 (돌 5개 가공 루트 미사용)'),
  ('hard_wood',      '단단한 목재',      'wood',  'generator', 110, null),
  ('coralium_ore',   '코랄리움 광석',    'ore',   'generator', 120, null),
  ('crude_oil',      '원유',             'misc',  'oil',       130, null),
  ('wool',           '양털',             'misc',  'ranch',     140, null),
  ('flame_organ',    '발화 기관',        'organ', 'hunt_fire', 150, '화염 속성 팰'),
  ('electric_organ', '발전 기관',        'organ', 'hunt_elec', 160, '번개 속성 팰'),
  ('hq_pal_oil',     '고급 팰 기름',     'organ', 'hunt_oil',  170, '기름 드롭 팰(그린모스 등)'),
  ('venom_gland',    '독샘',             'organ', 'hunt_poison',180, '독 속성 팰'),
  ('aqua_slime',     '수생 팰의 점액',   'organ', 'hunt_water',190, '물 속성 팰'),
  ('ice_organ',      '빙결 기관',        'organ', 'hunt_ice',  200, '얼음 속성 팰'),
  ('bone',           '뼈',               'organ', 'butcher',   210, null),
  ('leather',        '가죽',             'organ', 'butcher',   220, null),
  ('palkicite_ore',  '팰키사이트 광석',  'ore',   'worldtree', 230, '세계수에서만 나온다. 최대 병목.'),
  ('sacred_water',   '세계수의 성수',    'misc',  'worldtree', 240, null),
  ('mystic_wood',    '신비한 목재',      'wood',  'worldtree', 250, null),
  ('ancient_core',   '고대 문명의 코어', 'relic', 'worldtree', 260, '원정·세계수에서 파밍한다'),
  ('ancient_part',   '고대 문명의 부품', 'relic', 'relic',     270, null)
on conflict (id) do update set
  name = excluded.name, category = excluded.category,
  source_id = excluded.source_id, sort = excluded.sort, note = excluded.note;

-- 중간재 (source_id 없음 = 제작으로만 얻는다)

insert into public.pal_items (id, name, category, source_id, sort, note) values
  ('fiber',           '섬유',               'misc',  null, 300, null),
  ('charcoal',        '숯',                 'misc',  null, 310, null),
  ('cement',          '시멘트',             'misc',  null, 320, null),
  ('hq_cloth',        '상급 천',            'misc',  null, 330, null),
  ('carbon_fiber',    '카본 섬유',          'part',  null, 340, null),
  ('polymer',         '폴리머',             'part',  null, 350, null),
  ('corrosive',       '부식성 용액',        'part',  null, 360, null),
  ('hexolite',        '헥소라이트',         'part',  null, 370, null),
  ('cryo_medium',     '극저온 냉각 매체',   'part',  null, 380, null),
  ('metal_ingot',     '금속 주괴',          'ingot', null, 400, null),
  ('refined_ingot',   '제련 주괴',          'ingot', null, 410, null),
  ('pal_metal_ingot', '팰 금속 주괴',       'ingot', null, 420, null),
  ('coralium_ingot',  '코랄리움 주괴',      'ingot', null, 430, null),
  ('solite_ingot',    '솔라이트 주괴',      'ingot', null, 440, null),
  ('palkicite_ingot', '팰키사이트 주괴',    'ingot', null, 450, '고대 문명 화로에서만 제련된다. 화로 1대가 나머지 전부의 선행 조건.'),
  ('nail',            '못',                 'part',  null, 500, null),
  ('plank',           '나무 판자',          'part',  null, 510, null),
  ('hq_plank',        '상급 나무 판자',     'part',  null, 520, null),
  ('plastil',         '플라스틸',           'part',  null, 530, null),
  ('circuit_board',   '전자기판',           'part',  null, 540, '설계도 8장의 "회로 기판"은 이 항목으로 본다'),
  ('bio_battery',     '바이오 배터리',      'part',  null, 550, null),
  ('superheat_core',  '초고열 코어',        'part',  null, 560, null),
  ('computer',        '컴퓨터',             'part',  null, 600, '982개 중 800개가 AI 코어용이다'),
  ('ai_core',         'AI 코어',            'part',  null, 610, '배합기 3대 = 150개. 이 계산서 전체를 지배한다.')
on conflict (id) do update set
  name = excluded.name, category = excluded.category,
  source_id = excluded.source_id, sort = excluded.sort, note = excluded.note;

-- ---------- 레시피 (설계도 16-1) ----------
-- tier: 1 가공 / 2 제련 / 3 조립 / 4 최종 부품 (16-3 의 1차~4차 구분)

delete from public.pal_recipes;
insert into public.pal_recipes (output_id, input_id, qty, yield, tier) values
  -- 1차 가공
  ('fiber',          'wood',           1,  1, 1),
  ('charcoal',       'wood',           2,  1, 1),
  ('cement',         'stone',         20,  1, 1),
  ('cement',         'bone',           1,  1, 1),
  ('cement',         'aqua_slime',     1,  1, 1),
  ('hq_cloth',       'wool',          10,  1, 1),
  ('hq_cloth',       'leather',        1,  1, 1),
  ('carbon_fiber',   'coal',           2,  1, 1),
  ('carbon_fiber',   'flame_organ',    1,  1, 1),
  ('polymer',        'hq_pal_oil',     2,  1, 1),
  ('polymer',        'sulfur',         1,  1, 1),
  ('corrosive',      'venom_gland',    1,  1, 1),
  ('corrosive',      'sulfur',         1,  1, 1),
  ('hexolite',       'chromite',       1,  1, 1),
  ('hexolite',       'hexo_quartz',    1,  1, 1),
  ('cryo_medium',    'aqua_slime',     1,  1, 1),
  ('cryo_medium',    'ice_organ',      1,  1, 1),
  -- 2차 제련
  ('metal_ingot',     'metal_ore',     2,  1, 2),
  ('refined_ingot',   'metal_ore',     2,  1, 2),
  ('refined_ingot',   'coal',          2,  1, 2),
  ('pal_metal_ingot', 'metal_ore',     4,  1, 2),
  ('pal_metal_ingot', 'pure_quartz',   1,  1, 2),
  ('pal_metal_ingot', 'paldium',       2,  1, 2),
  ('coralium_ingot',  'coralium_ore',  2,  1, 2),
  ('coralium_ingot',  'coal',          5,  1, 2),
  ('solite_ingot',    'solite_ore',    2,  1, 2),
  ('solite_ingot',    'pure_quartz',   2,  1, 2),
  ('palkicite_ingot', 'solite_ore',    1,  1, 2),
  ('palkicite_ingot', 'palkicite_ore', 2,  1, 2),
  ('palkicite_ingot', 'sacred_water',  1,  1, 2),
  -- 3차 조립
  ('nail',           'metal_ingot',    1,  1, 3),
  ('plank',          'wood',          10,  1, 3),
  ('plank',          'fiber',          5,  1, 3),
  ('plank',          'nail',           1,  1, 3),
  ('hq_plank',       'hard_wood',     10,  1, 3),
  ('hq_plank',       'wood',          10,  1, 3),
  ('hq_plank',       'hq_cloth',       2,  1, 3),
  ('plastil',        'crude_oil',      2,  1, 3),
  ('plastil',        'metal_ore',      5,  1, 3),
  ('circuit_board',  'pure_quartz',    2,  1, 3),
  ('circuit_board',  'polymer',        1,  1, 3),
  ('bio_battery',    'electric_organ', 1,  1, 3),
  ('bio_battery',    'refined_ingot',  1,  1, 3),
  ('bio_battery',    'carbon_fiber',   1,  1, 3),
  ('superheat_core', 'flame_organ',    4,  1, 3),
  ('superheat_core', 'coal',           8,  1, 3),
  ('superheat_core', 'corrosive',      2,  1, 3),
  ('superheat_core', 'hexolite',       2,  1, 3),
  -- 4차 최종 부품
  ('computer',       'circuit_board',  2,  1, 4),
  ('computer',       'plastil',        3,  1, 4),
  ('computer',       'bio_battery',    2,  1, 4),
  ('computer',       'carbon_fiber',   2,  1, 4),
  ('ai_core',        'computer',       5,  1, 4),
  ('ai_core',        'solite_ingot',  10,  1, 4),
  ('ai_core',        'superheat_core', 2,  1, 4),
  ('ai_core',        'ancient_core',   1,  1, 4);

-- ---------- 건축물 재료 (1대당) ----------

delete from public.pal_structure_costs;

-- 공통 세트 (설계도 4장) — 거점 4곳에 동일하게 적용
insert into public.pal_structure_costs (structure_id, item_id, qty)
select t.key || '_b' || b.id, t.item, t.qty
  from public.pal_bases b
  cross join (values
    ('bed','solite_ingot',10),   ('bed','sacred_water',2),      ('bed','mystic_wood',3),
    ('hotspring','palkicite_ingot',100), ('hotspring','sacred_water',10),
    ('hotspring','superheat_core',20),   ('hotspring','cryo_medium',20),
    ('watchtower','solite_ingot',100),   ('watchtower','ancient_core',5),
    ('clinic','solite_ingot',50), ('clinic','computer',15),
    ('clinic','sacred_water',45), ('clinic','ancient_core',10),
    ('guildchest','refined_ingot',50),   ('guildchest','paldium',100),
    ('guildchest','ancient_part',10),
    ('capacitor','metal_ingot',50),      ('capacitor','electric_organ',20),
    ('capacitor','cryo_medium',5),       ('capacitor','corrosive',5),
    ('coldfeedbox','pal_metal_ingot',20),('coldfeedbox','plastil',20),
    ('coldfeedbox','cryo_medium',15),
    ('feedbox','wood',20),
    ('palbox','paldium',1), ('palbox','wood',8), ('palbox','stone',3)
  ) as t(key, item, qty);

-- 거점별 고유 건축물 (설계도 5~8장의 "총 재료" 를 개수로 나눈 1대당 값)
insert into public.pal_structure_costs (structure_id, item_id, qty) values
  -- ① 화로 2대: 총 코랄리움 200 / 초고열 40 / 컴퓨터 60 / 고대코어 20
  ('furnace_b1','coralium_ingot',100), ('furnace_b1','superheat_core',20),
  ('furnace_b1','computer',30),        ('furnace_b1','ancient_core',10),
  -- ① 작업대 2대: 솔라이트 100 / AI 10 / 바이오 40
  ('workbench_b1','solite_ingot',50),  ('workbench_b1','ai_core',5),
  ('workbench_b1','bio_battery',20),
  -- ① 작업 공장 1대
  ('factory_b1','coralium_ingot',50),  ('factory_b1','hexolite',50),
  ('factory_b1','computer',30),        ('factory_b1','bio_battery',20),
  -- ① 무기 공장 1대
  ('weaponfactory_b1','coralium_ingot',50), ('weaponfactory_b1','superheat_core',10),
  ('weaponfactory_b1','corrosive',30),
  -- ① 고도 문명 상자 8대: 헥소 160 / 카본 160 / 컴퓨터 16
  ('hqbox_b1','hexolite',20), ('hqbox_b1','carbon_fiber',20), ('hqbox_b1','computer',2),
  ('hqbox_b2','hexolite',20), ('hqbox_b2','carbon_fiber',20), ('hqbox_b2','computer',2),
  -- 대형 부엌 1대: 시멘트 200 / 숯 200 / 상급 나무 판자 25 / 극저온 13
  ('bigkitchen_b1','cement',200), ('bigkitchen_b1','charcoal',200),
  ('bigkitchen_b1','hq_plank',25),('bigkitchen_b1','cryo_medium',13),
  ('bigkitchen_b2','cement',200), ('bigkitchen_b2','charcoal',200),
  ('bigkitchen_b2','hq_plank',25),('bigkitchen_b2','cryo_medium',13),
  ('bigkitchen_b4','cement',200), ('bigkitchen_b4','charcoal',200),
  ('bigkitchen_b4','hq_plank',25),('bigkitchen_b4','cryo_medium',13),
  -- 고대 문명 발전기 1대: 팰키사이트 100 / 발전 기관 200 / 고대코어 10
  ('powerplant_b1','palkicite_ingot',100), ('powerplant_b1','electric_organ',200), ('powerplant_b1','ancient_core',10),
  ('powerplant_b2','palkicite_ingot',100), ('powerplant_b2','electric_organ',200), ('powerplant_b2','ancient_core',10),
  ('powerplant_b3','palkicite_ingot',100), ('powerplant_b3','electric_organ',200), ('powerplant_b3','ancient_core',10),
  ('powerplant_b4','palkicite_ingot',100), ('powerplant_b4','electric_organ',200), ('powerplant_b4','ancient_core',10),
  -- ② 물질 생성기 5대: 팰키사이트 250 / 고대코어 50
  ('matter_generator_b2','palkicite_ingot',50), ('matter_generator_b2','ancient_core',10),
  -- ③ 재배기 4대: 팰키 200 / 성수 200 / 신비목재 400 / 코어 40
  ('plantation_b3','palkicite_ingot',50), ('plantation_b3','sacred_water',50),
  ('plantation_b3','mystic_wood',100),    ('plantation_b3','ancient_core',10),
  -- ③ 부엌 1대
  ('kitchen_b3','solite_ingot',80), ('kitchen_b3','superheat_core',30),
  ('kitchen_b3','cryo_medium',50),  ('kitchen_b3','ancient_core',10),
  -- ③ 가축 목장 4대: 목재 120 / 돌 80 / 섬유 120
  ('ranch_b3','wood',30), ('ranch_b3','stone',20), ('ranch_b3','fiber',30),
  -- ③ 제분기 1대
  ('mill_b3','plank',10), ('mill_b3','stone',40), ('mill_b3','metal_ingot',10),
  -- ④ 배합기 3대: 팰키 300 / AI 150 / 고대부품 90 / 코어 60
  ('breeding_b4','palkicite_ingot',100), ('breeding_b4','ai_core',50),
  ('breeding_b4','ancient_part',30),     ('breeding_b4','ancient_core',20),
  -- ④ 원유 추출기(일반형) 1대당: 팰 금속 125 / 전자기판 25 (설계도 8장)
  ('oil_extractor_b4','pal_metal_ingot',125), ('oil_extractor_b4','circuit_board',25);

-- ---------- 선행 관계 ----------

delete from public.pal_structure_unlocks;
insert into public.pal_structure_unlocks (structure_id, item_id) values
  -- 팰키사이트 주괴는 고대 문명 화로에서만 제련된다 (설계도 11장)
  ('furnace_b1', 'palkicite_ingot'),
  -- 컴퓨터·AI 코어는 고도 문명 작업 공장에서 만든다 (설계도 5장)
  ('factory_b1', 'computer'),
  ('factory_b1', 'ai_core');

-- ---------- 팰 (설계도 9장) ----------

insert into public.pal_pals (id, name, aptitudes, nocturnal, foreman, partner, source) values
  -- 알파 세크메트 배합 부모 (풀농축해서 엔트리에 1마리씩)
  ('labradon',     '라브라돈',      '{}', false, null, '알파 세크메트 배합 부모. 풀농축 필요.', null),
  ('spradon',      '스프라돈',      '{}', false, null, '알파 세크메트 배합 부모. 풀농축 필요.', null),
  ('eophwamu',     '업화무',        '{"kindling":8}',                       false, null, null, '세계수 이후'),
  ('senko',        '센코',          '{"kindling":6,"handiwork":6}',         false, null, '불+수작업 겸업', '천양향 필드 보스'),
  ('bulchorong',   '불초롱',        '{"kindling":6,"watering":6}',          false, null, '불+관개 겸업', null),
  ('magmakaiser',  '마그마카이저',  '{"mining":7,"kindling":6}',            false, null, null, null),
  ('binghouger',   '빙호우거',      '{"cooling":8,"lumbering":6,"mining":5}',false, null, null, null),
  ('bingcheonma',  '빙천마',        '{"cooling":7}',                        false, null, null, null),
  ('monochrona',   '모노크로나',    '{"handiwork":8}',                      true,  null, null, null),
  ('dalbomi',      '달보미',        '{"handiwork":6,"medicine":6}',         true,  null, '어둠 속성이라 야행성', '천양향 필드 보스'),
  ('alpha_sekhmet','알파 세크메트', '{"handiwork":6,"mining":6}',           false, null, '작업 속도 400%. 제약이 없어 고대 작업대에는 못 들어간다.', null),
  ('anubis',       '아누비스',      '{"handiwork":6,"mining":6}',           false, null, null, null),
  ('moslon',       '모슬론',        '{"medicine":8}',                       false, null, null, null),
  ('lilin',        '릴린',          '{"planting":7,"gathering":6,"medicine":6}', false, null, null, null),
  ('bloodcatty',   '블러드캐티',    '{"medicine":6}',                       true,  null, null, null),
  ('shellgadra',   '셸가드라',      '{"mining":8}',                         false, null, null, null),
  ('nyangbat',     '냥뱃',          '{"mining":6,"transport":6}',           true,  null, null, null),
  ('noksaju',      '녹사주',        '{"planting":8}',                       true,  null, null, '세계수 레이드'),
  ('plumlin',      '플럼린',        '{"planting":3,"gathering":2}',         false, null, '풀농축 시 수확량 +35%', '천락의 땅'),
  ('beautiflower', '뷰티플라워',    '{"planting":3}',                       false, null, '작물 성장 속도 +70%', '벚꽃섬'),
  ('shaolong',     '샤오롱',        '{"watering":8,"gathering":5}',         false, null, null, null),
  ('shogunbokchi', '쇼군복치',      '{"generating":6,"watering":6}',        false, null, '풀농축하면 관개 6이 되어 재배기까지 잡는다. 농축 3단계에서 멈출 것.', null),
  ('azuribi',      '아주리비',      '{"watering":6}',                       false, null, '관개 전념', null),
  ('jetragon',     '제트래곤',      '{"gathering":8}',                      false, null, null, null),
  ('violeta',      '비오레타',      '{"gathering":6}',                      false, null, '6종 겸업', null),
  ('pullesio',     '풀레시오',      '{"planting":5,"gathering":5}',         false, null, '알 생산 +20%', null),
  ('voljex',       '볼젝스',        '{"generating":8,"transport":4}',       false, null, '불면 필수', null),
  ('raigaruda',    '라이가루다',    '{"generating":6}',                     true,  null, null, null),
  ('cosmodial',    '코스모디얼',    '{"lumbering":8}',                      true,  null, '육성 가치 낮음 — 목재는 구매', null),
  ('magnite',      '마그나이트',    '{"transport":7,"mining":7}',           false, null, null, null),
  ('terranite',    '테라나이트',    '{"transport":7,"mining":7}',           false, null, null, null),
  ('milcow',       '밀카우',        '{"ranch":1}',                          false, null, '우유', null),
  ('bittersheep',  '비터쉽',        '{"ranch":1}',                          false, null, '포만도 감소 -15%. 양털.', null),
  ('candysheep',   '캔디쉽',        '{"ranch":1}',                          false, null, '포만도 감소 -10%. 양털.', null),
  ('lunarin',      '루나린',        '{"handiwork":5}',                      false, null, '책 1권만 먹이면 수작업 6', '벚꽃섬'),
  ('bellaruju',    '벨라루주',      '{"handiwork":6,"medicine":6}',         false, null, '즉시 전력이 필요하면 레이드로 확보', '레이드'),
  -- 작업반장 (배치만 해도 다른 팰의 해당 적성 +1, 중복 불가)
  ('cattywizard',  '캐티위자드',    '{}', false, 'kindling',   '불 피우기 반장', null),
  ('liorine',      '리오리네',      '{}', false, 'watering',   '관개 반장', null),
  ('florina',      '플로리나',      '{}', false, 'planting',   '파종 반장', null),
  ('jjariring',    '짜리링',        '{}', false, 'generating', '발전 반장', null),
  ('pingto',       '핑토',          '{}', false, 'handiwork',  '수작업 반장', null),
  ('brooming',     '브루밍',        '{}', false, 'gathering',  '채집 반장', null),
  ('sanryeong',    '산령사슴',      '{}', false, 'lumbering',  '벌목 반장', null),
  ('nureumbuk',    '누름북',        '{}', false, 'mining',     '채굴 반장', null),
  ('nundaengi',    '눈댕이',        '{}', false, 'cooling',    '냉각 반장', null),
  ('umpo',         '움포',          '{"transport":6}', false, 'transport', '운반 반장', null),
  ('gwiyobi',      '귀요비',        '{}', false, 'ranch',      '목장 반장', null),
  ('musully',      '머슐리',        '{}', false, 'medicine',   '제약 반장', null)
on conflict (id) do update set
  name = excluded.name, aptitudes = excluded.aptitudes, nocturnal = excluded.nocturnal,
  foreman = excluded.foreman, partner = excluded.partner, source = excluded.source;

-- 알파 세크메트는 잡는 게 아니라 배합으로 양산한다.
-- 라브라돈·스프라돈을 풀농축해 엔트리에 1마리씩 넣어두고 알을 줍는 방식이라,
-- "세크메트 13마리 포획"이 아니라 "부모 2마리 풀농축"이 먼저 떠야 한다.
update public.pal_pals
   set breed_from = '{labradon,spradon}',
       breed_note = '라브라돈·스프라돈을 풀농축해 엔트리에 1마리씩 넣고 알을 줍는다'
 where id = 'alpha_sekhmet';

-- ---------- 팰 배치 (설계도 5~8장) ----------

delete from public.pal_assignments;
insert into public.pal_assignments (base_id, role, count, pal_ids, sort, note) values
  -- ① 메인 (합계 20)
  (1, '불 피우기 6+ (화로)',        2, '{senko,eophwamu}', 10, '세계수 이후 업화무로 교체'),
  (1, '냉각 6+ (화로)',             2, '{bingcheonma,binghouger}', 20, null),
  (1, '수작업 6+ (고대 작업대)',    2, '{dalbomi,lunarin}', 30, '알파 세크메트는 제약이 없어 여기엔 못 들어간다'),
  (1, '제약 6+ (고대 작업대)',      2, '{dalbomi,moslon}', 40, null),
  (1, '수작업 (작업 공장, 4자리)',  4, '{alpha_sekhmet}', 50, '작업 속도 400%. 모노크로나 대신 알파 세크메트로 통일.'),
  (1, '수작업 (무기 공장, 4자리)',  4, '{alpha_sekhmet,anubis}', 60, '알파 세크메트 우선, 모자라면 아누비스'),
  (1, '발전 6+',                    1, '{shogunbokchi}', 70, null),
  (1, '관개',                       1, '{bulchorong}', 80, null),
  (1, '운반',                       1, '{magnite}', 90, '산출물이 쌓이면 ②의 운반 팰을 잠깐 빌려온다'),
  (1, '반장',                       1, '{pingto}', 100, '공장 8자리를 전부 강화하므로 여기가 가장 이득'),
  -- ② 자원 (합계 20)
  (2, '물질 생성기 (5대 × 1마리)',  5, '{alpha_sekhmet,shellgadra}', 10, '채굴 6 필요'),
  (2, '대형 부엌 (불 피우기)',      1, '{magmakaiser}', 20, null),
  (2, '발전 6+',                    2, '{shogunbokchi}', 30, null),
  (2, '관개',                       1, '{bulchorong}', 40, null),
  (2, '운반',                       4, '{magnite,terranite,nyangbat}', 50, null),
  (2, '반장',                       3, '{nureumbuk,umpo,pingto}', 60, null),
  (2, '교대 예비',                  4, '{}', 70, '야행성 개체'),
  -- ③ 농사 (합계 20)
  (3, '파종 6+',                    4, '{plumlin,beautiflower,noksaju}', 10, '플럼린·뷰티플라워는 농축 + 응용학 책 투자 필요'),
  (3, '채집 6+',                    3, '{jetragon,lilin}', 20, null),
  (3, '관개 6+ (재배기·부엌 순회)', 2, '{bulchorong}', 30, null),
  (3, '부엌 (불 6 + 수작업 6)',     2, '{bulchorong}', 40, '수작업은 농사 팰이 비는 시간에 겸업'),
  (3, '목장',                       4, '{milcow,bittersheep,candysheep}', 50, null),
  (3, '발전 6+',                    2, '{shogunbokchi}', 60, '농축은 3단계에서 멈출 것 — 풀농축하면 관개 6이 되어 재배기까지 잡는다'),
  (3, '반장',                       3, '{florina,liorine,gwiyobi}', 70, null),
  -- ④ 배합·원유 (합계 20)
  (4, '배합 부모 (3대 × 암수)',     6, '{}', 10, '목표 조합에 맞춰 교체'),
  (4, '발전 6+',                    4, '{shogunbokchi,voljex}', 20, '불면 필수'),
  (4, '관개',                       2, '{bulchorong,shaolong}', 30, null),
  (4, '운반',                       2, '{umpo}', 40, null),
  (4, '반장',                       1, '{jjariring}', 50, null),
  (4, '교대 예비',                  5, '{}', 60, '배합 대기 개체');

-- ---------- 재고 행 확보 (모든 아이템에 0 행을 만들어 둔다) ----------

insert into public.pal_inventory (item_id, qty)
select id, 0 from public.pal_items
on conflict (item_id) do nothing;

-- ---------- 건설 진행도 행 확보 (없어진 건축물 행은 정리) ----------

delete from public.pal_checklist where kind = 'build'
  and ref_id not in (select id from public.pal_structures);

insert into public.pal_checklist (kind, ref_id, built)
select 'build', id, 0 from public.pal_structures
on conflict (kind, ref_id) do nothing;
