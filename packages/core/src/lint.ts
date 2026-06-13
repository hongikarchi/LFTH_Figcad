import {
  resolveOpening,
  type Id,
  type OpeningType,
  type Pt,
  type SlabElement,
  type WallElement,
} from './schema';
import type { DocStore } from './store';

/**
 * M5 데이터 위생 — lint(store) → LintFinding[] 순수 함수.
 *
 * 파라메트릭 모델이라 CAD식 쓰레기(중복선·스냅 미스)는 구조적으로 드물다.
 * 남는 검사 (Solibri/Revit 카테고리 매핑): 깨진 참조, 고아/부적합 개구부,
 * 중복 요소, 겹침 벽, 미접합 끝점, 극단 치수.
 *
 * v1 = 경고 + 원클릭 수정 제안. 수정은 전부 삭제 기반(중복·고아 제거)만 —
 * 지오메트리를 움직이는 자동수정(갭 힐링 등)은 고위험이라 v1.5 옵트인으로.
 */

export type LintSeverity = 'error' | 'warning' | 'info';

/** 정렬용 — 낮을수록 심각 */
export const LINT_SEVERITY_RANK: Record<LintSeverity, number> = {
  error: 0,
  warning: 1,
  info: 2,
};

export type LintCode =
  | 'missing-ref' // levelId/typeId가 존재하지 않거나 kind 불일치
  | 'orphan-opening' // hostId가 벽으로 해석 안 됨 (렌더에서 조용히 스킵되는 유령 데이터)
  | 'opening-misfit' // 개구부가 호스트에 물리적으로 안 맞아 표시 안 됨
  | 'opening-clamped' // 저장된 offset이 벽 밖 — 클램프된 위치로 표시 중
  | 'duplicate' // 동일 지오메트리+타입 중복
  | 'overlap-wall' // 근접 평행 벽 겹침
  | 'unjoined-endpoint' // 끝점이 거의 만나지만 정확히 안 붙음 (마이터 조인 불발)
  | 'extreme-dimension'; // 극단적으로 짧은 벽/낮은 벽/작은 슬라브 등

export interface LintFix {
  label: string;
  /** v1 수정 = 삭제만 — UI가 store.deleteElements(deleteIds)로 적용 */
  deleteIds: Id[];
}

export interface LintFinding {
  code: LintCode;
  severity: LintSeverity;
  message: string;
  /** 관련 요소 — [0]이 점프 대상 */
  elementIds: Id[];
  fix?: LintFix;
}

// --- 검사 임계값 (mm) ---
const OVERLAP_LATERAL_MAX = 50; // 겹침 벽: 중심선 측면 간격 한계
const OVERLAP_PARALLEL_SIN = 0.035; // ≈ 2° — 이하면 평행 취급
const OVERLAP_MIN = 10; // 종방향 겹침 최소 길이
const GAP_MAX = 250; // 미접합 끝점: 이 이하 갭만 "거의 만남"으로 경고
const GRID_CELL = 4000; // 공간 버킷 셀 크기 — 쌍 검사 후보 프루닝용
const WALL_LEN_MIN = 100; // 극단적으로 짧은 벽
const WALL_HEIGHT_MIN = 300; // 극단적으로 낮은 벽
const WALL_HEIGHT_INFO = 12000; // 비정상적으로 높은 벽 (정보)
const SLAB_AREA_MIN = 10000; // 0.01㎡ — 극단적으로 작은 슬라브

const KIND_LABEL: Record<string, string> = {
  wall: '벽',
  opening: '개구부',
  slab: '슬라브',
  grid: '그리드',
  column: '기둥',
};

const dist = (p: Pt, q: Pt): number => Math.hypot(p[0] - q[0], p[1] - q[1]);

/** 점→선분 거리 + 투영 파라미터 t(0..1 밖이면 클램프 전 값) */
function pointSegment(p: Pt, a: Pt, b: Pt): { d: number; t: number } {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return { d: dist(p, a), t: 0 };
  const t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2;
  const ct = Math.max(0, Math.min(1, t));
  return { d: Math.hypot(p[0] - (a[0] + dx * ct), p[1] - (a[1] + dy * ct)), t };
}

/** 끝점 무순서 정규화 키 — 방향 뒤집힌 중복도 같은 키 */
function segKey(a: Pt, b: Pt): string {
  const fwd = a[0] < b[0] || (a[0] === b[0] && a[1] <= b[1]);
  const [p, q] = fwd ? [a, b] : [b, a];
  return `${p[0]},${p[1]}:${q[0]},${q[1]}`;
}

/** 폴리곤 순환·방향 정규화 키 — 시작점/와인딩만 다른 중복도 같은 키 */
function boundaryKey(boundary: Pt[]): string {
  const ring = boundary.map((p) => `${p[0]},${p[1]}`);
  const variants: string[] = [];
  for (const r of [ring, [...ring].reverse()]) {
    for (let i = 0; i < r.length; i++) {
      variants.push([...r.slice(i), ...r.slice(0, i)].join(':'));
    }
  }
  return variants.sort()[0]!;
}

/** 슈레이스 면적 (절댓값, mm²) */
function polygonArea(boundary: Pt[]): number {
  let s = 0;
  for (let i = 0; i < boundary.length; i++) {
    const p = boundary[i]!;
    const q = boundary[(i + 1) % boundary.length]!;
    s += p[0] * q[1] - q[0] * p[1];
  }
  return Math.abs(s) / 2;
}

/**
 * 문서 데이터 위생 검사 — 읽기 전용, 심각도순 정렬(error→warning→info) 반환.
 * O(레벨별 벽 n²) — MVP 규모(수백 요소)에서 충분.
 */
export function lint(store: DocStore): LintFinding[] {
  const findings: LintFinding[] = [];
  const els = store.listElements();
  const walls = els.filter((e): e is WallElement => e.kind === 'wall');

  // --- 1. 깨진 참조 + 고아/부적합 개구부 ---
  for (const el of els) {
    if (el.kind === 'grid') continue;
    const label = KIND_LABEL[el.kind] ?? el.kind;

    if ('levelId' in el && !store.getLevel(el.levelId)) {
      findings.push({
        code: 'missing-ref',
        severity: 'error',
        message: `${label}이(가) 존재하지 않는 레벨을 참조 — 어디에도 표시되지 않음`,
        elementIds: [el.id],
      });
    }
    const type = store.getType(el.typeId);
    if (!type || type.kind !== el.kind) {
      findings.push({
        code: 'missing-ref',
        severity: 'error',
        message: `${label}의 타입 참조가 깨짐 (${type ? '종류 불일치' : '존재하지 않음'}) — 표시되지 않음`,
        elementIds: [el.id],
      });
    }

    if (el.kind === 'opening') {
      const host = store.getElement(el.hostId);
      if (host?.kind !== 'wall') {
        findings.push({
          code: 'orphan-opening',
          severity: 'error',
          message: '고아 개구부 — 호스트 벽이 없어 표시되지 않는 유령 데이터',
          elementIds: [el.id],
          fix: { label: '개구부 삭제', deleteIds: [el.id] },
        });
      } else if (type?.kind === 'opening') {
        const level = store.getLevel(host.levelId);
        const hostHeight = host.height ?? level?.height ?? 0;
        const openingType = type as OpeningType;
        const resolved = resolveOpening(el, openingType, host, hostHeight);
        const wantW = el.widthOverride ?? openingType.opening.width;
        const wantH = el.heightOverride ?? openingType.opening.height;
        if (!resolved) {
          findings.push({
            code: 'opening-misfit',
            severity: 'error',
            message: '개구부가 호스트 벽에 맞지 않아 표시되지 않음 (벽이 너무 짧거나 낮음)',
            elementIds: [el.id, host.id],
            fix: { label: '개구부 삭제', deleteIds: [el.id] },
          });
        } else if (resolved.width < wantW - 1 || resolved.height < wantH - 1) {
          findings.push({
            code: 'opening-misfit',
            severity: 'warning',
            message: `개구부(${wantW}×${wantH})가 벽에 비해 커서 ${Math.round(resolved.width)}×${Math.round(resolved.height)}로 줄여 표시 중`,
            elementIds: [el.id, host.id],
          });
        } else if (Math.abs(resolved.offset - el.offset) > 1) {
          findings.push({
            code: 'opening-clamped',
            severity: 'info',
            message: `개구부 저장 위치(${el.offset}mm)가 벽 범위 밖 — ${Math.round(resolved.offset)}mm로 클램프되어 표시 중`,
            elementIds: [el.id, host.id],
          });
        }
      }
    }
  }

  // --- 2. 중복 요소 (동일 지오메트리+타입+레벨) ---
  const dupKeys = new Map<string, Id>();
  const dupPairs = new Set<string>(); // 겹침 검사에서 이중 보고 방지용
  for (const el of els) {
    let key: string;
    if (el.kind === 'wall') {
      key = `w|${el.levelId}|${el.typeId}|${el.height ?? ''}|${el.baseOffset ?? ''}|${segKey(el.a, el.b)}`;
    } else if (el.kind === 'grid') {
      key = `g|${segKey(el.a, el.b)}`;
    } else if (el.kind === 'opening') {
      key = `o|${el.hostId}|${el.typeId}|${el.offset}|${el.widthOverride ?? ''}|${el.heightOverride ?? ''}|${el.sillOverride ?? ''}`;
    } else if (el.kind === 'column') {
      key = `c|${el.levelId}|${el.typeId}|${el.at[0]},${el.at[1]}|${el.height ?? ''}|${el.baseOffset ?? ''}`;
    } else {
      key = `s|${el.levelId}|${el.typeId}|${el.thicknessOverride ?? ''}|${boundaryKey(el.boundary)}`;
    }
    const first = dupKeys.get(key);
    if (first) {
      dupPairs.add([el.id, first].sort().join('|'));
      findings.push({
        code: 'duplicate',
        severity: 'warning',
        message: `중복 ${KIND_LABEL[el.kind]} — 같은 자리에 동일 요소가 겹쳐 있음`,
        elementIds: [el.id, first],
        fix: { label: '중복 삭제', deleteIds: [el.id] },
      });
    } else {
      dupKeys.set(key, el.id);
    }
  }

  // --- 3. 겹침 벽 + 미접합 끝점 (레벨별 벽 쌍) ---
  const byLevel = new Map<Id, WallElement[]>();
  for (const w of walls) {
    const list = byLevel.get(w.levelId) ?? [];
    list.push(w);
    byLevel.set(w.levelId, list);
  }

  for (const [levelId, group] of byLevel) {
    const levelHeight = store.getLevel(levelId)?.height ?? 0;
    /** 벽 수직 구간 [base, top] — 인방벽/허리벽처럼 높이로 분리된 벽 구분용 */
    const zRange = (w: WallElement): [number, number] => {
      const base = w.baseOffset ?? 0;
      return [base, base + (w.height ?? levelHeight)];
    };

    // 공간 그리드 버킷팅 — 전수 O(n²) 대신 셀(GRID_CELL)을 공유하는 쌍만 정밀 검사.
    // 각 벽 bbox를 최대 상호작용 거리(GAP_MAX)만큼 패딩해 등록하므로,
    // 250mm 이내의 모든 쌍은 반드시 최소 한 셀을 공유한다 (후보 누락 없음).
    const neighborSets: Set<number>[] = group.map(() => new Set<number>());
    {
      const cellMap = new Map<number, number[]>();
      for (let i = 0; i < group.length; i++) {
        const w = group[i]!;
        const x0 = Math.floor((Math.min(w.a[0], w.b[0]) - GAP_MAX) / GRID_CELL);
        const x1 = Math.floor((Math.max(w.a[0], w.b[0]) + GAP_MAX) / GRID_CELL);
        const y0 = Math.floor((Math.min(w.a[1], w.b[1]) - GAP_MAX) / GRID_CELL);
        const y1 = Math.floor((Math.max(w.a[1], w.b[1]) + GAP_MAX) / GRID_CELL);
        for (let ix = x0; ix <= x1; ix++) {
          for (let iy = y0; iy <= y1; iy++) {
            const key = ix * 0x40000 + iy; // 셀 좌표 합성 키 (±13만 셀 = ±5km 문서까지 충돌 없음)
            const list = cellMap.get(key);
            if (list) list.push(i);
            else cellMap.set(key, [i]);
          }
        }
      }
      for (const list of cellMap.values()) {
        for (let a = 0; a < list.length; a++) {
          for (let b = a + 1; b < list.length; b++) {
            neighborSets[list[a]!]!.add(list[b]!);
            neighborSets[list[b]!]!.add(list[a]!);
          }
        }
      }
    }

    // 3a. 근접 평행 겹침
    for (let i = 0; i < group.length; i++) {
      for (const j of neighborSets[i]!) {
        if (j <= i) continue; // 쌍당 1회
        const w1 = group[i]!;
        const w2 = group[j]!;
        // duplicate로 이미 보고된 쌍만 제외 — 같은 선상이라도 타입이 다르면
        // 중복이 아니므로 여기서 겹침으로 잡아야 함 (미탐 방지)
        if (dupPairs.has([w1.id, w2.id].sort().join('|'))) continue;
        // 수직 구간이 안 겹치면 평면상 같은 자리여도 정상 (문 위 인방벽, 고창 아래 허리벽)
        const [z1a, z1b] = zRange(w1);
        const [z2a, z2b] = zRange(w2);
        if (Math.min(z1b, z2b) - Math.max(z1a, z2a) <= 0) continue;
        const len1 = dist(w1.a, w1.b);
        const len2 = dist(w2.a, w2.b);
        if (len1 === 0 || len2 === 0) continue;
        const d1: Pt = [(w1.b[0] - w1.a[0]) / len1, (w1.b[1] - w1.a[1]) / len1];
        const d2: Pt = [(w2.b[0] - w2.a[0]) / len2, (w2.b[1] - w2.a[1]) / len2];
        if (Math.abs(d1[0] * d2[1] - d1[1] * d2[0]) > OVERLAP_PARALLEL_SIN) continue;
        // 측면 간격: w2 양끝의 w1 무한선 거리
        const lat = (p: Pt) => Math.abs(d1[0] * (p[1] - w1.a[1]) - d1[1] * (p[0] - w1.a[0]));
        const gap = Math.max(lat(w2.a), lat(w2.b));
        if (gap > OVERLAP_LATERAL_MAX) continue;
        // 종방향 겹침 구간
        const t = (p: Pt) => d1[0] * (p[0] - w1.a[0]) + d1[1] * (p[1] - w1.a[1]);
        const [tA, tB] = [t(w2.a), t(w2.b)].sort((x, y) => x - y) as [number, number];
        const overlap = Math.min(len1, tB) - Math.max(0, tA);
        if (overlap < OVERLAP_MIN) continue;
        findings.push({
          code: 'overlap-wall',
          severity: 'warning',
          message: `벽 2개가 ${Math.round(overlap)}mm 겹침 (간격 ${Math.round(gap)}mm) — 의도한 게 아니면 하나를 지우거나 떼어 놓으세요`,
          elementIds: [w1.id, w2.id],
        });
      }
    }

    // 3b. 미접합 끝점 — 정확히 붙으면 마이터/T자 조인, 거의 붙으면(≤250mm) 미접합 경고
    // 끝점이 조인됨 = 다른 벽 끝점과 정확히 일치(마이터) 또는 몸체 위 정확히 위치(T자)
    // (접촉 거리 0 ≤ GAP_MAX 패딩이므로 그리드 이웃만 보면 충분)
    const isJoined = (idx: number, p: Pt): boolean => {
      for (const oi of neighborSets[idx]!) {
        const o = group[oi]!;
        if (dist(o.a, p) === 0 || dist(o.b, p) === 0 || pointSegment(p, o.a, o.b).d === 0)
          return true;
      }
      return false;
    };
    const joinedEnds = new Map<string, boolean>();
    for (let i = 0; i < group.length; i++) {
      const w = group[i]!;
      joinedEnds.set(`${w.id}:a`, isJoined(i, w.a));
      joinedEnds.set(`${w.id}:b`, isJoined(i, w.b));
    }

    const reported = new Set<string>();
    for (let wi = 0; wi < group.length; wi++) {
      const w = group[wi]!;
      for (const end of ['a', 'b'] as const) {
        const p = w[end];
        if (joinedEnds.get(`${w.id}:${end}`)) continue;
        // 가장 가까운 후보 — 단, 이 벽 자신의 몸체 위에 정확히 닿아 있는 끝점은
        // 제외 (T자 교차점을 지나 뻗은 자유 끝이 그 교차점을 "거의 만남"으로
        // 오인하는 것 방지 — 이미 이 벽과 접합된 점이므로)
        let best: { d: number; other: WallElement; kind: 'end' | 'body'; key: string } | null =
          null;
        for (const oi of neighborSets[wi]!) {
          const o = group[oi]!;
          for (const oEnd of ['a', 'b'] as const) {
            if (pointSegment(o[oEnd], w.a, w.b).d === 0) continue;
            const d = dist(o[oEnd], p);
            if (d > 0 && (!best || d < best.d)) {
              const key = [`${w.id}:${end}`, `${o.id}:${oEnd}`].sort().join('|');
              best = { d, other: o, kind: 'end', key };
            }
          }
          const { d, t } = pointSegment(p, o.a, o.b);
          // 몸체 투영만 (끝 근처는 끝점 후보가 잡음) — 정확히 몸체 위(d=0)는 T자 접합으로 정상
          if (t > 0 && t < 1 && d > 0 && (!best || d < best.d)) {
            // 키가 단방향인 건 의도 — 서로의 몸체에 가까운 두 끝점은 별개의 미접합 2건
            best = { d, other: o, kind: 'body', key: `${w.id}:${end}>${o.id}` };
          }
        }
        if (!best || best.d > GAP_MAX) continue;
        if (reported.has(best.key)) continue;
        reported.add(best.key);
        findings.push({
          code: 'unjoined-endpoint',
          severity: 'warning',
          message:
            best.kind === 'end'
              ? `벽 끝점이 다른 벽 끝점과 ${Math.round(best.d)}mm 떨어짐 — 정확히 붙여야 모서리가 접합됨`
              : `벽 끝점이 다른 벽 몸체에서 ${Math.round(best.d)}mm 떨어짐 — T자 접합이 안 된 상태`,
          elementIds: [w.id, best.other.id],
        });
      }
    }
  }

  // --- 4. 극단 치수 ---
  for (const w of walls) {
    const len = dist(w.a, w.b);
    if (len < WALL_LEN_MIN) {
      findings.push({
        code: 'extreme-dimension',
        severity: 'warning',
        message: `극단적으로 짧은 벽 (${Math.round(len)}mm) — 그리다 만 조각일 가능성`,
        elementIds: [w.id],
        fix: { label: '벽 삭제', deleteIds: [w.id] },
      });
    }
    const h = w.height ?? store.getLevel(w.levelId)?.height;
    if (h !== undefined && h < WALL_HEIGHT_MIN) {
      findings.push({
        code: 'extreme-dimension',
        severity: 'warning',
        message: `극단적으로 낮은 벽 (높이 ${h}mm)`,
        elementIds: [w.id],
      });
    } else if (h !== undefined && h > WALL_HEIGHT_INFO) {
      findings.push({
        code: 'extreme-dimension',
        severity: 'info',
        message: `비정상적으로 높은 벽 (높이 ${h}mm) — 의도 확인`,
        elementIds: [w.id],
      });
    }
  }
  for (const el of els) {
    if (el.kind !== 'slab') continue;
    const area = polygonArea((el as SlabElement).boundary);
    if (area < SLAB_AREA_MIN) {
      findings.push({
        code: 'extreme-dimension',
        severity: 'warning',
        message: `극단적으로 작은 슬라브 (${(area / 1_000_000).toFixed(3)}㎡)`,
        elementIds: [el.id],
        fix: { label: '슬라브 삭제', deleteIds: [el.id] },
      });
    }
  }

  // 심각도순 정렬 (같은 심각도는 발견 순서 유지)
  return findings.sort((x, y) => LINT_SEVERITY_RANK[x.severity] - LINT_SEVERITY_RANK[y.severity]);
}
