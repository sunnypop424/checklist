'use client';

import { Lock } from 'lucide-react';
import type { PalPlan } from '@/lib/pal/types';
import { nf, pct } from './format';

/** 획득처별 전체 목록 — 무엇이 얼마나 남았는지 한눈에 */
export default function FarmTab({ plan }: { plan: PalPlan }) {
  if (plan.farm.length === 0) {
    return <p className="muted">모을 재료가 남아 있지 않습니다.</p>;
  }

  return (
    <div className="farm">
      {plan.farm.map((t) => (
        <section className="card" key={t.source.id} data-locked={t.lockedBy ? 'true' : 'false'}>
          <div className="card__head">
            <h2>
              {t.source.name}
              {t.source.method === 'manual' ? (
                <span className="chip chip--manual">수동</span>
              ) : (
                <span className="chip">자동</span>
              )}
            </h2>
            <span className="farm__pct">{pct(t.progress)}</span>
          </div>

          {t.lockedBy && (
            <p className="lock">
              <Lock size={13} aria-hidden />
              <span>
                <b>{t.lockedBy.name}</b> 를 1대라도 지어야 이 {t.items.length}종이 자동으로 모이기
                시작합니다.
              </span>
            </p>
          )}
          {t.source.note && <p className="muted">{t.source.note}</p>}

          <ul className="farmlist">
            {t.items.map((line) => (
              <li key={line.id} className="farmrow">
                <span className="farmrow__name">{line.name}</span>
                <span className="bar">
                  <span className="bar__fill" style={{ width: `${line.progress * 100}%` }} />
                </span>
                <span className="farmrow__num">
                  {nf(line.have)} / {nf(line.need)}
                </span>
                <span className="farmrow__short">−{nf(line.short)}</span>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
