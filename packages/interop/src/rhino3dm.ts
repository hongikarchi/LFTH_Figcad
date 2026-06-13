import rhino3dm from 'rhino3dm';
import {
  DocStore,
  sectionRing,
  type BeamType,
  type ColumnType,
  type DocSnapshot,
  type Id,
  type WallType,
} from '@figcad/core';

/**
 * Rhino .3dm export/import (rhino3dm WASM).
 *
 * .3dm은 지오메트리 레벨 — 파라메트릭 보존 불가 (리서치 결론, IFC가 그 역할).
 * 따라서 의도적 손실: 벽 두께/타입/개구부는 .3dm 라운드트립에서 보존하지 않는다.
 * 교환하는 것은 "편집 가능한 곡선": 벽 중심선·풋프린트, 슬라브 경계, 그리드 —
 * Rhino 사용자가 보고 스냅·모델링할 수 있는 형태. 좌표는 mm(문서 단위 그대로).
 *
 * export: Wall Axis(중심선)·Walls(풋프린트 사각형)·Slab(경계)·Grid·Column(단면
 *         풋프린트)·Beam(중심축) 레이어 — 모든 1차 요소의 지오메트리를 곡선으로.
 * import: Wall Axis 라인 → 벽(기본 두께), Slab 닫힌 폴리라인 → 슬라브.
 *         Column/Beam 레이어는 v1에서 되읽지 않음(스킵+카운트 — 구조요소 파라메트릭
 *         복원은 IFC 경유). 조용한 누락 없음.
 *         외부 .3dm은 레이어가 달라도 best-effort(열린 곡선→벽, 닫힌→슬라브),
 *         메시/B-rep/서피스는 매핑 대상이 없어 스킵+카운트.
 */

const DEFAULT_THICKNESS = 200;
const DEFAULT_SLAB_THICKNESS = 150;

type Rhino = Awaited<ReturnType<typeof rhino3dm>>;

/** 브라우저에서 rhino3dm.wasm 위치 주입용 (vite ?url). node(테스트)는 생략 — fs로 자동 탐색 */
export interface RhinoOpts {
  wasmUrl?: string;
}

let rhinoPromise: Promise<Rhino> | null = null;
function getRhino(opts?: RhinoOpts): Promise<Rhino> {
  if (!rhinoPromise) {
    // emscripten 팩토리는 moduleOverrides를 받는다 (d.ts는 무인자로 표기 — 런타임 캐스트).
    // locateFile로 .wasm을 vite가 served한 URL로 해결 (없으면 node fs 기본 경로).
    const factory = rhino3dm as unknown as (mod?: {
      locateFile?: (path: string, prefix: string) => string;
    }) => Promise<Rhino>;
    const arg = opts?.wasmUrl
      ? { locateFile: (path: string, prefix: string) => (path.endsWith('.wasm') ? opts.wasmUrl! : prefix + path) }
      : undefined;
    rhinoPromise = factory(arg).catch((e) => {
      rhinoPromise = null;
      throw e;
    });
  }
  return rhinoPromise;
}

export async function exportRhino(snap: DocSnapshot, opts?: RhinoOpts): Promise<Uint8Array> {
  const rhino = await getRhino(opts);
  const doc = new rhino.File3dm();
  try {
    doc.settings().modelUnitSystem = rhino.UnitSystem.Millimeters;
  } catch {
    /* 단위 설정 실패해도 좌표는 mm로 기록 */
  }

  const layers = doc.layers();
  const axisLayer = layers.addLayer('Wall Axis', { r: 60, g: 60, b: 60 });
  const wallLayer = layers.addLayer('Walls', { r: 120, g: 120, b: 120 });
  const slabLayer = layers.addLayer('Slab', { r: 150, g: 150, b: 150 });
  const gridLayer = layers.addLayer('Grid', { r: 200, g: 60, b: 60 });
  const columnLayer = layers.addLayer('Column', { r: 90, g: 90, b: 120 });
  const beamLayer = layers.addLayer('Beam', { r: 110, g: 110, b: 90 });
  const attr = (idx: number) => {
    const a = new rhino.ObjectAttributes();
    a.layerIndex = idx;
    return a;
  };
  const objects = doc.objects();
  const elev = new Map(snap.levels.map((l) => [l.id, l.elevation]));
  const levelH = new Map(snap.levels.map((l) => [l.id, l.height]));
  const wallTypes = new Map(
    snap.types.filter((t) => t.kind === 'wall').map((t) => [t.id, t as WallType]),
  );
  const columnTypes = new Map(
    snap.types.filter((t) => t.kind === 'column').map((t) => [t.id, t as ColumnType]),
  );
  const beamTypes = new Map(
    snap.types.filter((t) => t.kind === 'beam').map((t) => [t.id, t as BeamType]),
  );

  for (const el of snap.elements) {
    if (el.kind === 'wall') {
      const z = (elev.get(el.levelId) ?? 0) + (el.baseOffset ?? 0);
      // 중심선 (import 소스)
      objects.add(
        new rhino.PolylineCurve([
          [el.a[0], el.a[1], z],
          [el.b[0], el.b[1], z],
        ]),
        attr(axisLayer),
      );
      // 풋프린트 사각형 (시각용) — 두께 양옆
      const t = (wallTypes.get(el.typeId)?.thickness ?? DEFAULT_THICKNESS) / 2;
      const dx = el.b[0] - el.a[0];
      const dy = el.b[1] - el.a[1];
      const len = Math.hypot(dx, dy) || 1;
      const nx = (-dy / len) * t;
      const ny = (dx / len) * t;
      objects.add(
        new rhino.PolylineCurve([
          [el.a[0] + nx, el.a[1] + ny, z],
          [el.b[0] + nx, el.b[1] + ny, z],
          [el.b[0] - nx, el.b[1] - ny, z],
          [el.a[0] - nx, el.a[1] - ny, z],
          [el.a[0] + nx, el.a[1] + ny, z],
        ]),
        attr(wallLayer),
      );
    } else if (el.kind === 'slab') {
      const z = elev.get(el.levelId) ?? 0;
      const pts = el.boundary.map((p) => [p[0], p[1], z] as number[]);
      pts.push(pts[0]!);
      objects.add(new rhino.PolylineCurve(pts), attr(slabLayer));
    } else if (el.kind === 'grid') {
      objects.add(
        new rhino.PolylineCurve([
          [el.a[0], el.a[1], 0],
          [el.b[0], el.b[1], 0],
        ]),
        attr(gridLayer),
      );
    } else if (el.kind === 'column') {
      // 단면 풋프린트 폴리라인 (베이스 z) — Rhino에서 보고 스냅 가능
      const z = (elev.get(el.levelId) ?? 0) + (el.baseOffset ?? 0);
      const section = columnTypes.get(el.typeId)?.section ?? { shape: 'rect', width: 400, depth: 400 };
      const ring = sectionRing(section).map(([sx, sy]) => [el.at[0] + sx, el.at[1] + sy, z] as number[]);
      ring.push(ring[0]!);
      objects.add(new rhino.PolylineCurve(ring), attr(columnLayer));
    } else if (el.kind === 'beam') {
      // 중심축 라인 (보 높이 z)
      const section = beamTypes.get(el.typeId)?.section ?? { shape: 'rect', width: 300, depth: 600 };
      const vHalf = section.shape === 'circle' ? section.diameter / 2 : section.depth / 2;
      const z = (elev.get(el.levelId) ?? 0) + (el.zOffset ?? (levelH.get(el.levelId) ?? 3000) - vHalf);
      objects.add(
        new rhino.PolylineCurve([
          [el.a[0], el.a[1], z],
          [el.b[0], el.b[1], z],
        ]),
        attr(beamLayer),
      );
    }
  }

  return doc.toByteArray();
}

export interface RhinoImportResult {
  snapshot: DocSnapshot;
  skipped: Record<string, number>;
}

export async function importRhino(bytes: Uint8Array, opts?: RhinoOpts): Promise<RhinoImportResult> {
  const rhino = await getRhino(opts);
  const doc = rhino.File3dm.fromByteArray(bytes);
  const skipped: Record<string, number> = {};
  const bump = (k: string) => (skipped[k] = (skipped[k] ?? 0) + 1);

  // 레이어 index → 이름
  const layers = doc.layers();
  const layerName = new Map<number, string>();
  for (let i = 0; i < layers.count; i++) {
    const l = layers.get(i);
    layerName.set(typeof l.index === 'number' ? l.index : i, l.name);
  }

  const store = new DocStore();

  // 곡선 수집 (z별 레벨 구성 위해 2패스)
  interface Curve {
    layer: string;
    pts: [number, number][];
    z: number;
    closed: boolean;
  }
  const curves: Curve[] = [];
  const objects = doc.objects();
  for (let i = 0; i < objects.count; i++) {
    const obj = objects.get(i);
    const geom = obj.geometry() as unknown as {
      pointCount?: number;
      point?: (i: number) => number[];
      isClosed?: boolean;
    };
    if (typeof geom.pointCount !== 'number' || typeof geom.point !== 'function') {
      bump('비곡선(메시/서피스 등)');
      continue;
    }
    const n = geom.pointCount;
    if (n < 2) {
      bump('빈 곡선');
      continue;
    }
    const raw: number[][] = [];
    for (let k = 0; k < n; k++) raw.push(geom.point(k));
    const z = Math.round(raw[0]![2] ?? 0);
    const first = raw[0]!;
    const last = raw[n - 1]!;
    const closed =
      !!geom.isClosed || (Math.abs(first[0]! - last[0]!) < 1 && Math.abs(first[1]! - last[1]!) < 1);
    const pts = raw.map((p) => [Math.round(p[0]!), Math.round(p[1]!)] as [number, number]);
    const attr = obj.attributes();
    curves.push({ layer: layerName.get(attr.layerIndex) ?? '', pts, z, closed });
  }

  // 레벨: 곡선들의 distinct z → 레벨 (그리드(z=0 강제)는 레벨 결정에서 제외)
  const zSet = new Set<number>();
  for (const c of curves) if (c.layer !== 'Grid') zSet.add(c.z);
  if (zSet.size === 0) zSet.add(0);
  const sortedZ = [...zSet].sort((a, b) => a - b);
  const levelByZ = new Map<number, Id>();
  sortedZ.forEach((z, i) => {
    const next = sortedZ[i + 1];
    const height = next ? next - z : 3000;
    const id = store.addLevel({ name: `레벨 ${z}`, elevation: z, height: height > 0 ? height : 3000, order: i });
    levelByZ.set(z, id);
  });
  const wallTypeId = store.addType({ kind: 'wall', name: `벽 ${DEFAULT_THICKNESS}`, thickness: DEFAULT_THICKNESS, color: '#eceae5' });
  let slabTypeId: Id | null = null;
  const slabType = () =>
    (slabTypeId ??= store.addType({ kind: 'slab', name: `슬라브 ${DEFAULT_SLAB_THICKNESS}`, thickness: DEFAULT_SLAB_THICKNESS, color: '#dcdad5' }));

  const hasFigcadLayers = curves.some((c) => c.layer === 'Wall Axis' || c.layer === 'Slab');

  for (const c of curves) {
    // Figcad가 만든 .3dm: 레이어로 명확히 분류. 외부 .3dm: 형태로 best-effort.
    const isWall = hasFigcadLayers ? c.layer === 'Wall Axis' : !c.closed;
    const isSlab = hasFigcadLayers ? c.layer === 'Slab' : c.closed;
    const isGrid = c.layer === 'Grid';
    if (c.layer === 'Walls') continue; // 시각용 풋프린트 — import는 Axis에서
    if (c.layer === 'Column' || c.layer === 'Beam') {
      bump('구조요소(v1 가져오기 미지원 — IFC 경유)');
      continue;
    }

    if (isGrid) {
      try {
        store.createGridLine({ a: c.pts[0]!, b: c.pts[c.pts.length - 1]! });
      } catch {
        bump('grid(퇴화)');
      }
    } else if (isWall) {
      const a = c.pts[0]!;
      const b = c.pts[c.pts.length - 1]!;
      if (a[0] === b[0] && a[1] === b[1]) {
        bump('wall(길이0)');
        continue;
      }
      const levelId = levelByZ.get(c.z) ?? levelByZ.get(sortedZ[0]!)!;
      store.createWall({ levelId, typeId: wallTypeId, a, b });
    } else if (isSlab) {
      const ring = [...c.pts];
      if (ring.length > 1) {
        const f = ring[0]!;
        const l = ring[ring.length - 1]!;
        if (f[0] === l[0] && f[1] === l[1]) ring.pop();
      }
      if (ring.length < 3) {
        bump('slab(점부족)');
        continue;
      }
      const levelId = levelByZ.get(c.z) ?? levelByZ.get(sortedZ[0]!)!;
      try {
        store.createSlab({ levelId, typeId: slabType(), boundary: ring });
      } catch {
        bump('slab(자가교차)');
      }
    }
  }

  const snapshot = store.snapshot();
  snapshot.meta = { ...snapshot.meta, projectName: '가져온 Rhino 모델' };
  return { snapshot, skipped };
}
