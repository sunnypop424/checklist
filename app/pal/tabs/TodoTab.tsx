'use client';

import { useState } from 'react';
import type { BuildTask, BuiltMap, FarmTask, Inventory, OwnedPals, PalPlan } from '@/lib/pal/types';
import { nf, pct } from './format';

type Props = {
  plan: PalPlan;
  built: BuiltMap;
  owned: OwnedPals;
  inventory: Inventory;
  onSync: () => void;
  onBuild: (structureId: string, value: number) => void;
  onCatch: (palId: string, count: number) => void;
  onSetQty: (itemId: string, qty: number) => void;
  onAddQty: (itemId: string, delta: number) => void;
  /** 여러 재고를 한 번에 목표치로 채운다 */
  onComplete: (entries: { itemId: string; qty: number }[]) => void;
};

/**
 * 앱을 열면 처음 보이는 화면. 여기서 곧바로 수치를 고칠 수 있어야 한다 —
 * 방송 중에 탭을 옮겨 다니며 재고를 넣을 여유가 없다.
 *
 * 순서는 기획서 8-3 그대로:
 *   막고 있는 시설 → 지금 지을 수 있는 것 → 파밍 → 팰 확보
 */
export default function TodoTab({
  plan,
  built,
  owned,
  inventory,
  onSync,
  onBuild,
  onCatch,
  onSetQty,
  onAddQty,
  onComplete,
}: Props) {
  // 획득처마다 품목이 12개까지 있어서 전부 펼치면 할 일 탭이 재고 탭이 된다.
  // 오버레이에 나가는 대표 품목만 기본 노출하고, 나머지는 접어 둔다.
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  // 파밍은 "지금 단계" 기준. 4거점 전체 수량을 띄우면 손도 못 댄다.
  const stageFarm = plan.stage.farm.length > 0 ? plan.stage.farm : plan.farm;
  const locked = stageFarm.filter((t) => t.lockedBy);
  const ready = plan.build.filter((b) => b.ready).slice(0, 6);
  const farming = stageFarm.filter((t) => !t.lockedBy).slice(0, 8);
  const catches = plan.palCatches.slice(0, 8);

  // 이 단계에서 지어야 하는 건축물 (막고 있는 시설 포함)
  const stageBuilds = plan.build
    .filter((b) => plan.stage.structures.some((s) => s.id === b.structure.id))
    .sort((a, b) => b.structure.unlock_score - a.structure.unlock_score);

  const nothing =
    locked.length === 0 && ready.length === 0 && farming.length === 0 && catches.length === 0;

  return (
    <div className="todo">
      <section className="card">
        <div className="card__head">
          <h2>다음에 할 일</h2>
          <span className="muted">
            {plan.stage.structures.length > 0
              ? `${plan.stage.order}단계 · ${plan.stage.structures.length}종 건설 · 재료 ${pct(plan.stage.progress)}`
              : '전부 완료'}
          </span>
          <button className="btn btn--sm" onClick={onSync}>
            오버레이 갱신
          </button>
        </div>

        {nothing && <p className="muted">할 일이 없습니다. 4거점이 전부 완성됐습니다.</p>}

        {farming.length > 0 && (
          <Group title={`${plan.stage.order}단계 재료 파밍`}>
            {farming.map((t) => (
              <FarmRow
                key={t.source.id}
                task={t}
                inventory={inventory}
                open={expanded[t.source.id] === true}
                onToggle={() => setExpanded((s) => ({ ...s, [t.source.id]: !s[t.source.id] }))}
                onSetQty={onSetQty}
                onAddQty={onAddQty}
                onComplete={onComplete}
              />
            ))}
          </Group>
        )}

        {locked.length > 0 && (
          <Group title="먼저 지어야 자동 파밍이 시작됩니다">
            {locked.map((t) => (
              <BuildRow
                key={t.source.id}
                task={plan.build.find((b) => b.structure.id === t.lockedBy!.id)}
                fallbackName={t.lockedBy!.name}
                sub={`${t.source.name} 해금 — ${t.items.length}종 자동 생산`}
                urgent
                built={built[t.lockedBy!.id] ?? 0}
                onBuild={(v) => onBuild(t.lockedBy!.id, v)}
              />
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
                    <span className="task__pct">
                      {b.built} / {b.structure.count}대
                    </span>
                  </span>
                  <small>{b.base?.name}</small>
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

        {stageBuilds.filter((b) => !b.ready && !locked.some((l) => l.lockedBy?.id === b.structure.id)).length > 0 && (
          <Group title={`${plan.stage.order}단계에서 지어야 하는 것`}>
            {stageBuilds
              .filter((b) => !b.ready && !locked.some((l) => l.lockedBy?.id === b.structure.id))
              .map((b) => (
                <BuildRow
                  key={b.structure.id}
                  task={b}
                  fallbackName={b.structure.name}
                  sub={b.base?.name ?? ''}
                  built={b.built}
                  onBuild={(v) => onBuild(b.structure.id, v)}
                />
              ))}
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
                <div className="task__count">
                  <button
                    className="qbtn"
                    onClick={() => onCatch(c.pal.id, (owned[c.pal.id] ?? 0) - 1)}
                    disabled={(owned[c.pal.id] ?? 0) <= 0}
                  >
                    −
                  </button>
                  <span className="task__num">{owned[c.pal.id] ?? 0}</span>
                  <button
                    className="qbtn"
                    onClick={() => onCatch(c.pal.id, (owned[c.pal.id] ?? 0) + 1)}
                  >
                    +
                  </button>
                </div>
              </li>
            ))}
          </Group>
        )}
      </section>
    </div>
  );
}

/**
 * 건설 행. "5대 지어라" 라고만 하면 뭘 캐야 할지 알 수 없으니
 * 남은 대수 전부에 필요한 재료를 같이 보여준다.
 */
function BuildRow({
  task,
  fallbackName,
  sub,
  urgent,
  built,
  onBuild,
}: {
  task?: BuildTask;
  fallbackName: string;
  sub: string;
  urgent?: boolean;
  built: number;
  onBuild: (value: number) => void;
}) {
  const remaining = task?.remaining ?? 1;
  const count = task?.structure.count ?? 1;
  const need = task?.missingAll ?? [];

  return (
    <li className={`task ${urgent ? 'task--urgent' : ''}`}>
      <div className="task__body">
        <span className="task__title">
          <b>{task?.structure.name ?? fallbackName}</b> 건설
          <span className="task__pct">
            {built} / {count}대
          </span>
        </span>
        {sub && <small>{sub}</small>}

        {need.length > 0 ? (
          <small className="task__need">
            남은 {remaining}대분 부족: {need.slice(0, 5).map((m) => `${m.name} ${nf(m.short)}`).join(' · ')}
            {need.length > 5 && ` 외 ${need.length - 5}종`}
          </small>
        ) : (
          <small className="task__ready">재료 충족 — 지금 지을 수 있습니다</small>
        )}
        {task?.blockedBy && (
          <small className="task__blocked">{task.blockedBy.name} 이(가) 먼저 필요합니다</small>
        )}
      </div>
      <button className="btn btn--sm btn--brand" onClick={() => onBuild(built + 1)}>
        1대 지음
      </button>
    </li>
  );
}

/**
 * 할 일 탭에서 바로 재고를 고칠 수 있는 파밍 행.
 * 오버레이에 나가는 건 대표 품목 하나뿐이라 그것만 펼쳐 두고,
 * 같은 획득처의 나머지 품목은 접어서 필요할 때만 연다.
 */
function FarmRow({
  task,
  inventory,
  open,
  onToggle,
  onSetQty,
  onAddQty,
  onComplete,
}: {
  task: FarmTask;
  inventory: Inventory;
  open: boolean;
  onToggle: () => void;
  onSetQty: (itemId: string, qty: number) => void;
  onAddQty: (itemId: string, delta: number) => void;
  onComplete: (entries: { itemId: string; qty: number }[]) => void;
}) {
  const shown = open ? task.items : task.items.slice(0, 1);
  const more = task.items.length - 1;

  return (
    <li className="task task--farm">
      <div className="task__body">
        <span className="task__title">
          <b>{task.source.name}</b>
          {task.source.method === 'manual' && <span className="chip chip--manual">수동</span>}
          <span className="task__pct">{pct(task.progress)}</span>
          <button
            className="btn btn--sm btn--done"
            title="이 획득처의 재료를 전부 목표치로 채웁니다"
            onClick={() => onComplete(task.items.map((i) => ({ itemId: i.id, qty: i.need })))}
          >
            전부 완료
          </button>
        </span>
        {task.source.place && <small>{task.source.place}</small>}

        <ul className="qlist">
          {shown.map((line) => (
            <li key={line.id} className="qrow">
              <span className="qrow__name">{line.name}</span>
              <input
                className="qrow__qty"
                type="number"
                min={0}
                value={inventory[line.id] ?? 0}
                onChange={(e) => onSetQty(line.id, Number(e.target.value))}
                onFocus={(e) => e.currentTarget.select()}
              />
              <span className="qrow__need">/ {nf(line.need)}</span>
              <span className="qrow__btns">
                {[10, 100, 500].map((d) => (
                  <button key={d} className="qbtn" onClick={() => onAddQty(line.id, d)}>
                    +{d}
                  </button>
                ))}
                <button className="qbtn qbtn--minus" onClick={() => onAddQty(line.id, -10)}>
                  −10
                </button>
                <button
                  className="qbtn qbtn--done"
                  title="이 재료를 다 모았습니다"
                  onClick={() => onSetQty(line.id, line.need)}
                >
                  완료
                </button>
              </span>
            </li>
          ))}
        </ul>

        {more > 0 && (
          <button className="task__more" onClick={onToggle}>
            {open ? '접기' : `이 획득처의 나머지 ${more}종 펼치기`}
          </button>
        )}
      </div>
    </li>
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
