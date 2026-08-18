'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { publicClient } from '@/lib/supabase';
import type { Item, List } from '@/lib/types';
import ChecklistPanel from '@/components/ChecklistPanel';

type Props = {
  listId: string;
  initialList: List;
  initialItems: Item[];
  scale: number;
  debug: boolean;
  hideDone: boolean;
  hideProgress: boolean;
  sortDone: boolean;
  hideEmpty: boolean;
};

const POLL_NORMAL = 15_000;
const POLL_DEGRADED = 5_000;
const WATCHDOG_MS = 30_000;

export default function Overlay({
  listId,
  initialList,
  initialItems,
  scale,
  debug,
  hideDone,
  hideProgress,
  sortDone,
  hideEmpty,
}: Props) {
  const [list, setList] = useState<List>(initialList);
  const [items, setItems] = useState<Item[]>(initialItems);
  const [connected, setConnected] = useState(false);
  const [lastSync, setLastSync] = useState<number>(Date.now());

  const lastSubscribedAt = useRef<number>(Date.now());
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlight = useRef(false);

  /** 리스트 전체를 다시 읽는다. payload 를 패치하지 않고 항상 통째로 가져와 자체 복구되게 한다. */
  const refetch = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      const db = publicClient();
      const [listRes, itemsRes] = await Promise.all([
        db.from('lists').select('*').eq('id', listId).maybeSingle(),
        db.from('items').select('*').eq('list_id', listId).order('position', { ascending: true }),
      ]);
      if (listRes.data) setList(listRes.data as List);
      if (itemsRes.data) setItems(itemsRes.data as Item[]);
      if (!listRes.error && !itemsRes.error) setLastSync(Date.now());
    } catch {
      /* 다음 폴링에서 재시도 */
    } finally {
      inFlight.current = false;
    }
  }, [listId]);

  /** 여러 이벤트가 몰려와도(예: 전체 해제) 쿼리 한 번으로 합친다 */
  const scheduleRefetch = useCallback(() => {
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    debounceTimer.current = setTimeout(() => {
      void refetch();
    }, 80);
  }, [refetch]);

  // ── Realtime 구독 (백오프 재구독 포함) ──────────────────────
  useEffect(() => {
    const db = publicClient();
    let channel: RealtimeChannel | null = null;
    let retry = 0;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let disposed = false;

    const connect = () => {
      if (disposed) return;

      channel = db
        .channel(`checklist:${listId}:${retry}`)
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'items', filter: `list_id=eq.${listId}` },
          scheduleRefetch
        )
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'lists', filter: `id=eq.${listId}` },
          scheduleRefetch
        )
        .subscribe((status) => {
          if (disposed) return;

          if (status === 'SUBSCRIBED') {
            retry = 0;
            lastSubscribedAt.current = Date.now();
            setConnected(true);
            // 재연결 직후 재동기화 — 실질적으로 가장 중요한 방어
            void refetch();
            return;
          }

          if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
            setConnected(false);
            if (channel) {
              void db.removeChannel(channel);
              channel = null;
            }
            const delay = Math.min(10_000, 1_000 * 2 ** retry) + Math.random() * 500;
            retry += 1;
            retryTimer = setTimeout(connect, delay);
          }
        });
    };

    connect();

    return () => {
      disposed = true;
      if (retryTimer) clearTimeout(retryTimer);
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
      if (channel) void db.removeChannel(channel);
    };
  }, [listId, refetch, scheduleRefetch]);

  // ── 폴링 폴백 + 워치독 ─────────────────────────────────────
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;

    const tick = () => {
      void refetch();
      const stale = Date.now() - lastSubscribedAt.current > WATCHDOG_MS;
      timer = setTimeout(tick, !connected && stale ? POLL_DEGRADED : POLL_NORMAL);
    };

    timer = setTimeout(tick, connected ? POLL_NORMAL : POLL_DEGRADED);
    return () => clearTimeout(timer);
  }, [refetch, connected]);

  // ── 네트워크 복구 / 탭 표시 시 즉시 재동기화 ────────────────
  useEffect(() => {
    const onOnline = () => void refetch();
    const onVisible = () => {
      if (document.visibilityState === 'visible') void refetch();
    };
    window.addEventListener('online', onOnline);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.removeEventListener('online', onOnline);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [refetch]);

  const age = Date.now() - lastSync;
  const dot = connected ? 'ok' : age < 30_000 ? 'poll' : 'stale';

  return (
    <div className="overlay-root" style={{ fontSize: `${scale}rem` }} data-debug={debug ? 'true' : 'false'}>
      <ChecklistPanel
        title={list.title}
        items={items}
        hideDone={hideDone}
        hideProgress={hideProgress}
        sortDone={sortDone}
        hideEmpty={hideEmpty}
      />
      {debug && (
        <div className="overlay-debug">
          <span className="overlay-debug__dot" data-state={dot} />
          {connected ? 'realtime' : 'polling'} · {Math.round(age / 1000)}s · {items.length}개
        </div>
      )}
    </div>
  );
}
