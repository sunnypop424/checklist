import { keyMatches } from '@/lib/auth';
import { publicClient } from '@/lib/supabase';
import { CONTROL_ENV, missingEnv } from '@/lib/env';
import type { List } from '@/lib/types';
import ControlApp from './ControlApp';
import Gate from '@/components/Gate';
import SetupNotice from '../SetupNotice';
import './control.css';

export const dynamic = 'force-dynamic';

type Props = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function ControlPage({ searchParams }: Props) {
  const sp = await searchParams;
  const raw = Array.isArray(sp.key) ? sp.key[0] : sp.key;

  const missing = missingEnv(CONTROL_ENV);
  if (missing.length > 0) return <SetupNotice missing={missing} />;

  // URL 에 키가 없으면 클라이언트가 저장해둔 키로 재시도한다
  if (!raw) return <Gate title="체크리스트 컨트롤" redirectTo="/control" />;
  // 키가 틀리면 저장된 키를 지우고 다시 입력받는다 (안 그러면 영영 못 들어온다)
  if (!keyMatches(raw)) return <Gate title="체크리스트 컨트롤" redirectTo="/control" invalid />;

  const db = publicClient();
  const { data: lists } = await db
    .from('lists')
    .select('*')
    .order('sort', { ascending: true })
    .order('created_at', { ascending: true });

  return <ControlApp controlKey={raw} initialLists={(lists ?? []) as List[]} />;
}
