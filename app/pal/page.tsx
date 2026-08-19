import { keyMatches } from '@/lib/auth';
import { adminClient } from '@/lib/supabase';
import { CONTROL_ENV, missingEnv } from '@/lib/env';
import {
  loadBuilt,
  loadInventory,
  loadOwnedPals,
  loadPalData,
  loadRoster,
  loadSettings,
} from '@/lib/pal/db';
import Gate from '@/components/Gate';
import SetupNotice from '../SetupNotice';
import PalApp from './PalApp';
import './pal.css';

export const dynamic = 'force-dynamic';

type Props = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function PalPage({ searchParams }: Props) {
  const sp = await searchParams;
  const raw = Array.isArray(sp.key) ? sp.key[0] : sp.key;

  const missing = missingEnv(CONTROL_ENV);
  if (missing.length > 0) return <SetupNotice missing={missing} />;

  // /control 과 완전히 같은 흐름 — 키도 localStorage 키 이름도 공유한다
  if (!raw) return <Gate title="팰월드 트래커" redirectTo="/pal" />;
  if (!keyMatches(raw)) return <Gate title="팰월드 트래커" redirectTo="/pal" invalid />;

  // pal_* 는 anon 이 읽을 수 없으므로 서버에서 service_role 로 읽어 넘긴다
  const db = adminClient();
  const [data, inventory, built, roster, owned, settings] = await Promise.all([
    loadPalData(db),
    loadInventory(db),
    loadBuilt(db),
    loadRoster(db),
    loadOwnedPals(db),
    loadSettings(db),
  ]);

  if (data.items.length === 0) {
    return (
      <main className="pal pal--empty">
        <h1>팰월드 트래커</h1>
        <p>
          게임 데이터가 아직 없습니다. 터미널에서 <code>npm run db:setup</code> 을 실행해
          <code>supabase/schema-pal.sql</code> 을 적용해 주세요.
        </p>
      </main>
    );
  }

  return (
    <PalApp
      controlKey={raw}
      data={data}
      initialInventory={inventory}
      initialBuilt={built}
      roster={roster}
      initialOwned={owned}
      initialSettings={settings}
    />
  );
}
