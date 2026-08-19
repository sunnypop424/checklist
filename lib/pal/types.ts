/** 팰월드 트래커 — DB 행 타입과 계산 결과 타입 */

export type FarmMethod = 'auto' | 'manual';

export type FarmSource = {
  id: string;
  name: string;
  method: FarmMethod;
  place: string | null;
  sort: number;
  note: string | null;
  /** 이 시설을 1대라도 지어야 자동 획득이 시작된다 */
  requires_structure: string | null;
};

export type PalItem = {
  id: string;
  name: string;
  category: string;
  /** 최하위 재료만 값이 있다. 중간재는 null(= 레시피로만 얻는다) */
  source_id: string | null;
  sort: number;
  note: string | null;
};

export type RecipeRow = {
  output_id: string;
  input_id: string;
  qty: number;
  yield: number;
  tier: number;
};

export type PalBase = {
  id: number;
  name: string;
  role: string | null;
  weight: number;
  pal_slots: number;
  note: string | null;
};

export type Structure = {
  id: string;
  name: string;
  base_id: number | null;
  count: number;
  unlock_score: number;
  build_order: number | null;
  note: string | null;
};

export type StructureCost = { structure_id: string; item_id: string; qty: number };
export type StructureUnlock = { structure_id: string; item_id: string };

export type PalMon = {
  id: string;
  name: string;
  aptitudes: Record<string, number>;
  nocturnal: boolean;
  foreman: string | null;
  partner: string | null;
  source: string | null;
  /** 잡는 게 아니라 배합으로 얻는 팰. 이 부모들을 먼저 확보해야 한다. */
  breed_from?: string[];
  breed_note?: string | null;
};

export type Assignment = {
  id: number;
  base_id: number;
  role: string;
  count: number;
  pal_ids: string[];
  sort: number;
  note: string | null;
};

/** item_id → 보유 수량 */
export type Inventory = Record<string, number>;
/** structure_id → 지은 개수 */
export type BuiltMap = Record<string, number>;

/** 계산에 필요한 게임 데이터 전부 */
export type PalData = {
  sources: FarmSource[];
  items: PalItem[];
  recipes: RecipeRow[];
  bases: PalBase[];
  structures: Structure[];
  costs: StructureCost[];
  unlocks: StructureUnlock[];
};

export type Recipe = {
  outputId: string;
  yield: number;
  tier: number;
  inputs: { id: string; qty: number }[];
};

/** output_id → 레시피 */
export type RecipeMap = Record<string, Recipe>;

export type ExpandOut = {
  /** 최하위 재료별 부족량 */
  leaf: Record<string, number>;
  /** 제작해야 할 횟수(batch) */
  craft: Record<string, number>;
};

export type FarmItemLine = {
  id: string;
  name: string;
  have: number;
  need: number;
  short: number;
  /** 0~1 */
  progress: number;
};

export type FarmTask = {
  source: FarmSource;
  items: FarmItemLine[];
  /** 이 획득처 전체 진행률 0~1 (품목별 진행률의 평균) */
  progress: number;
  score: number;
  /** 자동 획득처인데 선행 시설이 아직 없다 */
  lockedBy: Structure | null;
};

export type BuildTask = {
  structure: Structure;
  base: PalBase | null;
  built: number;
  remaining: number;
  /** 1대를 더 짓기 위해 부족한 재료 (재고·다른 건축물 소모 반영) */
  missing: { id: string; name: string; short: number }[];
  /** 재료가 전부 있어 지금 바로 지을 수 있다 */
  ready: boolean;
  /** 이 건축물이 선행 시설(예: 고대 문명 화로) 때문에 막혀 있다 */
  blockedBy: Structure | null;
  /** 0~1 */
  progress: number;
  score: number;
};

export type CraftLine = {
  item: PalItem;
  tier: number;
  /** 몇 개 만들어야 하는가 */
  batches: number;
  have: number;
  inputs: { id: string; name: string; qty: number; have: number; short: number }[];
  /** 재료가 전부 있어 지금 바로 만들 수 있다 */
  ready: boolean;
};

/** 한 배치 자리를 채우는 데 몇 마리가 모자란가 */
export type PalNeed = {
  base: PalBase;
  assignment: Assignment;
  /** 이 자리에 넣을 수 있는 추천 팰 */
  candidates: PalMon[];
  /** 배정된 마릿수 (보유분에서 이 자리에 할당된 수) */
  filled: number;
  need: number;
  short: number;
  /** 부족분을 채우려면 잡아야 할 후보 (보유 0인 것 우선) */
  toCatch: PalMon[];
};

/** 팰 한 종을 몇 마리 더 확보해야 하는가 */
export type PalCatchLine = {
  pal: PalMon;
  owned: number;
  /** 이 팰이 필요한 자리들 */
  roles: { baseName: string; role: string }[];
  /** 최소 몇 마리 더 필요한가 */
  short: number;
  /** 'catch' 직접 포획 / 'breed' 배합으로 양산 */
  via: 'catch' | 'breed';
  /** 배합 부모 중 아직 확보하지 못한 것 */
  missingParents: PalMon[];
  note: string | null;
};

export type ChecklistLine = {
  ref: string;
  label: string;
  done: boolean;
  position: number;
};

export type PalPlan = {
  farm: FarmTask[];
  build: BuildTask[];
  craft: CraftLine[];
  /** 거점 배치 자리별 충원 현황 */
  palNeeds: PalNeed[];
  /** 잡아야 할 팰 (부족한 순) */
  palCatches: PalCatchLine[];
  /** 최하위 재료 전체 달성률 0~1 */
  overall: number;
  /** 팰 배치 충원률 0~1 */
  palOverall: number;
  shortage: ExpandOut;
  /** 부족량이 큰 순서대로 병목 재료 */
  bottlenecks: FarmItemLine[];
};

/** 팰 도감·배치표 (게임 데이터와 분리해서 로드한다) */
export type PalRoster = {
  pals: PalMon[];
  assignments: Assignment[];
};

/** pal_id → 보유 마릿수 */
export type OwnedPals = Record<string, number>;
