/**
 * DWG → 2D 언더레이(빽도면) 평탄화 — 순수 함수.
 *
 * libredwg(@mlightcad/libredwg-web) WASM이 파싱한 `DwgDatabase`(모델공간 entities + BLOCK_RECORD)를
 * 받아 **평면 라인워크 세그먼트(mm) + 라벨 + 레이어 태그 + 스킵 카운트**로 평탄화한다.
 * CAD 도면을 Rhino 빽도면처럼 레벨 평면에 깔기 위한 입력 — 의미 분류(벽/슬라브) 안 함, 전부 라인.
 *
 * **불변① 무위반**: 결과는 ref(blob)에서 파생되는 *클라 로컬 표현*(ReferenceLayer flat-2D) — Y.Doc 미진입.
 * **WASM 비의존**: libredwg 타입을 import하지 않고 구조적 인터페이스만 소비 →
 *   합성 픽스처 단위테스트 + 실파일 Node 하네스(WASM 로드) 양쪽에서 동일 검증.
 *
 * 처리: LINE·LWPOLYLINE/POLYLINE2D(+bulge 호)·CIRCLE·ARC·ELLIPSE 테셀 / INSERT 블록 재귀 전개(변환행렬) /
 *       TEXT·MTEXT·INSERT attrib → 라벨. HATCH·SOLID·DIMENSION·WIPEOUT 등은 스킵+카운트(조용한 누락 없음).
 *
 * 좌표: DWG 도면 단위 그대로(보통 mm) — 단위 환산·센터링·회전은 배치(FederationSource.underlay)에서.
 */

// ---- 소비하는 구조적 타입(libredwg DwgDatabase의 부분집합) ----
export interface DwgVec {
  x: number;
  y: number;
  z?: number;
}
export interface DwgVertex {
  x: number;
  y: number;
  bulge?: number;
}
export interface DwgInsertAttrib {
  text?: string;
  startPoint?: DwgVec;
  textHeight?: number;
}
export interface DwgEntity {
  type: string;
  layer?: string;
  /** 핸들 — XCLIP(SPATIAL_FILTER) 연결 + 소유체인용 */
  handle?: string;
  ownerBlockRecordSoftId?: string;
  // LINE
  startPoint?: DwgVec;
  endPoint?: DwgVec;
  // CIRCLE / ARC / ELLIPSE
  center?: DwgVec;
  radius?: number;
  startAngle?: number;
  endAngle?: number;
  majorAxisEndPoint?: DwgVec;
  axisRatio?: number;
  // LWPOLYLINE / POLYLINE2D
  vertices?: DwgVertex[];
  flag?: number;
  closed?: boolean;
  // INSERT
  name?: string;
  blockName?: string;
  insertionPoint?: DwgVec;
  xScale?: number;
  yScale?: number;
  rotation?: number;
  attribs?: DwgInsertAttrib[];
  // TEXT / MTEXT
  text?: string;
  textHeight?: number;
  height?: number;
  position?: DwgVec;
  // HATCH
  boundaryPaths?: DwgHatchPath[];
  // SOLID / TRACE (2D 채움 4점)
  corner1?: DwgVec;
  corner2?: DwgVec;
  corner3?: DwgVec;
  corner4?: DwgVec;
  // SPLINE
  controlPoints?: DwgVec[];
  fitPoints?: DwgVec[];
}
/** HATCH 경계 경로 — polyline(flag&2: vertices) 또는 edge 기반(edges: line/arc/ellipse/spline). */
export interface DwgHatchEdge {
  type?: number; // 1=line, 2=arc, 3=ellipse, 4=spline
  start?: DwgVec;
  end?: DwgVec;
  center?: DwgVec;
  radius?: number;
  startAngle?: number;
  endAngle?: number;
  isCounterClockwise?: number;
  majorAxisEndPoint?: DwgVec;
  axisRatio?: number;
  controlPoints?: DwgVec[];
}
export interface DwgHatchPath {
  boundaryPathTypeFlag?: number;
  edges?: DwgHatchEdge[];
  vertices?: DwgVertex[];
}
export interface DwgBlockRecord {
  name?: string;
  blockName?: string;
  basePoint?: DwgVec;
  entities?: DwgEntity[];
}
export interface DwgLayerRecord {
  name?: string;
  frozen?: boolean;
  off?: boolean;
  /** true-color int (0xRRGGBB). libredwg: 16777215 = 흰색 */
  color?: number;
  colorIndex?: number;
}
type TableLike<T> = T[] | Record<string, T> | { entries?: T[] | Record<string, T> };
/** XCLIP — INSERT의 클립 경계(SPATIAL_FILTER). vertices=경계점, invertBlockMatrix=WCS↔블록 역변환(3x4). */
export interface DwgSpatialFilter {
  handle?: string;
  ownerHandle?: string;
  vertices?: DwgVec[];
  invertBlockMatrix?: number[];
}
export interface DwgDictRecord {
  handle?: string;
  ownerHandle?: string;
}
export interface DwgDatabaseLike {
  entities?: DwgEntity[];
  tables?: {
    BLOCK_RECORD?: TableLike<DwgBlockRecord>;
    LAYER?: TableLike<DwgLayerRecord>;
  };
  objects?: {
    SPATIAL_FILTER?: DwgSpatialFilter[];
    DICTIONARY?: DwgDictRecord[];
  };
}

// ---- 결과 ----
export interface DwgLabel {
  text: string;
  /** mm 평면 (배치 미적용 — 도면 좌표 그대로) */
  x: number;
  y: number;
  height: number;
  layer: string;
}
export interface DwgUnderlay {
  /** [x1,y1,x2,y2, …] mm 평면 — 한 LineSegments 버퍼로 직행 */
  segments: Float32Array;
  /** 세그먼트별 레이어 인덱스 (length = segments.length/4) — 레이어 필터용 */
  segLayer: Uint16Array;
  /** 인덱스 → 레이어명 */
  layers: string[];
  /**
   * 레이어별 frozen||off 여부 (layers 동일 인덱스) — **CAD 표시 의미론**. CAD 작성자가 frozen/off 한
   * 레이어는 화면에 안 보인다(예: xref 베이스맵). 파싱은 보존하되 렌더 기본은 이걸로 숨김 →
   * "임의 hide(정보손실)" 아니라 "CAD 화면 그대로". 레이어 픽커가 toggle. LAYER 테이블 없으면 전부 false.
   */
  layerHidden: boolean[];
  /** 레이어별 색(0xRRGGBB, layers 동일 인덱스) — CAD 레이어 색 재현용. 0 = 미지정/기본. */
  layerColor: number[];
  /** 레이어별 세그먼트 수 (layers와 동일 순서) */
  layerSegCount: number[];
  labels: DwgLabel[];
  /** 미지원/미렌더 엔티티 타입별 개수 — 조용한 누락 방지(UI 고지) */
  skipped: Record<string, number>;
  /** 전체 bbox [minX, minY, maxX, maxY] mm (세그먼트만) */
  bbox: [number, number, number, number];
}

export interface DwgUnderlayOptions {
  /** 호 테셀 각 분해능(rad). 기본 π/16(~11.25°) */
  arcStep?: number;
  /** 블록 재귀 최대 깊이. 기본 8 */
  maxDepth?: number;
}

// ---- 2×3 아핀: (x,y) → (a·x + c·y + e, b·x + d·y + f) ----
type Mat = [number, number, number, number, number, number];
const ID: Mat = [1, 0, 0, 1, 0, 0];
const apply = (M: Mat, x: number, y: number): [number, number] => [
  M[0] * x + M[2] * y + M[4],
  M[1] * x + M[3] * y + M[5],
];
const mul = (A: Mat, B: Mat): Mat => [
  A[0] * B[0] + A[2] * B[1],
  A[1] * B[0] + A[3] * B[1],
  A[0] * B[2] + A[2] * B[3],
  A[1] * B[2] + A[3] * B[3],
  A[0] * B[4] + A[2] * B[5] + A[4],
  A[1] * B[4] + A[3] * B[5] + A[5],
];
/** INSERT 변환 = T(insertion) · R(rot) · S(sx,sy) · T(-basePoint) */
function insertMatrix(ins: DwgVec | undefined, base: DwgVec | undefined, sx: number, sy: number, rot: number): Mat {
  const c = Math.cos(rot), s = Math.sin(rot);
  const rsa = sx * c, rsb = sx * s, rsc = -sy * s, rsd = sy * c; // R·S
  const bx = base?.x ?? 0, by = base?.y ?? 0;
  return [rsa, rsb, rsc, rsd, rsa * -bx + rsc * -by + (ins?.x ?? 0), rsb * -bx + rsd * -by + (ins?.y ?? 0)];
}

/**
 * 세그먼트(x0,y0)-(x1,y1)를 AABB [xmin,ymin,xmax,ymax]로 클립 (Liang-Barsky) — XCLIP 렌더용.
 * 경계서 **트림**(cull 아님 — 가로지르는 선은 경계까지 잘림). 완전 바깥이면 null. 결과 [x0,y0,x1,y1].
 */
export function clipSegmentAabb(
  x0: number, y0: number, x1: number, y1: number,
  xmin: number, ymin: number, xmax: number, ymax: number,
): [number, number, number, number] | null {
  const dx = x1 - x0, dy = y1 - y0;
  const p = [-dx, dx, -dy, dy];
  const q = [x0 - xmin, xmax - x0, y0 - ymin, ymax - y0];
  let t0 = 0, t1 = 1;
  for (let i = 0; i < 4; i++) {
    if (p[i] === 0) {
      if (q[i]! < 0) return null; // 경계에 평행 + 바깥
    } else {
      const r = q[i]! / p[i]!;
      if (p[i]! < 0) { if (r > t1) return null; if (r > t0) t0 = r; }
      else { if (r < t0) return null; if (r < t1) t1 = r; }
    }
  }
  return [x0 + t0 * dx, y0 + t0 * dy, x0 + t1 * dx, y0 + t1 * dy];
}

/** 세 점의 외접원 중심. 동일선상이면 null. */
function circumcenter(
  ax: number, ay: number, bx: number, by: number, cx: number, cy: number,
): [number, number] | null {
  const d = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by));
  if (Math.abs(d) < 1e-9) return null;
  const a2 = ax * ax + ay * ay, b2 = bx * bx + by * by, c2 = cx * cx + cy * cy;
  return [
    (a2 * (by - cy) + b2 * (cy - ay) + c2 * (ay - by)) / d,
    (a2 * (cx - bx) + b2 * (ax - cx) + c2 * (bx - ax)) / d,
  ];
}

/** libredwg 테이블({entries} 래퍼 / 직접 레코드맵 / 배열) → 레코드 배열. 배열도 'entries'(proto) 보유 → !Array.isArray 가드. */
function tableEntries<T>(table: TableLike<T> | undefined): T[] {
  const raw = (table && !Array.isArray(table) && 'entries' in table ? table.entries : table) ?? {};
  return (Array.isArray(raw) ? raw : Object.values(raw)) as T[];
}

function blockMap(db: DwgDatabaseLike): Map<string, DwgBlockRecord> {
  const m = new Map<string, DwgBlockRecord>();
  for (const b of tableEntries(db.tables?.BLOCK_RECORD)) {
    const nm = b?.name ?? b?.blockName;
    if (b && nm) m.set(nm, b);
  }
  return m;
}

/** 레이어명 → {hidden(frozen||off), color(0xRRGGBB)}. LAYER 테이블 없으면 빈 맵(전부 보임). */
function layerStates(db: DwgDatabaseLike): Map<string, { hidden: boolean; color: number }> {
  const m = new Map<string, { hidden: boolean; color: number }>();
  for (const l of tableEntries(db.tables?.LAYER)) {
    if (!l?.name) continue;
    m.set(l.name, { hidden: !!(l.frozen || l.off), color: typeof l.color === 'number' ? l.color : 0 });
  }
  return m;
}

/** 볼록 폴리곤(월드 점 배열)으로 세그먼트 클립 (Cyrus-Beck). 완전 바깥=null, 아니면 트림된 [x0,y0,x1,y1]. */
function clipSegmentPoly(
  x0: number, y0: number, x1: number, y1: number, poly: [number, number][],
): [number, number, number, number] | null {
  const n = poly.length;
  if (n < 3) return [x0, y0, x1, y1];
  const dx = x1 - x0, dy = y1 - y0;
  let cx = 0, cy = 0;
  for (const p of poly) { cx += p[0]; cy += p[1]; }
  cx /= n; cy /= n;
  let tE = 0, tL = 1;
  for (let i = 0; i < n; i++) {
    const a = poly[i]!, b = poly[(i + 1) % n]!;
    let nx = -(b[1] - a[1]), ny = b[0] - a[0]; // 에지 왼쪽 법선
    if (nx * (cx - a[0]) + ny * (cy - a[1]) < 0) { nx = -nx; ny = -ny; } // 내부(중심) 향하게
    const denom = nx * dx + ny * dy;
    const num = nx * (a[0] - x0) + ny * (a[1] - y0); // 제약: t·denom >= num
    if (denom > 1e-12) { const t = num / denom; if (t > tE) tE = t; }
    else if (denom < -1e-12) { const t = num / denom; if (t < tL) tL = t; }
    else if (num > 1e-9) return null; // 에지에 평행 + 바깥
    if (tE > tL) return null;
  }
  return [x0 + tE * dx, y0 + tE * dy, x0 + tL * dx, y0 + tL * dy];
}

/**
 * INSERT 핸들 → XCLIP {invBlock(2x3 아핀), verts}. 파일의 SPATIAL_FILTER(XCLIP)를 소유체인
 * (filter → ACAD_FILTER dict → xdict → INSERT)으로 연결. invertBlockMatrix(3x4)에서 2x3 추출.
 * 월드 클립 폴리곤 = mul(M2, invBlock)·verts (M2=INSERT 누적변환) — 실측 검증된 변환.
 */
function buildClipMap(db: DwgDatabaseLike): Map<string, { invBlock: Mat; verts: [number, number][] }> {
  const out = new Map<string, { invBlock: Mat; verts: [number, number][] }>();
  const filters = db.objects?.SPATIAL_FILTER ?? [];
  if (!filters.length) return out;
  const ents = new Map<string, DwgEntity>();
  const idxE = (e: DwgEntity) => { if (e?.handle) ents.set(e.handle, e); };
  for (const e of db.entities ?? []) idxE(e);
  for (const b of tableEntries(db.tables?.BLOCK_RECORD)) for (const e of b.entities ?? []) idxE(e);
  const dicts = new Map<string, DwgDictRecord>();
  for (const d of db.objects?.DICTIONARY ?? []) if (d?.handle) dicts.set(d.handle, d);
  for (const f of filters) {
    const m = f.invertBlockMatrix;
    if (!f.vertices?.length || !m || m.length < 8) continue;
    let cur: string | undefined = f.ownerHandle, hit: string | undefined;
    for (let d = 0; d < 12 && cur; d++) {
      const e = ents.get(cur);
      if (e) { if (e.type === 'INSERT' && e.handle) { hit = e.handle; break; } cur = e.ownerBlockRecordSoftId; continue; }
      const dict = dicts.get(cur);
      if (dict) { cur = dict.ownerHandle; continue; }
      break;
    }
    if (hit) {
      // 3x4 → 2x3: x'=m0·x+m1·y+m3, y'=m4·x+m5·y+m7 → [a,b,c,d,e,f]=[m0,m4,m1,m5,m3,m7]
      const invBlock: Mat = [m[0]!, m[4]!, m[1]!, m[5]!, m[3]!, m[7]!];
      let verts: [number, number][] = f.vertices.map((v) => [v.x, v.y]);
      // AutoCAD 직사각형 XCLIP = 2점(대각 모서리)으로 저장 → 4코너 폴리곤 확장
      // (변환이 회전 포함할 수 있으니 클립공간서 확장 후 변환해야 정확).
      if (verts.length === 2) {
        const [a, b] = verts as [[number, number], [number, number]];
        verts = [[a[0], a[1]], [b[0], a[1]], [b[0], b[1]], [a[0], b[1]]];
      }
      out.set(hit, { invBlock, verts });
    }
  }
  return out;
}

export function extractDwgUnderlay(db: DwgDatabaseLike, opts: DwgUnderlayOptions = {}): DwgUnderlay {
  const arcStep = opts.arcStep ?? Math.PI / 16;
  const maxDepth = opts.maxDepth ?? 8;
  const blocks = blockMap(db);
  const lstates = layerStates(db);
  const clipMap = buildClipMap(db);
  // 활성 XCLIP 폴리곤 스택(월드) — clipped INSERT 서브트리 진입 시 push, 나갈 때 pop. 세그는 전부와 교차 클립.
  const clipStack: [number, number][][] = [];

  const seg: number[] = [];
  const segLayerIdx: number[] = [];
  const labels: DwgLabel[] = [];
  const skipped: Record<string, number> = {};
  const layerIndex = new Map<string, number>();
  const layers: string[] = [];
  const layerHidden: boolean[] = [];
  const layerColor: number[] = [];
  const layerSegCount: number[] = [];
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

  const skip = (t: string) => (skipped[t] = (skipped[t] ?? 0) + 1);
  const layerOf = (name: string): number => {
    let i = layerIndex.get(name);
    if (i === undefined) {
      i = layers.length;
      layerIndex.set(name, i);
      layers.push(name);
      const st = lstates.get(name);
      layerHidden.push(st?.hidden ?? false);
      layerColor.push(st?.color ?? 0);
      layerSegCount.push(0);
    }
    return i;
  };
  const pushSeg = (p0: [number, number], p1: [number, number], li: number) => {
    let x0 = p0[0], y0 = p0[1], x1 = p1[0], y1 = p1[1];
    // XCLIP: 활성 클립 폴리곤 전부와 교차 — 하나라도 완전 바깥이면 버림(CAD 모델공간 XCLIP 그대로).
    for (let k = 0; k < clipStack.length; k++) {
      const c = clipSegmentPoly(x0, y0, x1, y1, clipStack[k]!);
      if (!c) return;
      x0 = c[0]; y0 = c[1]; x1 = c[2]; y1 = c[3];
    }
    seg.push(x0, y0, x1, y1);
    segLayerIdx.push(li);
    layerSegCount[li]!++;
    if (x0 < minX) minX = x0;
    if (y0 < minY) minY = y0;
    if (x0 > maxX) maxX = x0;
    if (y0 > maxY) maxY = y0;
    if (x1 < minX) minX = x1;
    if (y1 < minY) minY = y1;
    if (x1 > maxX) maxX = x1;
    if (y1 > maxY) maxY = y1;
  };
  /** a0→a1 CCW 호를 테셀 (각도 rad, 로컬좌표 → M 변환) */
  const tessArc = (cx: number, cy: number, r: number, a0: number, a1: number, M: Mat, li: number) => {
    let span = a1 - a0;
    while (span <= 0) span += Math.PI * 2;
    tessSweep(cx, cy, r, a0, span, M, li);
  };
  /** a0에서 부호있는 span(±)만큼 호 테셀 */
  const tessSweep = (cx: number, cy: number, r: number, a0: number, span: number, M: Mat, li: number) => {
    const n = Math.max(2, Math.ceil(Math.abs(span) / arcStep));
    let prev = apply(M, cx + r * Math.cos(a0), cy + r * Math.sin(a0));
    for (let i = 1; i <= n; i++) {
      const a = a0 + (span * i) / n;
      const p = apply(M, cx + r * Math.cos(a), cy + r * Math.sin(a));
      pushSeg(prev, p, li);
      prev = p;
    }
  };

  function walk(ents: DwgEntity[], M: Mat, depth: number, seen: Set<string>) {
    for (const e of ents) {
      const layer = e.layer ?? '0';
      const li = layerOf(layer);
      switch (e.type) {
        case 'LINE': {
          if (!e.startPoint || !e.endPoint) { skip('LINE-bad'); break; }
          pushSeg(apply(M, e.startPoint.x, e.startPoint.y), apply(M, e.endPoint.x, e.endPoint.y), li);
          break;
        }
        case 'LWPOLYLINE':
        case 'POLYLINE2D': {
          const vs = e.vertices ?? [];
          if (vs.length < 2) { skip(`${e.type}-short`); break; }
          // libredwg LWPOLYLINE는 flag bit 512(0x200)=closed, POLYLINE2D는 bit 1(DXF) — 둘 다 체크.
          const fl = e.flag ?? 0;
          const closed = (fl & 1) !== 0 || (fl & 512) !== 0 || e.closed === true;
          const count = closed ? vs.length : vs.length - 1;
          for (let i = 0; i < count; i++) {
            const a = vs[i]!;
            const b = vs[(i + 1) % vs.length]!;
            if (a.bulge && Math.abs(a.bulge) > 1e-9) {
              tessBulge(a, b, a.bulge, M, li);
            } else {
              pushSeg(apply(M, a.x, a.y), apply(M, b.x, b.y), li);
            }
          }
          break;
        }
        case 'CIRCLE': {
          if (!e.center || e.radius == null) { skip('CIRCLE-bad'); break; }
          tessArc(e.center.x, e.center.y, e.radius, 0, Math.PI * 2, M, li);
          break;
        }
        case 'ARC': {
          if (!e.center || e.radius == null) { skip('ARC-bad'); break; }
          tessArc(e.center.x, e.center.y, e.radius, e.startAngle ?? 0, e.endAngle ?? Math.PI * 2, M, li);
          break;
        }
        case 'ELLIPSE': {
          if (!e.center || !e.majorAxisEndPoint) { skip('ELLIPSE-bad'); break; }
          tessEllipse(e, M, li);
          break;
        }
        case 'HATCH': {
          // 채움 패턴 대신 경계선만 렌더 (라인워크 backdrop엔 충분, SOLID도 영역 외곽 보임).
          const paths = e.boundaryPaths ?? [];
          if (!paths.length) { skip('HATCH-empty'); break; }
          for (const path of paths) {
            const pv = path.vertices;
            if (((path.boundaryPathTypeFlag ?? 0) & 2) && pv && pv.length >= 2) {
              for (let i = 0; i < pv.length; i++) { // 폴리라인 경계(닫힘)
                const a = pv[i]!, b = pv[(i + 1) % pv.length]!;
                if (a.bulge && Math.abs(a.bulge) > 1e-9) tessBulge(a, b, a.bulge, M, li);
                else pushSeg(apply(M, a.x, a.y), apply(M, b.x, b.y), li);
              }
              continue;
            }
            for (const ed of path.edges ?? []) { // edge 기반 경계
              if (!ed) continue;
              if (ed.type === 1 && ed.start && ed.end) {
                pushSeg(apply(M, ed.start.x, ed.start.y), apply(M, ed.end.x, ed.end.y), li);
              } else if (ed.type === 2 && ed.center && ed.radius != null) {
                const a0 = ed.startAngle ?? 0, a1 = ed.endAngle ?? Math.PI * 2;
                if (ed.isCounterClockwise === 0) tessArc(ed.center.x, ed.center.y, ed.radius, a1, a0, M, li);
                else tessArc(ed.center.x, ed.center.y, ed.radius, a0, a1, M, li);
              } else if (ed.type === 4 && ed.controlPoints && ed.controlPoints.length >= 2) {
                const cps = ed.controlPoints; // 스플라인 = 제어점 폴리라인 근사
                for (let i = 0; i + 1 < cps.length; i++) pushSeg(apply(M, cps[i]!.x, cps[i]!.y), apply(M, cps[i + 1]!.x, cps[i + 1]!.y), li);
              } else {
                skip(`HATCH-edge${ed.type ?? '?'}`);
              }
            }
          }
          break;
        }
        case 'SOLID':
        case 'TRACE': {
          // 2D 채움 4점 — 외곽선 렌더 (DXF 와인딩 1-2-4-3). 채움 대신 경계.
          const c = [e.corner1, e.corner2, e.corner4, e.corner3].filter(Boolean) as DwgVec[];
          if (c.length < 3) { skip(`${e.type}-bad`); break; }
          for (let i = 0; i < c.length; i++) {
            const a = c[i]!, b = c[(i + 1) % c.length]!;
            if (a.x === b.x && a.y === b.y) continue; // SOLID는 코너 중복 흔함(삼각형)
            pushSeg(apply(M, a.x, a.y), apply(M, b.x, b.y), li);
          }
          break;
        }
        case 'SPLINE': {
          // fitPoints(곡선 위 점) 우선, 없으면 controlPoints 폴리라인 근사.
          const pts = (e.fitPoints?.length ? e.fitPoints : e.controlPoints) ?? [];
          if (pts.length < 2) { skip('SPLINE-short'); break; }
          for (let i = 0; i + 1 < pts.length; i++) pushSeg(apply(M, pts[i]!.x, pts[i]!.y), apply(M, pts[i + 1]!.x, pts[i + 1]!.y), li);
          break;
        }
        case 'INSERT': {
          const def = blocks.get(e.name ?? e.blockName ?? '');
          if (!def?.entities) { skip('INSERT-nodef'); break; }
          if (depth >= maxDepth) { skip('INSERT-deep'); break; }
          const key = e.name ?? e.blockName ?? '';
          if (seen.has(key)) { skip('INSERT-cycle'); break; }
          const M2 = mul(M, insertMatrix(e.insertionPoint, def.basePoint, e.xScale ?? 1, e.yScale ?? 1, e.rotation ?? 0));
          const seen2 = new Set(seen);
          seen2.add(key);
          // XCLIP: 이 INSERT에 SPATIAL_FILTER 있으면 월드 클립 폴리곤 = mul(M2, invBlock)·verts → 스택(서브트리 클립).
          const clip = e.handle ? clipMap.get(e.handle) : undefined;
          if (clip) {
            const T = mul(M2, clip.invBlock);
            clipStack.push(clip.verts.map(([vx, vy]) => apply(T, vx, vy)));
          }
          walk(def.entities, M2, depth + 1, seen2);
          if (clip) clipStack.pop();
          for (const at of e.attribs ?? []) {
            if (!at?.text) continue;
            const p = apply(M2, at.startPoint?.x ?? 0, at.startPoint?.y ?? 0);
            labels.push({ text: at.text, x: p[0], y: p[1], height: at.textHeight ?? 100, layer });
          }
          break;
        }
        case 'TEXT':
        case 'MTEXT': {
          const ip = e.startPoint ?? e.insertionPoint ?? e.position;
          if (!ip || !e.text) { skip(`${e.type}-bad`); break; }
          const p = apply(M, ip.x, ip.y);
          labels.push({ text: e.text, x: p[0], y: p[1], height: e.textHeight ?? e.height ?? 100, layer });
          break;
        }
        default:
          skip(e.type);
      }
    }
  }

  /**
   * LWPOLYLINE bulge 세그먼트 → 호. bulge = tan(θ/4), 음수 = CW (DXF 스펙: "CW면 음수").
   * 양수 bulge = CCW(호 중심 기준) = apex가 a→b 현의 **오른쪽**(왼쪽수직 × -sagitta).
   *   (반례 검증: A(0,0)→B(10,0) bulge=1 = 반원, 중심(5,0), CCW 180°→270°→360° = apex (5,-5).)
   * robust: a·apex·b 외접원 → apex 지나는 방향(CCW/CW)으로 스윕. 동일선상(외접원 없음) = 직선.
   */
  function tessBulge(a: DwgVertex, b: DwgVertex, bulge: number, M: Mat, li: number) {
    const chordx = b.x - a.x, chordy = b.y - a.y;
    const chord = Math.hypot(chordx, chordy);
    if (chord < 1e-9) return;
    const sagitta = -bulge * (chord / 2); // 양수 bulge → apex 오른쪽(아래) = 왼쪽수직의 음방향
    const lx = -chordy / chord, ly = chordx / chord; // 왼쪽 수직 단위
    const apexX = (a.x + b.x) / 2 + lx * sagitta;
    const apexY = (a.y + b.y) / 2 + ly * sagitta;
    const cc = circumcenter(a.x, a.y, apexX, apexY, b.x, b.y);
    if (!cc) { pushSeg(apply(M, a.x, a.y), apply(M, b.x, b.y), li); return; }
    const [cx, cy] = cc;
    const r = Math.hypot(a.x - cx, a.y - cy);
    const angA = Math.atan2(a.y - cy, a.x - cx);
    const angB = Math.atan2(b.y - cy, b.x - cx);
    const angAp = Math.atan2(apexY - cy, apexX - cx);
    const norm = (x: number) => { let v = x % (Math.PI * 2); if (v < 0) v += Math.PI * 2; return v; };
    const ccw = norm(angB - angA); // A→B CCW 스윕
    const apexOff = norm(angAp - angA);
    const span = apexOff <= ccw ? ccw : ccw - Math.PI * 2; // apex가 CCW 안이면 CCW, 아니면 CW
    tessSweep(cx, cy, r, angA, span, M, li);
  }

  /** ELLIPSE → 테셀. major = majorAxisEndPoint(center 상대), minor = perp(major)·axisRatio */
  function tessEllipse(e: DwgEntity, M: Mat, li: number) {
    const mxv = e.majorAxisEndPoint!.x, myv = e.majorAxisEndPoint!.y;
    const k = e.axisRatio ?? 1;
    const a0 = e.startAngle ?? 0;
    let span = (e.endAngle ?? Math.PI * 2) - a0;
    while (span <= 1e-9) span += Math.PI * 2;
    const n = Math.max(4, Math.ceil(span / arcStep));
    const pt = (t: number): [number, number] => {
      const cs = Math.cos(t), sn = Math.sin(t);
      return apply(M, e.center!.x + cs * mxv + sn * -myv * k, e.center!.y + cs * myv + sn * mxv * k);
    };
    let prev = pt(a0);
    for (let i = 1; i <= n; i++) {
      const p = pt(a0 + (span * i) / n);
      pushSeg(prev, p, li);
      prev = p;
    }
  }

  walk(db.entities ?? [], ID, 0, new Set());

  return {
    segments: new Float32Array(seg),
    segLayer: Uint16Array.from(segLayerIdx),
    layers,
    layerHidden,
    layerColor,
    layerSegCount,
    labels,
    skipped,
    bbox: seg.length ? [minX, minY, maxX, maxY] : [0, 0, 0, 0],
  };
}

/**
 * 세그먼트가 가장 밀집한 윈도의 중심(mm) — 메가시트(측량좌표·xref 흩어짐) 대비 기본 배치용.
 * CAD 도면은 건물+부지컨텍스트가 km 스케일로 흩어져 bbox 중심이 빈 공간일 수 있다 →
 * 가장 빽빽한 cell 중심을 잡아 그 도면을 원점 근처로 센터링(언더레이 origin = -denseCenter).
 * win = cell 한 변(mm, 기본 50m). 빈 언더레이는 [0,0].
 */
export function underlayDenseCenter(u: DwgUnderlay, win = 50000): [number, number] {
  const seg = u.segments;
  if (!seg.length) return [0, 0];
  const bins = new Map<string, { n: number; sx: number; sy: number }>();
  let best = '', bestN = 0;
  for (let i = 0; i < seg.length; i += 4) {
    if (u.layerHidden[u.segLayer[i / 4]!]) continue; // 숨김(frozen/off) 레이어 무시 — 보이는 콘텐츠에 센터
    const mx = (seg[i]! + seg[i + 2]!) / 2, my = (seg[i + 1]! + seg[i + 3]!) / 2;
    const k = `${Math.floor(mx / win)},${Math.floor(my / win)}`;
    const c = bins.get(k) ?? { n: 0, sx: 0, sy: 0 };
    c.n++; c.sx += mx; c.sy += my;
    bins.set(k, c);
    if (c.n > bestN) { bestN = c.n; best = k; }
  }
  if (!best) return [0, 0]; // 보이는 세그 없음
  const c = bins.get(best)!;
  return [c.sx / c.n, c.sy / c.n]; // 밀집 cell 내 세그 중점 평균
}
