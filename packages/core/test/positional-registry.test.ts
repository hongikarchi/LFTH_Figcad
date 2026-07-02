import { describe, expect, it } from 'vitest';
import { DocStore, seedDocument, type SeedRefs } from '../src/store';
import { elementFootprint } from '../src/select';
import { POSITIONAL, type Element, type Pt } from '../src/schema';

/**
 * POSITIONAL 레지스트리 **열거(enumerated) 테스트** — 진짜 §5 산출물.
 * golden 테스트가 *현재* 동작을 pin해 리팩터를 보호한다면, 이 파일은 *미래 kind*를 보호한다:
 * 새 Element kind를 추가하고 move/rotate/transformCopy/footprint 중 하나라도 배선을 잊으면
 * → 조용한 no-op이 아니라 **이 테스트가 요란하게 실패**.
 *
 * 가드 2겹:
 *  (1) `POSITIONAL`이 `Record<Element['kind'],…>` → 신규 kind = schema.ts 컴파일 에러.
 *  (2) FACTORY 완전성 + 카테고리별 동작 단언 → 신규 kind = 이 테스트 실패(배선 강제).
 */

// 모든 kind 대표 인스턴스 팩토리. 신규 kind 추가 시 여기 누락 = 완전성 테스트 실패.
type Factory = (store: DocStore, seed: SeedRefs) => string;
const FACTORY: Record<Element['kind'], Factory> = {
  wall: (s, d) => s.createWall({ levelId: d.levelId, typeId: d.wallTypeIds[0]!, a: [100, 100], b: [4100, 100] }),
  opening: (s, d) => {
    const w = s.createWall({ levelId: d.levelId, typeId: d.wallTypeIds[0]!, a: [100, 100], b: [6100, 100] });
    return s.createOpening({ hostId: w, typeId: d.doorTypeId, offset: 2000 });
  },
  slab: (s, d) => s.createSlab({ levelId: d.levelId, typeId: d.slabTypeId, boundary: [[100, 100], [4100, 100], [4100, 4100], [100, 4100]] }),
  grid: (s) => s.createGridLine({ a: [200, 200], b: [200, 5200] }),
  column: (s, d) => s.createColumn({ levelId: d.levelId, typeId: d.columnTypeId, at: [1000, 2000] }),
  beam: (s, d) => s.createBeam({ levelId: d.levelId, typeId: d.beamTypeId, a: [300, 300], b: [4300, 300] }),
  stair: (s, d) => s.createStair({ levelId: d.levelId, typeId: d.stairTypeId, a: [400, 400], b: [4400, 400] }),
  railing: (s, d) => s.createRailing({ levelId: d.levelId, typeId: d.railingTypeId, a: [500, 500], b: [4500, 500] }),
  roof: (s, d) => s.createRoof({ levelId: d.levelId, typeId: d.roofTypeId, boundary: [[600, 600], [4600, 600], [4600, 4600], [600, 4600]] }),
  curtainwall: (s, d) => s.createCurtainWall({ levelId: d.levelId, typeId: d.curtainWallTypeId, a: [700, 700], b: [4700, 700], uSpacing: 1500, vSpacing: 1500 }),
  zone: (s, d) => s.createZone({ levelId: d.levelId, boundary: [[800, 800], [2800, 800], [2800, 2800], [800, 2800]], name: 'Z' }),
  text: (s, d) => s.createText({ levelId: d.levelId, at: [3000, 3000], text: 'hi' }),
  label: (s, d) => s.createLabel({ levelId: d.levelId, at: [3100, 3100], template: 'custom', customText: 'L' }),
  // 끝점이 다른 요소와 mm-일치하지 않게 → 자동 바인딩 회피(stored a/b가 곧 좌표)
  dimension: (s, d) => s.createDimension({ levelId: d.levelId, a: [9123, 9123], b: [9123, 13123] }),
  sketch: (s, d) =>
    s.createSketch({
      levelId: d.levelId,
      mode: 'line',
      boundary: [[200, 9000], [4200, 9000], [4200, 9500]],
      style: { color: '#0a84ff', opacity: 1, width: 2, lineType: 'solid' },
    }),
  asset: (s, d) => s.createAsset({ levelId: d.levelId, assetKind: 'tree', at: [5000, 5000] }),
};

const ALL_KINDS = Object.keys(POSITIONAL) as Element['kind'][];

/** 카테고리가 소유한 좌표 점들 (segment=a,b / polygon=boundary / point=at / hosted=없음) */
function coords(el: Element): Pt[] {
  switch (POSITIONAL[el.kind]) {
    case 'segment':
      return [(el as { a: Pt }).a, (el as { b: Pt }).b];
    case 'polygon':
      return (el as { boundary: Pt[] }).boundary;
    case 'point':
      return [(el as { at: Pt }).at];
    case 'hosted':
      return [];
  }
}

function make(kind: Element['kind']) {
  const store = new DocStore();
  const seed = seedDocument(store);
  const id = FACTORY[kind](store, seed);
  return { store, seed, id };
}

describe('곡선 벽 sagitta — transformCopy 부호 정책 (반사=반전, 이동/회전=보존)', () => {
  // FACTORY는 Record<kind> 라 wall 항목이 1개뿐(직선 baseline 유지) → 곡선 벽은 여기 별도 검증.
  // POSITIONAL['wall']은 'segment' 그대로(a,b만 좌표) — 아래 enumerated move/rotate는 sagitta를 안 건드림.
  function makeCurved(sagitta: number) {
    const store = new DocStore();
    const seed = seedDocument(store);
    const id = store.createWall({
      levelId: seed.levelId,
      typeId: seed.wallTypeIds[0]!,
      a: [100, 100],
      b: [4100, 100],
      sagitta,
    });
    return { store, id };
  }

  it('mirror = sagitta 부호 반전 (반사는 방향반전 → 휘는 쪽 뒤집힘)', () => {
    const { store, id } = makeCurved(500);
    const [copyId] = store.mirrorElements([id], [0, 0], [4000, 0]); // x축 반사
    const copy = store.getElement(copyId!) as { sagitta?: number };
    expect(copy.sagitta).toBe(-500);
  });

  it('move = sagitta 보존 (등거리 평행이동)', () => {
    const { store, id } = makeCurved(500);
    store.moveElements([id], [1000, 2000]);
    const el = store.getElement(id) as { sagitta?: number };
    expect(el.sagitta).toBe(500);
  });

  it('rotate = sagitta 보존 (방향보존 변환)', () => {
    const { store, id } = makeCurved(500);
    store.rotateElements([id], [0, 0], Math.PI / 2);
    const el = store.getElement(id) as { sagitta?: number };
    expect(el.sagitta).toBe(500);
  });

  it('duplicate(=평행이동 복사) = sagitta 보존 (flipOpenings=false)', () => {
    const { store, id } = makeCurved(500);
    const [copyId] = store.duplicateElements([id], [3000, 0]);
    const copy = store.getElement(copyId!) as { sagitta?: number };
    expect(copy.sagitta).toBe(500);
  });
});

describe('enumerated: POSITIONAL 완전성', () => {
  it('FACTORY 키 = POSITIONAL 키 = 모든 Element kind (신규 kind 배선 강제)', () => {
    expect(Object.keys(FACTORY).sort()).toEqual(ALL_KINDS.slice().sort());
  });
});

describe.each(ALL_KINDS)('enumerated: %s × 4 op (category-consistent)', (kind) => {
  const cat = POSITIONAL[kind];

  it(`move = ${cat} 좌표 += delta (non-no-op)`, () => {
    const { store, id } = make(kind);
    const before = coords(store.getElement(id)!);
    store.moveElements([id], [1000, 2000]);
    const after = coords(store.getElement(id)!);
    if (cat === 'hosted') {
      // 호스트 위 파생 — 자체 좌표 없음. 단독 이동은 no-op(호스트가 추종시킴). footprint로 별도 검증.
      expect(after.length).toBe(0);
      return;
    }
    expect(after.length).toBe(before.length);
    expect(after.length).toBeGreaterThan(0); // 카테고리가 좌표 소유함을 보장
    after.forEach((p, i) => {
      expect(p[0]).toBe(before[i]![0] + 1000); // 배선 누락 시 == before → 실패
      expect(p[1]).toBe(before[i]![1] + 2000);
    });
  });

  it(`rotate = 좌표 변동 (non-no-op)`, () => {
    const { store, id } = make(kind);
    const before = JSON.stringify(coords(store.getElement(id)!));
    store.rotateElements([id], [0, 0], Math.PI / 2);
    const after = JSON.stringify(coords(store.getElement(id)!));
    if (cat === 'hosted') return; // 자체 좌표 없음
    expect(after).not.toBe(before); // 회전 미배선 시 동일 → 실패
  });

  it(`footprint = category 매칭`, () => {
    const { store, id } = make(kind);
    const fp = elementFootprint(store.getElement(id)!, store);
    expect(fp).not.toBeNull();
    const expected = cat === 'hosted' ? 'point' : cat; // opening은 호스트 위 점으로 해석
    expect(fp!.kind).toBe(expected);
  });

  it(`duplicate = 새 요소 생성 (위치 변환)`, () => {
    const { store, id } = make(kind);
    if (cat === 'hosted') {
      // 호스트 포함해야 복사됨 — 호스트 단독 셋이면 0개(golden에서 검증). 여기선 호스트+개구부.
      const host = (store.getElement(id) as { hostId: string }).hostId;
      const created = store.duplicateElements([host, id], [3000, 0]);
      expect(created.length).toBe(2); // 벽 + 개구부
      return;
    }
    const created = store.duplicateElements([id], [3000, 0]);
    expect(created.length).toBeGreaterThan(0);
    const copy = store.getElement(created[0]!)!;
    expect(copy.kind).toBe(kind);
    // 복사본 좌표가 원본과 다름(변환 적용됨) — grid 라벨 재발급 등 특수훅과 무관히 좌표는 이동
    const origC = JSON.stringify(coords(store.getElement(id)!));
    const copyC = JSON.stringify(coords(copy));
    expect(copyC).not.toBe(origC);
  });
});
