import { describe, expect, it } from 'vitest';
import { DocStore, seedDocument } from '../src/store';
import { DeriveCache, buildDeriveIndex } from '../src/geometry';
import type { SketchElement } from '../src/schema';

const STYLE = { color: '#0a84ff', opacity: 1, width: 2, lineType: 'solid' as const };

function setup() {
  const store = new DocStore();
  const seed = seedDocument(store);
  return { store, seed };
}
const derive = (store: DocStore, id: string) =>
  new DeriveCache().derive(store, id, buildDeriveIndex(store));

describe('스케치 — derive (DeriveCache 디스패치)', () => {
  it('line = 열린 폴리라인 edges, 채움 없음', () => {
    const { store, seed } = setup();
    const id = store.createSketch({
      levelId: seed.levelId, mode: 'line', boundary: [[0, 0], [1000, 0], [1000, 1000]], style: STYLE,
    });
    const geo = derive(store, id)!;
    expect(geo.positions.length).toBe(2 * 18); // 픽 프록시 리본: 2 세그 × 2삼각형 × 3정점 × 3좌표
    expect(geo.edges.length).toBe(2 * 6); // 보이는 폴리라인: 2 세그(열림) × 6 float
  });

  it('zone = 채움 mesh + 닫힌 edges', () => {
    const { store, seed } = setup();
    const id = store.createSketch({
      levelId: seed.levelId, mode: 'zone', boundary: [[0, 0], [1000, 0], [1000, 1000]], style: STYLE,
    });
    const geo = derive(store, id)!;
    expect(geo.positions.length).toBeGreaterThan(0); // 채움
    expect(geo.edges.length).toBe(3 * 6); // 3 세그(닫힘=wraparound) × 6
  });

  it('스타일 변경 = re-derive 안 함 (deriveKey가 style 제외)', () => {
    const { store, seed } = setup();
    const id = store.createSketch({
      levelId: seed.levelId, mode: 'line', boundary: [[0, 0], [1000, 0]], style: STYLE,
    });
    const cache = new DeriveCache();
    const g1 = cache.derive(store, id);
    store.updateElement(id, { style: { ...STYLE, color: '#ff0000', opacity: 0.5, width: 8 } });
    const g2 = cache.derive(store, id);
    expect(g2).toBe(g1); // 같은 객체 = 재파생 스킵
    expect((store.getElement(id) as SketchElement).style.opacity).toBe(0.5); // 값은 반영
  });

  it('boundary 변경 = re-derive (deriveKey 폴드)', () => {
    const { store, seed } = setup();
    const id = store.createSketch({
      levelId: seed.levelId, mode: 'line', boundary: [[0, 0], [1000, 0]], style: STYLE,
    });
    const cache = new DeriveCache();
    const g1 = cache.derive(store, id);
    store.updateElement(id, { boundary: [[0, 0], [1000, 0], [2000, 0]] });
    const g2 = cache.derive(store, id);
    expect(g2).not.toBe(g1);
    expect(g2!.edges.length).toBe(2 * 6); // 3점 = 2 세그
  });

  it('move = boundary 전 정점 평행이동 (POSITIONAL polygon)', () => {
    const { store, seed } = setup();
    const id = store.createSketch({
      levelId: seed.levelId, mode: 'line', boundary: [[100, 200], [1100, 200]], style: STYLE,
    });
    store.moveElements([id], [50, 60]);
    expect((store.getElement(id) as SketchElement).boundary).toEqual([[150, 260], [1150, 260]]);
  });
});
