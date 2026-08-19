'use client';

import { useState } from 'react';
import { ChevronRight } from 'lucide-react';
import type { PalPlan } from '@/lib/pal/types';
import { nf } from './format';

const TIER_NAMES: Record<number, string> = {
  1: '1차 — 원재료만으로 바로 제작',
  2: '2차 — 제련 (고대 문명 화로 / 거대한 화로)',
  3: '3차 — 조립',
  4: '4차 — 최종 부품',
};

/** 제작 순서 트리. 아래 단계부터 만들어야 위 단계가 풀린다. */
export default function CraftTab({ plan }: { plan: PalPlan }) {
  const [open, setOpen] = useState<Record<number, boolean>>({ 1: true, 2: true, 3: true, 4: true });

  if (plan.craft.length === 0) {
    return <p className="muted">제작할 중간재가 없습니다.</p>;
  }

  const tiers = [...new Set(plan.craft.map((c) => c.tier))].sort((a, b) => a - b);

  return (
    <div className="craft">
      {tiers.map((tier) => {
        const lines = plan.craft.filter((c) => c.tier === tier);
        const isOpen = open[tier] !== false;
        const readyCount = lines.filter((l) => l.ready).length;

        return (
          <section className="card" key={tier}>
            <button
              className="card__head card__head--toggle"
              onClick={() => setOpen((s) => ({ ...s, [tier]: !isOpen }))}
            >
              <h2>
                <ChevronRight
                  className="caret"
                  size={15}
                  data-open={isOpen ? 'true' : 'false'}
                  aria-hidden
                />
                {TIER_NAMES[tier] ?? `${tier}차`}
              </h2>
              <span className="muted">
                {lines.length}종 · 지금 만들 수 있는 것 {readyCount}
              </span>
            </button>

            {isOpen && (
              <ul className="craftlist">
                {lines.map((line) => (
                  <li key={line.item.id} className="craftrow" data-ready={line.ready ? 'true' : 'false'}>
                    <div className="craftrow__head">
                      <b>{line.item.name}</b>
                      <span className="craftrow__count">{nf(line.batches)}개 제작</span>
                      {line.have > 0 && <span className="muted">보유 {nf(line.have)}</span>}
                      {line.ready && <span className="chip chip--ok">지금 가능</span>}
                    </div>
                    <ul className="craftrow__inputs">
                      {line.inputs.map((i) => (
                        <li key={i.id} data-short={i.short > 0 ? 'true' : 'false'}>
                          <span>{i.name}</span>
                          <span className="mono">
                            {nf(i.have)} / {nf(i.qty)}
                            {i.short > 0 && <b> (−{nf(i.short)})</b>}
                          </span>
                        </li>
                      ))}
                    </ul>
                    {line.item.note && <p className="muted craftrow__note">{line.item.note}</p>}
                  </li>
                ))}
              </ul>
            )}
          </section>
        );
      })}
    </div>
  );
}
