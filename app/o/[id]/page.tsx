import { notFound } from 'next/navigation';
import { publicClient } from '@/lib/supabase';
import { OVERLAY_ENV, missingEnv } from '@/lib/env';
import type { Item, List } from '@/lib/types';
import Overlay from './Overlay';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function OverlayPage({ params, searchParams }: Props) {
  const { id } = await params;
  const sp = await searchParams;

  // 환경변수가 없으면 크래시 대신 조용히 빈 화면 — 방송 중 붉은 에러 화면이 뜨는 것보다 낫다
  if (missingEnv(OVERLAY_ENV).length > 0) return null;

  const db = publicClient();

  const { data: list } = await db.from('lists').select('*').eq('id', id).maybeSingle();
  if (!list) notFound();

  const { data: items } = await db
    .from('items')
    .select('*')
    .eq('list_id', id)
    .order('position', { ascending: true });

  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  const scale = Number(one(sp.scale) ?? '1');

  return (
    <Overlay
      listId={id}
      initialList={list as List}
      initialItems={(items ?? []) as Item[]}
      scale={Number.isFinite(scale) && scale > 0 ? scale : 1}
      debug={one(sp.debug) === '1'}
      hideDone={one(sp.hideDone) === '1'}
      hideProgress={one(sp.hideProgress) === '1'}
      sortDone={one(sp.sortDone) !== '0'}
      hideEmpty={one(sp.hideEmpty) === '1'}
    />
  );
}
