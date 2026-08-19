import { NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { adminClient } from '@/lib/supabase';
import { requireKey } from '@/lib/auth';
import type { MutateAction } from '@/lib/types';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function bad(message: string, status = 400) {
  return NextResponse.json({ ok: false, error: message }, { status });
}

/** 오버레이 한 줄에 들어갈 수 있는 현실적인 상한 */
const MAX_LABEL = 200;
const MAX_TITLE = 60;

/** 제어문자(줄바꿈·탭 포함). 붙여넣기 때 자주 섞여 들어온다. */
const CONTROL_CHARS = /[\u0000-\u001f\u007f]+/g;

function clean(text: string, max: number): string {
  return text
    .replace(CONTROL_CHARS, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim()
    .slice(0, max);
}

/**
 * 팰월드 트래커가 관리하는 목록(source='pal')은 내용을 손으로 못 고치게 막는다.
 * 다음 sync 때 어차피 덮어써지므로 조용히 사라지는 것보다 거절이 낫다.
 * 목록 이름 변경·삭제·정렬은 허용한다 (trade-off: 삭제하면 다음 sync 가 다시 만든다).
 */
const PAL_GUARDED: ReadonlySet<MutateAction['action']> = new Set([
  'reset_list',
  'add_item',
  'update_item',
  'delete_item',
  'reorder_items',
]);

/** action 이 건드리는 목록의 source 를 찾는다. 항목 단위 action 은 list_id 를 먼저 역추적한다. */
async function listSourceOf(db: SupabaseClient, body: MutateAction): Promise<string | null> {
  let listId = 'listId' in body ? body.listId : undefined;

  if (!listId && 'itemId' in body) {
    const { data } = await db
      .from('items')
      .select('list_id')
      .eq('id', body.itemId)
      .maybeSingle();
    listId = data?.list_id as string | undefined;
  }
  if (!listId) return null;

  const { data } = await db.from('lists').select('source').eq('id', listId).maybeSingle();
  return (data?.source as string | undefined) ?? null;
}

export async function POST(req: Request) {
  if (!requireKey(req)) {
    return bad('인증 실패', 401);
  }

  let body: MutateAction;
  try {
    body = (await req.json()) as MutateAction;
  } catch {
    return bad('JSON 파싱 실패');
  }

  const db = adminClient();

  if (PAL_GUARDED.has(body.action) && (await listSourceOf(db, body)) === 'pal') {
    return bad('팰월드 트래커가 관리하는 목록입니다. /pal 에서 수정하세요.');
  }

  try {
    switch (body.action) {
      case 'create_list': {
        const { data: maxRow } = await db
          .from('lists')
          .select('sort')
          .order('sort', { ascending: false })
          .limit(1)
          .maybeSingle();

        const { data, error } = await db
          .from('lists')
          .insert({
            title: clean(body.title ?? '', MAX_TITLE) || '새 체크리스트',
            sort: (maxRow?.sort ?? -1) + 1,
          })
          .select()
          .single();
        if (error) throw error;
        return NextResponse.json({ ok: true, list: data });
      }

      case 'rename_list': {
        const { error } = await db
          .from('lists')
          .update({ title: clean(body.title, MAX_TITLE) || '체크리스트' })
          .eq('id', body.listId);
        if (error) throw error;
        return NextResponse.json({ ok: true });
      }

      case 'delete_list': {
        const { error } = await db.from('lists').delete().eq('id', body.listId);
        if (error) throw error;
        return NextResponse.json({ ok: true });
      }

      case 'reset_list': {
        const { error } = await db
          .from('items')
          .update({ done: false })
          .eq('list_id', body.listId)
          .eq('done', true);
        if (error) throw error;
        return NextResponse.json({ ok: true });
      }

      case 'add_item': {
        const label = clean(body.label, MAX_LABEL);
        if (!label) return bad('빈 항목');

        const { data: maxRow } = await db
          .from('items')
          .select('position')
          .eq('list_id', body.listId)
          .order('position', { ascending: false })
          .limit(1)
          .maybeSingle();

        const { data, error } = await db
          .from('items')
          .insert({
            list_id: body.listId,
            label,
            position: (maxRow?.position ?? -1) + 1,
          })
          .select()
          .single();
        if (error) throw error;
        return NextResponse.json({ ok: true, item: data });
      }

      case 'update_item': {
        const patch: Record<string, unknown> = {};
        if (typeof body.label === 'string') {
          const label = clean(body.label, MAX_LABEL);
          if (!label) return bad('빈 항목');
          patch.label = label;
        }
        if (typeof body.done === 'boolean') patch.done = body.done;
        if (Object.keys(patch).length === 0) return bad('변경할 내용이 없음');

        const { error } = await db.from('items').update(patch).eq('id', body.itemId);
        if (error) throw error;
        return NextResponse.json({ ok: true });
      }

      case 'delete_item': {
        const { error } = await db.from('items').delete().eq('id', body.itemId);
        if (error) throw error;
        return NextResponse.json({ ok: true });
      }

      case 'reorder_items': {
        if (!Array.isArray(body.ids) || body.ids.length === 0) return bad('빈 순서 배열');
        const { error } = await db.rpc('reorder_items', {
          p_list_id: body.listId,
          p_ids: body.ids,
        });
        if (error) throw error;
        return NextResponse.json({ ok: true });
      }

      default:
        return bad('알 수 없는 action');
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error('[mutate]', body.action, message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
