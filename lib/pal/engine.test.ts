import { describe, expect, it } from 'vitest';
import {
  buildRecipeMap,
  buildTasks,
  emptyOut,
  expand,
  farmTasks,
  plan,
  toChecklist,
  totalShortage,
} from './engine';
import type { PalData } from './types';

/**
 * 최소 데이터셋.
 *   widget = gear 2 + ore 3   (gear = ore 2)
 * ore 는 자동 획득처(generator, 시설 필요), gear·widget 은 제작품.
 */
function fixture(): PalData {
  return {
    sources: [
      {
        id: 'generator',
        name: '물질 생성기',
        method: 'auto',
        place: '거점②',
        sort: 10,
        note: null,
        requires_structure: 'gen',
      },
      {
        id: 'hunt',
        name: '사냥',
        method: 'manual',
        place: null,
        sort: 20,
        note: null,
        requires_structure: null,
      },
    ],
    items: [
      { id: 'ore', name: '광석', category: 'ore', source_id: 'generator', sort: 1, note: null },
      { id: 'organ', name: '기관', category: 'organ', source_id: 'hunt', sort: 2, note: null },
      { id: 'gear', name: '기어', category: 'part', source_id: null, sort: 3, note: null },
      { id: 'widget', name: '위젯', category: 'part', source_id: null, sort: 4, note: null },
    ],
    recipes: [
      { output_id: 'gear', input_id: 'ore', qty: 2, yield: 1, tier: 1 },
      { output_id: 'widget', input_id: 'gear', qty: 2, yield: 1, tier: 2 },
      { output_id: 'widget', input_id: 'organ', qty: 3, yield: 1, tier: 2 },
    ],
    bases: [{ id: 1, name: '① 메인', role: null, weight: 2, pal_slots: 20, note: null }],
    structures: [
      { id: 'gen', name: '생성기', base_id: 1, count: 1, unlock_score: 9, build_order: 1, note: null },
      { id: 'shop', name: '공방', base_id: 1, count: 2, unlock_score: 5, build_order: 2, note: null },
    ],
    costs: [
      { structure_id: 'gen', item_id: 'ore', qty: 10 },
      { structure_id: 'shop', item_id: 'widget', qty: 1 },
    ],
    unlocks: [],
  };
}

describe('expand — 재고 선차감', () => {
  it('재고가 없으면 최하위까지 전부 전개한다', () => {
    const recipes = buildRecipeMap(fixture());
    const out = emptyOut();
    expand(recipes, 'widget', 1, {}, out);

    // widget 1 → gear 2 + organ 3 → gear 2 = ore 4
    expect(out.leaf).toEqual({ ore: 4, organ: 3 });
    expect(out.craft).toEqual({ widget: 1, gear: 2 });
  });

  it('중간재를 갖고 있으면 그만큼 하위 전개를 하지 않는다', () => {
    const recipes = buildRecipeMap(fixture());
    const out = emptyOut();
    // gear 를 2개 갖고 있으면 ore 는 전혀 필요 없다
    expand(recipes, 'widget', 1, { gear: 2 }, out);

    expect(out.leaf).toEqual({ organ: 3 });
    expect(out.craft).toEqual({ widget: 1 });
    expect(out.leaf.ore).toBeUndefined();
  });

  it('완제품을 갖고 있으면 아무것도 안 만든다', () => {
    const recipes = buildRecipeMap(fixture());
    const out = emptyOut();
    expand(recipes, 'widget', 1, { widget: 5 }, out);

    expect(out.leaf).toEqual({});
    expect(out.craft).toEqual({});
  });

  it('부분 재고는 부족분만 전개한다', () => {
    const recipes = buildRecipeMap(fixture());
    const out = emptyOut();
    // gear 1개 보유 → gear 1개만 더 만들면 되고 ore 는 2개만 필요
    expand(recipes, 'widget', 1, { gear: 1 }, out);

    expect(out.craft.gear).toBe(1);
    expect(out.leaf.ore).toBe(2);
  });

  it('호출자가 넘긴 stock 은 깎인다 — 복사본을 넘겨야 한다', () => {
    const recipes = buildRecipeMap(fixture());
    const original = { gear: 2, organ: 10 };
    const copy = { ...original };
    expand(recipes, 'widget', 1, copy, emptyOut());

    expect(copy.gear).toBe(0);
    expect(copy.organ).toBe(7);
    // 원본은 그대로여야 한다
    expect(original).toEqual({ gear: 2, organ: 10 });
  });

  it('yield 가 2 면 절반만 제작한다', () => {
    const data = fixture();
    data.recipes = data.recipes.map((r) => (r.output_id === 'gear' ? { ...r, yield: 2 } : r));
    const out = emptyOut();
    expand(buildRecipeMap(data), 'gear', 4, {}, out);

    expect(out.craft.gear).toBe(2); // 4개 / yield 2 = 2회
    expect(out.leaf.ore).toBe(4); // 2회 × ore 2
  });

  it('순환 참조를 감지해 던진다', () => {
    const data = fixture();
    data.recipes.push({ output_id: 'ore', input_id: 'widget', qty: 1, yield: 1, tier: 1 });
    expect(() => expand(buildRecipeMap(data), 'widget', 1, {}, emptyOut())).toThrow(/순환 참조/);
  });

  it('음수·0 수량은 무시한다', () => {
    const recipes = buildRecipeMap(fixture());
    const out = emptyOut();
    expand(recipes, 'widget', 0, {}, out);
    expand(recipes, 'widget', -5, {}, out);
    expect(out.leaf).toEqual({});
  });
});

describe('totalShortage — 재고를 한 번만 쓴다', () => {
  it('여러 건축물이 같은 재고를 중복으로 쓰지 않는다', () => {
    const data = fixture();
    const recipes = buildRecipeMap(data);

    // gen 1대(ore 10) + shop 2대(widget 2 → gear 4 + organ 6 → ore 8)
    // ore 총 18 필요. ore 를 10개 갖고 있으면 부족은 8이어야 한다.
    const out = totalShortage(data, recipes, { ore: 10 }, {});
    expect(out.leaf.ore).toBe(8);
    expect(out.leaf.organ).toBe(6);
  });

  it('이미 지은 개수만큼은 빼고 계산한다', () => {
    const data = fixture();
    const recipes = buildRecipeMap(data);

    const none = totalShortage(data, recipes, {}, {});
    const half = totalShortage(data, recipes, {}, { gen: 1, shop: 1 });

    expect(none.leaf.ore).toBe(18); // gen 10 + shop 2대분 8
    expect(half.leaf.ore).toBe(4); // gen 완료, shop 1대분만 남음
    expect(half.leaf.organ).toBe(3);
  });

  it('전부 지었으면 부족량이 없다', () => {
    const data = fixture();
    const out = totalShortage(data, buildRecipeMap(data), {}, { gen: 1, shop: 2 });
    expect(out.leaf).toEqual({});
    expect(out.craft).toEqual({});
  });
});

describe('farmTasks — 획득처로 묶기', () => {
  it('부족 재료를 획득처별로 묶는다', () => {
    const data = fixture();
    const tasks = farmTasks(data, buildRecipeMap(data), {}, { gen: 1 });
    const ids = tasks.map((t) => t.source.id).sort();
    expect(ids).toEqual(['generator', 'hunt']);
  });

  it('자동 획득처인데 시설이 없으면 최상단으로 올리고 lockedBy 를 채운다', () => {
    const data = fixture();
    const tasks = farmTasks(data, buildRecipeMap(data), {}, {});

    expect(tasks[0].source.id).toBe('generator');
    expect(tasks[0].lockedBy?.id).toBe('gen');
    expect(tasks[0].score).toBeGreaterThan(2000);
  });

  it('시설을 1대라도 지으면 잠금이 풀린다', () => {
    const data = fixture();
    const tasks = farmTasks(data, buildRecipeMap(data), {}, { gen: 1 });
    const gen = tasks.find((t) => t.source.id === 'generator');

    expect(gen?.lockedBy).toBeNull();
    expect(gen!.score).toBeLessThan(2000);
  });

  it('잠금이 풀린 뒤에는 수동 획득처가 자동보다 앞선다', () => {
    const data = fixture();
    // 양쪽 진행률을 비슷하게 맞춰 method 가산점만 비교되게 한다
    const tasks = farmTasks(data, buildRecipeMap(data), { ore: 2, organ: 1 }, { gen: 1 });
    const genIdx = tasks.findIndex((t) => t.source.id === 'generator');
    const huntIdx = tasks.findIndex((t) => t.source.id === 'hunt');

    expect(huntIdx).toBeLessThan(genIdx);
  });

  it('진행률은 품목별 비율의 평균이다', () => {
    const data = fixture();
    const tasks = farmTasks(data, buildRecipeMap(data), {}, { gen: 1, shop: 1 });
    const hunt = tasks.find((t) => t.source.id === 'hunt')!;

    expect(hunt.items[0].have).toBe(0);
    expect(hunt.items[0].need).toBe(3);
    expect(hunt.progress).toBe(0);
  });
});

describe('buildTasks', () => {
  it('재료가 다 있으면 ready 로 표시한다', () => {
    const data = fixture();
    const tasks = buildTasks(data, buildRecipeMap(data), { ore: 10 }, {});
    const gen = tasks.find((t) => t.structure.id === 'gen')!;

    expect(gen.ready).toBe(true);
    expect(gen.missing).toEqual([]);
  });

  it('부족하면 ready 가 아니고 missing 이 채워진다', () => {
    const data = fixture();
    const tasks = buildTasks(data, buildRecipeMap(data), { ore: 3 }, {});
    const gen = tasks.find((t) => t.structure.id === 'gen')!;

    expect(gen.ready).toBe(false);
    expect(gen.missing).toEqual([{ id: 'ore', name: '광석', short: 7 }]);
  });

  it('선행 시설이 없으면 blockedBy 로 뒤로 밀린다', () => {
    const data = fixture();
    // widget 은 gen 이 있어야 만들 수 있다고 선언
    data.unlocks.push({ structure_id: 'gen', item_id: 'widget' });

    const blocked = buildTasks(data, buildRecipeMap(data), { widget: 99 }, {});
    const shop = blocked.find((t) => t.structure.id === 'shop')!;
    expect(shop.blockedBy?.id).toBe('gen');
    expect(shop.ready).toBe(false);

    const unblocked = buildTasks(data, buildRecipeMap(data), { widget: 99 }, { gen: 1 });
    const shop2 = unblocked.find((t) => t.structure.id === 'shop')!;
    expect(shop2.blockedBy).toBeNull();
    expect(shop2.ready).toBe(true);
  });

  it('선행 아이템이 중간재를 통해 간접적으로 필요해도 잡아낸다', () => {
    const data = fixture();
    // shop 의 비용은 widget 이고, widget 은 gear 를 쓴다.
    // gear 를 푸는 시설이 없으면 shop 도 막혀야 한다.
    data.unlocks.push({ structure_id: 'gen', item_id: 'gear' });

    const tasks = buildTasks(data, buildRecipeMap(data), {}, {});
    const shop = tasks.find((t) => t.structure.id === 'shop')!;
    expect(shop.blockedBy?.id).toBe('gen');
  });

  it('다 지은 건축물은 맨 뒤로 간다', () => {
    const data = fixture();
    const tasks = buildTasks(data, buildRecipeMap(data), { ore: 999 }, { gen: 1 });
    expect(tasks[tasks.length - 1].structure.id).toBe('gen');
    expect(tasks[tasks.length - 1].remaining).toBe(0);
  });
});

describe('plan / toChecklist', () => {
  it('시설이 없으면 체크리스트 최상단이 그 건설이다', () => {
    const data = fixture();
    const lines = toChecklist(plan(data, {}, {}));

    expect(lines[0].ref).toBe('build:gen');
    expect(lines[0].label).toContain('생성기');
    expect(lines[0].label).toContain('해금');
  });

  it('position 이 0부터 빠짐없이 매겨진다', () => {
    const lines = toChecklist(plan(fixture(), {}, {}));
    expect(lines.map((l) => l.position)).toEqual(lines.map((_, i) => i));
  });

  it('ref 가 중복되지 않는다', () => {
    const lines = toChecklist(plan(fixture(), { ore: 10 }, {}));
    expect(new Set(lines.map((l) => l.ref)).size).toBe(lines.length);
  });

  it('showTotals 를 끄면 총량 대신 퍼센트만 내보낸다', () => {
    const p = plan(fixture(), { organ: 1 }, { gen: 1 });
    const withTotals = toChecklist(p, { showTotals: true });
    const without = toChecklist(p, { showTotals: false });

    expect(withTotals.some((l) => l.label.includes('/'))).toBe(true);
    expect(without.some((l) => l.label.includes('/'))).toBe(false);
    expect(without.some((l) => /\d+%/.test(l.label))).toBe(true);
  });

  it('limit 을 넘지 않는다 (완료 항목 제외)', () => {
    const lines = toChecklist(plan(fixture(), {}, {}), { limit: 1 });
    expect(lines.filter((l) => !l.done).length).toBeLessThanOrEqual(1);
  });

  it('전부 완성이면 할 일이 없다', () => {
    const p = plan(fixture(), {}, { gen: 1, shop: 2 });
    expect(p.overall).toBe(1);
    expect(toChecklist(p)).toEqual([]);
  });
});
