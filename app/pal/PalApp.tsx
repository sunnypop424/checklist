'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { KEY_STORAGE } from '@/components/Gate';
import { plan } from '@/lib/pal/engine';
import type { PalSettings } from '@/lib/pal/db';
import type { BuiltMap, Inventory, OwnedPals, PalData, PalRoster } from '@/lib/pal/types';
import type { PalMutateAction } from '@/app/api/pal/mutate/route';
import TodoTab from './tabs/TodoTab';
import InventoryTab from './tabs/InventoryTab';
import FarmTab from './tabs/FarmTab';
import CraftTab from './tabs/CraftTab';
import BasesTab from './tabs/BasesTab';
import DataTab from './tabs/DataTab';

const TABS = ['할 일', '재고', '파밍', '제작', '거점', '데이터'] as const;
type Tab = (typeof TABS)[number];

type Props = {
  controlKey: string;
  data: PalData;
  initialInventory: Inventory;
  initialBuilt: BuiltMap;
  roster: PalRoster;
  initialOwned: OwnedPals;
  initialSettings: PalSettings;
};

export default function PalApp({
  controlKey,
  data,
  initialInventory,
  initialBuilt,
  roster,
  initialOwned,
  initialSettings,
}: Props) {
  const [tab, setTab] = useState<Tab>('할 일');
  const [inventory, setInventory] = useState<Inventory>(initialInventory);
  const [built, setBuilt] = useState<BuiltMap>(initialBuilt);
  const [owned, setOwned] = useState<OwnedPals>(initialOwned);
  const [settings, setSettings] = useState<PalSettings>(initialSettings);
  const [toast, setToast] = useState<string | null>(null);
  const [syncedAt, setSyncedAt] = useState<string | null>(null);
  const [busy, setBusy] = useState(0);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 키를 저장하고 주소창을 정리한다 (방송 중 브라우저가 화면에 잡혀도 키가 안 보이게)
  useEffect(() => {
    localStorage.setItem(KEY_STORAGE, controlKey);
    sessionStorage.setItem(KEY_STORAGE, controlKey);
    if (window.location.search) window.history.replaceState(null, '', '/pal');
  }, [controlKey]);

  useEffect(() => {
    const saved = localStorage.getItem('pal_tab');
    if (saved && (TABS as readonly string[]).includes(saved)) setTab(saved as Tab);
  }, []);

  const selectTab = useCallback((t: Tab) => {
    setTab(t);
    localStorage.setItem('pal_tab', t);
  }, []);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2600);
  }, []);

  /**
   * 계산은 전부 클라이언트에서 다시 돈다 — 재고를 타이핑하는 즉시 부족량이 바뀐다.
   * 서버는 같은 계산을 한 번 더 해서 오버레이용 체크리스트를 만든다.
   */
  const p = useMemo(
    () => plan(data, inventory, built, roster, owned),
    [data, inventory, built, roster, owned]
  );

  const send = useCallback(
    async (payload: PalMutateAction) => {
      setBusy((n) => n + 1);
      try {
        const res = await fetch('/api/pal/mutate', {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-control-key': controlKey },
          body: JSON.stringify(payload),
        });
        const json = await res.json().catch(() => ({ ok: false, error: '응답 파싱 실패' }));
        if (!res.ok || !json.ok) throw new Error(json.error || `HTTP ${res.status}`);
        if (json.synced != null) {
          setSyncedAt(new Date().toLocaleTimeString('ko-KR'));
        }
        return json;
      } finally {
        setBusy((n) => n - 1);
      }
    },
    [controlKey]
  );

  /** 낙관적 업데이트 → 실패하면 되돌린다 */
  const optimistic = useCallback(
    async (apply: () => void, revert: () => void, payload: PalMutateAction) => {
      apply();
      try {
        await send(payload);
      } catch (e) {
        revert();
        showToast(`실패: ${e instanceof Error ? e.message : String(e)}`);
      }
    },
    [send, showToast]
  );

  const setQty = useCallback(
    (itemId: string, qty: number) => {
      const prev = inventory[itemId] ?? 0;
      const next = Math.max(0, qty);
      if (next === prev) return;
      void optimistic(
        () => setInventory((s) => ({ ...s, [itemId]: next })),
        () => setInventory((s) => ({ ...s, [itemId]: prev })),
        { action: 'set_inventory', itemId, qty: next }
      );
    },
    [inventory, optimistic]
  );

  const addQty = useCallback(
    (itemId: string, delta: number) => {
      const prev = inventory[itemId] ?? 0;
      const next = Math.max(0, prev + delta);
      void optimistic(
        () => setInventory((s) => ({ ...s, [itemId]: next })),
        () => setInventory((s) => ({ ...s, [itemId]: prev })),
        { action: 'add_inventory', itemId, delta }
      );
    },
    [inventory, optimistic]
  );

  const setBuiltCount = useCallback(
    (structureId: string, value: number) => {
      const prev = built[structureId] ?? 0;
      const structure = data.structures.find((s) => s.id === structureId);
      const next = Math.max(0, Math.min(structure?.count ?? 0, value));
      if (next === prev) return;
      void optimistic(
        () => setBuilt((s) => ({ ...s, [structureId]: next })),
        () => setBuilt((s) => ({ ...s, [structureId]: prev })),
        { action: 'set_built', structureId, built: next }
      );
    },
    [built, data.structures, optimistic]
  );

  const setPalOwned = useCallback(
    (palId: string, count: number) => {
      const prev = owned[palId] ?? 0;
      const next = Math.max(0, Math.min(80, count));
      if (next === prev) return;
      void optimistic(
        () => setOwned((s) => ({ ...s, [palId]: next })),
        () => setOwned((s) => ({ ...s, [palId]: prev })),
        { action: 'set_pal_owned', palId, count: next }
      );
    },
    [owned, optimistic]
  );

  const updateSettings = useCallback(
    (patch: Partial<PalSettings>) => {
      const prev = settings;
      const next = { ...settings, ...patch };
      void optimistic(
        () => setSettings(next),
        () => setSettings(prev),
        { action: 'update_settings', config: next as unknown as Record<string, unknown> }
      );
    },
    [optimistic, settings]
  );

  const forceSync = useCallback(async () => {
    try {
      const res = await send({ action: 'sync' });
      showToast(`오버레이 갱신됨 — ${res.synced}줄`);
    } catch (e) {
      showToast(`갱신 실패: ${e instanceof Error ? e.message : String(e)}`);
    }
  }, [send, showToast]);

  const pct = (v: number) => `${Math.round(v * 100)}%`;

  // 건축물 진행률: 건축물별 비율의 평균이 아니라 지은 대수 / 전체 대수.
  // 평균으로 재면 20대짜리 침대와 1대짜리 진료소가 같은 무게가 된다.
  const buildProgress = (() => {
    const built = p.build.reduce((s, b) => s + b.built, 0);
    const total = p.build.reduce((s, b) => s + b.structure.count, 0);
    return total > 0 ? built / total : 1;
  })();

  return (
    <main className="pal">
      <header className="pal__top">
        <h1 className="pal__brand">팰월드 4거점 트래커</h1>
        <div className="pal__top-right">
          <span className="pal__stat">
            재료 <em>{pct(p.overall)}</em>
          </span>
          <span className="pal__stat">
            건축물 <em>{pct(buildProgress)}</em>
          </span>
          <span className="pal__stat">
            팰 <em>{pct(p.palOverall)}</em>
          </span>
          <a className="pal__link" href="/control">
            체크리스트 →
          </a>
        </div>
      </header>

      <nav className="pal__tabs">
        {TABS.map((t) => (
          <button
            key={t}
            className="pal__tab"
            data-active={t === tab ? 'true' : 'false'}
            onClick={() => selectTab(t)}
          >
            {t}
          </button>
        ))}
        <span className="pal__sync">
          {busy > 0 ? '저장 중…' : syncedAt ? `오버레이 ${syncedAt} 갱신` : '/o/pal'}
        </span>
      </nav>

      <div className="pal__body">
        {tab === '할 일' && (
          <TodoTab
            plan={p}
            settings={settings}
            onUpdateSettings={updateSettings}
            onSync={forceSync}
            onBuild={setBuiltCount}
            built={built}
            onCatch={setPalOwned}
            owned={owned}
          />
        )}
        {tab === '재고' && (
          <InventoryTab
            data={data}
            inventory={inventory}
            plan={p}
            onSet={setQty}
            onAdd={addQty}
          />
        )}
        {tab === '파밍' && <FarmTab plan={p} />}
        {tab === '제작' && <CraftTab plan={p} />}
        {tab === '거점' && (
          <BasesTab
            data={data}
            roster={roster}
            plan={p}
            built={built}
            owned={owned}
            onBuild={setBuiltCount}
            onCatch={setPalOwned}
          />
        )}
        {tab === '데이터' && <DataTab data={data} send={send} onToast={showToast} />}
      </div>

      {toast && <div className="pal__toast">{toast}</div>}
    </main>
  );
}
