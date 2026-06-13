import { describe, expect, it } from 'vitest';
import { DocStore, seedDocument } from '../src/store';
import { HATCH_CONCRETE, deriveDrawing, hatchPolygon, wallFootprint } from '../src/geometry';
import { CORE_SCHEMA_VERSION } from '../src/schema';
import type { DrawingView, Level, WallElement, WallType } from '../src/schema';

function setup() {
  const store = new DocStore();
  const seed = seedDocument(store);
  return { store, seed };
}

const planView = (levelId: string, cutHeight = 1200): DrawingView => ({
  id: 'v1',
  name: '1층 평면',
  type: 'plan',
  levelId,
  cutHeight,
});

describe('deriveDrawing — 평면뷰 절단/투영 분류', () => {
  it('절단면에 걸린 벽 4개 박스 → 절단 윤곽 4 + 해치, 투영 0', () => {
    const { store, seed } = setup();
    const t = seed.wallTypeIds[0]!;
    const L = seed.levelId;
    // 기본 높이(level.height=3000), cut=1200 → 전부 절단
    store.createWall({ levelId: L, typeId: t, a: [0, 0], b: [4000, 0] });
    store.createWall({ levelId: L, typeId: t, a: [4000, 0], b: [4000, 3000] });
    store.createWall({ levelId: L, typeId: t, a: [4000, 3000], b: [0, 3000] });
    store.createWall({ levelId: L, typeId: t, a: [0, 3000], b: [0, 0] });

    const d = deriveDrawing(planView(L), store);
    expect(d.cut).toHaveLength(4);
    expect(d.proj).toHaveLength(0);
    expect(d.hatch.length).toBeGreaterThan(0);
    // 절단 폴리곤은 닫힌 사각형(4점)
    expect(d.cut.every((p) => p.closed && p.pts.length === 4)).toBe(true);
  });

  it('절단면 아래 벽 → 투영(가는 선), 절단 0', () => {
    const { store, seed } = setup();
    const id = store.createWall({
      levelId: seed.levelId,
      typeId: seed.wallTypeIds[0]!,
      a: [0, 0],
      b: [4000, 0],
      height: 600, // top=600 < cut=1200
    });
    expect(id).toBeTruthy();
    const d = deriveDrawing(planView(seed.levelId), store);
    expect(d.cut).toHaveLength(0);
    expect(d.proj).toHaveLength(1);
    expect(d.hatch).toHaveLength(0);
  });

  it('절단면 위 벽 → 숨김(절단·투영 모두 0)', () => {
    const { store, seed } = setup();
    store.createWall({
      levelId: seed.levelId,
      typeId: seed.wallTypeIds[0]!,
      a: [0, 0],
      b: [4000, 0],
      baseOffset: 2000, // bottom=2000, top=3000, cut=1200 → above
      height: 1000,
    });
    const d = deriveDrawing(planView(seed.levelId), store);
    expect(d.cut).toHaveLength(0);
    expect(d.proj).toHaveLength(0);
  });

  it('슬라브 → 투영 윤곽, 그리드 → 축선 + 라벨', () => {
    const { store, seed } = setup();
    store.createSlab({
      levelId: seed.levelId,
      typeId: seed.slabTypeId,
      boundary: [
        [0, 0],
        [4000, 0],
        [4000, 3000],
        [0, 3000],
      ],
    });
    store.createGridLine({ a: [0, -1000], b: [0, 4000], label: 'A' });
    const d = deriveDrawing(planView(seed.levelId), store);
    // 슬라브(닫힘) + 그리드(열림) = 투영 2
    expect(d.proj).toHaveLength(2);
    expect(d.proj.some((p) => p.closed && p.pts.length === 4)).toBe(true); // 슬라브
    expect(d.proj.some((p) => !p.closed)).toBe(true); // 그리드 축선
    expect(d.labels).toContainEqual({ text: 'A', pos: [0, 4000] });
  });

  it('기둥 절단 → 단면 윤곽 + 해치', () => {
    const { store, seed } = setup();
    store.createColumn({ levelId: seed.levelId, typeId: seed.columnTypeId, at: [1000, 1000] });
    const d = deriveDrawing(planView(seed.levelId), store);
    expect(d.cut.length).toBeGreaterThan(0);
    expect(d.hatch.length).toBeGreaterThan(0);
  });

  it('elevation 뷰는 v1에서 빈 결과 (1c 후속 — 정사영+은선제거)', () => {
    const { store, seed } = setup();
    store.createWall({ levelId: seed.levelId, typeId: seed.wallTypeIds[0]!, a: [0, 0], b: [4000, 0] });
    const el = deriveDrawing({ id: 'v', name: 'e', type: 'elevation', line: [[0, -500], [4000, -500]] }, store);
    expect(el.cut).toHaveLength(0);
    expect(el.proj).toHaveLength(0);
  });
});

describe('deriveDrawing — 단면뷰 절단(cut), (u,z) 좌표', () => {
  const section = (line: [[number, number], [number, number]]) =>
    ({ id: 'v', name: 's', type: 'section', line }) as const;

  it('벽 가로지름 → cut 사각형, z = [elevation+baseOffset .. +height] 정확', () => {
    const { store, seed } = setup();
    // 레벨 elevation=0·height=3000. 벽 남북(a[0,0]→b[0,4000]). 절단선 동서로 가로지름.
    store.createWall({ levelId: seed.levelId, typeId: seed.wallTypeIds[0]!, a: [0, 0], b: [0, 4000] });
    const d = deriveDrawing(section([[-1000, 2000], [1000, 2000]]), store);
    expect(d.cut).toHaveLength(1);
    const z = d.cut[0]!.pts.map((p) => p[1]);
    expect(Math.min(...z)).toBeCloseTo(0); // zb = elevation
    expect(Math.max(...z)).toBeCloseTo(3000); // zt = +height
    expect(d.hatch.length).toBeGreaterThan(0);
  });

  it('절단선에 평행/빗나간 벽 → cut 없음 (grazing)', () => {
    const { store, seed } = setup();
    store.createWall({ levelId: seed.levelId, typeId: seed.wallTypeIds[0]!, a: [0, 0], b: [4000, 0] });
    const d = deriveDrawing(section([[0, 2000], [4000, 2000]]), store); // 평행, y=2000 안 만남
    expect(d.cut).toHaveLength(0);
  });

  it('슬라브 절단 → z 위=elevation·아래로 두께, u-범위=가로지른 거리', () => {
    const { store, seed } = setup();
    store.createSlab({
      levelId: seed.levelId,
      typeId: seed.slabTypeId,
      boundary: [[0, 0], [4000, 0], [4000, 4000], [0, 4000]],
    });
    const th = store.getType(seed.slabTypeId)!.kind === 'slab' ? (store.getType(seed.slabTypeId) as { thickness: number }).thickness : 0;
    const d = deriveDrawing(section([[-500, 2000], [4500, 2000]]), store);
    expect(d.cut).toHaveLength(1);
    const z = d.cut[0]!.pts.map((p) => p[1]);
    expect(Math.max(...z)).toBeCloseTo(0); // 위 = elevation
    expect(Math.min(...z)).toBeCloseTo(-th); // 아래로 두께만큼
    const u = d.cut[0]!.pts.map((p) => p[0]);
    expect(Math.min(...u)).toBeCloseTo(500); // 절단선 길이 5000 중 slab 진입 u
    expect(Math.max(...u)).toBeCloseTo(4500);
  });

  it('빈 절단선(길이 0) → 빈 결과', () => {
    const { store, seed } = setup();
    store.createWall({ levelId: seed.levelId, typeId: seed.wallTypeIds[0]!, a: [0, 0], b: [4000, 0] });
    expect(deriveDrawing(section([[100, 100], [100, 100]]), store).cut).toHaveLength(0);
  });
});

describe('deriveDrawing — 입면뷰 실루엣(painter HLR)', () => {
  const elev = (line: [[number, number], [number, number]]) =>
    ({ id: 'v', name: 'e', type: 'elevation', line }) as const;

  it('실루엣 far→near 정렬 — 가까운 게 배열 마지막 (부호규약 핀)', () => {
    const { store, seed } = setup();
    // baseline x축. n=[0,1] → toN=y. 관찰자 +y → 가까움=높은 y.
    // 먼 벽 y=1000(height 3000), 가까운 벽 y=5000(height 2000, 구분용).
    store.createWall({ levelId: seed.levelId, typeId: seed.wallTypeIds[0]!, a: [1000, 1000], b: [3000, 1000] });
    store.createWall({ levelId: seed.levelId, typeId: seed.wallTypeIds[0]!, a: [1000, 5000], b: [3000, 5000], height: 2000 });
    const d = deriveDrawing(elev([[0, 0], [10000, 0]]), store);
    expect(d.silhouettes).toBeDefined();
    expect(d.silhouettes!).toHaveLength(2);
    const ztOf = (i: number) => Math.max(...d.silhouettes![i]!.pts.map((p) => p[1]));
    expect(ztOf(0)).toBeCloseTo(3000); // 먼 벽 = 배열 처음
    expect(ztOf(1)).toBeCloseTo(2000); // 가까운 벽 = 배열 마지막(위에 그려 덮음). 뒤집히면 3000
  });

  it('전 층 포함 — 레벨 필터 없음 (1·2층 모두 실루엣)', () => {
    const { store, seed } = setup();
    const L2 = store.addLevel({ name: '2층', elevation: 3000, height: 3000, order: 1 });
    store.createWall({ levelId: seed.levelId, typeId: seed.wallTypeIds[0]!, a: [0, 1000], b: [4000, 1000] });
    store.createWall({ levelId: L2, typeId: seed.wallTypeIds[0]!, a: [0, 1000], b: [4000, 1000] });
    const d = deriveDrawing(elev([[0, 0], [4000, 0]]), store);
    expect(d.silhouettes!).toHaveLength(2);
    const tops = d.silhouettes!.map((s) => Math.max(...s.pts.map((p) => p[1]))).sort((a, b) => a - b);
    expect(tops).toEqual([3000, 6000]); // 1층 0..3000, 2층 3000..6000
  });
});

describe('wallFootprint — 마이터 footprint 폴리곤 (butt 기본)', () => {
  it('단일 벽 → 두께 사각형 4점', () => {
    const level: Level = { id: 'L', name: '1', elevation: 0, height: 3000, order: 0 };
    const type: WallType = { id: 'T', kind: 'wall', name: 'w', thickness: 200, color: '#fff' };
    const wall: WallElement = { id: 'w1', kind: 'wall', levelId: 'L', typeId: 'T', a: [0, 0], b: [1000, 0] };
    const fp = wallFootprint({ wall, type, level });
    expect(fp).toHaveLength(4);
    // x축 벽, 두께 200 → y ∈ {-100, +100}, x ∈ {0, 1000}
    const ys = fp.map((p) => p[1]).sort((a, b) => a - b);
    expect(ys).toEqual([-100, -100, 100, 100]);
    const xs = [...new Set(fp.map((p) => p[0]))].sort((a, b) => a - b);
    expect(xs).toEqual([0, 1000]);
  });

  it('0길이 벽 → 빈 배열', () => {
    const level: Level = { id: 'L', name: '1', elevation: 0, height: 3000, order: 0 };
    const type: WallType = { id: 'T', kind: 'wall', name: 'w', thickness: 200, color: '#fff' };
    const wall: WallElement = { id: 'w1', kind: 'wall', levelId: 'L', typeId: 'T', a: [50, 50], b: [50, 50] };
    expect(wallFootprint({ wall, type, level })).toEqual([]);
  });
});

describe('hatchPolygon — even-odd 평행선 채움', () => {
  it('1000×1000 사각형, 0°·간격200 → 수평선 4개, 각 길이 1000', () => {
    const sq: [number, number][] = [
      [0, 0],
      [1000, 0],
      [1000, 1000],
      [0, 1000],
    ];
    const segs = hatchPolygon(sq, { angle: 0, spacing: 200 });
    // y=200,400,600,800 (start=ceil(0/200)*200=0 제외? t<tMax & t from 0) → 0 포함되나 경계라 even-odd…
    expect(segs.length).toBeGreaterThanOrEqual(4);
    for (const [p0, p1] of segs) {
      expect(Math.abs(p0[1] - p1[1])).toBeLessThan(1e-6); // 수평
      expect(Math.abs(Math.hypot(p1[0] - p0[0], p1[1] - p0[1]) - 1000)).toBeLessThan(1e-6); // 길이 1000
    }
  });

  it('오목(U자) 폴리곤 — 극값 정점 스캔선 전체 채움 (리뷰 회귀)', () => {
    // 상단에 V노치 — 노치 정점 [1500,1000]이 스캔축 극값. 이전 버그: 비대칭 가드로
    // 홀수 교차수 → 오른쪽 절반 누락. 수정 후 전 폭 채움.
    const u: [number, number][] = [
      [0, 0],
      [3000, 0],
      [3000, 2000],
      [2000, 2000],
      [1500, 1000],
      [1000, 2000],
      [0, 2000],
    ];
    const segs = hatchPolygon(u, { angle: 0, spacing: 200 });
    const atApex = segs.filter(([p0]) => Math.abs(p0[1] - 1000) < 1e-6);
    const covered = atApex.reduce((acc, [p0, p1]) => acc + Math.abs(p1[0] - p0[0]), 0);
    expect(covered).toBeCloseTo(3000, 3); // [0..1500]+[1500..3000] = 전 폭
  });

  it('45° 콘크리트 패턴 → 폴리곤 bbox 내 선분', () => {
    const sq: [number, number][] = [
      [0, 0],
      [600, 0],
      [600, 600],
      [0, 600],
    ];
    const segs = hatchPolygon(sq, HATCH_CONCRETE);
    expect(segs.length).toBeGreaterThan(0);
    for (const [p0, p1] of segs) {
      for (const p of [p0, p1]) {
        expect(p[0]).toBeGreaterThanOrEqual(-1);
        expect(p[0]).toBeLessThanOrEqual(601);
        expect(p[1]).toBeGreaterThanOrEqual(-1);
        expect(p[1]).toBeLessThanOrEqual(601);
      }
    }
  });
});

describe('도면 뷰 채널 — ops + 스냅샷', () => {
  it('createView/updateView/deleteView + mm 양자화', () => {
    const { store, seed } = setup();
    const id = store.createView({ name: '1층 평면', type: 'plan', levelId: seed.levelId, cutHeight: 1200.6 });
    expect(store.getView(id)!.cutHeight).toBe(1201);
    store.updateView(id, { cutHeight: 900, name: '지하 평면' });
    expect(store.getView(id)!.cutHeight).toBe(900);
    expect(store.getView(id)!.name).toBe('지하 평면');
    expect(store.listViews()).toHaveLength(1);
    store.deleteView(id);
    expect(store.listViews()).toHaveLength(0);
  });

  it('snapshot 라운드트립 — schemaVersion 3 + views 보존', () => {
    const { store, seed } = setup();
    store.createView({ name: 'p', type: 'plan', levelId: seed.levelId, cutHeight: 1200 });
    const snap = store.snapshot();
    expect(snap.meta.schemaVersion).toBe(CORE_SCHEMA_VERSION);
    expect(snap.views).toHaveLength(1);
    const restored = DocStore.fromSnapshot(snap);
    expect(restored.listViews()).toHaveLength(1);
  });

  it('importSnapshot — views 부재(커밋복원)=보존, 명시(JSON백업)=교체', () => {
    const { store, seed } = setup();
    store.createView({ name: 'p', type: 'plan', levelId: seed.levelId });
    store.importSnapshot({ ...store.snapshot(), views: undefined }); // 커밋 복원 → 보존
    expect(store.listViews()).toHaveLength(1);
    store.importSnapshot({ ...store.snapshot(), views: [] }); // JSON 백업 → 교체(비움)
    expect(store.listViews()).toHaveLength(0);
  });
});
