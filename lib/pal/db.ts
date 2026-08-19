/**
 * 팰월드 트래커 서버측 데이터 접근.
 * pal_* 테이블은 anon 이 읽을 수 없으므로 전부 service_role(adminClient)로 읽는다.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { plan, toChecklist } from './engine';
import type { Assignment, BuiltMap, Inventory, OwnedPals, PalData, PalMon, PalRoster } from './types';

export type PalSettings = {
  /** 오버레이 label 에 총량을 넣을지. 끄면 "발화 기관 32%" 로 나간다. */
  showTotals: boolean;
  /** 체크리스트에 내보낼 항목 수 */
  limit: number;
  /** 재고를 고칠 때마다 자동으로 오버레이를 갱신할지 */
  autoSync: boolean;
  /** 'focus' = 지금 할 것 위주로 몇 줄만 / 'full' = limit 까지 꽉 채움 */
  mode: 'focus' | 'full';
};

export const DEFAULT_SETTINGS: PalSettings = { showTotals: true, limit: 5, autoSync: true, mode: 'focus' };

export function normalizeSettings(raw: unknown): PalSettings {
  const o = (raw ?? {}) as Partial<PalSettings>;
  const limit = Number(o.limit);
  return {
    showTotals: o.showTotals !== false,
    limit: Number.isFinite(limit) && limit >= 1 && limit <= 30 ? Math.floor(limit) : DEFAULT_SETTINGS.limit,
    autoSync: o.autoSync !== false,
    mode: o.mode === 'full' ? 'full' : 'focus',
  };
}

/** PostgREST 는 numeric 을 문자열로 줄 때가 있어 방어적으로 캐스팅한다 */
function nums<T extends Record<string, unknown>>(rows: T[], keys: string[]): T[] {
  for (const r of rows) {
    for (const k of keys) {
      if (r[k] != null) (r as Record<string, unknown>)[k] = Number(r[k]);
    }
  }
  return rows;
}

export async function loadPalData(db: SupabaseClient): Promise<PalData> {
  const [sources, items, recipes, bases, structures, costs, unlocks] = await Promise.all([
    db.from('pal_farm_sources').select('*').order('sort'),
    db.from('pal_items').select('*').order('sort'),
    db.from('pal_recipes').select('*'),
    db.from('pal_bases').select('*').order('id'),
    db.from('pal_structures').select('*').order('id'),
    db.from('pal_structure_costs').select('*'),
    db.from('pal_structure_unlocks').select('*'),
  ]);

  return {
    sources: (sources.data ?? []) as PalData['sources'],
    items: (items.data ?? []) as PalData['items'],
    recipes: nums((recipes.data ?? []) as never[], ['qty', 'yield', 'tier']) as PalData['recipes'],
    bases: nums((bases.data ?? []) as never[], ['weight']) as PalData['bases'],
    structures: nums((structures.data ?? []) as never[], ['unlock_score', 'count']) as PalData['structures'],
    costs: nums((costs.data ?? []) as never[], ['qty']) as PalData['costs'],
    unlocks: (unlocks.data ?? []) as PalData['unlocks'],
  };
}

export async function loadInventory(db: SupabaseClient): Promise<Inventory> {
  const { data } = await db.from('pal_inventory').select('item_id, qty');
  const inv: Inventory = {};
  for (const row of data ?? []) inv[row.item_id as string] = Number(row.qty) || 0;
  return inv;
}

export async function loadBuilt(db: SupabaseClient): Promise<BuiltMap> {
  const { data } = await db.from('pal_checklist').select('ref_id, built').eq('kind', 'build');
  const built: BuiltMap = {};
  for (const row of data ?? []) built[row.ref_id as string] = Number(row.built) || 0;
  return built;
}

export async function loadSettings(db: SupabaseClient): Promise<PalSettings> {
  const { data } = await db.from('pal_settings').select('config').eq('id', 1).maybeSingle();
  return normalizeSettings(data?.config);
}

export async function loadPals(db: SupabaseClient): Promise<PalMon[]> {
  const { data } = await db.from('pal_pals').select('*').order('name');
  return (data ?? []) as PalMon[];
}

/** pal_id → 보유 마릿수 (pal_checklist 의 kind='pal' 행) */
export async function loadOwnedPals(db: SupabaseClient): Promise<OwnedPals> {
  const { data } = await db.from('pal_checklist').select('ref_id, built').eq('kind', 'pal');
  const owned: OwnedPals = {};
  for (const row of data ?? []) owned[row.ref_id as string] = Number(row.built) || 0;
  return owned;
}

export async function loadRoster(db: SupabaseClient): Promise<PalRoster> {
  const [pals, assignments] = await Promise.all([loadPals(db), loadAssignments(db)]);
  return { pals, assignments };
}

export async function loadAssignments(db: SupabaseClient): Promise<Assignment[]> {
  const { data } = await db.from('pal_assignments').select('*').order('base_id').order('sort');
  return (data ?? []) as Assignment[];
}

/**
 * 계산을 다시 돌려 체크리스트(lists id='pal' + items)에 밀어넣는다.
 * 오버레이는 여기서 나온 결과를 기존 Realtime 구독으로 그대로 받는다.
 */
export async function syncChecklist(db: SupabaseClient): Promise<number> {
  const [data, inventory, built, settings, roster, owned] = await Promise.all([
    loadPalData(db),
    loadInventory(db),
    loadBuilt(db),
    loadSettings(db),
    loadRoster(db),
    loadOwnedPals(db),
  ]);

  const lines = toChecklist(plan(data, inventory, built, roster, owned), {
    limit: settings.limit,
    showTotals: settings.showTotals,
    mode: settings.mode,
  });

  const { error } = await db.rpc('pal_sync_list', { p_items: lines });
  if (error) throw new Error(`체크리스트 sync 실패: ${error.message}`);
  return lines.length;
}
