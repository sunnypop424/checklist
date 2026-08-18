import { keyMatches } from '@/lib/auth';
import { publicClient } from '@/lib/supabase';
import type { List } from '@/lib/types';
import ControlApp from './ControlApp';
import Gate from './Gate';
import './control.css';

export const dynamic = 'force-dynamic';

type Props = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function ControlPage({ searchParams }: Props) {
  const sp = await searchParams;
  const raw = Array.isArray(sp.key) ? sp.key[0] : sp.key;

  // URL 에 키가 없으면 클라이언트가 sessionStorage 에 보관해둔 키로 재시도한다
  if (!raw) return <Gate />;
  if (!keyMatches(raw)) {
    return (
      <main className="control control--gate">
        <div className="gate">
          <h1>접근할 수 없습니다</h1>
          <p>비밀 키가 올바르지 않습니다.</p>
        </div>
      </main>
    );
  }

  const db = publicClient();
  const { data: lists } = await db
    .from('lists')
    .select('*')
    .order('sort', { ascending: true })
    .order('created_at', { ascending: true });

  return <ControlApp controlKey={raw} initialLists={(lists ?? []) as List[]} />;
}
