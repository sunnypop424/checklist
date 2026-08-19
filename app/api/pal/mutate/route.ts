import { NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { adminClient } from '@/lib/supabase';
import { requireKey } from '@/lib/auth';
import { loadSettings, normalizeSettings, syncChecklist } from '@/lib/pal/db';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export type PalMutateAction =
  /** 재고를 절대값으로 설정 */
  | { action: 'set_inventory'; itemId: string; qty: number }
  /** 재고 증분 (파밍 후엔 이쪽이 훨씬 편하다) */
  | { action: 'add_inventory'; itemId: string; delta: number }
  /** 여러 재고를 한 번에 */
  | { action: 'set_inventory_bulk'; entries: { itemId: string; qty: number }[] }
  /** 건축물을 몇 대 지었는지 */
  | { action: 'set_built'; structureId: string; built: number }
  /** 이 팰을 몇 마리 확보했는지 */
  | { action: 'set_pal_owned'; palId: string; count: number }
  | { action: 'update_recipe'; outputId: string; inputId: string; qty?: number; yield?: number }
  | { action: 'update_cost'; structureId: string; itemId: string; qty: number }
  | { action: 'update_structure'; structureId: string; count?: number; unlockScore?: number }
  | { action: 'update_settings'; config: Record<string, unknown> }
  /** 계산만 다시 돌려 오버레이 갱신 */
  | { action: 'sync' };

function bad(message: string, status = 400) {
  return NextResponse.json({ ok: false, error: message }, { status });
}

/** 수량은 음수·NaN·비현실적인 값을 막는다 */
const MAX_QTY = 1_000_000;

function qtyOf(v: unknown): number | null {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0 || n > MAX_QTY) return null;
  return n;
}

async function setInventory(db: SupabaseClient, itemId: string, qty: number) {
  const { error } = await db
    .from('pal_inventory')
    .upsert({ item_id: itemId, qty, updated_at: new Date().toISOString() }, { onConflict: 'item_id' });
  if (error) throw error;
}

export async function POST(req: Request) {
  if (!requireKey(req)) return bad('인증 실패', 401);

  let body: PalMutateAction;
  try {
    body = (await req.json()) as PalMutateAction;
  } catch {
    return bad('JSON 파싱 실패');
  }

  const db = adminClient();

  try {
    switch (body.action) {
      case 'set_inventory': {
        const qty = qtyOf(body.qty);
        if (qty === null) return bad('수량이 올바르지 않습니다');
        await setInventory(db, body.itemId, qty);
        break;
      }

      case 'add_inventory': {
        const delta = Number(body.delta);
        if (!Number.isFinite(delta)) return bad('증감량이 올바르지 않습니다');
        const { data } = await db
          .from('pal_inventory')
          .select('qty')
          .eq('item_id', body.itemId)
          .maybeSingle();
        // 0 아래로는 내려가지 않는다 — 실수로 -값을 넣어도 재고가 음수가 되면 계산이 망가진다
        const next = Math.min(MAX_QTY, Math.max(0, (Number(data?.qty) || 0) + delta));
        await setInventory(db, body.itemId, next);
        break;
      }

      case 'set_inventory_bulk': {
        if (!Array.isArray(body.entries) || body.entries.length === 0) return bad('빈 목록');
        if (body.entries.length > 200) return bad('한 번에 200개까지');
        const rows = [];
        for (const e of body.entries) {
          const qty = qtyOf(e.qty);
          if (qty === null) return bad(`${e.itemId} 수량이 올바르지 않습니다`);
          rows.push({ item_id: e.itemId, qty, updated_at: new Date().toISOString() });
        }
        const { error } = await db.from('pal_inventory').upsert(rows, { onConflict: 'item_id' });
        if (error) throw error;
        break;
      }

      case 'set_built': {
        const { data: s } = await db
          .from('pal_structures')
          .select('count')
          .eq('id', body.structureId)
          .maybeSingle();
        if (!s) return bad('없는 건축물입니다');

        const built = Math.max(0, Math.min(Number(s.count) || 0, Math.floor(Number(body.built) || 0)));
        const { error } = await db
          .from('pal_checklist')
          .upsert(
            { kind: 'build', ref_id: body.structureId, built, updated_at: new Date().toISOString() },
            { onConflict: 'kind,ref_id' }
          );
        if (error) throw error;
        break;
      }

      case 'set_pal_owned': {
        const { data: p } = await db.from('pal_pals').select('id').eq('id', body.palId).maybeSingle();
        if (!p) return bad('없는 팰입니다');

        // 거점 정원이 20마리라 한 종을 그 이상 세는 건 의미가 없다
        const count = Math.max(0, Math.min(80, Math.floor(Number(body.count) || 0)));
        const { error } = await db
          .from('pal_checklist')
          .upsert(
            { kind: 'pal', ref_id: body.palId, built: count, updated_at: new Date().toISOString() },
            { onConflict: 'kind,ref_id' }
          );
        if (error) throw error;
        break;
      }

      case 'update_recipe': {
        const patch: Record<string, number> = {};
        if (body.qty !== undefined) {
          const q = qtyOf(body.qty);
          if (q === null || q <= 0) return bad('재료 수량은 1 이상이어야 합니다');
          patch.qty = q;
        }
        if (body.yield !== undefined) {
          const y = qtyOf(body.yield);
          if (y === null || y <= 0) return bad('산출량은 1 이상이어야 합니다');
          patch.yield = y;
        }
        if (Object.keys(patch).length === 0) return bad('변경할 내용이 없음');
        const { error } = await db
          .from('pal_recipes')
          .update(patch)
          .eq('output_id', body.outputId)
          .eq('input_id', body.inputId);
        if (error) throw error;
        break;
      }

      case 'update_cost': {
        const qty = qtyOf(body.qty);
        if (qty === null || qty <= 0) return bad('재료 수량은 1 이상이어야 합니다');
        const { error } = await db
          .from('pal_structure_costs')
          .update({ qty })
          .eq('structure_id', body.structureId)
          .eq('item_id', body.itemId);
        if (error) throw error;
        break;
      }

      case 'update_structure': {
        const patch: Record<string, number> = {};
        if (body.count !== undefined) {
          const c = qtyOf(body.count);
          if (c === null) return bad('개수가 올바르지 않습니다');
          patch.count = Math.floor(c);
        }
        if (body.unlockScore !== undefined) {
          const u = Number(body.unlockScore);
          if (!Number.isFinite(u) || u < 0 || u > 100) return bad('unlock_score 는 0~100');
          patch.unlock_score = u;
        }
        if (Object.keys(patch).length === 0) return bad('변경할 내용이 없음');
        const { error } = await db.from('pal_structures').update(patch).eq('id', body.structureId);
        if (error) throw error;
        break;
      }

      case 'update_settings': {
        const config = normalizeSettings(body.config);
        const { error } = await db.from('pal_settings').upsert({ id: 1, config }, { onConflict: 'id' });
        if (error) throw error;
        break;
      }

      case 'sync':
        break;

      default:
        return bad('알 수 없는 action');
    }

    // 무엇을 바꿨든 계산 결과가 달라지므로 오버레이를 다시 밀어넣는다.
    // autoSync 를 꺼둔 경우엔 명시적인 sync 요청일 때만.
    const settings = await loadSettings(db);
    const shouldSync = body.action === 'sync' || settings.autoSync;
    const synced = shouldSync ? await syncChecklist(db) : null;

    return NextResponse.json({ ok: true, synced });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error('[pal/mutate]', body.action, message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
