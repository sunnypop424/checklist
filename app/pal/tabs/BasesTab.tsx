'use client';

import { useState } from 'react';
import { Lock } from 'lucide-react';
import { byId } from '@/lib/pal/engine';
import type { BuiltMap, OwnedPals, PalData, PalPlan, PalRoster } from '@/lib/pal/types';
import { nf, pct } from './format';

type Props = {
  data: PalData;
  roster: PalRoster;
  plan: PalPlan;
  built: BuiltMap;
  owned: OwnedPals;
  onBuild: (structureId: string, value: number) => void;
  onCatch: (palId: string, count: number) => void;
};

/** 거점 ①~④ — 건축물 체크리스트 + 팰 배치표(잡아야 할 팰 포함) */
export default function BasesTab({ data, roster, plan, built, owned, onBuild, onCatch }: Props) {
  const [baseId, setBaseId] = useState<number>(data.bases[0]?.id ?? 1);
  const base = data.bases.find((b) => b.id === baseId);
  const palById = byId(roster.pals);

  const structures = plan.build
    .filter((b) => b.structure.base_id === baseId)
    .sort(
      (a, b) =>
        (a.structure.build_order ?? 99) - (b.structure.build_order ?? 99) ||
        b.structure.unlock_score - a.structure.unlock_score
    );

  const needs = plan.palNeeds.filter((n) => n.base?.id === baseId);
  const slots = needs.reduce((s, n) => s + n.need, 0);
  const filled = needs.reduce((s, n) => s + n.filled, 0);

  return (
    <div className="bases">
      <div className="subtabs">
        {data.bases.map((b) => (
          <button
            key={b.id}
            className="subtab"
            data-active={b.id === baseId ? 'true' : 'false'}
            onClick={() => setBaseId(b.id)}
          >
            {b.name}
          </button>
        ))}
      </div>

      {base && (
        <p className="muted base__role">
          {base.role}
          {base.note ? ` · ${base.note}` : ''}
        </p>
      )}

      <section className="card">
        <div className="card__head">
          <h2>건축물</h2>
          <span className="muted">
            {structures.filter((s) => s.remaining === 0).length} / {structures.length} 완료
          </span>
        </div>

        <ul className="blist">
          {structures.map((b) => (
            <li
              key={b.structure.id}
              className="brow"
              data-done={b.remaining === 0 ? 'true' : 'false'}
              data-blocked={b.blockedBy ? 'true' : 'false'}
            >
              <div className="brow__main">
                <div className="brow__name">
                  <b>{b.structure.name}</b>
                  {b.structure.unlock_score >= 8 && <span className="chip chip--key">핵심</span>}
                  {b.ready && <span className="chip chip--ok">지금 가능</span>}
                  {b.blockedBy && (
                    <span className="chip chip--lock">
                      <Lock size={11} aria-hidden /> {b.blockedBy.name} 필요
                    </span>
                  )}
                </div>
                {b.structure.note && <small className="muted">{b.structure.note}</small>}
                {b.remaining > 0 && b.missing.length > 0 && (
                  <small className="brow__missing">
                    1대분 부족:{' '}
                    {b.missing.slice(0, 4).map((m) => `${m.name} ${nf(m.short)}`).join(' · ')}
                    {b.missing.length > 4 && ` 외 ${b.missing.length - 4}종`}
                  </small>
                )}
              </div>

              <div className="brow__count">
                <button
                  className="qbtn"
                  onClick={() => onBuild(b.structure.id, b.built - 1)}
                  disabled={b.built <= 0}
                >
                  −
                </button>
                <span className="brow__num">
                  {b.built} / {b.structure.count}
                </span>
                <button
                  className="qbtn"
                  onClick={() => onBuild(b.structure.id, b.built + 1)}
                  disabled={b.remaining <= 0}
                >
                  +
                </button>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section className="card">
        <div className="card__head">
          <h2>팰 배치</h2>
          <span className="muted">
            {filled} / {slots} 마리 · {pct(slots > 0 ? filled / slots : 1)}
          </span>
        </div>

        <ul className="plist">
          {needs.map((n) => (
            <li key={n.assignment.id} className="prow" data-done={n.short === 0 ? 'true' : 'false'}>
              <div className="prow__role">
                <b>{n.assignment.role}</b>
                <span className="prow__slots">
                  {n.filled} / {n.need}
                </span>
              </div>

              <div className="prow__pals">
                {n.candidates.length === 0 ? (
                  <span className="muted">추천 팰 미지정{n.assignment.note ? ` — ${n.assignment.note}` : ''}</span>
                ) : (
                  n.candidates.map((c) => {
                    const have = owned[c.id] ?? 0;
                    return (
                      <span key={c.id} className="palchip" data-have={have > 0 ? 'true' : 'false'}>
                        <button className="palchip__btn" onClick={() => onCatch(c.id, have - 1)} disabled={have <= 0}>
                          −
                        </button>
                        <span className="palchip__name">
                          {c.name}
                          {c.nocturnal && <i title="야행성">·야</i>}
                        </span>
                        <span className="palchip__have">{have}</span>
                        <button className="palchip__btn" onClick={() => onCatch(c.id, have + 1)}>
                          +
                        </button>
                      </span>
                    );
                  })
                )}
              </div>

              {n.short > 0 && n.candidates.length > 0 && (
                <div className="prow__todo">
                  {n.short}마리 더 필요 — 확보:{' '}
                  {n.toCatch.slice(0, 3).map((c) => c.name).join(', ')}
                </div>
              )}
              {n.assignment.note && n.candidates.length > 0 && (
                <small className="muted">{n.assignment.note}</small>
              )}
            </li>
          ))}
        </ul>
      </section>

      {plan.palCatches.length > 0 && (
        <section className="card">
          <div className="card__head">
            <h2>전 거점 통합 — 확보해야 할 팰</h2>
          </div>
          <ul className="catchlist">
            {plan.palCatches.map((c) => {
              const pal = palById[c.pal.id];
              return (
                <li key={c.pal.id} className="catchrow">
                  <div className="catchrow__main">
                    <b>{c.pal.name}</b>
                    <span className="chip">{c.short}마리</span>
                    {c.via === 'breed' && <span className="chip chip--breed">배합</span>}
                    {c.pal.nocturnal && <span className="chip chip--night">야행성</span>}
                    <small className="muted">
                      {c.roles.map((r) => `${r.baseName} ${r.role}`.trim()).join(' · ')}
                    </small>
                    {c.missingParents.length > 0 && (
                      <small className="task__blocked">
                        먼저 {c.missingParents.map((p) => p.name).join(' · ')} 확보
                        {c.note ? ` — ${c.note}` : ''}
                      </small>
                    )}
                    {(pal?.partner || pal?.source) && (
                      <small className="muted">
                        {[pal.source, pal.partner].filter(Boolean).join(' · ')}
                      </small>
                    )}
                  </div>
                  <div className="brow__count">
                    <span className="brow__num">{c.owned}마리 보유</span>
                    <button className="qbtn" onClick={() => onCatch(c.pal.id, c.owned + 1)}>
                      +
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
}
