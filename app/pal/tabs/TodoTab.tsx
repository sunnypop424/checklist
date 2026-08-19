'use client';

import { useMemo } from 'react';
import ChecklistPanel from '@/components/ChecklistPanel';
import { toChecklist } from '@/lib/pal/engine';
import type { PalSettings } from '@/lib/pal/db';
import type { BuiltMap, OwnedPals, PalPlan } from '@/lib/pal/types';
import type { Item as ListItem } from '@/lib/types';
import { nf, pct } from './format';

type Props = {
  plan: PalPlan;
  settings: PalSettings;
  built: BuiltMap;
  owned: OwnedPals;
  onUpdateSettings: (patch: Partial<PalSettings>) => void;
  onSync: () => void;
  onBuild: (structureId: string, value: number) => void;
  onCatch: (palId: string, count: number) => void;
};

/**
 * 앱을 열면 처음 보이는 화면.
 * 순서는 기획서 8-3 그대로: 막고 있는 시설 → 지금 지을 수 있는 것 → 파밍 → 팰 포획.
 */
export default function TodoTab({
  plan,
  settings,
  built,
  owned,
  onUpdateSettings,
  onSync,
  onBuild,
  onCatch,
}: Props) {
  const locked = plan.farm.filter((t) => t.lockedBy);
  const ready = plan.build.filter((b) => b.ready).slice(0, 6);
  const farming = plan.farm.filter((t) => !t.lockedBy).slice(0, 6);
  const catches = plan.palCatches.slice(0, 6);

  const nothing =
    locked.length === 0 && ready.length === 0 && farming.length === 0 && catches.length === 0;

  // 건축물별 비율의 평균이 아니라 "지은 대수 / 전체 대수".
  // 평균으로 재면 20대짜리 침대와 1대짜리 진료소가 같은 무게가 돼서
  // 진료소 하나 지었을 뿐인데 진행률이 훌쩍 뛴다.
  const builtTotal = plan.build.reduce((s, b) => s + b.built, 0);
  const countTotal = plan.build.reduce((s, b) => s + b.structure.count, 0);
  const buildProgress = countTotal > 0 ? builtTotal / countTotal : 1;

  const palFilled = plan.palNeeds.reduce((s, n) => s + n.filled, 0);
  const palSlots = plan.palNeeds.reduce((s, n) => s + n.need, 0);

  // 오버레이에 실제로 나갈 줄. 서버가 sync 할 때 쓰는 함수와 같은 것을 그대로 쓴다.
  const preview = useMemo(
    () =>
      toChecklist(plan, {
        limit: settings.limit,
        showTotals: settings.showTotals,
        mode: settings.mode,
      }),
    [plan, settings.limit, settings.showTotals, settings.mode]
  );

  // ChecklistPanel 은 오버레이가 쓰는 것과 동일한 컴포넌트라, 여기 보이는 게 곧 방송 화면이다
  const previewItems: ListItem[] = preview.map((l) => ({
    id: l.ref,
    list_id: 'pal',
    label: l.label,
    done: l.done,
    position: l.position,
    ref: l.ref,
    created_at: '',
  }));

  return (
    <div className="todo">
      <div className="todo__cols">
        <div className="todo__main">
          <section className="card">
            <div className="card__head">
              <h2>전체 진행률</h2>
            </div>
            <div className="gauges">
              <Gauge label="최하위 재료" value={plan.overall} />
              <Gauge label="건축물" value={buildProgress} hint={`${builtTotal} / ${countTotal}대`} />
              <Gauge label="팰 배치" value={plan.palOverall} hint={`${palFilled} / ${palSlots}마리`} />
            </div>

            {plan.bottlenecks.length > 0 && (
              <>
                <h3 className="card__sub">병목 재료 상위 5</h3>
                <ul className="bottleneck">
                  {plan.bottlenecks.map((b) => (
                    <li key={b.id}>
                      <span className="bottleneck__name">{b.name}</span>
                      <span className="bar">
                        <span className="bar__fill" style={{ width: `${b.progress * 100}%` }} />
                      </span>
                      <span className="bottleneck__num">
                        {nf(b.have)} / {nf(b.need)}
                      </span>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </section>

          <section className="card">
            <div className="card__head">
              <h2>다음에 할 일</h2>
            </div>

            {nothing && <p className="muted">할 일이 없습니다. 4거점이 전부 완성됐습니다.</p>}

            {locked.length > 0 && (
              <Group title="먼저 지어야 자동 파밍이 시작됩니다">
                {locked.map((t) => (
                  <li key={t.source.id} className="task task--urgent">
                    <div className="task__body">
                      <span className="task__title">
                        <b>{t.lockedBy!.name}</b> 건설
                      </span>
                      <small>
                        {t.source.name} 해금 — {t.items.length}종 자동 생산
                      </small>
                    </div>
                    <button
                      className="btn btn--sm btn--brand"
                      onClick={() => onBuild(t.lockedBy!.id, (built[t.lockedBy!.id] ?? 0) + 1)}
                    >
                      1대 지음
                    </button>
                  </li>
                ))}
              </Group>
            )}

            {ready.length > 0 && (
              <Group title="재료가 충분해서 지금 지을 수 있습니다">
                {ready.map((b) => (
                  <li key={b.structure.id} className="task task--ready">
                    <div className="task__body">
                      <span className="task__title">
                        <b>{b.structure.name}</b>
                      </span>
                      <small>
                        {b.base?.name} · {b.built}/{b.structure.count}대
                      </small>
                    </div>
                    <button
                      className="btn btn--sm btn--brand"
                      onClick={() => onBuild(b.structure.id, b.built + 1)}
                    >
                      1대 지음
                    </button>
                  </li>
                ))}
              </Group>
            )}

            {farming.length > 0 && (
              <Group title="파밍">
                {farming.map((t) => {
                  const top = t.items[0];
                  return (
                    <li key={t.source.id} className="task">
                      <div className="task__body">
                        <span className="task__title">
                          <b>{t.source.name}</b>
                          {t.source.method === 'manual' && (
                            <span className="chip chip--manual">수동</span>
                          )}
                        </span>
                        <small>
                          {top ? `${top.name} ${nf(top.have)} / ${nf(top.need)}` : ''}
                          {t.source.place ? ` · ${t.source.place}` : ''}
                        </small>
                      </div>
                      <span className="bar bar--sm">
                        <span className="bar__fill" style={{ width: `${t.progress * 100}%` }} />
                      </span>
                      <span className="task__pct">{pct(t.progress)}</span>
                    </li>
                  );
                })}
              </Group>
            )}

            {catches.length > 0 && (
              <Group title="거점에 배치할 팰 확보">
                {catches.map((c) => (
                  <li key={c.pal.id} className="task">
                    <div className="task__body">
                      <span className="task__title">
                        <b>{c.pal.name}</b>
                        <span className="chip">{c.short}마리</span>
                        {c.via === 'breed' && <span className="chip chip--breed">배합</span>}
                        {c.pal.nocturnal && <span className="chip chip--night">야행성</span>}
                      </span>
                      <small>
                        {c.roles.map((r) => `${r.baseName} ${r.role}`.trim()).join(' · ')}
                        {c.pal.source ? ` · ${c.pal.source}` : ''}
                      </small>
                      {c.missingParents.length > 0 && (
                        <small className="task__blocked">
                          배합 부모: {c.missingParents.map((p) => p.name).join(' · ')} 필요
                        </small>
                      )}
                      {c.missingConditions.length > 0 && (
                        <small className="task__blocked">
                          소지 조건: {c.missingConditions.map((p) => p.name).join(' · ')} 풀농축 필요
                        </small>
                      )}
                      {c.note && <small>{c.note}</small>}
                    </div>
                    <button
                      className="btn btn--sm"
                      onClick={() => onCatch(c.pal.id, (owned[c.pal.id] ?? 0) + 1)}
                    >
                      확보 +1
                    </button>
                  </li>
                ))}
              </Group>
            )}
          </section>
        </div>

        <aside className="todo__side">
          <section className="card">
            <div className="card__head">
              <h2>오버레이 미리보기</h2>
              <button className="btn btn--sm" onClick={onSync}>
                지금 갱신
              </button>
            </div>

            <p className="muted">
              여기 보이는 그대로 <code>/o/pal</code> 에 나갑니다.
            </p>

            <div className="ovpreview">
              <div className="overlay-root" style={{ fontSize: '0.85rem' }}>
                <ChecklistPanel title="팰월드 4거점" items={previewItems} sortDone={false} />
              </div>
            </div>

            <div className="settings">
              <label className="check">
                <input
                  type="checkbox"
                  checked={settings.mode === 'focus'}
                  onChange={(e) => onUpdateSettings({ mode: e.target.checked ? 'focus' : 'full' })}
                />
                <span>
                  집중 모드
                  <small>
                    지금 할 것 위주로 몇 줄만 띄웁니다. 끄면 표시 항목 수만큼 꽉 채웁니다.
                  </small>
                </span>
              </label>
              <label className="check">
                <input
                  type="checkbox"
                  checked={settings.showTotals}
                  onChange={(e) => onUpdateSettings({ showTotals: e.target.checked })}
                />
                <span>
                  총량 표시
                  <small>끄면 &quot;발화 기관 32%&quot; 처럼 비율만 방송에 나갑니다</small>
                </span>
              </label>
              <label className="check">
                <input
                  type="checkbox"
                  checked={settings.autoSync}
                  onChange={(e) => onUpdateSettings({ autoSync: e.target.checked })}
                />
                <span>
                  자동 갱신
                  <small>재고를 고칠 때마다 오버레이를 다시 밀어넣습니다</small>
                </span>
              </label>
              <label className="field">
                <span>표시 항목 수</span>
                <input
                  type="number"
                  min={1}
                  max={30}
                  value={settings.limit}
                  onChange={(e) => onUpdateSettings({ limit: Number(e.target.value) })}
                />
              </label>
            </div>

            <p className="muted">
              OBS 브라우저 소스 URL 은 <code>/o/pal</code> 입니다. 체크리스트 오버레이와 같은
              방식이라 기존 소스를 복제해 URL 만 바꾸면 됩니다. 크기·글자 크기 옵션은{' '}
              <a href="/control">컨트롤 화면</a>에서 조정할 수 있습니다.
            </p>
          </section>
        </aside>
      </div>
    </div>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <>
      <h3 className="card__sub">{title}</h3>
      <ul className="tasks">{children}</ul>
    </>
  );
}

function Gauge({ label, value, hint }: { label: string; value: number; hint?: string }) {
  return (
    <div className="gauge">
      <div className="gauge__label">{label}</div>
      <div className="gauge__value">{pct(value)}</div>
      <span className="bar">
        <span className="bar__fill" style={{ width: `${value * 100}%` }} />
      </span>
      {hint && <div className="gauge__hint">{hint}</div>}
    </div>
  );
}
