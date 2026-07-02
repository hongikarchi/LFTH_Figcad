import { POSITIONAL, type Element, type PositionalCategory } from './schema';

/**
 * 커넥터(Rhino 등) 라이브 쓰기 멱등화 — create 옵의 content key.
 * figcadpushbreps 재푸시가 같은 Brep을 다시 보내면 동일 위치에 정확히 중첩되던 버그(iter-2 2)를
 * 서버에서 차단: 기존 요소와 content가 같은 create는 스킵. .cs writeback과 달리 in-block geo·
 * 커넥터 버전 무관하게 동작(서버 단일 지점). 위치+종류+타입+레벨이 같으면 동일로 본다(좌표 라운드).
 *
 * 주의: createdIds 순서 정렬에 의존하는 Push()(곡선 푸시 writeback)는 dedup 비활성(opt-in ?dedup=1).
 */

const CREATE_KIND: Record<string, Element['kind']> = {
  create_wall: 'wall',
  create_slab: 'slab',
  create_column: 'column',
  create_beam: 'beam',
  create_grid_line: 'grid', // 실제 op id (capabilities/catalog) — 'create_grid'는 존재 안 함, 예전 키는 dead
  create_stair: 'stair',
  create_railing: 'railing',
  create_roof: 'roof',
  create_zone: 'zone',
  create_curtainwall: 'curtainwall',
};

function qPt(p: unknown): [number, number] | null {
  return Array.isArray(p) && p.length >= 2 && typeof p[0] === 'number' && typeof p[1] === 'number'
    ? [Math.round(p[0]), Math.round(p[1])]
    : null;
}

/** POSITIONAL 카테고리별 좌표 키 (좌표 라운드 — 요소는 이미 정수, 옵 인자는 round로 정렬). */
function posKey(cat: PositionalCategory, src: Record<string, unknown>): string {
  if (cat === 'segment') return `S:${JSON.stringify(qPt(src['a']))}|${JSON.stringify(qPt(src['b']))}`;
  if (cat === 'polygon') {
    const b = Array.isArray(src['boundary']) ? (src['boundary'] as unknown[]).map(qPt) : [];
    return `P:${JSON.stringify(b)}`;
  }
  if (cat === 'point') return `O:${JSON.stringify(qPt(src['at']))}`;
  return 'H'; // hosted(opening) — dedup 대상 아님
}

/**
 * 수직 파라미터 키 (v0.4 리뷰) — zOffset(보)·baseOffset(기둥/벽…)·height가 있을 때만 폴드.
 * 같은 평면 좌표에 층층이 쌓인 부재(보 zOffset·기둥 baseOffset만 다른 2개)가 dedup에
 * 조용히 삭제되지 않게. 필드 없으면 빈 문자열 = 기존 요소/옵 키 불변(양쪽 동일 파생).
 */
function vertKey(src: Record<string, unknown>): string {
  let out = '';
  for (const k of ['zOffset', 'baseOffset', 'height']) {
    const v = src[k];
    if (typeof v === 'number') out += `|${k}:${Math.round(v)}`;
  }
  return out;
}

/** 기존 요소의 content key (종류+레벨+타입+좌표+수직 파라미터). */
export function elementContentKey(el: Element): string {
  const typeId = 'typeId' in el ? (el as { typeId: string }).typeId : '';
  const levelId = 'levelId' in el ? (el as { levelId: string }).levelId : '';
  const src = el as unknown as Record<string, unknown>;
  return `${el.kind}|${levelId}|${typeId}|${posKey(POSITIONAL[el.kind], src)}${vertKey(src)}`;
}

/**
 * create 옵의 content key — 기존 요소와 비교용. dedup 대상 아닌 옵(update/delete·hosted·주석)은 null.
 * null = 항상 적용(스킵 안 함).
 */
export function createOpContentKey(opName: string, args: Record<string, unknown>): string | null {
  const kind = CREATE_KIND[opName];
  if (!kind) return null;
  const typeId = typeof args['typeId'] === 'string' ? (args['typeId'] as string) : '';
  const levelId = typeof args['levelId'] === 'string' ? (args['levelId'] as string) : '';
  return `${kind}|${levelId}|${typeId}|${posKey(POSITIONAL[kind], args)}${vertKey(args)}`;
}
