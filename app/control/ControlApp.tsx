'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { publicClient } from '@/lib/supabase';
import { isPalList, type Item, type List, type MutateAction } from '@/lib/types';
import ChecklistPanel from '@/components/ChecklistPanel';
import OverlayOptionsPanel from './OverlayOptions';
import {
  DEFAULT_OPTIONS,
  buildOverlayPath,
  loadOptions,
  saveOptions,
  type OverlayOptions,
} from '@/lib/overlayOptions';

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
  const [showOptions, setShowOptions] = useState(true);
  const [showPreview, setShowPreview] = useState(true);
  const [helpOpen, setHelpOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [renamingList, setRenamingList] = useState(false);
  const [options, setOptions] = useState<OverlayOptions>(DEFAULT_OPTIONS);

  const addInputRef = useRef<HTMLInputElement>(null);
  const previewRef = useRef<HTMLElement>(null);
  /** 미리보기 칼럼의 실제 너비 — 창 크기에 따라 미리보기를 축소하는 기준 */
  const [previewWidth, setPreviewWidth] = useState(420);
  /** 내가 방금 보낸 변경이 실시간 이벤트로 되돌아와 낙관적 상태를 덮어쓰지 않게 하는 가드 */
  const mutatedAt = useRef(0);

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

  // 미리보기 칼럼 폭을 실제로 재서 축소 비율을 정한다.
  // 고정값(420)으로 계산하면 창이 좁아졌을 때 미리보기가 잘려나간다.
  useEffect(() => {
    const el = previewRef.current;
    if (!el) return;
    const measure = () => setPreviewWidth(el.clientWidth || 420);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [showOptions, showPreview]);

  // 패널 접힘 상태 복원
  useEffect(() => {
    setShowOptions(localStorage.getItem('show_options') !== '0');
    setShowPreview(localStorage.getItem('show_preview') !== '0');
  }, []);

  const toggleOptions = useCallback(() => {
    setShowOptions((v) => {
      localStorage.setItem('show_options', v ? '0' : '1');
      return !v;
    });
  }, []);

  const togglePreview = useCallback(() => {
    setShowPreview((v) => {
      localStorage.setItem('show_preview', v ? '0' : '1');
      return !v;
    });
  }, []);

  // 옵션은 리스트마다 따로 기억한다 (리스트별로 OBS 소스가 다를 수 있다)
  useEffect(() => {
    setOptions(activeId ? loadOptions(activeId) : DEFAULT_OPTIONS);
  }, [activeId]);

  const updateOptions = useCallback(
    (next: OverlayOptions) => {
      setOptions(next);
      if (activeId) saveOptions(activeId, next);
    },
    [activeId]
  );

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

  // 다른 기기(폰)에서 바꾼 내용을 실시간으로 받는다.
  // 내가 방금 보낸 변경(1.5초 이내)은 무시한다 — 낙관적 UI 가 되돌아가 깜빡이는 걸 막는다.
  useEffect(() => {
    if (!activeId) return;
    const db = publicClient();
    let timer: ReturnType<typeof setTimeout> | null = null;
    let channel: RealtimeChannel | null = null;

    const onChange = () => {
      if (Date.now() - mutatedAt.current < 1500) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        if (Date.now() - mutatedAt.current < 1500) return;
        void loadItems(activeId);
        void loadLists();
      }, 250);
    };

    channel = db
      .channel(`control:${activeId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'items', filter: `list_id=eq.${activeId}` },
        onChange
      )
      .on('postgres_changes', { event: '*', schema: 'public', table: 'lists' }, onChange)
      .subscribe();

    return () => {
      if (timer) clearTimeout(timer);
      if (channel) void db.removeChannel(channel);
    };
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
      mutatedAt.current = Date.now();
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
    const url = `${window.location.origin}${buildOverlayPath(activeId, options)}`;
    void navigator.clipboard.writeText(url).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      },
      () => showToast(`복사 실패. 직접 복사하세요: ${url}`)
    );
  }, [activeId, options, showToast]);

  const activeList = lists.find((l) => l.id === activeId) ?? null;
  /** 팰월드 트래커가 채우는 목록 — 여기서는 읽기 전용이다 (다음 sync 가 덮어쓴다) */
  const readOnly = isPalList(activeList);

  // ── 숫자키 1~9 로 N번째 항목 토글 / Esc 로 모달 닫기 ───────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && helpOpen) {
        setHelpOpen(false);
        return;
      }
      // 모달이 떠 있는 동안은 뒤쪽 체크리스트가 반응하면 안 된다
      if (helpOpen) return;
      // 트래커 목록은 완료 여부가 재고에서 나온다 — 손으로 토글하면 안 된다
      if (readOnly) return;
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
  }, [helpOpen, items, readOnly, toggle]);

  const doneCount = items.filter((i) => i.done).length;
  // 미리보기 칼럼 폭에 맞춘 축소 비율 (소스가 더 크면 줄여서 보여준다)
  const fit = Math.min(1, previewWidth / options.width);

  return (
    <main className="control">
      <header className="control__top">
        <h1 className="control__brand">
          방송 체크리스트
        </h1>
        <button className="control__hint" onClick={() => setHelpOpen(true)}>
          OBS 설정법
        </button>
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
              {isPalList(l) && (
                <span className="pill__bot" aria-hidden="true">
                  🤖
                </span>
              )}
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

            {readOnly && (
              <a className="managed" href="/pal">
                🤖 트래커가 관리 — /pal 에서 수정
              </a>
            )}
          </section>

          <div className="control__body" data-aside={showOptions || showPreview ? 'true' : 'false'}>
            {/* ── 항목 편집 ── */}
            <section className="editor">
              <ul className="editor__list">
                {items.map((item, index) => (
                  <li key={item.id} className="erow" data-done={item.done ? 'true' : 'false'}>
                    <button
                      className="erow__check"
                      onClick={() => toggle(item)}
                      aria-pressed={item.done}
                      disabled={readOnly}
                      title={readOnly ? '재고에 따라 자동으로 결정됩니다' : `${index + 1}번 키로도 토글`}
                    >
                      <svg viewBox="0 0 24 24" focusable="false">
                        <path d="M4.5 12.5l5 5 10-11" />
                      </svg>
                    </button>

                    <span className="erow__num">{readOnly || index >= 9 ? '' : index + 1}</span>

                    {readOnly ? (
                      <span className="erow__label erow__label--static">{item.label}</span>
                    ) : editingId === item.id ? (
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

                    {!readOnly && (
                      <div className="erow__tools">
                        <button
                          className="icon icon--danger"
                          onClick={() => remove(item)}
                          title="삭제"
                        >
                          ×
                        </button>
                      </div>
                    )}
                  </li>
                ))}
              </ul>

              {readOnly ? (
                <p className="add__hint add__hint--managed">
                  이 목록은 팰월드 트래커가 채웁니다. 항목 추가·수정·체크는{' '}
                  <a href="/pal">/pal</a> 에서 재고를 입력하면 자동으로 반영됩니다.
                </p>
              ) : (
                <>
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
                    여러 줄을 붙여넣으면 한 번에 등록됩니다. 숫자키 <kbd>1</kbd>~<kbd>9</kbd> 로
                    토글.
                  </p>
                </>
              )}

              {/* 방송 중 자주 쓰는 건 체크 토글뿐이라, 나머지 버튼은 목록 아래로 내렸다 */}
              <div className="editor__actions">
                {!readOnly && (
                  <button className="btn" onClick={resetAll} disabled={doneCount === 0}>
                    전체 해제
                  </button>
                )}
                <button className="btn" onClick={copyOverlayUrl}>
                  {copied ? '복사됨 ✓' : 'OBS URL 복사'}
                </button>
                <button className="btn" onClick={toggleOptions} aria-pressed={showOptions}>
                  옵션 {showOptions ? '끄기' : '켜기'}
                </button>
                <button className="btn" onClick={togglePreview} aria-pressed={showPreview}>
                  미리보기 {showPreview ? '끄기' : '켜기'}
                </button>
                <button className="btn btn--danger" onClick={deleteList}>
                  리스트 삭제
                </button>
              </div>
            </section>

            {/* ── 옵션 + 미리보기 ── */}
            {(showOptions || showPreview) && (
              <section className="preview" ref={previewRef}>
                {showOptions && (
                  <OverlayOptionsPanel
                    value={options}
                    onChange={updateOptions}
                    onReset={() => updateOptions(DEFAULT_OPTIONS)}
                    urlPath={buildOverlayPath(activeList.id, options)}
                    copied={copied}
                    onCopy={copyOverlayUrl}
                  />
                )}

                {showPreview && (
                  <>
                    <div className="preview__label">
                      미리보기
                      <span className="preview__dim">
                        {options.width} × {options.height}
                        {fit < 1 && ` · ${Math.round(fit * 100)}% 축소 표시`}
                      </span>
                    </div>

                    {/* 실제 소스 크기 그대로 그린 뒤, 칼럼에 안 들어가면 통째로 축소한다 */}
                    <div className="preview__frame" style={{ height: options.height * fit }}>
                      <div
                        className="preview__stage"
                        style={{
                          width: options.width,
                          height: options.height,
                          transform: fit < 1 ? `scale(${fit})` : undefined,
                        }}
                      >
                        <div className="overlay-root" style={{ fontSize: `${options.scale}rem` }}>
                          <ChecklistPanel
                            title={activeList.title}
                            items={items}
                            hideDone={options.hideDone}
                            hideProgress={options.hideProgress}
                            sortDone={options.sortDone}
                            hideEmpty={options.hideEmpty}
                          />
                        </div>
                      </div>
                    </div>
                  </>
                )}
              </section>
            )}
          </div>

          {/* ── OBS 설정법 (모달) ── */}
          {helpOpen && (
            <div
              className="modal"
              role="dialog"
              aria-modal="true"
              aria-labelledby="help-title"
              onClick={() => setHelpOpen(false)}
            >
              <div className="modal__panel" onClick={(e) => e.stopPropagation()}>
                <div className="modal__head">
                  <h2 id="help-title" className="modal__title">
                    OBS 설정
                  </h2>
                  <button
                    className="modal__close"
                    onClick={() => setHelpOpen(false)}
                    aria-label="닫기"
                    autoFocus
                  >
                    ×
                  </button>
                </div>

                <div className="help">
                  <ol>
                    <li>
                      소스 추가 → <b>브라우저</b>, URL 은 툴바의 <b>OBS URL 복사</b> 버튼으로 복사한
                      주소
                    </li>
                    <li>
                      너비 <b>{options.width}</b>, 높이 <b>{options.height}</b> (오버레이 옵션에서
                      바꿀 수 있습니다)
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
                    글자 크기는 OBS 변형 핸들로 늘리지 마세요 — 소스 해상도로 렌더한 걸 OBS 가 다시
                    늘리기 때문에 글자가 뭉개집니다. <b>오버레이 옵션</b>에서 글자 크기와 소스 크기를
                    바꾸면 어느 크기에서도 선명합니다.
                  </p>
                </div>
              </div>
            </div>
          )}
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
