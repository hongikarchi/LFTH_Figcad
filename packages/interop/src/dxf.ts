import Drawing from 'dxf-writer';
import * as dxfParser from 'dxf-parser';
import {
  DocStore,
  deriveDrawing,
  sectionRing,
  arcPolyline,
  curvedWallFootprint,
  type ColumnType,
  type DocSnapshot,
  type DrawingView,
  type Id,
  type StairType,
  type WallType,
} from '@figcad/core';

// dxf-parser는 CJS로 클래스 자체를 module.exports — 빌더(vite/esbuild)별 default/named
// 위치가 달라 런타임 안전 픽업 (named DxfParser → default → 네임스페이스 자체)
interface DxfDoc {
  entities?: DxfEntity[];
}
type DxfParserCtor = new () => { parseSync(text: string): DxfDoc | null };
const ns = dxfParser as Record<string, unknown>;
const DxfParser = (ns['DxfParser'] ?? ns['default'] ?? dxfParser) as DxfParserCtor;

const ACI_GRAY = 8; // ACI에 GRAY 상수 없음 — 8 = dark gray

/**
 * DXF 2D export/import — 평면 도면 교환 (컨설턴트 도면 일상 워크플로).
 *
 * DXF는 2D 지오메트리만 (높이/레벨/두께 없음) — 지오메트리 레벨 교환.
 * export: 평면 투영. 벽 중심선(Wall Axis)+풋프린트(Walls), 슬라브 경계(Slab),
 *         그리드(Grid)+라벨, 기둥 단면(Column), 보 중심축(Beam), 계단 풋프린트(Stair),
 *         난간 축(Railing), 지붕 경계(Roof). 좌표 mm.
 *         모든 레벨이 한 평면에 겹쳐 그려진다(2D 한계).
 * import: Wall Axis 라인 → 벽(기본 두께, 단일 레벨), 닫힌 폴리라인 → 슬라브.
 *         Column/Beam/Stair/Railing/Roof 레이어는 v1에서 되읽지 않음(스킵+카운트 — IFC 경유). 조용한 누락 없음.
 *         외부 DXF는 best-effort(LINE/열린→벽, 닫힌 폴리라인→슬라브). 호/원/문자 등 스킵.
 */

const DEFAULT_THICKNESS = 200;
const DEFAULT_SLAB_THICKNESS = 150;

export function exportDxf(snap: DocSnapshot): string {
  const d = new Drawing();
  d.setUnits('Millimeters');
  d.addLayer('Wall Axis', Drawing.ACI.WHITE, 'CONTINUOUS');
  d.addLayer('Walls', ACI_GRAY, 'CONTINUOUS');
  d.addLayer('Slab', Drawing.ACI.CYAN, 'CONTINUOUS');
  d.addLayer('Grid', Drawing.ACI.RED, 'CONTINUOUS');
  d.addLayer('Column', Drawing.ACI.GREEN, 'CONTINUOUS');
  d.addLayer('Beam', Drawing.ACI.YELLOW, 'CONTINUOUS');
  d.addLayer('Stair', Drawing.ACI.MAGENTA, 'CONTINUOUS');
  d.addLayer('Railing', Drawing.ACI.CYAN, 'CONTINUOUS');
  d.addLayer('Roof', ACI_GRAY, 'CONTINUOUS');
  d.addLayer('Zone', Drawing.ACI.GREEN, 'CONTINUOUS');
  d.addLayer('CurtainWall', Drawing.ACI.CYAN, 'CONTINUOUS');
  d.addLayer('Sketch', Drawing.ACI.YELLOW, 'CONTINUOUS'); // 마크업 스케치(iter-3) — line/zone 폴리라인

  const wallTypes = new Map(
    snap.types.filter((t) => t.kind === 'wall').map((t) => [t.id, t as WallType]),
  );
  const columnTypes = new Map(
    snap.types.filter((t) => t.kind === 'column').map((t) => [t.id, t as ColumnType]),
  );
  const stairTypes = new Map(
    snap.types.filter((t) => t.kind === 'stair').map((t) => [t.id, t as StairType]),
  );

  for (const el of snap.elements) {
    if (el.kind === 'wall') {
      const thickness = wallTypes.get(el.typeId)?.thickness ?? DEFAULT_THICKNESS;
      if (el.sagitta) {
        // 곡선 벽(C5): 중심선·풋프린트를 호 테셀 폴리라인으로 — 직선 chord 곡률 손실 방지.
        d.setActiveLayer('Wall Axis');
        d.drawPolyline(arcPolyline(el.a, el.b, el.sagitta), false);
        d.setActiveLayer('Walls');
        d.drawPolyline(curvedWallFootprint(el.a, el.b, el.sagitta, thickness), true);
      } else {
        d.setActiveLayer('Wall Axis');
        d.drawLine(el.a[0], el.a[1], el.b[0], el.b[1]);
        // 풋프린트 (시각용)
        const t = thickness / 2;
        const dx = el.b[0] - el.a[0];
        const dy = el.b[1] - el.a[1];
        const len = Math.hypot(dx, dy) || 1;
        const nx = (-dy / len) * t;
        const ny = (dx / len) * t;
        d.setActiveLayer('Walls');
        d.drawPolyline(
          [
            [el.a[0] + nx, el.a[1] + ny],
            [el.b[0] + nx, el.b[1] + ny],
            [el.b[0] - nx, el.b[1] - ny],
            [el.a[0] - nx, el.a[1] - ny],
          ],
          true,
        );
      }
    } else if (el.kind === 'slab') {
      d.setActiveLayer('Slab');
      d.drawPolyline(
        el.boundary.map((p) => [p[0], p[1]] as [number, number]),
        true,
      );
    } else if (el.kind === 'grid') {
      d.setActiveLayer('Grid');
      d.drawLine(el.a[0], el.a[1], el.b[0], el.b[1]);
      d.drawText(el.a[0], el.a[1], 300, 0, el.label);
    } else if (el.kind === 'column') {
      d.setActiveLayer('Column');
      const section = columnTypes.get(el.typeId)?.section ?? { shape: 'rect', width: 400, depth: 400 };
      d.drawPolyline(
        sectionRing(section).map(([sx, sy]) => [el.at[0] + sx, el.at[1] + sy] as [number, number]),
        true,
      );
    } else if (el.kind === 'beam') {
      d.setActiveLayer('Beam');
      d.drawLine(el.a[0], el.a[1], el.b[0], el.b[1]);
    } else if (el.kind === 'stair') {
      // 풋프린트 사각형 (주행 × 폭) + 주행 중심선
      d.setActiveLayer('Stair');
      const w = (stairTypes.get(el.typeId)?.width ?? 1000) / 2;
      const dx = el.b[0] - el.a[0];
      const dy = el.b[1] - el.a[1];
      const len = Math.hypot(dx, dy) || 1;
      const nx = (-dy / len) * w;
      const ny = (dx / len) * w;
      d.drawPolyline(
        [
          [el.a[0] + nx, el.a[1] + ny],
          [el.b[0] + nx, el.b[1] + ny],
          [el.b[0] - nx, el.b[1] - ny],
          [el.a[0] - nx, el.a[1] - ny],
        ],
        true,
      );
      d.drawLine(el.a[0], el.a[1], el.b[0], el.b[1]);
    } else if (el.kind === 'railing') {
      d.setActiveLayer('Railing');
      d.drawLine(el.a[0], el.a[1], el.b[0], el.b[1]);
    } else if (el.kind === 'roof') {
      d.setActiveLayer('Roof');
      d.drawPolyline(
        el.boundary.map((p) => [p[0], p[1]] as [number, number]),
        true,
      );
    } else if (el.kind === 'zone') {
      d.setActiveLayer('Zone');
      d.drawPolyline(
        el.boundary.map((p) => [p[0], p[1]] as [number, number]),
        true,
      );
      // 중심에 이름 스탬프
      const cx = el.boundary.reduce((s, p) => s + p[0], 0) / el.boundary.length;
      const cy = el.boundary.reduce((s, p) => s + p[1], 0) / el.boundary.length;
      d.drawText(cx, cy, 300, 0, el.number ? `${el.number} ${el.name}` : el.name);
    } else if (el.kind === 'curtainwall') {
      // 평면 = 베이스라인 (멀리언 그리드는 입면/3D, 2D 평면은 선)
      d.setActiveLayer('CurtainWall');
      d.drawLine(el.a[0], el.a[1], el.b[0], el.b[1]);
    } else if (el.kind === 'sketch') {
      // 마크업 스케치(iter-3) — line=열린/zone=닫힌 폴리라인. style·3D frame은 DXF 미보존(2D 평면 투영).
      d.setActiveLayer('Sketch');
      d.drawPolyline(el.boundary.map((p) => [p[0], p[1]] as [number, number]), el.mode === 'zone');
    }
  }

  return d.toDxfString();
}

/**
 * 도면 뷰 DXF export (M11) — exportDxf(전체모델 평면 투영)와 다름:
 * 특정 도면 뷰의 라인워크(deriveDrawing)를 절단/투영/해치/문자 레이어로.
 * 2D 도면 납품(컨설턴트 교환). 좌표 mm. 단면/입면 뷰도 동일 경로(좌표는 paper space).
 */
export function exportDrawingDxf(view: DrawingView, store: DocStore): string {
  const d = new Drawing();
  d.setUnits('Millimeters');
  d.addLayer('Cut', Drawing.ACI.WHITE, 'CONTINUOUS'); // 절단 — 굵게(뷰어 가중치)
  d.addLayer('Projection', ACI_GRAY, 'CONTINUOUS');
  d.addLayer('Hatch', ACI_GRAY, 'CONTINUOUS');
  d.addLayer('Elevation', Drawing.ACI.WHITE, 'CONTINUOUS'); // 입면 실루엣 윤곽
  d.addLayer('Text', Drawing.ACI.RED, 'CONTINUOUS');

  const dr = deriveDrawing(view, store);
  const poly = (pts: [number, number][], closed: boolean) => {
    if (pts.length < 2) return;
    d.drawPolyline(pts, closed);
  };

  d.setActiveLayer('Hatch');
  for (const [a, b] of dr.hatch) d.drawLine(a[0], a[1], b[0], b[1]);
  d.setActiveLayer('Projection');
  for (const pl of dr.proj) poly(pl.pts.map((p) => [p[0], p[1]] as [number, number]), pl.closed);
  d.setActiveLayer('Cut');
  for (const pl of dr.cut) poly(pl.pts.map((p) => [p[0], p[1]] as [number, number]), pl.closed);
  // 입면 실루엣 윤곽 — 2D DXF는 z-order 가림 없음(화면 HLR과 불일치, 알려진 한계: 윤곽만)
  d.setActiveLayer('Elevation');
  for (const pl of dr.silhouettes ?? []) poly(pl.pts.map((p) => [p[0], p[1]] as [number, number]), pl.closed);
  d.setActiveLayer('Text');
  for (const l of dr.labels) d.drawText(l.pos[0], l.pos[1], 300, 0, l.text);

  return d.toDxfString();
}

export interface DxfImportResult {
  snapshot: DocSnapshot;
  skipped: Record<string, number>;
}

interface DxfVertex {
  x: number;
  y: number;
}
interface DxfEntity {
  type: string;
  layer?: string;
  vertices?: DxfVertex[];
  shape?: boolean; // LWPOLYLINE 닫힘
}

export function importDxf(text: string): DxfImportResult {
  const parsed = new DxfParser().parseSync(text) as { entities?: DxfEntity[] } | null;
  const entities = parsed?.entities ?? [];
  const skipped: Record<string, number> = {};
  const bump = (k: string) => (skipped[k] = (skipped[k] ?? 0) + 1);

  const store = new DocStore();
  const levelId = store.addLevel({ name: '1층', elevation: 0, height: 3000, order: 0 });
  const wallTypeId = store.addType({ kind: 'wall', name: `벽 ${DEFAULT_THICKNESS}`, thickness: DEFAULT_THICKNESS, color: '#eceae5' });
  let slabTypeId: Id | null = null;
  const slabType = () =>
    (slabTypeId ??= store.addType({ kind: 'slab', name: `슬라브 ${DEFAULT_SLAB_THICKNESS}`, thickness: DEFAULT_SLAB_THICKNESS, color: '#dcdad5' }));

  const hasFigcadLayers = entities.some((e) => e.layer === 'Wall Axis' || e.layer === 'Slab');
  const pts = (e: DxfEntity): [number, number][] =>
    (e.vertices ?? []).map((v) => [Math.round(v.x), Math.round(v.y)] as [number, number]);

  for (const e of entities) {
    const isPolyline = e.type === 'LWPOLYLINE' || e.type === 'POLYLINE';
    if (e.type !== 'LINE' && !isPolyline) {
      if (e.type === 'TEXT' || e.type === 'MTEXT') continue; // 라벨 — 무시(손실 아님)
      bump(e.type);
      continue;
    }
    if (e.layer === 'Walls') continue; // 시각용 풋프린트 — Axis에서 import
    if (
      e.layer === 'Column' ||
      e.layer === 'Beam' ||
      e.layer === 'Stair' ||
      e.layer === 'Railing' ||
      e.layer === 'Roof'
    ) {
      bump('구조요소(v1 가져오기 미지원 — IFC 경유)');
      continue;
    }

    const v = pts(e);
    if (v.length < 2) {
      bump('빈 곡선');
      continue;
    }
    const closed = isPolyline && (e.shape === true || (v.length > 2 && v[0]![0] === v[v.length - 1]![0] && v[0]![1] === v[v.length - 1]![1]));

    const isWall = hasFigcadLayers ? e.layer === 'Wall Axis' : !closed;
    const isSlab = hasFigcadLayers ? e.layer === 'Slab' : closed;
    const isGrid = e.layer === 'Grid';

    if (isGrid) {
      try {
        store.createGridLine({ a: v[0]!, b: v[v.length - 1]! });
      } catch {
        bump('grid(퇴화)');
      }
    } else if (isWall) {
      // 다정점 열린 폴리라인 = 연속 정점쌍마다 벽 1개(체인) — 첫·끝만 쓰면 중간 정점 손실(직선 1개로 붕괴).
      let made = 0;
      for (let i = 0; i < v.length - 1; i++) {
        const a = v[i]!;
        const b = v[i + 1]!;
        if (a[0] === b[0] && a[1] === b[1]) continue; // 길이0 세그 스킵
        store.createWall({ levelId, typeId: wallTypeId, a, b });
        made++;
      }
      if (!made) bump('wall(길이0)');
    } else if (isSlab) {
      const ring = [...v];
      if (ring.length > 1) {
        const f = ring[0]!;
        const l = ring[ring.length - 1]!;
        if (f[0] === l[0] && f[1] === l[1]) ring.pop();
      }
      if (ring.length < 3) {
        bump('slab(점부족)');
        continue;
      }
      try {
        store.createSlab({ levelId, typeId: slabType(), boundary: ring });
      } catch {
        bump('slab(자가교차)');
      }
    }
  }

  const snapshot = store.snapshot();
  snapshot.meta = { ...snapshot.meta, projectName: '가져온 DXF 도면' };
  return { snapshot, skipped };
}
