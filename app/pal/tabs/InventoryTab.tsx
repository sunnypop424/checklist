'use client';

import { useMemo, useState } from 'react';
import { itemsBySource } from '@/lib/pal/engine';
import type { Inventory, PalData, PalPlan } from '@/lib/pal/types';
import { nf, pct } from './format';

type Props = {
  data: PalData;
  inventory: Inventory;
  plan: PalPlan;
  onSet: (itemId: string, qty: number) => void;
  onAdd: (itemId: string, delta: number) => void;
};

/**
 * 이 앱에서 반복적으로 하는 행동은 재고 숫자 입력 하나다.
 * 그래서 획득처별로 묶고, 파밍 직후에 편한 증분 입력(+N)을 같이 둔다.
 */
export default function InventoryTab({ data, inventory, plan, onSet, onAdd }: Props) {
  const [hideDone, setHideDone] = useState(true);
  const [query, setQuery] = useState('');

  const grouped = useMemo(() => itemsBySource(data), [data]);
  const needById = useMemo(() => {
    const map: Record<string, { need: number; short: number }> = {};
    for (const t of plan.farm) {
      for (const line of t.items) map[line.id] = { need: line.need, short: line.short };
    }
    return map;
  }, [plan]);

  const q = query.trim();

  return (
    <div className="inv">
      <div className="inv__bar">
        <input
          className="inv__search"
          placeholder="재료 이름으로 찾기"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <label className="check check--inline">
          <input type="checkbox" checked={hideDone} onChange={(e) => setHideDone(e.target.checked)} />
          <span>다 모은 재료 숨기기</span>
        </label>
      </div>

      {data.sources.map((source) => {
        const items = (grouped[source.id] ?? []).filter((i) => !q || i.name.includes(q));
        const visible = items.filter((i) => !hideDone || (needById[i.id]?.short ?? 0) > 0);
        if (visible.length === 0) return null;

        return (
          <section className="card" key={source.id}>
            <div className="card__head">
              <h2>
                {source.name}
                {source.method === 'manual' ? (
                  <span className="chip chip--manual">수동</span>
                ) : (
                  <span className="chip">자동</span>
                )}
              </h2>
              {source.place && <span className="muted">{source.place}</span>}
            </div>

            <ul className="invlist">
              {visible.map((item) => {
                const have = inventory[item.id] ?? 0;
                const info = needById[item.id];
                const need = info ? info.need : have;
                const short = info?.short ?? 0;
                const progress = need > 0 ? Math.min(1, have / need) : 1;

                return (
                  <li key={item.id} className="invrow" data-done={short === 0 ? 'true' : 'false'}>
                    <div className="invrow__name">
                      <span title={item.note ?? undefined}>{item.name}</span>
                    </div>

                    <input
                      className="invrow__qty"
                      type="number"
                      min={0}
                      value={have}
                      onChange={(e) => onSet(item.id, Number(e.target.value))}
                      onFocus={(e) => e.currentTarget.select()}
                    />

                    <div className="invrow__quick">
                      {[10, 100, 500].map((d) => (
                        <button key={d} className="qbtn" onClick={() => onAdd(item.id, d)}>
                          +{d}
                        </button>
                      ))}
                      <button className="qbtn qbtn--minus" onClick={() => onAdd(item.id, -10)}>
                        −10
                      </button>
                    </div>

                    <span className="bar bar--sm">
                      <span className="bar__fill" style={{ width: `${progress * 100}%` }} />
                    </span>

                    <span className="invrow__need">
                      {short > 0 ? (
                        <>
                          {nf(need)} 필요 · <b>{nf(short)} 부족</b>
                        </>
                      ) : (
                        <span className="ok">충족 {pct(progress)}</span>
                      )}
                    </span>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
