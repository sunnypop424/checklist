import { NextResponse } from 'next/server';
import { adminClient } from '@/lib/supabase';
import { requireKey } from '@/lib/auth';
import type { MutateAction } from '@/lib/types';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function bad(message: string, status = 400) {
  return NextResponse.json({ ok: false, error: message }, { status });
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
            title: body.title?.trim() || '새 체크리스트',
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
          .update({ title: body.title.trim() || '체크리스트' })
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
        const label = body.label.trim();
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
          const label = body.label.trim();
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
