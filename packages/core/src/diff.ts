import type { Element, Level, ElemType } from './schema';
import type { DocSnapshot } from './store';

/**
 * M6 버전 관리 — 파라메트릭 시맨틱 diff (순수 함수).
 * 문서가 파라미터 전부이므로 요소 단위 비교가 곧 의미 있는 변경 목록이다
 * (git 텍스트 diff보다 나은 지점 — 리서치 결론).
 */

export interface ElementChange {
  id: string;
  kind: Element['kind'];
  /** 값이 달라진 필드 이름들 */
  fields: string[];
}

export interface SnapshotDiff {
  added: Element[];
  removed: Element[];
  changed: ElementChange[];
  /** 레벨/타입 변경은 횟수만 (요소보다 드묾) */
  levelChanges: number;
  typeChanges: number;
}

// 키 순서 불변 비교 — 커밋 blob은 키 정렬된 canonical JSON이라
// 파싱 결과의 키 순서가 라이브 스냅샷과 다르다 (순서 민감 비교 = 가짜 변경)
const sortDeep = (v: unknown): unknown => {
  if (Array.isArray(v)) return v.map(sortDeep);
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(o)
        .sort()
        .map((k) => [k, sortDeep(o[k])]),
    );
  }
  return v;
};

const shallowEqual = (a: unknown, b: unknown): boolean =>
  JSON.stringify(sortDeep(a)) === JSON.stringify(sortDeep(b));

function changedFields(a: Element, b: Element): string[] {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  const out: string[] = [];
  for (const k of keys) {
    if (k === 'id') continue;
    if (!shallowEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]))
      out.push(k);
  }
  return out;
}

function countMapChanges<T extends { id: string }>(before: T[], after: T[]): number {
  const a = new Map(before.map((x) => [x.id, x]));
  const b = new Map(after.map((x) => [x.id, x]));
  let n = 0;
  for (const [id, x] of b) {
    const prev = a.get(id);
    if (!prev) n++;
    else if (!shallowEqual(prev, x)) n++;
  }
  for (const id of a.keys()) if (!b.has(id)) n++;
  return n;
}

/** before → after 요소 단위 diff */
export function diffSnapshots(before: DocSnapshot, after: DocSnapshot): SnapshotDiff {
  const a = new Map(before.elements.map((e) => [e.id, e]));
  const b = new Map(after.elements.map((e) => [e.id, e]));
  const added: Element[] = [];
  const removed: Element[] = [];
  const changed: ElementChange[] = [];
  for (const [id, el] of b) {
    const prev = a.get(id);
    if (!prev) {
      added.push(el);
    } else {
      const fields = changedFields(prev, el);
      if (fields.length) changed.push({ id, kind: el.kind, fields });
    }
  }
  for (const [id, el] of a) {
    if (!b.has(id)) removed.push(el);
  }
  return {
    added,
    removed,
    changed,
    levelChanges: countMapChanges<Level>(before.levels, after.levels),
    typeChanges: countMapChanges<ElemType>(before.types, after.types),
  };
}

export const KIND_LABEL: Record<Element['kind'], string> = {
  wall: '벽',
  opening: '개구부',
  slab: '슬라브',
  grid: '그리드',
  column: '기둥',
  beam: '보',
  stair: '계단',
  railing: '난간',
  roof: '지붕',
  curtainwall: '커튼월',
  zone: '존',
  text: '텍스트',
  label: '레이블',
  dimension: '치수',
};

export const countByKind = (els: Element[]): string =>
  Object.entries(
    els.reduce<Record<string, number>>((acc, e) => {
      acc[KIND_LABEL[e.kind]] = (acc[KIND_LABEL[e.kind]] ?? 0) + 1;
      return acc;
    }, {}),
  )
    .map(([k, n]) => `${k} ${n}`)
    .join(', ');

/** 한 줄 한국어 요약 — 타임라인/복원 확인용 */
export function diffSummary(diff: SnapshotDiff): string {
  const parts: string[] = [];
  if (diff.added.length) parts.push(`+${diff.added.length} (${countByKind(diff.added)})`);
  if (diff.removed.length) parts.push(`−${diff.removed.length} (${countByKind(diff.removed)})`);
  if (diff.changed.length) parts.push(`~${diff.changed.length} 수정`);
  if (diff.levelChanges) parts.push(`레벨 ${diff.levelChanges}건`);
  if (diff.typeChanges) parts.push(`타입 ${diff.typeChanges}건`);
  return parts.length ? parts.join(' · ') : '변경 없음';
}

/** diff가 비어 있는가 (커밋 dedup 보조) */
export function isDiffEmpty(diff: SnapshotDiff): boolean {
  return (
    !diff.added.length &&
    !diff.removed.length &&
    !diff.changed.length &&
    !diff.levelChanges &&
    !diff.typeChanges
  );
}
