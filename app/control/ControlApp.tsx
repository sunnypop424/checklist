'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { publicClient } from '@/lib/supabase';
import type { Item, List, MutateAction } from '@/lib/types';
import ChecklistPanel from '@/components/ChecklistPanel';

type Props = {
  controlKey: string;
  initialLists: List[];
};

export default function ControlApp({ controlKey, initialLists }: Props) {
  const [lists, setLists] = useState<List[]>(initialLists);
  const [activeId, setActiveId] = useState<string | null>(initialLists[0]?.id ?? null);
  const [items, setItems] = useState<Item[]>([]);
  const [toast, setToast] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [showPreview, setShowPreview] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [renamingList, setRenamingList] = useState(false);

  const addInputRef = useRef<HTMLInputElement>(null);

  // 키를 저장하고 주소창을 정리한다 (방송 중 브라우저가 화면에 잡혀도 키가 안 보이게)
  useEffect(() => {
    localStorage.setItem('control_key', controlKey);
    sessionStorage.setItem('control_key', controlKey);
    if (window.location.search) {
      window.history.replaceState(null, '', '/control');
    }
  }, [controlKey]);

  // 마지막으로 보던 리스트 복원
  useEffect(() => {
    const saved = localStorage.getItem('active_list_id');
    if (saved && initialLists.some((l) => l.id === saved)) setActiveId(saved);
  }, [initialLists]);

  useEffect(() => {
    if (activeId) localStorage.setItem('active_list_id', activeId);
  }, [activeId]);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2600);
  }, []);

  // ── 데이터 로드 ────────────────────────────────────────────
  const loadLists = useCallback(async () => {
    const db = publicClient();
    const { data } = await db
      .from('lists')
      .select('*')
      .order('sort', { ascending: true })
      .order('created_at', { ascending: true });
    if (data) setLists(data as List[]);
    return (data ?? []) as List[];
  }, []);

  const loadItems = useCallback(async (listId: string) => {
    const db = publicClient();
    const { data } = await db
      .from('items')
      .select('*')
      .eq('list_id', listId)
      .order('position', { ascending: true });
    if (data) setItems(data as Item[]);
  }, []);

  useEffect(() => {
    if (activeId) void loadItems(activeId);
    else setItems([]);
  }, [activeId, loadItems]);

  // 다른 기기(폰 등)에서 바꾼 내용 반영
  useEffect(() => {
    const onFocus = () => {
      void loadLists();
      if (activeId) void loadItems(activeId);
    };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [activeId, loadItems, loadLists]);

  // ── 서버 호출 ──────────────────────────────────────────────
  const send = useCallback(
    async (payload: MutateAction) => {
      const res = await fetch('/api/mutate', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-control-key': controlKey },
        body: JSON.stringify(payload),
      });
      const json = await res.json().catch(() => ({ ok: false, error: '응답 파싱 실패' }));
      if (!res.ok || !json.ok) throw new Error(json.error || `HTTP ${res.status}`);
      return json;
    },
    [controlKey]
  );

  /** 낙관적 업데이트 → 실패 시 롤백 */
  const optimistic = useCallback(
    async (apply: () => void, payload: MutateAction) => {
      const snapshot = items;
      apply();
      try {
        await send(payload);
      } catch (e) {
        setItems(snapshot);
        showToast(`실패: ${e instanceof Error ? e.message : String(e)}`);
      }
    },
    [items, send, showToast]
  );

  // ── 항목 조작 ──────────────────────────────────────────────
  const toggle = useCallback(
    (item: Item) => {
      void optimistic(
        () => setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, done: !i.done } : i))),
        { action: 'update_item', itemId: item.id, done: !item.done }
      );
    },
    [optimistic]
  );

  const rename = useCallback(
    (item: Item, label: string) => {
      const next = label.trim();
      setEditingId(null);
      if (!next || next === item.label) return;
      void optimistic(
        () => setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, label: next } : i))),
        { action: 'update_item', itemId: item.id, label: next }
      );
    },
    [optimistic]
  );

  const remove = useCallback(
    (item: Item) => {
      void optimistic(
        () => setItems((prev) => prev.filter((i) => i.id !== item.id)),
        { action: 'delete_item', itemId: item.id }
      );
    },
    [optimistic]
  );

  const move = useCallback(
    (index: number, delta: number) => {
      const target = index + delta;
      if (target < 0 || target >= items.length || !activeId) return;
      const next = [...items];
      const tmp = next[index];
      next[index] = next[target];
      next[target] = tmp;
      void optimistic(() => setItems(next), {
        action: 'reorder_items',
        listId: activeId,
        ids: next.map((i) => i.id),
      });
    },
    [activeId, items, optimistic]
  );

  const addItem = useCallback(
    async (label: string) => {
      const text = label.trim();
      if (!text || !activeId) return;
      try {
        const res = await send({ action: 'add_item', listId: activeId, label: text });
        setItems((prev) => [...prev, res.item as Item]);
      } catch (e) {
        showToast(`추가 실패: ${e instanceof Error ? e.message : String(e)}`);
      }
    },
    [activeId, send, showToast]
  );

  const resetAll = useCallback(() => {
    if (!activeId) return;
    void optimistic(
      () => setItems((prev) => prev.map((i) => ({ ...i, done: false }))),
      { action: 'reset_list', listId: activeId }
    );
  }, [activeId, optimistic]);

  // ── 리스트 조작 ────────────────────────────────────────────
  const createList = useCallback(async () => {
    const title = window.prompt('새 체크리스트 이름', '새 체크리스트');
    if (title === null) return;
    try {
      const res = await send({ action: 'create_list', title });
      await loadLists();
      setActiveId((res.list as List).id);
    } catch (e) {
      showToast(`생성 실패: ${e instanceof Error ? e.message : String(e)}`);
    }
  }, [loadLists, send, showToast]);

  const renameList = useCallback(
    async (title: string) => {
      setRenamingList(false);
      const next = title.trim();
      const current = lists.find((l) => l.id === activeId);
      if (!activeId || !next || !current || next === current.title) return;
      setLists((prev) => prev.map((l) => (l.id === activeId ? { ...l, title: next } : l)));
      try {
        await send({ action: 'rename_list', listId: activeId, title: next });
      } catch (e) {
        await loadLists();
        showToast(`이름 변경 실패: ${e instanceof Error ? e.message : String(e)}`);
      }
    },
    [activeId, lists, loadLists, send, showToast]
  );

  const deleteList = useCallback(async () => {
    if (!activeId) return;
    const current = lists.find((l) => l.id === activeId);
    const ok = window.confirm(
      `"${current?.title}" 체크리스트를 삭제할까요? 항목도 함께 지워집니다.`
    );
    if (!ok) return;
    try {
      await send({ action: 'delete_list', listId: activeId });
      const next = await loadLists();
      setActiveId(next[0]?.id ?? null);
    } catch (e) {
      showToast(`삭제 실패: ${e instanceof Error ? e.message : String(e)}`);
    }
  }, [activeId, lists, loadLists, send, showToast]);

  const copyOverlayUrl = useCallback(() => {
    if (!activeId) return;
    const url = `${window.location.origin}/o/${activeId}`;
    void navigator.clipboard.writeText(url).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      },
      () => showToast(`복사 실패. 직접 복사하세요: ${url}`)
    );
  }, [activeId, showToast]);

  // ── 숫자키 1~9 로 N번째 항목 토글 ──────────────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const n = Number(e.key);
      if (!Number.isInteger(n) || n < 1 || n > 9) return;
      const item = items[n - 1];
      if (item) {
        e.preventDefault();
        toggle(item);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [items, toggle]);

  const activeList = lists.find((l) => l.id === activeId) ?? null;
  const doneCount = items.filter((i) => i.done).length;

  return (
    <main className="control">
      <header className="control__top">
        <h1 className="control__brand">
          방송 체크리스트
        </h1>
        <a className="control__hint" href="#help">
          OBS 설정법
        </a>
      </header>

      {/* ── 리스트 전환 ── */}
      <section className="lists">
        <div className="lists__row">
          {lists.map((l) => (
            <button
              key={l.id}
              className="pill"
              data-active={l.id === activeId ? 'true' : 'false'}
              onClick={() => setActiveId(l.id)}
            >
              {l.title}
            </button>
          ))}
          <button className="pill pill--add" onClick={createList}>
            + 새 체크리스트
          </button>
        </div>
      </section>

      {activeList ? (
        <>
          {/* ── 툴바 ── */}
          <section className="toolbar">
            {renamingList ? (
              <input
                className="toolbar__rename"
                defaultValue={activeList.title}
                autoFocus
                onBlur={(e) => void renameList(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                  if (e.key === 'Escape') setRenamingList(false);
                }}
              />
            ) : (
              <button
                className="toolbar__title"
                onClick={() => setRenamingList(true)}
                title="클릭해서 이름 변경"
              >
                {activeList.title}
                <span className="toolbar__counter">
                  {doneCount} / {items.length}
                </span>
              </button>
            )}

            <div className="toolbar__actions">
              <button className="btn" onClick={resetAll} disabled={doneCount === 0}>
                전체 해제
              </button>
              <button className="btn" onClick={copyOverlayUrl}>
                {copied ? '복사됨 ✓' : 'OBS URL 복사'}
              </button>
              <button
                className="btn"
                onClick={() => setShowPreview((v) => !v)}
                aria-pressed={showPreview}
              >
                미리보기 {showPreview ? '끄기' : '켜기'}
              </button>
              <button className="btn btn--danger" onClick={deleteList}>
                리스트 삭제
              </button>
            </div>
          </section>

          <div className="control__body">
            {/* ── 항목 편집 ── */}
            <section className="editor">
              <ul className="editor__list">
                {items.map((item, index) => (
                  <li key={item.id} className="erow" data-done={item.done ? 'true' : 'false'}>
                    <button
                      className="erow__check"
                      onClick={() => toggle(item)}
                      aria-pressed={item.done}
                      title={`${index + 1}번 키로도 토글`}
                    >
                      <svg viewBox="0 0 24 24" focusable="false">
                        <path d="M4.5 12.5l5 5 10-11" />
                      </svg>
                    </button>

                    <span className="erow__num">{index < 9 ? index + 1 : ''}</span>

                    {editingId === item.id ? (
                      <input
                        className="erow__input"
                        defaultValue={item.label}
                        autoFocus
                        onBlur={(e) => rename(item, e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                          if (e.key === 'Escape') setEditingId(null);
                        }}
                      />
                    ) : (
                      <button className="erow__label" onClick={() => setEditingId(item.id)}>
                        {item.label}
                      </button>
                    )}

                    <div className="erow__tools">
                      <button
                        className="icon"
                        onClick={() => move(index, -1)}
                        disabled={index === 0}
                        title="위로"
                      >
                        ↑
                      </button>
                      <button
                        className="icon"
                        onClick={() => move(index, 1)}
                        disabled={index === items.length - 1}
                        title="아래로"
                      >
                        ↓
                      </button>
                      <button
                        className="icon icon--danger"
                        onClick={() => remove(item)}
                        title="삭제"
                      >
                        ×
                      </button>
                    </div>
                  </li>
                ))}
              </ul>

              <form
                className="add"
                onSubmit={(e) => {
                  e.preventDefault();
                  const input = addInputRef.current;
                  if (!input) return;
                  const value = input.value;
                  input.value = '';
                  input.focus(); // 마우스 없이 연속 입력
                  void addItem(value);
                }}
              >
                <input
                  ref={addInputRef}
                  className="add__input"
                  placeholder="항목 입력 후 Enter"
                  onPaste={(e) => {
                    const text = e.clipboardData.getData('text');
                    const lines = text
                      .split(/\r?\n/)
                      .map((s) => s.trim())
                      .filter(Boolean);
                    if (lines.length > 1) {
                      e.preventDefault();
                      void (async () => {
                        for (const line of lines) await addItem(line);
                      })();
                    }
                  }}
                />
                <button type="submit" className="btn btn--brand">
                  추가
                </button>
              </form>
              <p className="add__hint">
                여러 줄을 붙여넣으면 한 번에 등록됩니다. 숫자키 <kbd>1</kbd>~<kbd>9</kbd> 로 토글.
              </p>
            </section>

            {/* ── 미리보기 ── */}
            {showPreview && (
              <section className="preview">
                <div className="preview__label">OBS 에 나가는 화면 (420 × 720)</div>
                <div className="preview__stage">
                  <div className="overlay-root">
                    <ChecklistPanel title={activeList.title} items={items} />
                  </div>
                </div>
                <div className="preview__url">
                  <code>/o/{activeList.id}</code>
                </div>
              </section>
            )}
          </div>

          <section id="help" className="help">
            <h2>OBS 설정</h2>
            <ol>
              <li>
                소스 추가 → <b>브라우저</b>, URL 은 위 <b>OBS URL 복사</b> 버튼으로 복사한 주소
              </li>
              <li>
                너비 <b>420</b>, 높이 <b>720</b>
              </li>
              <li>
                <b>소스가 보이지 않을 때 종료</b> 체크 해제
              </li>
              <li>
                <b>장면이 활성화될 때 브라우저 새로고침</b> 체크 해제
              </li>
              <li>
                <b>사용자 지정 프레임 속도</b> 체크 후 <b>30</b> fps
              </li>
              <li>사용자 지정 CSS 는 기본값 그대로 둘 것</li>
            </ol>
            <p className="help__note">
              글자를 키우려면 OBS 변형 핸들로 늘리지 말고 URL 뒤에 <code>?scale=1.25</code> 를 붙이고
              소스 속성의 너비·높이를 키우세요. 동기화 상태를 확인하려면 <code>?debug=1</code>.
            </p>
          </section>
        </>
      ) : (
        <section className="empty">
          <p>체크리스트가 없습니다.</p>
          <button className="btn btn--brand" onClick={createList}>
            첫 체크리스트 만들기
          </button>
        </section>
      )}

      {toast && <div className="toast">{toast}</div>}
    </main>
  );
}
