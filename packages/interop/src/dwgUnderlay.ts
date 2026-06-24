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
}
export interface DwgBlockRecord {
  name?: string;
  blockName?: string;
  basePoint?: DwgVec;
  entities?: DwgEntity[];
}
export interface DwgDatabaseLike {
  entities?: DwgEntity[];
  tables?: {
    BLOCK_RECORD?: DwgBlockRecord[] | Record<string, DwgBlockRecord> | { entries?: DwgBlockRecord[] | Record<string, DwgBlockRecord> };
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

function blockMap(db: DwgDatabaseLike): Map<string, DwgBlockRecord> {
  const br = db.tables?.BLOCK_RECORD as
    | DwgBlockRecord[]
    | Record<string, DwgBlockRecord>
    | { entries?: DwgBlockRecord[] | Record<string, DwgBlockRecord> }
    | undefined;
  // libredwg 테이블은 { entries } 래퍼이거나 직접 레코드 맵/배열 — 모두 흡수.
  // 주의: 배열도 'entries'(Array.prototype) 보유 → !Array.isArray 가드 필수.
  const raw = (br && !Array.isArray(br) && 'entries' in br ? br.entries : br) ?? {};
  const arr = Array.isArray(raw) ? raw : Object.values(raw);
  const m = new Map<string, DwgBlockRecord>();
  for (const b of arr) {
    const nm = b?.name ?? b?.blockName;
    if (b && nm) m.set(nm, b);
  }
  return m;
}

export function extractDwgUnderlay(db: DwgDatabaseLike, opts: DwgUnderlayOptions = {}): DwgUnderlay {
  const arcStep = opts.arcStep ?? Math.PI / 16;
  const maxDepth = opts.maxDepth ?? 8;
  const blocks = blockMap(db);

  const seg: number[] = [];
  const segLayerIdx: number[] = [];
  const labels: DwgLabel[] = [];
  const skipped: Record<string, number> = {};
  const layerIndex = new Map<string, number>();
  const layers: string[] = [];
  const layerSegCount: number[] = [];
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

  const skip = (t: string) => (skipped[t] = (skipped[t] ?? 0) + 1);
  const layerOf = (name: string): number => {
    let i = layerIndex.get(name);
    if (i === undefined) {
      i = layers.length;
      layerIndex.set(name, i);
      layers.push(name);
      layerSegCount.push(0);
    }
    return i;
  };
  const pushSeg = (p0: [number, number], p1: [number, number], li: number) => {
    seg.push(p0[0], p0[1], p1[0], p1[1]);
    segLayerIdx.push(li);
    layerSegCount[li]!++;
    if (p0[0] < minX) minX = p0[0];
    if (p0[1] < minY) minY = p0[1];
    if (p0[0] > maxX) maxX = p0[0];
    if (p0[1] > maxY) maxY = p0[1];
    if (p1[0] < minX) minX = p1[0];
    if (p1[1] < minY) minY = p1[1];
    if (p1[0] > maxX) maxX = p1[0];
    if (p1[1] > maxY) maxY = p1[1];
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
          const closed = (e.flag != null && (e.flag & 1) === 1) || e.closed === true;
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
        case 'INSERT': {
          const def = blocks.get(e.name ?? e.blockName ?? '');
          if (!def?.entities) { skip('INSERT-nodef'); break; }
          if (depth >= maxDepth) { skip('INSERT-deep'); break; }
          const key = e.name ?? e.blockName ?? '';
          if (seen.has(key)) { skip('INSERT-cycle'); break; }
          const M2 = mul(M, insertMatrix(e.insertionPoint, def.basePoint, e.xScale ?? 1, e.yScale ?? 1, e.rotation ?? 0));
          const seen2 = new Set(seen);
          seen2.add(key);
          walk(def.entities, M2, depth + 1, seen2);
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
    const mx = (seg[i]! + seg[i + 2]!) / 2, my = (seg[i + 1]! + seg[i + 3]!) / 2;
    const k = `${Math.floor(mx / win)},${Math.floor(my / win)}`;
    const c = bins.get(k) ?? { n: 0, sx: 0, sy: 0 };
    c.n++; c.sx += mx; c.sy += my;
    bins.set(k, c);
    if (c.n > bestN) { bestN = c.n; best = k; }
  }
  const c = bins.get(best)!;
  return [c.sx / c.n, c.sy / c.n]; // 밀집 cell 내 세그 중점 평균
}
