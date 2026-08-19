/**
 * 시드 검증은 두 갈래다.
 *
 *  1. design-doc-seed.json — 설계도 16장을 그대로 옮긴 **동결 스냅샷**.
 *     손으로 계산한 정답(16-2 / 16-3)과 대조해 계산 엔진을 검증한다.
 *     운영 중 설계가 바뀌어도 이 파일은 건드리지 않는다. 엔진의 기준점이다.
 *
 *  2. seed.json — 현재 supabase/schema-pal.sql 을 적용한 DB 의 덤프.
 *     운영하면서 설계가 바뀌므로(원유 추출기 교체 등) 정확한 수치는 묻지 않고
 *     참조 무결성과 우선순위 규칙만 확인한다.
 *
 * 시드를 고치면 seed.json 을 다시 뜬다 (README 참고).
 */
import { describe, expect, it } from 'vitest';
import docSeed from './__fixtures__/design-doc-seed.json';
import liveSeed from './__fixtures__/seed.json';
import roster from './__fixtures__/roster.json';
import { buildRecipeMap, plan } from './engine';
import type { PalData, PalRoster } from './types';

const doc = docSeed as unknown as PalData;
const live = liveSeed as unknown as PalData;
const crew = roster as unknown as PalRoster;

const docPlan = plan(doc, {}, {});
const leaf = docPlan.shortage.leaf;
const craft = docPlan.shortage.craft;

/** 설계도 16-2 — [1단계] 모아야 할 최하위 재료 (재고 0 · 전 건축물 미완성 기준) */
const LEAF_16_2: Record<string, number> = {
  metal_ore: 22038,
  coal: 19244,
  stone: 12132,
  pure_quartz: 10768,
  solite_ore: 8410,
  sulfur: 3204,
  wood: 2532,
  chromite: 1490,
  hexo_quartz: 1490,
  paldium: 1164,
  hard_wood: 750,
  coralium_ore: 600,
  crude_oil: 6052,
  flame_organ: 6598,
  hq_pal_oil: 4028,
  electric_organ: 3234,
  wool: 1500,
  venom_gland: 1190,
  aqua_slime: 949,
  bone: 600,
  ice_organ: 349,
  leather: 150,
  palkicite_ore: 4100,
  sacred_water: 2670,
  mystic_wood: 640,
  ancient_core: 450,
  ancient_part: 150,
};

/** 설계도 16-3 — [2단계] 제작할 중간재 */
const CRAFT_16_3: Record<string, number> = {
  carbon_fiber: 4358,
  polymer: 2014,
  corrosive: 1190,
  hexolite: 1490,
  cryo_medium: 349,
  charcoal: 600,
  cement: 600,
  hq_cloth: 150,
  fiber: 170,
  metal_ingot: 420,
  refined_ingot: 2274,
  pal_metal_ingot: 380,
  coralium_ingot: 300,
  solite_ingot: 3180,
  palkicite_ingot: 2050,
  plastil: 3026,
  circuit_board: 2014,
  bio_battery: 2074,
  superheat_core: 560,
  hq_plank: 75,
  plank: 10,
  computer: 982,
  ai_core: 160,
};

describe('설계도 16-2 — 최하위 재료 부족량 (동결 스냅샷)', () => {
  const names = Object.fromEntries(doc.items.map((i) => [i.id, i.name]));

  for (const [id, want] of Object.entries(LEAF_16_2)) {
    it(`${names[id] ?? id} = ${want.toLocaleString('ko-KR')}`, () => {
      expect(Math.round(leaf[id] ?? 0)).toBe(want);
    });
  }

  it('설계도에 없는 최하위 재료가 튀어나오지 않는다', () => {
    const extra = Object.keys(leaf).filter((id) => !(id in LEAF_16_2));
    expect(extra.map((id) => names[id] ?? id)).toEqual([]);
  });
});

describe('설계도 16-3 — 중간재 제작량 (동결 스냅샷)', () => {
  const names = Object.fromEntries(doc.items.map((i) => [i.id, i.name]));

  for (const [id, want] of Object.entries(CRAFT_16_3)) {
    it(`${names[id] ?? id} = ${want.toLocaleString('ko-KR')}`, () => {
      expect(Math.round(craft[id] ?? 0)).toBe(want);
    });
  }
});

describe('현재 시드 무결성', () => {
  it('아이템·레시피·건축물이 비어 있지 않다', () => {
    expect(live.items.length).toBeGreaterThan(40);
    expect(live.recipes.length).toBeGreaterThan(50);
    expect(live.structures.length).toBeGreaterThan(50);
    expect(live.costs.length).toBeGreaterThan(150);
  });

  it('레시피의 입출력이 전부 존재하는 아이템을 가리킨다', () => {
    const ids = new Set(live.items.map((i) => i.id));
    for (const r of live.recipes) {
      expect(ids, `레시피 출력 ${r.output_id}`).toContain(r.output_id);
      expect(ids, `레시피 입력 ${r.input_id}`).toContain(r.input_id);
    }
  });

  it('건축물 재료가 전부 존재하는 아이템을 가리킨다', () => {
    const ids = new Set(live.items.map((i) => i.id));
    for (const c of live.costs) {
      expect(ids, `${c.structure_id} 의 ${c.item_id}`).toContain(c.item_id);
    }
  });

  it('모든 건축물에 재료가 하나 이상 있다', () => {
    const withCost = new Set(live.costs.map((c) => c.structure_id));
    for (const s of live.structures) expect(withCost, `${s.name} (${s.id})`).toContain(s.id);
  });

  it('최하위 재료는 획득처가 있고, 중간재는 레시피가 있다', () => {
    const recipes = buildRecipeMap(live);
    const sourceIds = new Set(live.sources.map((s) => s.id));
    for (const item of live.items) {
      if (item.source_id) {
        expect(sourceIds, `${item.name} 의 획득처`).toContain(item.source_id);
        expect(recipes[item.id], `${item.name} 은 최하위 재료인데 레시피가 있다`).toBeUndefined();
      } else {
        expect(recipes[item.id], `${item.name} 은 획득처도 레시피도 없다`).toBeDefined();
      }
    }
  });

  it('획득처가 요구하는 시설이 실제로 존재한다', () => {
    const ids = new Set(live.structures.map((s) => s.id));
    for (const s of live.sources) {
      if (s.requires_structure) expect(ids, `${s.name} 의 선행 시설`).toContain(s.requires_structure);
    }
  });

  it('레시피에 순환 참조가 없다', () => {
    expect(() => plan(live, {}, {})).not.toThrow();
  });

  it('이름·설명에 이모지가 없다 (오버레이로 그대로 나간다)', () => {
    const emoji = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}]/u;
    const texts = [
      ...live.items.flatMap((i) => [i.name, i.note ?? '']),
      ...live.sources.flatMap((s) => [s.name, s.place ?? '', s.note ?? '']),
      ...live.structures.flatMap((s) => [s.name, s.note ?? '']),
      ...crew.pals.flatMap((p) => [p.name, p.partner ?? '', p.source ?? '']),
      ...crew.assignments.flatMap((a) => [a.role, a.note ?? '']),
    ];
    expect(texts.filter((t) => emoji.test(t))).toEqual([]);
  });
});

describe('배치표', () => {
  it('거점마다 정확히 20마리씩 배정돼 있다', () => {
    for (const base of live.bases) {
      const total = crew.assignments
        .filter((a) => a.base_id === base.id)
        .reduce((s, a) => s + a.count, 0);
      expect(total, `${base.name}`).toBe(base.pal_slots);
    }
  });

  it('배치표가 가리키는 팰이 전부 도감에 있다', () => {
    const ids = new Set(crew.pals.map((p) => p.id));
    for (const a of crew.assignments) {
      for (const id of a.pal_ids) expect(ids, `${a.role} 의 ${id}`).toContain(id);
    }
  });

  it('거점① 수작업 공장은 알파 세크메트로 채운다', () => {
    const factory = crew.assignments.find(
      (a) => a.base_id === 1 && a.role.includes('작업 공장')
    );
    expect(factory?.pal_ids).toContain('alpha_sekhmet');
    expect(factory?.pal_ids).not.toContain('monochrona');
  });

  it('팰을 하나도 안 잡았으면 80자리가 전부 비어 있다', () => {
    const p = plan(live, {}, {}, crew, {});
    expect(p.palOverall).toBe(0);
    expect(p.palNeeds.reduce((s, n) => s + n.need, 0)).toBe(80);
  });

  it('알파 세크메트는 잡는 게 아니라 배합이고, 부모 확보가 먼저 뜬다', () => {
    const p = plan(live, {}, {}, crew, {});
    const sekhmet = p.palCatches.find((c) => c.pal.id === 'alpha_sekhmet')!;

    expect(sekhmet.via).toBe('breed');
    expect(sekhmet.missingParents.map((x) => x.id).sort()).toEqual(['labradon', 'spradon']);

    // 부모 줄이 자식보다 앞에 있어야 한다
    const parentIdx = p.palCatches.findIndex((c) => c.pal.id === 'labradon');
    const childIdx = p.palCatches.findIndex((c) => c.pal.id === 'alpha_sekhmet');
    expect(parentIdx).toBeGreaterThanOrEqual(0);
    expect(parentIdx).toBeLessThan(childIdx);
    expect(p.palCatches.find((c) => c.pal.id === 'labradon')!.short).toBe(1);
  });

  it('부모를 확보하면 부모 줄이 사라진다', () => {
    const p = plan(live, {}, {}, crew, { labradon: 1, spradon: 1 });
    expect(p.palCatches.some((c) => c.pal.id === 'labradon')).toBe(false);
    expect(p.palCatches.find((c) => c.pal.id === 'alpha_sekhmet')!.missingParents).toEqual([]);
  });

  it('잡은 팰은 가중치 높은 거점부터 배정된다', () => {
    // 알파 세크메트는 거점①(가중치 2.5)과 ②(3.0) 양쪽에서 쓴다.
    // 4마리만 있으면 가중치가 높은 ② 물질 생성기 자리가 먼저 찬다.
    const p = plan(live, {}, {}, crew, { alpha_sekhmet: 4 });
    const gen = p.palNeeds.find((n) => n.base.id === 2 && n.assignment.role.includes('물질 생성기'));
    const factory = p.palNeeds.find((n) => n.base.id === 1 && n.assignment.role.includes('작업 공장'));
    expect(gen?.filled).toBe(4);
    expect(factory?.filled).toBe(0);
  });
});

describe('현재 시드 기준 우선순위', () => {
  const p = plan(live, {}, {}, crew, {});

  it('아무것도 없을 때 최우선은 물질 생성기 건설이다 (설계도 16-5)', () => {
    expect(p.farm[0].lockedBy?.id).toBe('matter_generator_b2');
  });

  it('원유 추출기는 이미 지은 것으로 보면 잠금이 풀린다', () => {
    const p2 = plan(live, {}, { oil_extractor_b4: 4 }, crew, {});
    const oil = p2.farm.find((t) => t.source.id === 'oil');
    expect(oil?.lockedBy).toBeNull();
  });

  it('자동 시설을 지으면 수동 파밍이 자동보다 앞선다 (설계도 16-5)', () => {
    const p2 = plan(live, {}, { matter_generator_b2: 1, oil_extractor_b4: 4, ranch_b3: 1 }, crew, {});
    expect(p2.farm[0].source.method).toBe('manual');

    const firstAuto = p2.farm.findIndex((t) => t.source.method === 'auto');
    const lastManual = p2.farm.map((t) => t.source.method).lastIndexOf('manual');
    expect(lastManual).toBeLessThan(firstAuto);
  });

  it('고대 문명의 코어는 세계수 원정에서 나온다', () => {
    const core = live.items.find((i) => i.id === 'ancient_core');
    expect(core?.source_id).toBe('worldtree');
  });

  it('팰키사이트 주괴는 고대 문명 화로 없이는 막힌다 (설계도 11장)', () => {
    const hotspring = p.build.find((b) => b.structure.id === 'hotspring_b1');
    expect(hotspring?.blockedBy?.id).toBe('furnace_b1');
  });
});
