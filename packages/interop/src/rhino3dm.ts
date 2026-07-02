import rhino3dm from 'rhino3dm';
import {
  DocStore,
  sectionRing,
  sectionVHalf,
  arcPolyline,
  curvedWallFootprint,
  type BeamType,
  type ColumnType,
  type DocSnapshot,
  type Id,
  type StairType,
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
 *         풋프린트)·Beam(중심축)·Stair(주행 풋프린트)·Railing(축)·Roof(경계) 레이어 —
 *         모든 1차 요소의 지오메트리를 곡선으로.
 * import: Wall Axis 라인 → 벽(기본 두께), Slab 닫힌 폴리라인 → 슬라브.
 *         Column/Beam/Stair/Railing/Roof 레이어는 v1에서 되읽지 않음(스킵+카운트 —
 *         구조요소 파라메트릭 복원은 IFC 경유). 조용한 누락 없음.
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
  const stairLayer = layers.addLayer('Stair', { r: 150, g: 90, b: 150 });
  const railingLayer = layers.addLayer('Railing', { r: 90, g: 150, b: 150 });
  const roofLayer = layers.addLayer('Roof', { r: 130, g: 120, b: 90 });
  const zoneLayer = layers.addLayer('Zone', { r: 90, g: 160, b: 90 });
  const cwLayer = layers.addLayer('CurtainWall', { r: 90, g: 150, b: 170 });
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
  const stairTypes = new Map(
    snap.types.filter((t) => t.kind === 'stair').map((t) => [t.id, t as StairType]),
  );

  for (const el of snap.elements) {
    if (el.kind === 'wall') {
      const z = (elev.get(el.levelId) ?? 0) + (el.baseOffset ?? 0);
      const thickness = wallTypes.get(el.typeId)?.thickness ?? DEFAULT_THICKNESS;
      if (el.sagitta) {
        // 곡선 벽(C5): 중심선·풋프린트를 호 테셀 폴리라인으로 — 직선 chord 곡률 손실 방지.
        const axisPts = arcPolyline(el.a, el.b, el.sagitta).map((p) => [p[0], p[1], z] as number[]);
        objects.add(new rhino.PolylineCurve(axisPts), attr(axisLayer));
        const fp = curvedWallFootprint(el.a, el.b, el.sagitta, thickness).map((p) => [p[0], p[1], z] as number[]);
        fp.push(fp[0]!); // 닫기
        objects.add(new rhino.PolylineCurve(fp), attr(wallLayer));
      } else {
        // 중심선 (import 소스)
        objects.add(
          new rhino.PolylineCurve([
            [el.a[0], el.a[1], z],
            [el.b[0], el.b[1], z],
          ]),
          attr(axisLayer),
        );
        // 풋프린트 사각형 (시각용) — 두께 양옆
        const t = thickness / 2;
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
      }
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
      // 수직 반높이 = 코어 sectionVHalf 단일 소스 (deriveBeam 기본 zOffset과 동일 수식 — 재인라인 금지)
      const z = (elev.get(el.levelId) ?? 0) + (el.zOffset ?? (levelH.get(el.levelId) ?? 3000) - sectionVHalf(section));
      objects.add(
        new rhino.PolylineCurve([
          [el.a[0], el.a[1], z],
          [el.b[0], el.b[1], z],
        ]),
        attr(beamLayer),
      );
    } else if (el.kind === 'stair') {
      // 주행 풋프린트 사각형 (폭 양옆) — 베이스 z
      const z = (elev.get(el.levelId) ?? 0) + (el.baseOffset ?? 0);
      const w = (stairTypes.get(el.typeId)?.width ?? 1000) / 2;
      const dx = el.b[0] - el.a[0];
      const dy = el.b[1] - el.a[1];
      const len = Math.hypot(dx, dy) || 1;
      const nx = (-dy / len) * w;
      const ny = (dx / len) * w;
      objects.add(
        new rhino.PolylineCurve([
          [el.a[0] + nx, el.a[1] + ny, z],
          [el.b[0] + nx, el.b[1] + ny, z],
          [el.b[0] - nx, el.b[1] - ny, z],
          [el.a[0] - nx, el.a[1] - ny, z],
          [el.a[0] + nx, el.a[1] + ny, z],
        ]),
        attr(stairLayer),
      );
    } else if (el.kind === 'railing') {
      // 상부레일 축 (height z)
      const rt = snap.types.find((t) => t.id === el.typeId);
      const h = rt && rt.kind === 'railing' ? rt.height : 1100;
      const z = (elev.get(el.levelId) ?? 0) + (el.baseOffset ?? 0) + h;
      objects.add(
        new rhino.PolylineCurve([
          [el.a[0], el.a[1], z],
          [el.b[0], el.b[1], z],
        ]),
        attr(railingLayer),
      );
    } else if (el.kind === 'roof') {
      // 경계 폴리라인 — 벽 위(level.height) z (평지붕 근사, 경사는 .3dm 미보존)
      const z = (elev.get(el.levelId) ?? 0) + (levelH.get(el.levelId) ?? 3000) + (el.baseOffset ?? 0);
      const pts = el.boundary.map((p) => [p[0], p[1], z] as number[]);
      pts.push(pts[0]!);
      objects.add(new rhino.PolylineCurve(pts), attr(roofLayer));
    } else if (el.kind === 'zone') {
      // 존 경계 — 바닥(레벨 elevation) z 닫힌 폴리라인 (공간 윤곽, 지오레벨)
      const z = elev.get(el.levelId) ?? 0;
      const pts = el.boundary.map((p) => [p[0], p[1], z] as number[]);
      pts.push(pts[0]!);
      objects.add(new rhino.PolylineCurve(pts), attr(zoneLayer));
    } else if (el.kind === 'curtainwall') {
      // 베이스라인 (멀리언 그리드는 지오레벨 미보존 — 베이스라인+높이만)
      const z = elev.get(el.levelId) ?? 0;
      objects.add(new rhino.PolylineCurve([[el.a[0], el.a[1], z], [el.b[0], el.b[1], z]]), attr(cwLayer));
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
  if (!doc) throw new Error('.3dm 파싱 실패'); // 형제 함수(import3dmMeshes/Refs)와 일관 — 손상 파일 명확한 에러
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
    if (
      c.layer === 'Column' ||
      c.layer === 'Beam' ||
      c.layer === 'Stair' ||
      c.layer === 'Railing' ||
      c.layer === 'Roof'
    ) {
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
      // 다정점 폴리라인 = 연속 정점쌍마다 벽(체인) — 첫·끝만 쓰면 중간 정점 손실(DXF import와 동일 수정).
      const levelId = levelByZ.get(c.z) ?? levelByZ.get(sortedZ[0]!)!;
      let made = 0;
      for (let i = 0; i < c.pts.length - 1; i++) {
        const a = c.pts[i]!;
        const b = c.pts[i + 1]!;
        if (a[0] === b[0] && a[1] === b[1]) continue;
        store.createWall({ levelId, typeId: wallTypeId, a, b });
        made++;
      }
      if (!made) bump('wall(길이0)');
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

/**
 * .3dm → federation 오버레이용 삼각망 (M13.6 D). **명시 Mesh 객체만** 추출(raw Brep·Extrusion·
 * InstanceReference는 메시 없으면 skip+count — 신뢰성, R2 결론. 정밀 .3dm=v1.5). importRhino의
 * 파라메트릭 복원과 다른 *충실 메시 표시* 경로(extractIfc/importIfcMeshes 대응).
 * 좌표: rhino = mm·**Z-up**(x동·y북·z높이) → Figcad world m·Y-up = `[x, z, y]*.001`(Z-up→Y-up,
 * 부호 무반전 — Figcad world Z=+north). non-indexed 삼각형(quad→2tri). normals 생략(consumer가 계산).
 */
export function import3dmMeshes(
  bytes: Uint8Array,
  opts?: RhinoOpts,
): Promise<{ meshes: { positions: Float32Array }[]; skipped: number }> {
  return getRhino(opts).then((rhino) => {
    const doc = rhino.File3dm.fromByteArray(bytes);
    if (!doc) throw new Error('.3dm 파싱 실패');
    const objs = doc.objects();
    const meshes: { positions: Float32Array }[] = [];
    let skipped = 0;
    const MM = 0.001;
    for (let i = 0; i < objs.count; i++) {
      const geo = objs.get(i)?.geometry();
      // ObjectType.Mesh = 32 (rhino3dm enum). Mesh 아니면 skip+count.
      if (!geo || geo.objectType !== rhino.ObjectType.Mesh) {
        skipped++;
        (geo as { delete?: () => void } | undefined)?.delete?.(); // Emscripten 힙 해제(누수 방지)
        continue;
      }
      const mesh = geo as unknown as import('rhino3dm').Mesh;
      const vl = mesh.vertices();
      const fl = mesh.faces();
      const vc = vl.count;
      const wv: number[][] = new Array(vc);
      for (let v = 0; v < vc; v++) {
        const p = vl.get(v); // [x_east, y_north, z_height] mm, Z-up
        wv[v] = p && p.length >= 3 ? [p[0]! * MM, p[2]! * MM, p[1]! * MM] : [0, 0, 0]; // → [east, height, north] m
      }
      const pos: number[] = [];
      for (let f = 0; f < fl.count; f++) {
        const face = fl.get(f); // [a,b,c] tri 또는 [a,b,c,d] quad
        if (!face || face.length < 3) continue;
        const i0 = face[0], i1 = face[1], i2 = face[2];
        if (i0 === undefined || i1 === undefined || i2 === undefined) continue;
        const a = wv[i0], b = wv[i1], c = wv[i2];
        if (!a || !b || !c) continue;
        pos.push(a[0]!, a[1]!, a[2]!, b[0]!, b[1]!, b[2]!, c[0]!, c[1]!, c[2]!);
        // rhino는 삼각형도 quad[a,b,c,c]로 저장(i3==i2=퇴화) → 진짜 quad일 때만 2nd tri.
        if (face.length >= 4) {
          const i3 = face[3];
          const d = i3 === undefined || i3 === i2 ? undefined : wv[i3];
          if (d) pos.push(a[0]!, a[1]!, a[2]!, c[0]!, c[1]!, c[2]!, d[0]!, d[1]!, d[2]!);
        }
      }
      if (pos.length) meshes.push({ positions: new Float32Array(pos) });
      (geo as { delete?: () => void }).delete?.(); // Emscripten 힙 해제 — 대형 .3dm 반복 import 누수 방지(IFC ifcMeshes 패턴)
    }
    (doc as { delete?: () => void }).delete?.();
    return { meshes, skipped };
  });
}

// ===== .3dm "있는 그대로" 추출 — Brep/Extrusion=솔리드 렌더메시·Curve=와이어프레임·블록 재귀 ======
// rhino3dm는 Brep 면 테셀(커널)은 못 하지만, .3dm에 캐시된 **렌더메시**는 노출한다(import_3dm 방식,
// 실측 확인): Brep = `brep.faces.get(f).getMesh(MeshType.Any)` 면별 메시 · Extrusion = `ex.getMesh()`.
// → 솔리드 삼각망(Rhino 셰이드 표시 모드 동급). 렌더메시 없는 Brep만 edge 폴리라인 폴백.
// standalone Curve = pointAt 폴리라인. 블록(InstanceReference) = 정의 재귀 + xform 합성.
// 좌표: rhino Z-up mm → Figcad Y-up m [x,z,y]*.001. 블록 xform 적용 후 변환.
const MAX_TRIS = 2_000_000; // 솔리드 삼각형 상한(메모리 — 9 float/tri).
const MAX_WIRE_SEG = 900_000; // 커브 세그먼트 상한(6 float/seg).

type Xf = number[]; // 4x4 row-dominant 16
const IDENT_XF: Xf = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
function applyXf(m: Xf, x: number, y: number, z: number): [number, number, number] {
  return [
    m[0]! * x + m[1]! * y + m[2]! * z + m[3]!,
    m[4]! * x + m[5]! * y + m[6]! * z + m[7]!,
    m[8]! * x + m[9]! * y + m[10]! * z + m[11]!,
  ];
}
function composeXf(a: Xf, b: Xf): Xf {
  const o: number[] = new Array(16).fill(0);
  for (let r = 0; r < 4; r++)
    for (let c = 0; c < 4; c++)
      for (let k = 0; k < 4; k++) o[r * 4 + c]! += a[r * 4 + k]! * b[k * 4 + c]!;
  return o;
}
/** Emscripten embind 핸들 해제 (누수 방지). 데이터 추출 후 일시 래퍼에만 호출. */
const del = (o: unknown): void => (o as { delete?: () => void } | null | undefined)?.delete?.();

/**
 * 병합 버퍼 내 객체 범위 — **삼각형 인덱스(faceIndex) 공간**, start 오름차순(방출 순서 = tris 단조 증가).
 * 임포트 객체 식별(스냅 정보칩·라벨 프리필·AI 매니페스트)용 — 렌더는 여전히 단일 메시(draw call 예산).
 */
export interface Rhino3dmObjectRange {
  start: number;
  count: number;
  /** 객체 이름 — 없으면 인스턴스 정의(블록) 이름 폴백 */
  name?: string;
  /** rhino object uuid (인스턴스별 유니크) */
  id?: string;
  /** 레이어 fullPath/이름 */
  layer?: string;
}

/** 정체성 range 상한 — 초과분은 소스레벨 이름으로 열화(캡 초과 메가모델 힙 가드, ~수 MB). */
const MAX_GROUPS = 50_000;

export function import3dmRefs(
  bytes: Uint8Array,
  opts?: RhinoOpts,
): Promise<{
  meshes: { positions: Float32Array; groups?: Rhino3dmObjectRange[] }[];
  edges: Float32Array;
  skipped: number;
  capped: boolean;
}> {
  return getRhino(opts).then((rhino) => {
    const doc = rhino.File3dm.fromByteArray(bytes);
    if (!doc) throw new Error('.3dm 파싱 실패');
    const MM = 0.001;
    const T = rhino.ObjectType;
    const meshType = (rhino as { MeshType?: { Any?: number } }).MeshType?.Any; // 보통 undefined → getMesh 기본=렌더메시(실측)
    const meshPos: number[] = []; // 솔리드 삼각형 정점 (world m, 단일 버퍼)
    const seg: number[] = []; // [x0,y0,z0,x1,y1,z1] world m (커브 와이어프레임)
    let tris = 0;
    let skipped = 0;
    let capped = false;

    // uuid → File3dmObject geometry (블록 재귀용). objects 1회 인덱싱.
    // ⚠️ doc.objects()는 **인스턴스 정의 멤버 지오메트리도 포함**(isInstanceDefinitionObject) — byId엔 넣되
    // top엔 넣지 않는다. 넣으면 (a) 변환 없이 원점에 중복 렌더 + (b) Mesh 멤버면 top emit이 delete →
    // InstanceReference 재귀가 삭제된 객체 재사용 = use-after-delete 크래시(블록 많은 .3dm = 타깃 파일).
    // 레이어 테이블 1회 — layerIndex → fullPath/이름 (정체성 표시·AI 카테고리용, 실패=무명).
    const layerTable: (string | undefined)[] = [];
    try {
      const layers = (doc as { layers?: () => { count: number; get: (i: number) => unknown } }).layers?.();
      if (layers) {
        for (let i = 0; i < layers.count; i++) {
          const ly = layers.get(i) as { fullPath?: string; name?: string } | undefined;
          layerTable[i] = ly?.fullPath || ly?.name || undefined;
        }
      }
    } catch {
      /* 레이어 무명 허용 */
    }

    const objs = doc.objects();
    const OM = (rhino as { ObjectMode?: { Hidden?: number } }).ObjectMode;
    const byId = new Map<string, unknown>();
    const top: { geo: unknown; name?: string; id?: string; layer?: string }[] = [];
    for (let i = 0; i < objs.count; i++) {
      const o = objs.get(i);
      const at = (o as { attributes?: () => { id?: string; name?: string; layerIndex?: number; isInstanceDefinitionObject?: boolean; mode?: number } } | undefined)?.attributes?.();
      const id = at?.id;
      const geo = (o as { geometry?: () => unknown } | undefined)?.geometry?.();
      if (!geo) continue;
      if (id) byId.set(id, geo);
      const isDefMember = at?.isInstanceDefinitionObject === true; // InstanceReference 통해서만 렌더
      const hidden = OM?.Hidden !== undefined && at?.mode === OM.Hidden; // 작성자가 숨긴 객체 제외
      if (!isDefMember && !hidden) {
        top.push({
          geo,
          name: at?.name || undefined,
          id,
          layer: at?.layerIndex !== undefined ? layerTable[at.layerIndex] : undefined,
        });
      }
    }
    const idefs = (doc as { instanceDefinitions?: () => { count: number; get: (i: number) => unknown } }).instanceDefinitions?.();
    const idefById = new Map<string, { count: number; get: (i: number) => string } | unknown>();
    if (idefs) {
      for (let i = 0; i < idefs.count; i++) {
        const d = idefs.get(i) as { id?: string };
        if (d?.id) idefById.set(d.id, d);
      }
    }

    const pushSeg = (a: [number, number, number], b: [number, number, number]): void => {
      if (seg.length / 6 >= MAX_WIRE_SEG) { capped = true; return; }
      seg.push(a[0] * MM, a[2] * MM, a[1] * MM, b[0] * MM, b[2] * MM, b[1] * MM); // Z-up→Y-up
    };
    // 커브(에지 포함) → 폴리라인 세그먼트(xform 적용 후, 변환 전 rhino 좌표).
    const tessCurve = (crv: { domain?: number[]; pointAt?: (t: number) => number[]; isLinear?: (tol: number) => boolean } | undefined, xf: Xf): void => {
      if (!crv?.pointAt || !crv.domain) return;
      const [t0, t1] = crv.domain;
      if (t0 === undefined || t1 === undefined || t1 <= t0) return;
      const linear = typeof crv.isLinear === 'function' ? crv.isLinear(0.001) : false;
      const N = linear ? 1 : 24;
      let prev: [number, number, number] | null = null;
      for (let k = 0; k <= N; k++) {
        const p = crv.pointAt(t0 + ((t1 - t0) * k) / N);
        if (!p || p.length < 3) continue;
        const w = applyXf(xf, p[0]!, p[1]!, p[2]!);
        if (prev) pushSeg(prev, w);
        prev = w;
      }
    };
    // 임의 rhino 메시(렌더메시 포함) → meshPos 누적(world m). 추가했으면 true. 끝나면 메시 dispose.
    type RMesh = { vertices?: () => { count: number; get: (i: number) => number[] }; faces?: () => { count: number; get: (i: number) => number[] }; delete?: () => void };
    // transient=true → getMesh()로 새로 받은 일시 핸들(Brep face·Extrusion)이라 delete로 해제.
    // transient=false → doc 소유 영속 지오(T.Mesh 객체·정의 멤버) — delete 금지(멀티 인스턴스 재사용/doc.delete가 회수).
    const emitMeshObj = (mesh: RMesh | undefined | null, xf: Xf, transient: boolean): boolean => {
      const vl = mesh?.vertices?.(); const fl = mesh?.faces?.();
      if (!vl || !fl) return false;
      const wv: number[][] = [];
      for (let v = 0; v < vl.count; v++) { const p = vl.get(v); const w = p && p.length >= 3 ? applyXf(xf, p[0]!, p[1]!, p[2]!) : [0, 0, 0]; wv[v] = [w[0]! * MM, w[2]! * MM, w[1]! * MM]; }
      let added = false;
      for (let f = 0; f < fl.count; f++) {
        if (tris >= MAX_TRIS) { capped = true; break; }
        const face = fl.get(f); if (!face || face.length < 3) continue;
        const a = wv[face[0]!], b = wv[face[1]!], c = wv[face[2]!]; if (!a || !b || !c) continue;
        meshPos.push(a[0]!, a[1]!, a[2]!, b[0]!, b[1]!, b[2]!, c[0]!, c[1]!, c[2]!); tris++; added = true;
        if (face.length >= 4 && face[3] !== undefined && face[3] !== face[2]) {
          const d = wv[face[3]!];
          if (d && tris < MAX_TRIS) { meshPos.push(a[0]!, a[1]!, a[2]!, c[0]!, c[1]!, c[2]!, d[0]!, d[1]!, d[2]!); tris++; }
        }
      }
      // 일시(transient) 메시만 vl/fl/mesh 핸들 해제. 영속(멀티 인스턴스 재사용)은 vl/fl 캐시가
      // 다음 인스턴스에 필요할 수 있어 유지(doc.delete가 회수).
      if (transient) { del(vl); del(fl); mesh?.delete?.(); }
      return added;
    };

    const emit = (geo: unknown, xf: Xf, depth: number): void => {
      if (!geo || depth > 8 || capped) return;
      const t = (geo as { objectType?: number }).objectType;
      if (t === T.Mesh) { emitMeshObj(geo as RMesh, xf, false); return; } // 영속 객체 — delete 금지(멀티 인스턴스)
      if (t === T.Brep) {
        // 면별 캐시 렌더메시 = 솔리드(import_3dm 방식). 없으면 edge 폴백. getMesh 핸들=일시(transient).
        const faces = (geo as { faces?: () => { count: number; get: (i: number) => { getMesh?: (mt: unknown) => RMesh } } }).faces?.();
        let got = false;
        if (faces) {
          for (let fi = 0; fi < faces.count; fi++) {
            if (capped) break; // 상한 도달 시 남은 면 getMesh 낭비 방지
            const bf = faces.get(fi);
            let fm: RMesh | undefined;
            try { fm = bf?.getMesh?.(meshType); } catch { fm = undefined; }
            if (emitMeshObj(fm, xf, true)) got = true;
            del(bf); // BrepFace 래퍼 해제(면당)
          }
          del(faces);
        }
        if (!got) { // 렌더메시 없는 Brep → edge 와이어프레임 폴백
          const edges = (geo as { edges?: () => { count: number; get: (i: number) => unknown } }).edges?.();
          if (edges) {
            for (let e = 0; e < edges.count; e++) { const ec = edges.get(e); tessCurve(ec as never, xf); del(ec); }
            del(edges);
          }
        }
        return;
      }
      if (t === T.Curve) { tessCurve(geo as never, xf); return; }
      if (t === T.Extrusion) {
        let em: RMesh | undefined;
        try { em = (geo as { getMesh?: (mt: unknown) => RMesh }).getMesh?.(meshType); } catch { em = undefined; }
        if (emitMeshObj(em, xf, true)) return;
        const br = (geo as { toBrep?: (split: boolean) => unknown }).toBrep?.(true) ?? (geo as { toBrep?: () => unknown }).toBrep?.();
        if (br) { emit(br, xf, depth + 1); (br as { delete?: () => void }).delete?.(); } else skipped++;
        return;
      }
      if (t === T.InstanceReference) {
        const ir = geo as { parentIdefId?: string; xform?: { toFloatArray?: (rowDominant: boolean) => number[] } };
        const def = ir.parentIdefId ? (idefById.get(ir.parentIdefId) as { getObjectIds?: () => string[] } | undefined) : undefined;
        const childXf = ir.xform?.toFloatArray ? composeXf(xf, ir.xform.toFloatArray(true)) : xf;
        const ids = def?.getObjectIds?.() ?? [];
        if (!ids.length) { skipped++; return; }
        for (const cid of ids) { const cg = byId.get(cid); if (cg) emit(cg, childXf, depth + 1); }
        return;
      }
      skipped++; // annotation·point 등
    };

    // 객체별 삼각형 range 수집 — tris 단조 증가라 groups는 정렬·연속 보장(이진탐색 가능).
    // 무명 InstanceReference는 인스턴스 정의(블록) 이름 폴백. 캡 초과분 = 소스레벨 이름으로 열화.
    const groups: Rhino3dmObjectRange[] = [];
    for (const t of top) {
      const start = tris;
      emit(t.geo, IDENT_XF, 0);
      if (tris > start && groups.length < MAX_GROUPS) {
        let name = t.name;
        if (!name && (t.geo as { objectType?: number }).objectType === T.InstanceReference) {
          const pid = (t.geo as { parentIdefId?: string }).parentIdefId;
          const def = pid ? (idefById.get(pid) as { name?: string } | undefined) : undefined;
          name = def?.name || undefined;
        }
        groups.push({ start, count: tris - start, name, id: t.id, layer: t.layer });
      }
    }
    (doc as { delete?: () => void }).delete?.();
    const meshes = meshPos.length
      ? [{ positions: new Float32Array(meshPos), ...(groups.length ? { groups } : {}) }]
      : [];
    return { meshes, edges: new Float32Array(seg), skipped, capped };
  });
}
