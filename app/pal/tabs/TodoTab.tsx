'use client';

import { useState } from 'react';
import type {
  BuiltMap,
  FarmTask,
  Inventory,
  OwnedPals,
  PalPlan,
  ProductionLine,
} from '@/lib/pal/types';
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
 * 두 트랙으로 나뉜다:
 *   생산 라인 — 시설 + 팰 + 전력을 갖춰가며 **순서대로 하나씩** 연다
 *   사냥·원정 — 시설과 무관하게 **언제든 병렬로** 할 수 있다
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
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  // 파밍 수량은 "지금 단계" 기준. 4거점 전체 수량을 띄우면 손도 못 댄다.
  const stageFarm = plan.stage.farm.length > 0 ? plan.stage.farm : plan.farm;
  const manual = stageFarm.filter((t) => t.source.method === 'manual').slice(0, 6);
  const running = stageFarm.filter((t) => t.source.method === 'auto' && !t.lockedBy).slice(0, 4);
  const catches = plan.palCatches.slice(0, 6);
  const line = plan.currentLine;

  const nothing = !line && manual.length === 0 && running.length === 0 && catches.length === 0;

  const farmRow = (t: FarmTask) => (
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
  );

  return (
    <div className="todo">
      <section className="card">
        <div className="card__head">
          <h2>다음에 할 일</h2>
          <span className="muted">
            {plan.stage.structures.length > 0
              ? `${plan.stage.order}단계 · 재료 ${pct(plan.stage.progress)}`
              : '전부 완료'}
          </span>
          <button className="btn btn--sm" onClick={onSync}>
            오버레이 갱신
          </button>
        </div>

        {nothing && <p className="muted">할 일이 없습니다. 4거점이 전부 완성됐습니다.</p>}

        {line && (
          <>
            <h3 className="card__sub">
              지금 여는 생산 라인 — {line.structure.name}
              {line.blocker && <span className="chip chip--manual">{line.blocker}</span>}
            </h3>
            <LineRow line={line} built={built} owned={owned} onBuild={onBuild} onCatch={onCatch} />
          </>
        )}

        {manual.length > 0 && <Group title="사냥·원정 (언제든 병렬로)">{manual.map(farmRow)}</Group>}

        {running.length > 0 && (
          <Group title="자동 생산 중 (팰이 모으는 중)">{running.map(farmRow)}</Group>
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
                      배합 부모: {c.missingParents.map((x) => x.name).join(' · ')} 필요
                    </small>
                  )}
                  {c.missingConditions.length > 0 && (
                    <small className="task__blocked">
                      소지 조건: {c.missingConditions.map((x) => x.name).join(' · ')} 풀농축 필요
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
 * 지금 여는 생산 라인 한 줄.
 *
 * 시설은 "지었다" 로 끝나지 않는다. 재료 → 건설 → 팰 → 전력 순으로 막히는데,
 * 어디서 막혔는지 보여주지 않으면 매번 다시 따져봐야 한다.
 */
function LineRow({
  line,
  built,
  owned,
  onBuild,
  onCatch,
}: {
  line: ProductionLine;
  built: BuiltMap;
  owned: OwnedPals;
  onBuild: (structureId: string, value: number) => void;
  onCatch: (palId: string, count: number) => void;
}) {
  const s = line.structure;
  const nBuilt = built[s.id] ?? 0;
  const missing = line.missingMaterials;

  return (
    <ul className="tasks">
      <li className="task task--urgent">
        <div className="task__body">
          <span className="task__title">
            <b>{s.name}</b>
            <span className="task__pct">
              {nBuilt} / {s.count}대
            </span>
          </span>
          <small>
            {line.base?.name}
            {line.source ? ` · ${line.source.name} 해금` : ''}
          </small>

          <ol className="steps">
            <li data-ok={missing.length === 0 ? 'true' : 'false'}>
              <span className="steps__label">재료</span>
              <span>
                {missing.length === 0
                  ? '충족'
                  : missing
                      .slice(0, 4)
                      .map((m) => `${m.name} ${nf(m.short)}`)
                      .join(' · ')}
                {missing.length > 4 && ` 외 ${missing.length - 4}종`}
              </span>
            </li>

            <li data-ok={nBuilt >= 1 ? 'true' : 'false'}>
              <span className="steps__label">건설</span>
              <span className="steps__row">
                {nBuilt >= 1 ? `${nBuilt}대 완료` : '아직 없음'}
                <button className="qbtn" onClick={() => onBuild(s.id, nBuilt + 1)}>
                  1대 지음
                </button>
              </span>
            </li>

            {line.aptitudes.length > 0 && (
              <li data-ok={line.aptitudes.every((a) => a.ok) ? 'true' : 'false'}>
                <span className="steps__label">팰</span>
                <span className="steps__row">
                  {line.aptitudes.map((a) => (
                    <span key={a.work} className="apt" data-ok={a.ok ? 'true' : 'false'}>
                      {a.label} {a.lv}+ {a.have}마리
                      {!a.ok &&
                        a.candidates.slice(0, 2).map((c) => (
                          <button
                            key={c.id}
                            className="qbtn"
                            title={`${c.name} 확보`}
                            onClick={() => onCatch(c.id, (owned[c.id] ?? 0) + 1)}
                          >
                            {c.name} +1
                          </button>
                        ))}
                    </span>
                  ))}
                </span>
              </li>
            )}

            {line.needsPower && (
              <li data-ok={line.powerOk ? 'true' : 'false'}>
                <span className="steps__label">전력</span>
                <span>
                  {line.powerOk
                    ? '공급 중'
                    : `${line.base?.name ?? ''} 발전기가 돌아야 합니다 (발전 6+ 팰 필요)`}
                </span>
              </li>
            )}
          </ol>
        </div>
      </li>
    </ul>
  );
}

/**
 * 재고를 바로 고칠 수 있는 파밍 행.
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
