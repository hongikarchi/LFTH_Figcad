import type { DocStore } from './store';
import type { Id, Pt } from './schema';

/**
 * M4 AI 모드 — 도구 카탈로그 + 드라이런/재생 공용 실행기.
 *
 * 흐름: 서버가 문서 스냅샷으로 드라이런 DocStore를 만들고, Claude의 tool_use를
 * executeOp로 실제 적용하면서 OpLogEntry를 기록한다(모델이 일관된 세계를 봄).
 * 클라이언트는 승인 시 applyOpLog로 자기 스토어에 같은 op들을 재생한다 —
 * 재생 시 새로 발급되는 id가 다르므로 드라이런 id → 실제 id 재매핑을 수행한다.
 *
 * 불변 규칙 2 준수: 모든 변경은 DocStore ops 경유 (여기서도 raw Y.Map 쓰기 없음).
 */

export interface OpLogEntry {
  op: string;
  /** 드라이런 시점 인자 (드라이런 id 포함 — 재생 시 재매핑) */
  args: Record<string, unknown>;
  /** 드라이런 실행 결과 (생성 id 등) — 재생 결과와 짝지어 id 매핑 구축 */
  result?: unknown;
}

interface AiToolDef {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
  /** true면 opLog에 기록 (문서 변경), false면 조회 전용 */
  mutating: boolean;
}

const pt = (desc: string) => ({
  type: 'array',
  items: { type: 'integer' },
  description: `${desc} — [x, y] mm 정수 2개`,
});
const idArr = (desc: string) => ({
  type: 'array',
  items: { type: 'string' },
  description: desc,
});

/** Anthropic strict tool use 호환 스키마 (additionalProperties:false, 단순 키워드만) */
export const AI_TOOLS: AiToolDef[] = [
  {
    name: 'get_document',
    description:
      '현재 문서 전체(레벨/타입/요소)를 JSON으로 조회. 도구 호출로 문서를 변경한 뒤 최신 상태를 다시 확인할 때 사용.',
    input_schema: { type: 'object', properties: {}, additionalProperties: false },
    mutating: false,
  },
  {
    name: 'create_wall',
    description:
      '벽 생성. a→b 중심선(mm), 두께는 typeId의 벽 타입에서. 끝점이 다른 벽 끝점과 정확히 일치하면 자동으로 마이터 조인된다. 방을 만들 때는 벽 4개의 끝점을 정확히 공유시킬 것.',
    input_schema: {
      type: 'object',
      properties: {
        levelId: { type: 'string', description: '배치할 레벨(층) id' },
        typeId: { type: 'string', description: '벽 타입 id (문서의 types에서 kind=wall)' },
        a: pt('중심선 시작점'),
        b: pt('중심선 끝점'),
        height: { type: 'integer', description: '벽 높이 mm (생략 시 레벨 층고)' },
      },
      required: ['levelId', 'typeId', 'a', 'b'],
      additionalProperties: false,
    },
    mutating: true,
  },
  {
    name: 'create_opening',
    description:
      '문/창 생성 — 벽에 호스트됨. offset은 벽 a끝에서 개구부 중심까지 거리(mm). 치수는 typeId 기본값 사용, 오버라이드 가능. 벽 길이 안에 들어가야 함(양끝 50mm 여유).',
    input_schema: {
      type: 'object',
      properties: {
        hostId: { type: 'string', description: '호스트 벽 id' },
        typeId: { type: 'string', description: '개구부 타입 id (kind=opening, 문 또는 창)' },
        offset: { type: 'integer', description: '벽 a끝 → 개구부 중심 거리 mm' },
        widthOverride: { type: 'integer', description: '폭 오버라이드 mm' },
        heightOverride: { type: 'integer', description: '높이 오버라이드 mm' },
        sillOverride: { type: 'integer', description: '창대 높이 오버라이드 mm (문은 0)' },
      },
      required: ['hostId', 'typeId', 'offset'],
      additionalProperties: false,
    },
    mutating: true,
  },
  {
    name: 'create_slab',
    description:
      '슬라브(바닥판) 생성. boundary는 단순 폴리곤(자가교차 금지) 꼭짓점 목록, 상면이 레벨 elevation에 맞고 아래로 두께만큼 내려감.',
    input_schema: {
      type: 'object',
      properties: {
        levelId: { type: 'string', description: '레벨 id' },
        typeId: { type: 'string', description: '슬라브 타입 id (kind=slab)' },
        boundary: {
          type: 'array',
          items: { type: 'array', items: { type: 'integer' } },
          description: '폴리곤 꼭짓점 [[x,y],...] mm — 3개 이상, 자가교차 금지',
        },
        thicknessOverride: { type: 'integer', description: '두께 오버라이드 mm' },
      },
      required: ['levelId', 'typeId', 'boundary'],
      additionalProperties: false,
    },
    mutating: true,
  },
  {
    name: 'create_grid_line',
    description:
      '구조 그리드 축선 생성 (전 층 공통, 평면 표시 + 스냅 기준). label 생략 시 자동(세로축=숫자, 가로축=알파벳).',
    input_schema: {
      type: 'object',
      properties: {
        a: pt('축선 시작점'),
        b: pt('축선 끝점'),
        label: { type: 'string', description: "축 라벨 ('A', '1' 등, 생략 시 자동)" },
      },
      required: ['a', 'b'],
      additionalProperties: false,
    },
    mutating: true,
  },
  {
    name: 'add_level',
    description: '레벨(층) 추가. elevation=바닥 전역 높이 mm, height=층고 mm, order=정렬 순서.',
    input_schema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: "층 이름 ('2층' 등)" },
        elevation: { type: 'integer', description: '바닥 높이 mm (1층=0, 2층=층고)' },
        height: { type: 'integer', description: '층고 mm' },
        order: { type: 'integer', description: '정렬 순서 (1층=0, 2층=1)' },
      },
      required: ['name', 'elevation', 'height', 'order'],
      additionalProperties: false,
    },
    mutating: true,
  },
  {
    name: 'update_level',
    description: '레벨 속성 수정 (이름/높이/층고).',
    input_schema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: '레벨 id' },
        name: { type: 'string' },
        elevation: { type: 'integer', description: '바닥 높이 mm' },
        height: { type: 'integer', description: '층고 mm' },
      },
      required: ['id'],
      additionalProperties: false,
    },
    mutating: true,
  },
  {
    name: 'update_element',
    description:
      '요소 필드 수정. kind에 맞는 필드만 사용: 벽=a/b/height/typeId, 개구부=offset/widthOverride/heightOverride/sillOverride, 슬라브=boundary/thicknessOverride, 그리드=a/b/label.',
    input_schema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: '요소 id' },
        a: pt('시작점 (벽/그리드)'),
        b: pt('끝점 (벽/그리드)'),
        height: { type: 'integer', description: '벽 높이 mm' },
        typeId: { type: 'string', description: '타입 교체' },
        offset: { type: 'integer', description: '개구부 중심 거리 mm' },
        widthOverride: { type: 'integer' },
        heightOverride: { type: 'integer' },
        sillOverride: { type: 'integer' },
        boundary: {
          type: 'array',
          items: { type: 'array', items: { type: 'integer' } },
          description: '슬라브 폴리곤 [[x,y],...]',
        },
        thicknessOverride: { type: 'integer' },
        label: { type: 'string', description: '그리드 라벨' },
      },
      required: ['id'],
      additionalProperties: false,
    },
    mutating: true,
  },
  {
    name: 'delete_elements',
    description: '요소 삭제. 벽 삭제 시 호스트된 개구부 연쇄 삭제.',
    input_schema: {
      type: 'object',
      properties: { ids: idArr('삭제할 요소 id 목록') },
      required: ['ids'],
      additionalProperties: false,
    },
    mutating: true,
  },
  {
    name: 'move_elements',
    description: '요소들을 delta만큼 평행이동 (벽의 개구부는 자동 추종).',
    input_schema: {
      type: 'object',
      properties: { ids: idArr('이동할 요소 id'), delta: pt('이동량 [dx, dy]') },
      required: ['ids', 'delta'],
      additionalProperties: false,
    },
    mutating: true,
  },
  {
    name: 'duplicate_elements',
    description: '요소들을 delta 간격으로 복사 (개구부 포함). 생성된 id 반환.',
    input_schema: {
      type: 'object',
      properties: { ids: idArr('복사할 요소 id'), delta: pt('복사 간격 [dx, dy]') },
      required: ['ids', 'delta'],
      additionalProperties: false,
    },
    mutating: true,
  },
  {
    name: 'array_elements',
    description: '배열 복사 — delta 간격으로 count개 (누적). 같은 방/창을 반복 배치할 때.',
    input_schema: {
      type: 'object',
      properties: {
        ids: idArr('복사할 요소 id'),
        delta: pt('간격 [dx, dy]'),
        count: { type: 'integer', description: '복사 개수 (원본 제외)' },
      },
      required: ['ids', 'delta', 'count'],
      additionalProperties: false,
    },
    mutating: true,
  },
  {
    name: 'mirror_elements',
    description: '대칭 복사 — axisA→axisB 직선을 축으로 반사 (개구부 flip 토글).',
    input_schema: {
      type: 'object',
      properties: {
        ids: idArr('대칭 복사할 요소 id'),
        axisA: pt('대칭축 점 1'),
        axisB: pt('대칭축 점 2'),
      },
      required: ['ids', 'axisA', 'axisB'],
      additionalProperties: false,
    },
    mutating: true,
  },
  {
    name: 'rotate_elements',
    description: '제자리 회전 — center 기준 angleDeg도(반시계+).',
    input_schema: {
      type: 'object',
      properties: {
        ids: idArr('회전할 요소 id'),
        center: pt('회전 중심'),
        angleDeg: { type: 'number', description: '각도 (도, 반시계+)' },
      },
      required: ['ids', 'center', 'angleDeg'],
      additionalProperties: false,
    },
    mutating: true,
  },
  {
    name: 'split_wall',
    description:
      '벽 분할 — point의 중심선 투영 지점에서 두 벽으로 (개구부는 가까운 쪽 재호스트). 끝 100mm 이내면 실패. 기존 벽 id는 사라지고 새 벽 2개 id 반환.',
    input_schema: {
      type: 'object',
      properties: { id: { type: 'string', description: '분할할 벽 id' }, point: pt('분할점') },
      required: ['id', 'point'],
      additionalProperties: false,
    },
    mutating: true,
  },
  {
    name: 'trim_extend_wall',
    description:
      "연장/자르기 — 벽의 end('a'|'b') 끝을 다른 벽의 무한 중심선까지 이동. 평행이면 실패.",
    input_schema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: '연장/자를 벽 id' },
        end: { type: 'string', enum: ['a', 'b'], description: '움직일 끝' },
        targetWallId: { type: 'string', description: '기준 벽 id (이 벽 중심선까지)' },
      },
      required: ['id', 'end', 'targetWallId'],
      additionalProperties: false,
    },
    mutating: true,
  },
];

const MUTATING = new Set(AI_TOOLS.filter((t) => t.mutating).map((t) => t.name));

export function isMutatingOp(op: string): boolean {
  return MUTATING.has(op);
}

const asPt = (v: unknown): Pt => {
  if (!Array.isArray(v) || v.length !== 2 || typeof v[0] !== 'number' || typeof v[1] !== 'number')
    throw new Error('point must be [x, y]');
  return [Math.round(v[0]), Math.round(v[1])];
};
const asIds = (v: unknown): Id[] => {
  if (!Array.isArray(v) || v.some((x) => typeof x !== 'string'))
    throw new Error('ids must be string[]');
  return v as Id[];
};
const asStr = (v: unknown, name: string): string => {
  if (typeof v !== 'string') throw new Error(`${name} must be string`);
  return v;
};
const asNum = (v: unknown, name: string): number => {
  if (typeof v !== 'number') throw new Error(`${name} must be number`);
  return v;
};
const optNum = (v: unknown): number | undefined => (typeof v === 'number' ? v : undefined);

/**
 * op 하나를 스토어에 실행 — 서버 드라이런과 클라이언트 재생이 같은 코드를 탄다.
 * 실패는 throw (서버는 tool_result is_error로 모델에 반환).
 */
export function executeOp(store: DocStore, op: string, args: Record<string, unknown>): unknown {
  switch (op) {
    case 'get_document':
      return store.snapshot();
    case 'create_wall':
      return store.createWall({
        levelId: asStr(args['levelId'], 'levelId'),
        typeId: asStr(args['typeId'], 'typeId'),
        a: asPt(args['a']),
        b: asPt(args['b']),
        ...(optNum(args['height']) !== undefined ? { height: optNum(args['height'])! } : {}),
      });
    case 'create_opening':
      return store.createOpening({
        hostId: asStr(args['hostId'], 'hostId'),
        typeId: asStr(args['typeId'], 'typeId'),
        offset: asNum(args['offset'], 'offset'),
        ...(optNum(args['widthOverride']) !== undefined
          ? { widthOverride: optNum(args['widthOverride'])! }
          : {}),
        ...(optNum(args['heightOverride']) !== undefined
          ? { heightOverride: optNum(args['heightOverride'])! }
          : {}),
        ...(optNum(args['sillOverride']) !== undefined
          ? { sillOverride: optNum(args['sillOverride'])! }
          : {}),
      });
    case 'create_slab': {
      const raw = args['boundary'];
      if (!Array.isArray(raw)) throw new Error('boundary must be [[x,y],...]');
      return store.createSlab({
        levelId: asStr(args['levelId'], 'levelId'),
        typeId: asStr(args['typeId'], 'typeId'),
        boundary: raw.map(asPt),
        ...(optNum(args['thicknessOverride']) !== undefined
          ? { thicknessOverride: optNum(args['thicknessOverride'])! }
          : {}),
      });
    }
    case 'create_grid_line':
      return store.createGridLine({
        a: asPt(args['a']),
        b: asPt(args['b']),
        ...(typeof args['label'] === 'string' ? { label: args['label'] } : {}),
      });
    case 'add_level':
      return store.addLevel({
        name: asStr(args['name'], 'name'),
        elevation: asNum(args['elevation'], 'elevation'),
        height: asNum(args['height'], 'height'),
        order: asNum(args['order'], 'order'),
      });
    case 'update_level': {
      const { id, ...patch } = args;
      store.updateLevel(asStr(id, 'id'), patch as Partial<Omit<import('./schema').Level, 'id'>>);
      return null;
    }
    case 'update_element': {
      const { id, ...patch } = args;
      const elId = asStr(id, 'id');
      if (!store.getElement(elId)) throw new Error(`element not found: ${elId}`);
      store.updateElement(elId, patch);
      return null;
    }
    case 'delete_elements':
      store.deleteElements(asIds(args['ids']));
      return null;
    case 'move_elements':
      store.moveElements(asIds(args['ids']), asPt(args['delta']));
      return null;
    case 'duplicate_elements':
      return store.duplicateElements(asIds(args['ids']), asPt(args['delta']));
    case 'array_elements':
      return store.arrayElements(
        asIds(args['ids']),
        asPt(args['delta']),
        asNum(args['count'], 'count'),
      );
    case 'mirror_elements':
      return store.mirrorElements(asIds(args['ids']), asPt(args['axisA']), asPt(args['axisB']));
    case 'rotate_elements':
      store.rotateElements(
        asIds(args['ids']),
        asPt(args['center']),
        (asNum(args['angleDeg'], 'angleDeg') * Math.PI) / 180,
      );
      return null;
    case 'split_wall': {
      const result = store.splitWall(asStr(args['id'], 'id'), asPt(args['point']));
      if (!result) throw new Error('split failed (끝 100mm 이내거나 벽이 너무 짧음)');
      return result;
    }
    case 'trim_extend_wall': {
      const target = store.getElement(asStr(args['targetWallId'], 'targetWallId'));
      if (target?.kind !== 'wall') throw new Error('target wall not found');
      const ok = store.trimExtendWall(
        asStr(args['id'], 'id'),
        args['end'] === 'b' ? 'b' : 'a',
        { a: target.a, b: target.b },
      );
      if (!ok) throw new Error('trim/extend failed (평행하거나 퇴화)');
      return null;
    }
    default:
      throw new Error(`unknown op: ${op}`);
  }
}

/** args 안의 드라이런 id를 실제 id로 치환 (문자열/문자열 배열만 — map에 있을 때만) */
function remapArgs(
  args: Record<string, unknown>,
  idMap: Map<string, string>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(args)) {
    if (typeof v === 'string') out[k] = idMap.get(v) ?? v;
    else if (Array.isArray(v) && v.every((x) => typeof x === 'string'))
      out[k] = v.map((x) => idMap.get(x) ?? x);
    else out[k] = v;
  }
  return out;
}

/** 드라이런 결과 ↔ 재생 결과를 짝지어 id 매핑 등록 */
function registerResult(dry: unknown, real: unknown, idMap: Map<string, string>): void {
  if (typeof dry === 'string' && typeof real === 'string') idMap.set(dry, real);
  else if (Array.isArray(dry) && Array.isArray(real)) {
    for (let i = 0; i < Math.min(dry.length, real.length); i++) {
      if (typeof dry[i] === 'string' && typeof real[i] === 'string')
        idMap.set(dry[i] as string, real[i] as string);
    }
  }
}

export interface ApplyResult {
  applied: number;
  failed: { entry: OpLogEntry; error: string }[];
  /** 새로 생성된 실제 요소 id (선택 강조용) */
  createdIds: Id[];
}

/**
 * 승인된 opLog를 스토어에 재생. 드라이런에서 발급된 id는 재생 결과와 짝지어
 * 후속 op 인자에서 자동 치환된다. 개별 실패는 건너뛰고 계속 (보고만).
 */
export function applyOpLog(store: DocStore, log: OpLogEntry[]): ApplyResult {
  const idMap = new Map<string, string>();
  const failed: ApplyResult['failed'] = [];
  const createdIds: Id[] = [];
  let applied = 0;
  for (const entry of log) {
    if (!isMutatingOp(entry.op)) continue;
    try {
      const result = executeOp(store, entry.op, remapArgs(entry.args, idMap));
      registerResult(entry.result, result, idMap);
      if (typeof result === 'string') createdIds.push(result);
      else if (Array.isArray(result))
        for (const r of result) if (typeof r === 'string') createdIds.push(r);
      applied++;
    } catch (e) {
      failed.push({ entry, error: e instanceof Error ? e.message : String(e) });
    }
  }
  return { applied, failed, createdIds };
}

const fmtPt = (v: unknown): string => {
  if (Array.isArray(v) && v.length === 2) return `(${Number(v[0])}, ${Number(v[1])})`;
  return '?';
};
const fmtLen = (a: unknown, b: unknown): string => {
  if (!Array.isArray(a) || !Array.isArray(b)) return '';
  const len = Math.hypot(Number(b[0]) - Number(a[0]), Number(b[1]) - Number(a[1]));
  return ` ${(len / 1000).toFixed(2)}m`;
};

/** opLog 엔트리 → 계획 카드용 한 줄 한글 요약 */
export function opSummary(entry: OpLogEntry): string {
  const a = entry.args;
  switch (entry.op) {
    case 'create_wall':
      return `벽 생성 ${fmtPt(a['a'])}→${fmtPt(a['b'])}${fmtLen(a['a'], a['b'])}`;
    case 'create_opening':
      return `개구부 배치 (offset ${a['offset']}mm)`;
    case 'create_slab': {
      const n = Array.isArray(a['boundary']) ? a['boundary'].length : 0;
      return `슬라브 생성 (꼭짓점 ${n}개)`;
    }
    case 'create_grid_line':
      return `그리드 축 ${a['label'] ?? '자동'} ${fmtPt(a['a'])}→${fmtPt(a['b'])}`;
    case 'add_level':
      return `레벨 추가 '${a['name']}' (EL ${a['elevation']}mm, 층고 ${a['height']}mm)`;
    case 'update_level':
      return `레벨 수정 (${Object.keys(a).filter((k) => k !== 'id').join(', ')})`;
    case 'update_element':
      return `요소 수정 (${Object.keys(a).filter((k) => k !== 'id').join(', ')})`;
    case 'delete_elements':
      return `요소 ${Array.isArray(a['ids']) ? a['ids'].length : 0}개 삭제`;
    case 'move_elements':
      return `요소 ${Array.isArray(a['ids']) ? a['ids'].length : 0}개 이동 ${fmtPt(a['delta'])}`;
    case 'duplicate_elements':
      return `요소 ${Array.isArray(a['ids']) ? a['ids'].length : 0}개 복사 ${fmtPt(a['delta'])}`;
    case 'array_elements':
      return `배열 복사 ×${a['count']} ${fmtPt(a['delta'])}`;
    case 'mirror_elements':
      return `대칭 복사 (축 ${fmtPt(a['axisA'])}→${fmtPt(a['axisB'])})`;
    case 'rotate_elements':
      return `회전 ${a['angleDeg']}° (중심 ${fmtPt(a['center'])})`;
    case 'split_wall':
      return `벽 분할 ${fmtPt(a['point'])}`;
    case 'trim_extend_wall':
      return `벽 연장/자르기 (${a['end']}끝)`;
    default:
      return entry.op;
  }
}
