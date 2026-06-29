import { describe, expect, it } from 'vitest';
import { DocStore, seedDocument } from '../src/store';
import { DeriveCache, buildDeriveIndex } from '../src/geometry';
import { elementFootprint } from '../src/select';
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

  it('zone <3 정점 = line으로 강등 (저장 mode가 실제 렌더와 일치)', () => {
    const { store, seed } = setup();
    const id = store.createSketch({ levelId: seed.levelId, mode: 'zone', boundary: [[0, 0], [1000, 0]], style: STYLE });
    expect((store.getElement(id) as SketchElement).mode).toBe('line');
    // 3정점 zone은 zone 유지
    const id2 = store.createSketch({ levelId: seed.levelId, mode: 'zone', boundary: [[0, 0], [1000, 0], [1000, 1000]], style: STYLE });
    expect((store.getElement(id2) as SketchElement).mode).toBe('zone');
  });

  it('framed sketch — footprint = world XY 투영(uv 아님) + move = frame.o 이동(boundary 불변)', () => {
    const { store, seed } = setup();
    // 수직 평면: o=[5000,0,2000]mm world, x=동, y=상. boundary=평면-로컬 uv.
    const id = store.createSketch({
      levelId: seed.levelId, mode: 'line', boundary: [[0, 0], [1000, 0]], style: STYLE,
      frame: { o: [5000, 0, 2000], x: [1, 0, 0], y: [0, 1, 0] },
    });
    // footprint = world [x,z]mm (uv 아님): uv(0,0)→[5000,2000], uv(1000,0)→[6000,2000]
    expect(elementFootprint(store.getElement(id)!, store)).toEqual({ kind: 'polygon', pts: [[5000, 2000], [6000, 2000]] });
    // move(doc dx=1000,dy=500) → frame.o += [1000,0,500], basis·boundary 불변
    store.moveElements([id], [1000, 500]);
    const el = store.getElement(id) as SketchElement;
    expect(el.frame!.o).toEqual([6000, 0, 2500]);
    expect(el.frame!.x).toEqual([1, 0, 0]);
    expect(el.boundary).toEqual([[0, 0], [1000, 0]]);
  });

  it('frame = 자유 3D 평면에 매핑 (수직 벽면 — S4)', () => {
    const { store, seed } = setup();
    const id = store.createSketch({
      levelId: seed.levelId,
      mode: 'line',
      boundary: [[0, 0], [1000, 0], [1000, 2000]],
      style: STYLE,
      frame: { o: [0, 0, 0], x: [1, 0, 0], y: [0, 1, 0] }, // 동(+X)-상(+Y) = 수직 평면
    });
    const geo = derive(store, id)!;
    // 1번째 세그: map(0,0)=[0,0,0] → map(1000,0)=[1,0,0] (동쪽 1m)
    expect([geo.edges[0], geo.edges[1], geo.edges[2]]).toEqual([0, 0, 0]);
    expect(geo.edges[3]).toBeCloseTo(1);
    expect(geo.edges[5]).toBeCloseTo(0);
    // 끝점 = map(1000,2000)=[1,2,0] — y=2m 위로(수직 평면 증명, 바닥 아님)
    expect(geo.edges[9]).toBeCloseTo(1);
    expect(geo.edges[10]).toBeCloseTo(2);
    expect(geo.edges[11]).toBeCloseTo(0);
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
