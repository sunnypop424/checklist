/**
 * 팰월드 트래커 계산 엔진.
 *
 * 핵심 원칙 두 가지:
 *  1. 재고를 먼저 차감하고 하위 전개한다 (컴퓨터를 300개 갖고 있으면 그만큼은 안 만든다).
 *  2. stock 은 반드시 복사본을 쓴다. 원본을 깎으면 재계산할 때마다 값이 어긋난다.
 */

import type {
  Assignment,
  BuildTask,
  BuiltMap,
  CraftLine,
  ChecklistLine,
  ExpandOut,
  FarmItemLine,
  FarmSource,
  FarmTask,
  Inventory,
  PalBase,
  PalData,
  PalCatchLine,
  PalItem,
  PalNeed,
  PalPlan,
  ProductionLine,
  AptitudeNeed,
  PalRoster,
  OwnedPals,
  PalMon,
  Recipe,
  RecipeMap,
  Structure,
} from './types';

// ─────────────────────────────────────────────────────────────
// 인덱스
// ─────────────────────────────────────────────────────────────

export function buildRecipeMap(data: PalData): RecipeMap {
  const map: RecipeMap = {};
  for (const r of data.recipes) {
    const cur =
      map[r.output_id] ??
      (map[r.output_id] = { outputId: r.output_id, yield: r.yield || 1, tier: r.tier, inputs: [] });
    // yield/tier 는 행마다 같아야 하지만, 데이터 탭에서 한 행만 고쳤을 수도 있어 최대값을 쓴다
    cur.yield = Math.max(cur.yield, r.yield || 1);
    cur.tier = Math.max(cur.tier, r.tier);
    cur.inputs.push({ id: r.input_id, qty: r.qty });
  }
  return map;
}

export function byId<T extends { id: string }>(rows: T[]): Record<string, T> {
  const map: Record<string, T> = {};
  for (const r of rows) map[r.id] = r;
  return map;
}

// ─────────────────────────────────────────────────────────────
// BOM 전개
// ─────────────────────────────────────────────────────────────

export function emptyOut(): ExpandOut {
  return { leaf: {}, craft: {} };
}

/**
 * itemId 를 qty 만큼 확보하는 데 필요한 것을 out 에 누적한다.
 *
 * ⚠ stock 을 직접 깎는다. 호출자가 복사본을 넘겨야 한다.
 */
export function expand(
  recipes: RecipeMap,
  itemId: string,
  qty: number,
  stock: Inventory,
  out: ExpandOut,
  seen: ReadonlySet<string> = new Set()
): void {
  if (!(qty > 0)) return;
  if (seen.has(itemId)) {
    throw new Error(`레시피 순환 참조: ${[...seen, itemId].join(' → ')}`);
  }

  // 재고 선차감 — 갖고 있는 만큼은 하위 전개를 하지 않는다
  const have = Math.min(stock[itemId] ?? 0, qty);
  if (have > 0) stock[itemId] = (stock[itemId] ?? 0) - have;

  const need = qty - have;
  if (!(need > 0)) return;

  const recipe = recipes[itemId];
  if (!recipe) {
    // 레시피가 없다 = 최하위 재료. 파밍으로 모아야 한다.
    out.leaf[itemId] = (out.leaf[itemId] ?? 0) + need;
    return;
  }

  const batches = Math.ceil(need / (recipe.yield || 1));
  out.craft[itemId] = (out.craft[itemId] ?? 0) + batches;

  const nextSeen = new Set(seen).add(itemId);
  for (const ing of recipe.inputs) {
    expand(recipes, ing.id, ing.qty * batches, stock, out, nextSeen);
  }
}

/** 아직 안 지은 개수 */
export function remainingOf(s: Structure, built: BuiltMap): number {
  return Math.max(0, s.count - (built[s.id] ?? 0));
}

/**
 * 미완성 건축물 전부를 한 번에 전개한 총 부족량.
 *
 * 재고 사본을 **하나만** 써서 전부를 훑는다. 건축물마다 사본을 새로 뜨면
 * 같은 재고가 여러 건축물에 중복으로 쓰인 것처럼 계산돼 부족량이 과소평가된다.
 */
export function totalShortage(
  data: PalData,
  recipes: RecipeMap,
  stock: Inventory,
  built: BuiltMap
): ExpandOut {
  const copy: Inventory = { ...stock };
  const out = emptyOut();
  const costsByStructure = groupCosts(data);

  // build_order → unlock_score 순으로 전개해야 재고가 중요한 것부터 소모된다
  const targets = [...data.structures].sort(
    (a, b) => (a.build_order ?? 99) - (b.build_order ?? 99) || b.unlock_score - a.unlock_score
  );

  for (const s of targets) {
    const remaining = remainingOf(s, built);
    if (remaining <= 0) continue;
    for (const c of costsByStructure[s.id] ?? []) {
      expand(recipes, c.item_id, c.qty * remaining, copy, out);
    }
  }
  return out;
}

function groupCosts(data: PalData): Record<string, { item_id: string; qty: number }[]> {
  const map: Record<string, { item_id: string; qty: number }[]> = {};
  for (const c of data.costs) {
    (map[c.structure_id] ??= []).push({ item_id: c.item_id, qty: c.qty });
  }
  return map;
}

/**
 * 재료별로 "이 재료 때문에 못 짓는 건축물들의 unlock_score 합".
 *
 * 여기서는 건축물마다 원본 재고 사본을 새로 쓴다 — 총량이 아니라
 * "이 건축물 하나만 놓고 봤을 때 무엇이 모자라나"를 묻는 것이기 때문이다.
 */
export function blockScores(
  data: PalData,
  recipes: RecipeMap,
  stock: Inventory,
  built: BuiltMap
): Record<string, number> {
  const scores: Record<string, number> = {};
  const costsByStructure = groupCosts(data);

  for (const s of data.structures) {
    const remaining = remainingOf(s, built);
    if (remaining <= 0) continue;
    const copy: Inventory = { ...stock };
    const out = emptyOut();
    for (const c of costsByStructure[s.id] ?? []) {
      expand(recipes, c.item_id, c.qty * remaining, copy, out);
    }
    for (const id of Object.keys(out.leaf)) {
      scores[id] = (scores[id] ?? 0) + s.unlock_score;
    }
  }
  return scores;
}

// ─────────────────────────────────────────────────────────────
// 파밍 작업
// ─────────────────────────────────────────────────────────────

/**
 * 자동 획득처가 실제로 생산 중인가.
 *
 * "지었다" 가 아니라 "돌아간다" 가 기준이다 — 시설만 세워두고 팰을 안 넣으면
 * 재료는 한 개도 안 늘어난다. operational 집합을 밖에서 넘겨받는다.
 */
function sourceUnlocked(src: FarmSource, built: BuiltMap, operational?: Set<string>): boolean {
  if (src.method !== 'auto' || !src.requires_structure) return true;
  if (operational) return operational.has(src.requires_structure);
  return (built[src.requires_structure] ?? 0) >= 1;
}

/**
 * 파밍 작업은 세 층으로 나뉜다. 층이 다르면 세부 점수와 무관하게 순서가 정해진다.
 *
 * 한 점수식에 전부 밀어넣지 않는 이유: 획득처마다 품목 수가 1개~12개로 달라서
 * 품목별 점수를 합산하면 "품목이 많다"는 것만으로 순위가 올라간다.
 * 물질 생성기(12종)가 화염 팰 사냥(1종)을 항상 이기는데, 설계도 16-5 는
 * 정반대로 수동 사냥이 진짜 병목이라고 못박고 있다.
 */
const TIER_LOCKED = 2000; // 자동인데 시설이 없다 → 파밍이 아니라 그 건설이 먼저다
const TIER_MANUAL = 1000; // 수동 파밍 — 직접 나가야 진행된다 (설계도 16-5)
const TIER_AUTO = 0; //     시설이 돌고 있으면 시간이 해결한다

export function farmTasks(
  data: PalData,
  recipes: RecipeMap,
  stock: Inventory,
  built: BuiltMap,
  shortage?: ExpandOut,
  operational?: Set<string>
): FarmTask[] {
  const short = shortage ?? totalShortage(data, recipes, stock, built);
  const blocked = blockScores(data, recipes, stock, built);
  const items = byId(data.items);
  const structures = byId(data.structures);

  // 부족한 최하위 재료를 획득처로 묶는다
  const grouped: Record<string, FarmItemLine[]> = {};
  for (const [id, shortQty] of Object.entries(short.leaf)) {
    if (!(shortQty > 0)) continue;
    const item = items[id];
    const srcId = item?.source_id ?? '__unknown';
    const have = stock[id] ?? 0;
    const need = have + shortQty;
    (grouped[srcId] ??= []).push({
      id,
      name: item?.name ?? id,
      have,
      need,
      short: shortQty,
      progress: need > 0 ? have / need : 1,
    });
  }

  const tasks: FarmTask[] = [];
  for (const [srcId, lines] of Object.entries(grouped)) {
    const source =
      data.sources.find((s) => s.id === srcId) ??
      ({
        id: srcId,
        name: '출처 미지정',
        method: 'manual',
        place: null,
        sort: 999,
        note: null,
        requires_structure: null,
      } as FarmSource);

    lines.sort((a, b) => b.short - a.short);

    // 품목별 진행률의 평균 — 수량 규모가 12종에 걸쳐 100배씩 차이 나서
    // 총합 비율로 재면 금속 광석 하나가 획득처 전체를 대표해버린다
    const progress = lines.reduce((sum, l) => sum + l.progress, 0) / lines.length;

    const unlocked = sourceUnlocked(source, built, operational);
    const lockedBy = unlocked ? null : (structures[source.requires_structure ?? ''] ?? null);

    // 합이 아니라 최댓값. 품목이 많다는 이유로 점수가 오르면 안 된다.
    const blockScore = lines.reduce((max, l) => Math.max(max, blocked[l.id] ?? 0), 0);

    const tier = !unlocked ? TIER_LOCKED : source.method === 'manual' ? TIER_MANUAL : TIER_AUTO;

    tasks.push({
      source,
      items: lines,
      progress,
      lockedBy,
      // 같은 층 안에서는 "많은 걸 막고 있는 것" → "덜 채워진 것" 순
      score: tier + blockScore / 10 + (1 - progress) * 10,
    });
  }

  tasks.sort((a, b) => b.score - a.score || a.source.sort - b.source.sort);
  return tasks;
}

// ─────────────────────────────────────────────────────────────
// 건설 작업
// ─────────────────────────────────────────────────────────────

/**
 * 이 건축물을 지으려면 먼저 있어야 하는 시설.
 * pal_structure_unlocks 에 걸린 아이템이 BOM 에 들어 있는데
 * 그 아이템을 푸는 시설이 아직 없으면 막힌 것이다.
 */
function findBlocker(
  structure: Structure,
  needed: Set<string>,
  data: PalData,
  built: BuiltMap,
  structures: Record<string, Structure>
): Structure | null {
  for (const u of data.unlocks) {
    if (u.structure_id === structure.id) continue; // 자기 자신은 선행이 아니다
    if (!needed.has(u.item_id)) continue;
    if ((built[u.structure_id] ?? 0) >= 1) continue;
    const blocker = structures[u.structure_id];
    if (blocker) return blocker;
  }
  return null;
}

/** BOM 전개 과정에서 등장한 모든 아이템 (중간재 포함) */
function touchedItems(recipes: RecipeMap, rootIds: string[]): Set<string> {
  const seen = new Set<string>();
  const walk = (id: string, path: ReadonlySet<string>) => {
    if (seen.has(id) || path.has(id)) return;
    seen.add(id);
    const r = recipes[id];
    if (!r) return;
    const next = new Set(path).add(id);
    for (const ing of r.inputs) walk(ing.id, next);
  };
  for (const id of rootIds) walk(id, new Set());
  return seen;
}

export function buildTasks(
  data: PalData,
  recipes: RecipeMap,
  stock: Inventory,
  built: BuiltMap
): BuildTask[] {
  const items = byId(data.items);
  const structures = byId(data.structures);
  const bases: Record<number, PalBase> = {};
  for (const b of data.bases) bases[b.id] = b;
  const costsByStructure = groupCosts(data);

  const tasks: BuildTask[] = [];

  for (const s of data.structures) {
    const remaining = remainingOf(s, built);
    const costs = costsByStructure[s.id] ?? [];
    if (costs.length === 0) continue;

    // "1대를 더 지을 수 있나" 를 묻는다. 재고 사본은 이 건축물 전용.
    const copy: Inventory = { ...stock };
    const out = emptyOut();
    if (remaining > 0) {
      for (const c of costs) expand(recipes, c.item_id, c.qty, copy, out);
    }

    const toLines = (o: ExpandOut) =>
      Object.entries(o.leaf)
        .filter(([, n]) => n > 0)
        .map(([id, n]) => ({ id, name: items[id]?.name ?? id, short: n }))
        .sort((a, b) => b.short - a.short);

    const missing = toLines(out);

    // 남은 대수 전부를 짓는 데 필요한 양. "5대 지어라" 라고만 하고
    // 5대분 재료를 안 알려주면 뭘 캐야 할지 알 수 없다.
    const copyAll: Inventory = { ...stock };
    const outAll = emptyOut();
    if (remaining > 0) {
      for (const c of costs) expand(recipes, c.item_id, c.qty * remaining, copyAll, outAll);
    }
    const missingAll = toLines(outAll);

    // 완성근접도: 1대분 재료 중 몇 %가 이미 있는가
    const totalCost = costs.reduce((sum, c) => sum + c.qty, 0);
    const missingCost = missing.reduce((sum, m) => sum + m.short, 0);
    const nearness = totalCost > 0 ? Math.max(0, 1 - missingCost / totalCost) : 1;

    const needed = touchedItems(
      recipes,
      costs.map((c) => c.item_id)
    );
    const blockedBy = findBlocker(s, needed, data, built, structures);
    const base = s.base_id != null ? (bases[s.base_id] ?? null) : null;
    const ready = remaining > 0 && missing.length === 0 && !blockedBy;

    tasks.push({
      structure: s,
      base,
      built: built[s.id] ?? 0,
      remaining,
      missing,
      missingAll,
      ready,
      blockedBy,
      progress: s.count > 0 ? (built[s.id] ?? 0) / s.count : 1,
      score:
        s.unlock_score * 3 +
        (base?.weight ?? 1) * 2 +
        nearness * 10 -
        (blockedBy ? 999 : 0) -
        (remaining <= 0 ? 9999 : 0),
    });
  }

  tasks.sort((a, b) => b.score - a.score);
  return tasks;
}

// ─────────────────────────────────────────────────────────────
// 생산 라인 — 시설 + 팰 + 전력
// ─────────────────────────────────────────────────────────────

/** 적성 코드 → 한국어 (설계도 9장 표기) */
export const WORK_LABELS: Record<string, string> = {
  kindling: '불 피우기',
  cooling: '냉각',
  handiwork: '수작업',
  medicine: '제약',
  mining: '채굴',
  planting: '파종',
  watering: '관개',
  gathering: '채집',
  generating: '발전',
  lumbering: '벌목',
  transport: '운반',
  ranch: '목장',
};

/** 이 적성을 lv 이상으로 가진 보유 팰 마릿수 */
function countAble(pals: PalMon[], owned: OwnedPals, work: string, lv: number): number {
  return pals
    .filter((p) => (p.aptitudes?.[work] ?? 0) >= lv)
    .reduce((sum, p) => sum + (owned[p.id] ?? 0), 0);
}

/** 이 적성을 만족하는 추천 팰 (아직 없을 때 뭘 잡을지) */
function ableCandidates(pals: PalMon[], work: string, lv: number): PalMon[] {
  return pals
    .filter((p) => (p.aptitudes?.[work] ?? 0) >= lv)
    .sort((a, b) => (b.aptitudes[work] ?? 0) - (a.aptitudes[work] ?? 0))
    .slice(0, 3);
}

/**
 * 생산 라인 목록. 설계도 12장 건설 순서대로 정렬한다.
 *
 * "지었다" 가 아니라 "돌아간다" 를 기준으로 삼는 게 핵심이다.
 * 물질 생성기를 지어도 채굴 6 팰이 없으면 광석은 한 개도 안 나온다.
 */
export function productionLines(
  data: PalData,
  recipes: RecipeMap,
  stock: Inventory,
  built: BuiltMap,
  roster: PalRoster | undefined,
  owned: OwnedPals
): ProductionLine[] {
  const pals = roster?.pals ?? [];
  const items = byId(data.items);
  const bases: Record<number, PalBase> = {};
  for (const b of data.bases) bases[b.id] = b;
  const costsByStructure = groupCosts(data);

  // 거점별 발전기가 돌아가는지 — 전력을 먹는 시설의 선행이다
  const powerOkByBase: Record<number, boolean> = {};
  for (const s of data.structures) {
    if (!/^powerplant_/.test(s.id) || s.base_id == null) continue;
    const reqs = s.req_aptitude ?? [];
    const ok =
      (built[s.id] ?? 0) >= 1 && reqs.every((r) => countAble(pals, owned, r.work, r.lv) >= 1);
    powerOkByBase[s.base_id] = powerOkByBase[s.base_id] || ok;
  }

  // 시설 → 그 시설이 열어주는 획득처
  const sourceOf: Record<string, FarmSource> = {};
  for (const src of data.sources) {
    if (src.requires_structure) sourceOf[src.requires_structure] = src;
  }

  // 팰이나 전력을 요구하는 시설, 또는 획득처를 여는 시설만 "라인" 으로 본다.
  // 침대·상자까지 라인으로 세면 목록이 의미를 잃는다.
  const relevant = data.structures.filter(
    (s) => (s.req_aptitude?.length ?? 0) > 0 || (s.power ?? 0) > 0 || sourceOf[s.id]
  );

  const lines = relevant.map((s): ProductionLine => {
    const nBuilt = built[s.id] ?? 0;

    // 1대를 더 짓는 데 부족한 재료
    const copy: Inventory = { ...stock };
    const out = emptyOut();
    if (nBuilt < s.count) {
      for (const c of costsByStructure[s.id] ?? []) expand(recipes, c.item_id, c.qty, copy, out);
    }
    const missingMaterials = Object.entries(out.leaf)
      .filter(([, n]) => n > 0)
      .map(([id, n]) => ({ id, name: items[id]?.name ?? id, short: n }))
      .sort((a, b) => b.short - a.short);

    const aptitudes: AptitudeNeed[] = (s.req_aptitude ?? []).map((r) => {
      const have = countAble(pals, owned, r.work, r.lv);
      return {
        work: r.work,
        label: WORK_LABELS[r.work] ?? r.work,
        lv: r.lv,
        have,
        ok: have >= 1,
        candidates: ableCandidates(pals, r.work, r.lv),
      };
    });

    const needsPower = (s.power ?? 0) > 0;
    const powerOk = !needsPower || (s.base_id != null && powerOkByBase[s.base_id] === true);
    const palsOk = aptitudes.every((a) => a.ok);
    const operational = nBuilt >= 1 && palsOk && powerOk;

    const blocker: ProductionLine['blocker'] = operational
      ? null
      : nBuilt < 1
        ? missingMaterials.length > 0
          ? '재료'
          : '건설'
        : !powerOk
          ? '전력'
          : '팰';

    return {
      structure: s,
      base: s.base_id != null ? (bases[s.base_id] ?? null) : null,
      source: sourceOf[s.id] ?? null,
      built: nBuilt,
      missingMaterials,
      aptitudes,
      needsPower,
      powerOk,
      operational,
      blocker,
    };
  });

  // 설계도 12장 순서 → 같은 순서 안에서는 해금 영향이 큰 것부터
  lines.sort(
    (a, b) =>
      (a.structure.build_order ?? 99) - (b.structure.build_order ?? 99) ||
      b.structure.unlock_score - a.structure.unlock_score
  );
  return lines;
}

// ─────────────────────────────────────────────────────────────
// 단계 (설계도 12장 건설 순서)
// ─────────────────────────────────────────────────────────────

/**
 * 아직 안 끝난 가장 앞 단계의 건축물들.
 *
 * 자동 획득처를 막고 있는 시설은 build_order 와 무관하게 항상 포함한다 —
 * 그게 안 지어지면 그 단계 재료 자체를 모을 수가 없다.
 */
export function stageStructures(data: PalData, built: BuiltMap): { order: number; structures: Structure[] } {
  const pending = data.structures.filter((s) => remainingOf(s, built) > 0);
  if (pending.length === 0) return { order: 0, structures: [] };

  const order = Math.min(...pending.map((s) => s.build_order ?? 99));
  const inStage = pending.filter((s) => (s.build_order ?? 99) === order);

  // 파밍을 막고 있는 선행 시설은 순서를 앞당겨서라도 같이 넣는다
  const blockerIds = new Set(
    data.sources
      .filter((src) => src.method === 'auto' && src.requires_structure)
      .filter((src) => (built[src.requires_structure!] ?? 0) < 1)
      .map((src) => src.requires_structure!)
  );
  for (const s of pending) {
    if (blockerIds.has(s.id) && !inStage.includes(s)) inStage.push(s);
  }

  return { order, structures: inStage };
}

/** 특정 건축물 집합만 놓고 본 부족량 */
export function shortageFor(
  data: PalData,
  recipes: RecipeMap,
  stock: Inventory,
  built: BuiltMap,
  structures: Structure[]
): ExpandOut {
  const copy: Inventory = { ...stock };
  const out = emptyOut();
  const costsByStructure = groupCosts(data);

  for (const s of structures) {
    const remaining = remainingOf(s, built);
    if (remaining <= 0) continue;
    for (const c of costsByStructure[s.id] ?? []) {
      expand(recipes, c.item_id, c.qty * remaining, copy, out);
    }
  }
  return out;
}

// ─────────────────────────────────────────────────────────────
// 제작 순서
// ─────────────────────────────────────────────────────────────

export function craftPlan(
  data: PalData,
  recipes: RecipeMap,
  stock: Inventory,
  shortage: ExpandOut
): CraftLine[] {
  const items = byId(data.items);
  const lines: CraftLine[] = [];

  for (const [id, batches] of Object.entries(shortage.craft)) {
    if (!(batches > 0)) continue;
    const recipe = recipes[id];
    const item = items[id];
    if (!recipe || !item) continue;

    const inputs = recipe.inputs.map((ing) => {
      const have = stock[ing.id] ?? 0;
      const qty = ing.qty * batches;
      return {
        id: ing.id,
        name: items[ing.id]?.name ?? ing.id,
        qty,
        have,
        short: Math.max(0, qty - have),
      };
    });

    lines.push({
      item,
      tier: recipe.tier,
      batches,
      have: stock[id] ?? 0,
      inputs,
      ready: inputs.every((i) => i.short === 0),
    });
  }

  // 1차 가공 → 제련 → 조립 → 최종 부품 순
  lines.sort((a, b) => a.tier - b.tier || b.batches - a.batches);
  return lines;
}

// ─────────────────────────────────────────────────────────────
// 팰 배치 — 어떤 팰을 몇 마리 더 잡아야 하는가
// ─────────────────────────────────────────────────────────────

/**
 * 배치표의 각 자리를 보유 팰로 채워 본다.
 *
 * 한 자리는 "추천 팰 중 아무거나 N마리"를 뜻하고, 팰 한 마리는 한 자리에만
 * 들어갈 수 있다. 그래서 단순히 자리마다 보유 수를 비교하면 안 되고
 * 거점 가중치가 높은 쪽부터 실제로 배정해 나가야 한다.
 */
export function palNeeds(roster: PalRoster, bases: PalBase[], owned: OwnedPals): PalNeed[] {
  const palById = byId(roster.pals);
  const baseById: Record<number, PalBase> = {};
  for (const b of bases) baseById[b.id] = b;

  // 남은 보유 마릿수 — 배정하면서 깎는다 (⚠ 복사본)
  const pool: OwnedPals = { ...owned };

  const ordered = [...roster.assignments].sort(
    (a, b) =>
      (baseById[b.base_id]?.weight ?? 0) - (baseById[a.base_id]?.weight ?? 0) ||
      a.base_id - b.base_id ||
      a.sort - b.sort
  );

  const needs: PalNeed[] = [];
  for (const a of ordered) {
    const candidates = a.pal_ids.map((id) => palById[id]).filter(Boolean);
    let filled = 0;

    for (const c of candidates) {
      if (filled >= a.count) break;
      const take = Math.min(pool[c.id] ?? 0, a.count - filled);
      if (take > 0) {
        pool[c.id] = (pool[c.id] ?? 0) - take;
        filled += take;
      }
    }

    const short = Math.max(0, a.count - filled);
    // 후보가 없는 자리(배합 부모·교대 예비)는 잡을 대상을 특정할 수 없다
    const toCatch = short > 0 ? candidates.filter((c) => (owned[c.id] ?? 0) === 0) : [];

    needs.push({
      base: baseById[a.base_id],
      assignment: a,
      candidates,
      filled,
      need: a.count,
      short,
      toCatch: toCatch.length > 0 ? toCatch : candidates,
    });
  }

  needs.sort(
    (a, b) => a.base.id - b.base.id || a.assignment.sort - b.assignment.sort
  );
  return needs;
}

/**
 * 자리별 부족을 팰 종류별로 뒤집어 "확보해야 할 목록" 으로 만든다.
 *
 * 배합으로 얻는 팰은 선행이 두 종류라 섞으면 안 된다.
 *   breed_from     — 배합기에 실제로 넣는 부모 (알파 세크메트는 세크메트끼리)
 *   breed_requires — 배합기에 넣는 게 아니라 소지만 하면 되는 조건 팰
 *                    (라브라돈·스프라돈 풀농축 2마리 → 알파 100%)
 * 둘 다 없으면 자식 13마리를 띄우는 게 아니라 선행 확보를 먼저 띄운다.
 */
export function palCatchList(
  needs: PalNeed[],
  owned: OwnedPals,
  pals: PalMon[] = []
): PalCatchLine[] {
  const palById = byId(pals);
  const byPal = new Map<string, PalCatchLine>();
  const has = (id: string) => (owned[id] ?? 0) >= 1;
  const lookup = (ids: string[] | undefined) => (ids ?? []).map((id) => palById[id]).filter(Boolean);

  for (const n of needs) {
    if (n.short <= 0 || n.toCatch.length === 0) continue;
    // 후보가 여럿이면 첫 번째(=설계도의 최상위 추천)를 대표로 센다.
    // 전부 세면 "확보해야 할 팰"이 실제 필요보다 몇 배로 부풀어 오른다.
    const primary = n.toCatch[0];
    const parents = lookup(primary.breed_from);
    const conditions = lookup(primary.breed_requires);
    const cur = byPal.get(primary.id) ?? {
      pal: primary,
      owned: owned[primary.id] ?? 0,
      roles: [],
      short: 0,
      via: parents.length > 0 ? ('breed' as const) : ('catch' as const),
      missingParents: parents.filter((p) => !has(p.id)),
      missingConditions: conditions.filter((p) => !has(p.id)),
      note: primary.breed_note ?? null,
    };
    cur.short += n.short;
    cur.roles.push({ baseName: n.base?.name ?? '', role: n.assignment.role });
    byPal.set(primary.id, cur);
  }

  const lines = [...byPal.values()];

  // 선행(부모·조건)은 자식보다 먼저 확보해야 하므로 별도 줄로 앞에 세운다.
  // 부모는 배합기 자리만큼, 조건 팰은 1마리만 있으면 된다.
  const preLines = new Map<string, PalCatchLine>();
  const addPre = (parent: PalMon, childName: string, kind: '배합 부모' | '소지 조건', count: number) => {
    const exist = preLines.get(parent.id);
    if (exist) {
      exist.roles.push({ baseName: '', role: `${childName} ${kind}` });
      exist.short = Math.max(exist.short, count);
      return;
    }
    preLines.set(parent.id, {
      pal: parent,
      owned: owned[parent.id] ?? 0,
      roles: [{ baseName: '', role: `${childName} ${kind}` }],
      short: count,
      via: 'catch',
      missingParents: [],
      missingConditions: [],
      note: parent.partner ?? null,
    });
  };

  for (const line of lines) {
    // 동종 배합이면 암수 2마리가 필요하다
    for (const parent of line.missingParents) {
      addPre(parent, line.pal.name, '배합 부모', line.missingParents.length === 1 ? 2 : 1);
    }
    for (const cond of line.missingConditions) {
      addPre(cond, line.pal.name, '소지 조건', 1);
    }
  }

  const rest = lines.sort((a, b) => b.short - a.short || a.pal.name.localeCompare(b.pal.name));
  return [...preLines.values(), ...rest];
}

// ─────────────────────────────────────────────────────────────
// 전체 계획
// ─────────────────────────────────────────────────────────────

export function plan(
  data: PalData,
  stock: Inventory,
  built: BuiltMap,
  roster?: PalRoster,
  owned: OwnedPals = {}
): PalPlan {
  const recipes = buildRecipeMap(data);

  // 생산 라인을 먼저 푼다 — 파밍 해금 판정이 "가동 중" 인지에 달려 있다
  const lines = productionLines(data, recipes, stock, built, roster, owned);
  const operational = new Set(lines.filter((l) => l.operational).map((l) => l.structure.id));
  const currentLine = lines.find((l) => !l.operational) ?? null;

  const shortage = totalShortage(data, recipes, stock, built);
  const farm = farmTasks(data, recipes, stock, built, shortage, operational);
  const build = buildTasks(data, recipes, stock, built);
  const craft = craftPlan(data, recipes, stock, shortage);

  // 지금 단계만 놓고 본 부족량. 할 일 탭과 오버레이는 이쪽을 쓴다.
  const { order, structures: stageStructs } = stageStructures(data, built);
  const stageShortage = shortageFor(data, recipes, stock, built, stageStructs);
  const stageFarm = farmTasks(data, recipes, stock, built, stageShortage, operational);
  const stageLines = stageFarm.flatMap((t) => t.items);
  const stage = {
    order,
    structures: stageStructs,
    shortage: stageShortage,
    farm: stageFarm,
    progress:
      stageLines.length > 0
        ? stageLines.reduce((sum, l) => sum + l.progress, 0) / stageLines.length
        : 1,
  };

  const needs = roster ? palNeeds(roster, data.bases, owned) : [];
  const palCatches = palCatchList(needs, owned, roster?.pals ?? []);

  const allLines = farm.flatMap((t) => t.items);
  const overall =
    allLines.length > 0
      ? allLines.reduce((sum, l) => sum + l.progress, 0) / allLines.length
      : 1;

  const slots = needs.reduce((sum, n) => sum + n.need, 0);
  const filled = needs.reduce((sum, n) => sum + n.filled, 0);
  const palOverall = slots > 0 ? filled / slots : 1;

  const bottlenecks = [...allLines].sort((a, b) => b.short - a.short).slice(0, 5);

  // 사냥·원정은 시설과 무관하게 언제든 병렬로 할 수 있다.
  // 생산 라인(시설을 갖춰가며 순서대로 여는 것)과 성격이 전혀 다르므로 따로 뽑는다.
  const manualFarm = stageFarm.filter((t) => t.source.method === 'manual');

  return {
    farm,
    stage,
    lines,
    currentLine,
    manualFarm,
    build,
    craft,
    palNeeds: needs,
    palCatches,
    overall,
    palOverall,
    shortage,
    bottlenecks,
  };
}

// ─────────────────────────────────────────────────────────────
// 체크리스트로 내보내기 (기획서 8-3)
// ─────────────────────────────────────────────────────────────

const nf = new Intl.NumberFormat('ko-KR');

export type ChecklistOptions = {
  /** 상위 몇 개까지 내보낼지 */
  limit?: number;
  /** false 면 "발화 기관 2,140/6,598" 대신 "발화 기관 32%" 로 내보낸다 */
  showTotals?: boolean;
  /**
   * 'focus' — 지금 할 것 하나에 집중. 획득처가 12개라 전부 띄우면 방송 화면이
   *           목록으로 가득 차고 "뭘 해야 하는지"가 안 보인다. 기본값.
   * 'full'  — limit 까지 꽉 채운다.
   */
  mode?: 'focus' | 'full';
};

/**
 * 집중 모드에서 각 구간이 차지할 최대 줄 수.
 * 파밍이 가장 많은 자리를 갖는다 — 시간의 대부분이 여기 들어가고,
 * 건설은 재료가 모이면 자동으로 따라오기 때문이다.
 */
const FOCUS_CAPS = { farm: 3, locked: 1, ready: 1, pal: 1 };

export function toChecklist(p: PalPlan, opts: ChecklistOptions = {}): ChecklistLine[] {
  const focus = opts.mode !== 'full';
  const limit = opts.limit ?? (focus ? 5 : 10);
  const showTotals = opts.showTotals !== false;
  const lines: { ref: string; label: string; done: boolean }[] = [];

  const pct = (v: number) => `${Math.round(v * 100)}%`;

  const cap = (n: number) => (focus ? n : limit);

  // 파밍 줄은 "지금 단계" 기준. 4거점 전체로 팰키사이트 광석 4,100 이라고 하면
  // 손도 못 대지만, 물질 생성기 5대분 500 이라고 하면 오늘 할 수 있는 일이 된다.
  const farmSource = p.stage.farm.length > 0 ? p.stage.farm : p.farm;

  // 1. 재료 파밍이 무조건 최우선.
  //    건설은 재료가 모이면 자연히 따라온다. 반대로 재료 없이 건설을 띄우면
  //    "지으라는데 뭘 캐야 하는지" 를 매번 다시 찾아봐야 한다.
  let farmCount = 0;
  for (const t of farmSource) {
    if (t.lockedBy) continue;
    if (farmCount >= cap(FOCUS_CAPS.farm)) break;
    farmCount++;
    const top = t.items[0];
    const detail = top
      ? showTotals
        ? `${top.name} ${nf.format(Math.round(top.have))}/${nf.format(Math.round(top.need))}`
        : `${top.name} ${pct(top.progress)}`
      : pct(t.progress);
    lines.push({
      ref: `farm:${t.source.id}`,
      label: `${t.source.name} — ${detail}`,
      done: false,
    });
  }

  // 2. 자동 획득처를 막고 있는 미완성 선행 시설.
  //    이건 파밍의 선행이라 파밍 바로 다음이다.
  const seenBlockers = new Set<string>();
  for (const t of farmSource) {
    if (!t.lockedBy || seenBlockers.has(t.lockedBy.id)) continue;
    if (seenBlockers.size >= cap(FOCUS_CAPS.locked)) break;
    seenBlockers.add(t.lockedBy.id);
    lines.push({
      ref: `build:${t.lockedBy.id}`,
      label: `${t.lockedBy.name} 건설 — ${t.source.name} 해금`,
      done: false,
    });
  }

  // 3. 재료가 이미 충분해서 지금 바로 지을 수 있는 건축물
  let readyCount = 0;
  for (const b of p.build) {
    if (!b.ready || seenBlockers.has(b.structure.id)) continue;
    if (readyCount >= cap(FOCUS_CAPS.ready)) break;
    readyCount++;
    lines.push({
      ref: `build:${b.structure.id}`,
      label: `${b.structure.name}${b.remaining > 1 ? ` ${b.remaining}대` : ''} — 재료 충족`,
      done: false,
    });
  }

  // 4. 거점에 배치할 팰 확보
  const palReserve = Math.min(
    cap(FOCUS_CAPS.pal),
    p.palCatches.length,
    Math.max(0, limit - lines.length)
  );
  for (const c of p.palCatches.slice(0, palReserve)) {
    const where = c.roles[0];
    const detail = where ? `${where.baseName} ${where.role}`.trim() : '거점 배치';
    const blocked = c.missingParents.length + c.missingConditions.length > 0;
    const verb = c.via === 'breed' ? (blocked ? '배합 준비' : '배합') : '포획';
    lines.push({
      ref: `pal:${c.pal.id}`,
      label: `${c.pal.name} ${c.short}마리 ${verb} — ${detail}${c.pal.nocturnal ? ' (야행성)' : ''}`,
      done: false,
    });
  }

  const active = lines.slice(0, limit);

  // 4. 최근 완료 — 부족량이 0이 된 획득처를 뒤에 붙여 성취감을 남긴다
  const doneSources = farmSource.filter((t) => t.progress >= 1).slice(0, 3);
  for (const t of doneSources) {
    active.push({ ref: `farm:${t.source.id}`, label: t.source.name, done: true });
  }

  // ref 중복 제거 — 같은 건축물이 1번과 2번에 동시에 걸릴 수 있다
  const seen = new Set<string>();
  return active
    .filter((l) => (seen.has(l.ref) ? false : (seen.add(l.ref), true)))
    .map((l, i) => ({ ...l, position: i }));
}

// ─────────────────────────────────────────────────────────────
// 팰 배치 헬퍼
// ─────────────────────────────────────────────────────────────

export function assignedSlots(assignments: Assignment[], baseId: number): number {
  return assignments.filter((a) => a.base_id === baseId).reduce((sum, a) => sum + a.count, 0);
}

export function itemsBySource(data: PalData): Record<string, PalItem[]> {
  const map: Record<string, PalItem[]> = {};
  for (const item of data.items) {
    if (!item.source_id) continue;
    (map[item.source_id] ??= []).push(item);
  }
  for (const list of Object.values(map)) list.sort((a, b) => a.sort - b.sort);
  return map;
}
