import { POSITIONAL, type Element, type PositionalCategory } from './schema';

/**
 * 커넥터(Rhino 등) 라이브 쓰기 멱등화 — create 옵의 content key.
 * figcadpushbreps 재푸시가 같은 Brep을 다시 보내면 동일 위치에 정확히 중첩되던 버그(iter-2 2)를
 * 서버에서 차단: 기존 요소와 content가 같은 create는 스킵. .cs writeback과 달리 in-block geo·
 * 커넥터 버전 무관하게 동작(서버 단일 지점). 위치+종류+타입+레벨이 같으면 동일로 본다(좌표 라운드).
 *
 * 주의: createdIds 순서 정렬에 의존하는 Push()(곡선 푸시 writeback)는 dedup 비활성(opt-in ?dedup=1).
 *
 * v2 (레벨 구조화 M2): levels 룩업이 주어지고 levelId가 해석되면 레벨 상대 수직 파라미터를
 * kind별 **절대 z**로 폴드하고 키의 levelId 성분을 'Z' 마커로 대체 — 평탄 푸시(전부 1층 +
 * 큰 오프셋)된 요소와 층 구조화 재푸시(다른 레벨 + 작은 오프셋)가 같은 절대 위치면 매칭돼
 * 전량 중복을 막는다. levels 미제공/미해석(레벨 토큰·미생성) = v1 키 그대로(back-compat).
 * 전제: 커넥터 프로토콜은 add_level(POST-A)을 요소 옵(POST-C)과 **별도 요청**으로 선행 —
 * 같은 배치 안의 add_level이 만든 레벨은 dedup 시점에 store에 없어 v1 폴백된다(의도).
 */

export type LevelInfo = { elevation: number; height: number };
export type LevelLookup = ReadonlyMap<string, LevelInfo>;

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
 * 수직/치수 파라미터 키 (v0.4 리뷰, v0.6 확장) — zOffset(보/슬라브)·baseOffset(기둥/벽…)·height·
 * rise(계단 총상승)·thicknessOverride(슬라브/지붕)가 있을 때만 폴드. 같은 평면 좌표에 층층이 쌓인
 * 부재(상승만 다른 계단 2주행 등)가 dedup에 조용히 삭제되지 않게.
 * 필드 없으면 빈 문자열 = 기존 요소/옵 키 불변(양쪽 동일 파생 — back-compat).
 */
function vertKey(src: Record<string, unknown>): string {
  let out = '';
  for (const k of ['zOffset', 'baseOffset', 'height', 'rise', 'thicknessOverride']) {
    const v = src[k];
    if (typeof v === 'number') out += `|${k}:${Math.round(v)}`;
  }
  return out;
}

/** 크기 파라미터 키 (절대 z 폴드 시 — 위치성 zOffset/baseOffset은 zabs가 대체). */
function sizeKey(src: Record<string, unknown>): string {
  let out = '';
  for (const k of ['height', 'rise', 'thicknessOverride']) {
    const v = src[k];
    if (typeof v === 'number') out += `|${k}:${Math.round(v)}`;
  }
  return out;
}

/**
 * kind별 절대 base z (mm, 라운드) — geometry 파생과 동일 규약:
 * slab=상면(elev+zOffset)·roof=처마(elev+height+baseOffset)·beam=축(elev+zOffset, **명시 시만** —
 * 부재 시 파생 기본값 height−vHalf는 타입 단면 없이 계산 불가 → null = 폴드 포기, 레벨 국한 v1 키 유지)·
 * 그 외(벽/기둥/계단/난간/커튼월/존…)=base(elev+baseOffset??0). lint level-band-mismatch와 공유.
 */
export function absBaseZ(
  kind: Element['kind'],
  src: Record<string, unknown>,
  lv: LevelInfo,
): number | null {
  const num = (k: string) => (typeof src[k] === 'number' ? (src[k] as number) : undefined);
  if (kind === 'beam') {
    const z = num('zOffset');
    return z === undefined ? null : Math.round(lv.elevation + z);
  }
  if (kind === 'slab') return Math.round(lv.elevation + (num('zOffset') ?? 0));
  if (kind === 'roof') return Math.round(lv.elevation + lv.height + (num('baseOffset') ?? 0));
  return Math.round(lv.elevation + (num('baseOffset') ?? 0));
}

function contentKey(
  kind: Element['kind'],
  levelId: string,
  typeId: string,
  src: Record<string, unknown>,
  levels?: LevelLookup,
): string {
  const pos = posKey(POSITIONAL[kind], src);
  const lv = levels?.get(levelId);
  if (lv) {
    const z = absBaseZ(kind, src, lv);
    if (z !== null) return `${kind}|Z|${typeId}|${pos}|zabs:${z}${sizeKey(src)}`;
  }
  return `${kind}|${levelId}|${typeId}|${pos}${vertKey(src)}`; // v1 — back-compat
}

/** 기존 요소의 content key (종류+레벨+타입+좌표+수직 파라미터 / levels 제공 시 절대 z 폴드). */
export function elementContentKey(el: Element, levels?: LevelLookup): string {
  const typeId = 'typeId' in el ? (el as { typeId: string }).typeId : '';
  const levelId = 'levelId' in el ? (el as { levelId: string }).levelId : '';
  return contentKey(el.kind, levelId, typeId, el as unknown as Record<string, unknown>, levels);
}

/**
 * create 옵의 content key — 기존 요소와 비교용. dedup 대상 아닌 옵(update/delete·hosted·주석)은 null.
 * null = 항상 적용(스킵 안 함).
 */
export function createOpContentKey(
  opName: string,
  args: Record<string, unknown>,
  levels?: LevelLookup,
): string | null {
  const kind = CREATE_KIND[opName];
  if (!kind) return null;
  const typeId = typeof args['typeId'] === 'string' ? (args['typeId'] as string) : '';
  const levelId = typeof args['levelId'] === 'string' ? (args['levelId'] as string) : '';
  return contentKey(kind, levelId, typeId, args, levels);
}
