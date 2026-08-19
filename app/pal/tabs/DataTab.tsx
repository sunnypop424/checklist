'use client';

import { useMemo, useState } from 'react';
import { byId } from '@/lib/pal/engine';
import type { PalData } from '@/lib/pal/types';
import type { PalMutateAction } from '@/app/api/pal/mutate/route';

type Props = {
  data: PalData;
  send: (payload: PalMutateAction) => Promise<{ ok: boolean }>;
  onToast: (msg: string) => void;
};

/**
 * 게임 수치를 직접 고치는 화면.
 * 설계도에 불확실한 값이 남아 있어(산출량·전력 등) 코드가 아니라 여기서 고쳐야 한다.
 *
 * ⚠ 저장은 되지만 npm run db:setup 을 다시 돌리면 시드 값으로 되돌아간다.
 */
export default function DataTab({ data, send, onToast }: Props) {
  const [section, setSection] = useState<'recipes' | 'structures'>('recipes');
  const [query, setQuery] = useState('');
  const items = useMemo(() => byId(data.items), [data.items]);
  const q = query.trim();

  const save = async (payload: PalMutateAction, label: string) => {
    try {
      await send(payload);
      onToast(`${label} 저장됨`);
    } catch (e) {
      onToast(`저장 실패: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const outputs = useMemo(() => {
    const set = new Map<string, typeof data.recipes>();
    for (const r of data.recipes) {
      const arr = set.get(r.output_id) ?? [];
      arr.push(r);
      set.set(r.output_id, arr);
    }
    return [...set.entries()]
      .map(([id, rows]) => ({ id, rows: rows.sort((a, b) => a.input_id.localeCompare(b.input_id)) }))
      .filter((e) => !q || (items[e.id]?.name ?? e.id).includes(q))
      .sort((a, b) => (a.rows[0]?.tier ?? 0) - (b.rows[0]?.tier ?? 0));
  }, [data.recipes, items, q]);

  const structures = useMemo(
    () =>
      data.structures
        .filter((s) => !q || s.name.includes(q))
        .sort((a, b) => (a.base_id ?? 0) - (b.base_id ?? 0) || b.unlock_score - a.unlock_score),
    [data.structures, q]
  );

  const costsByStructure = useMemo(() => {
    const map: Record<string, typeof data.costs> = {};
    for (const c of data.costs) (map[c.structure_id] ??= []).push(c);
    return map;
  }, [data.costs]);

  return (
    <div className="datatab">
      <div className="inv__bar">
        <div className="subtabs">
          <button
            className="subtab"
            data-active={section === 'recipes' ? 'true' : 'false'}
            onClick={() => setSection('recipes')}
          >
            레시피
          </button>
          <button
            className="subtab"
            data-active={section === 'structures' ? 'true' : 'false'}
            onClick={() => setSection('structures')}
          >
            건축물
          </button>
        </div>
        <input
          className="inv__search"
          placeholder="이름으로 찾기"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      <p className="muted warn">
        여기서 고친 값은 <code>npm run db:setup</code> 을 다시 돌리면 시드 값으로 되돌아갑니다.
        영구히 바꾸려면 <code>supabase/schema-pal.sql</code> 도 같이 고치세요.
      </p>

      {section === 'recipes' &&
        outputs.map((entry) => (
          <section className="card" key={entry.id}>
            <div className="card__head">
              <h2>{items[entry.id]?.name ?? entry.id}</h2>
              <span className="muted">{entry.rows[0]?.tier}차</span>
            </div>
            <ul className="editlist">
              {entry.rows.map((r) => (
                <li key={r.input_id}>
                  <span>{items[r.input_id]?.name ?? r.input_id}</span>
                  <label>
                    <small>필요</small>
                    <input
                      type="number"
                      min={1}
                      defaultValue={r.qty}
                      onBlur={(e) => {
                        const qty = Number(e.target.value);
                        if (qty !== r.qty && qty > 0) {
                          void save(
                            { action: 'update_recipe', outputId: r.output_id, inputId: r.input_id, qty },
                            '레시피'
                          );
                        }
                      }}
                    />
                  </label>
                  <label>
                    <small>산출량</small>
                    <input
                      type="number"
                      min={1}
                      defaultValue={r.yield}
                      onBlur={(e) => {
                        const y = Number(e.target.value);
                        if (y !== r.yield && y > 0) {
                          void save(
                            {
                              action: 'update_recipe',
                              outputId: r.output_id,
                              inputId: r.input_id,
                              yield: y,
                            },
                            '산출량'
                          );
                        }
                      }}
                    />
                  </label>
                </li>
              ))}
            </ul>
          </section>
        ))}

      {section === 'structures' &&
        structures.map((s) => (
          <section className="card" key={s.id}>
            <div className="card__head">
              <h2>{s.name}</h2>
              <span className="muted">거점 {s.base_id ?? '-'}</span>
            </div>
            <div className="editrow">
              <label>
                <small>개수</small>
                <input
                  type="number"
                  min={0}
                  defaultValue={s.count}
                  onBlur={(e) => {
                    const count = Number(e.target.value);
                    if (count !== s.count && count >= 0) {
                      void save({ action: 'update_structure', structureId: s.id, count }, '개수');
                    }
                  }}
                />
              </label>
              <label>
                <small>unlock_score</small>
                <input
                  type="number"
                  min={0}
                  max={100}
                  step={1}
                  defaultValue={s.unlock_score}
                  onBlur={(e) => {
                    const v = Number(e.target.value);
                    if (v !== s.unlock_score) {
                      void save(
                        { action: 'update_structure', structureId: s.id, unlockScore: v },
                        'unlock_score'
                      );
                    }
                  }}
                />
              </label>
            </div>
            <ul className="editlist">
              {(costsByStructure[s.id] ?? []).map((c) => (
                <li key={c.item_id}>
                  <span>{items[c.item_id]?.name ?? c.item_id}</span>
                  <label>
                    <small>1대당</small>
                    <input
                      type="number"
                      min={1}
                      defaultValue={c.qty}
                      onBlur={(e) => {
                        const qty = Number(e.target.value);
                        if (qty !== c.qty && qty > 0) {
                          void save(
                            { action: 'update_cost', structureId: s.id, itemId: c.item_id, qty },
                            '재료'
                          );
                        }
                      }}
                    />
                  </label>
                </li>
              ))}
            </ul>
          </section>
        ))}
    </div>
  );
}
