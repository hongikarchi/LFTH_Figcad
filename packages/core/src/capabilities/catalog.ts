import type { Level } from '../schema';
import {
  asIds,
  asNum,
  asPt,
  asStr,
  fmtLen,
  fmtPt,
  idArrSchema,
  optNum,
  ptSchema,
  type Capability,
} from './types';

/**
 * 기능 카탈로그 — 각 항목의 run/summary는 구 ai.ts executeOp/opSummary case를
 * 그대로 옮긴 것이다 (같은 store 호출·throw 메시지·요약 문구). 동작 무변경.
 */
export const CAPABILITIES: Capability[] = [
  // ===== query =====
  {
    id: 'get_document',
    category: 'query',
    titleKo: '문서 조회',
    icon: 'file-search',
    descriptionKo:
      '현재 문서 전체(레벨/타입/요소)를 JSON으로 조회. 도구 호출로 문서를 변경한 뒤 최신 상태를 다시 확인할 때 사용.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    mutating: false,
    aiExposed: true,
    run: (store) => store.snapshot(),
  },

  // ===== structure =====
  {
    id: 'create_wall',
    category: 'structure',
    titleKo: '벽',
    icon: 'wall',
    descriptionKo:
      '벽 생성. a→b 중심선(mm), 두께는 typeId의 벽 타입에서. 끝점이 다른 벽 끝점과 정확히 일치하면 자동으로 마이터 조인된다. 방을 만들 때는 벽 4개의 끝점을 정확히 공유시킬 것.',
    inputSchema: {
      type: 'object',
      properties: {
        levelId: { type: 'string', description: '배치할 레벨(층) id' },
        typeId: { type: 'string', description: '벽 타입 id (문서의 types에서 kind=wall)' },
        a: ptSchema('중심선 시작점'),
        b: ptSchema('중심선 끝점'),
        height: { type: 'integer', description: '벽 높이 mm (생략 시 레벨 층고)' },
      },
      required: ['levelId', 'typeId', 'a', 'b'],
      additionalProperties: false,
    },
    mutating: true,
    aiExposed: true,
    run: (store, a) =>
      store.createWall({
        levelId: asStr(a['levelId'], 'levelId'),
        typeId: asStr(a['typeId'], 'typeId'),
        a: asPt(a['a']),
        b: asPt(a['b']),
        ...(optNum(a['height']) !== undefined ? { height: optNum(a['height'])! } : {}),
      }),
    summary: (a) => `벽 생성 ${fmtPt(a['a'])}→${fmtPt(a['b'])}${fmtLen(a['a'], a['b'])}`,
  },
  {
    id: 'create_slab',
    category: 'structure',
    titleKo: '슬라브',
    icon: 'slab',
    descriptionKo:
      '슬라브(바닥판) 생성. boundary는 단순 폴리곤(자가교차 금지) 꼭짓점 목록, 상면이 레벨 elevation에 맞고 아래로 두께만큼 내려감.',
    inputSchema: {
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
    aiExposed: true,
    run: (store, a) => {
      const raw = a['boundary'];
      if (!Array.isArray(raw)) throw new Error('boundary must be [[x,y],...]');
      return store.createSlab({
        levelId: asStr(a['levelId'], 'levelId'),
        typeId: asStr(a['typeId'], 'typeId'),
        boundary: raw.map(asPt),
        ...(optNum(a['thicknessOverride']) !== undefined
          ? { thicknessOverride: optNum(a['thicknessOverride'])! }
          : {}),
      });
    },
    summary: (a) => {
      const n = Array.isArray(a['boundary']) ? a['boundary'].length : 0;
      return `슬라브 생성 (꼭짓점 ${n}개)`;
    },
  },
  {
    id: 'create_grid_line',
    category: 'structure',
    titleKo: '그리드',
    icon: 'grid',
    descriptionKo:
      '구조 그리드 축선 생성 (전 층 공통, 평면 표시 + 스냅 기준). label 생략 시 자동(세로축=숫자, 가로축=알파벳).',
    inputSchema: {
      type: 'object',
      properties: {
        a: ptSchema('축선 시작점'),
        b: ptSchema('축선 끝점'),
        label: { type: 'string', description: "축 라벨 ('A', '1' 등, 생략 시 자동)" },
      },
      required: ['a', 'b'],
      additionalProperties: false,
    },
    mutating: true,
    aiExposed: true,
    run: (store, a) =>
      store.createGridLine({
        a: asPt(a['a']),
        b: asPt(a['b']),
        ...(typeof a['label'] === 'string' ? { label: a['label'] } : {}),
      }),
    summary: (a) => `그리드 축 ${a['label'] ?? '자동'} ${fmtPt(a['a'])}→${fmtPt(a['b'])}`,
  },

  // ===== opening =====
  {
    id: 'create_opening',
    category: 'opening',
    titleKo: '개구부(문/창)',
    icon: 'door',
    descriptionKo:
      '문/창 생성 — 벽에 호스트됨. offset은 벽 a끝에서 개구부 중심까지 거리(mm). 치수는 typeId 기본값 사용, 오버라이드 가능. 벽 길이 안에 들어가야 함(양끝 50mm 여유).',
    inputSchema: {
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
    aiExposed: true,
    run: (store, a) =>
      store.createOpening({
        hostId: asStr(a['hostId'], 'hostId'),
        typeId: asStr(a['typeId'], 'typeId'),
        offset: asNum(a['offset'], 'offset'),
        ...(optNum(a['widthOverride']) !== undefined
          ? { widthOverride: optNum(a['widthOverride'])! }
          : {}),
        ...(optNum(a['heightOverride']) !== undefined
          ? { heightOverride: optNum(a['heightOverride'])! }
          : {}),
        ...(optNum(a['sillOverride']) !== undefined
          ? { sillOverride: optNum(a['sillOverride'])! }
          : {}),
      }),
    summary: (a) => `개구부 배치 (offset ${a['offset']}mm)`,
  },

  // ===== level =====
  {
    id: 'add_level',
    category: 'level',
    titleKo: '레벨 추가',
    icon: 'layers',
    descriptionKo:
      '레벨(층) 추가. elevation=바닥 전역 높이 mm, height=층고 mm, order=정렬 순서.',
    inputSchema: {
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
    aiExposed: true,
    run: (store, a) =>
      store.addLevel({
        name: asStr(a['name'], 'name'),
        elevation: asNum(a['elevation'], 'elevation'),
        height: asNum(a['height'], 'height'),
        order: asNum(a['order'], 'order'),
      }),
    summary: (a) => `레벨 추가 '${a['name']}' (EL ${a['elevation']}mm, 층고 ${a['height']}mm)`,
  },
  {
    id: 'update_level',
    category: 'level',
    titleKo: '레벨 수정',
    icon: 'layers',
    descriptionKo: '레벨 속성 수정 (이름/높이/층고).',
    inputSchema: {
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
    aiExposed: true,
    run: (store, a) => {
      const { id, ...patch } = a;
      store.updateLevel(asStr(id, 'id'), patch as Partial<Omit<Level, 'id'>>);
      return null;
    },
    summary: (a) => `레벨 수정 (${Object.keys(a).filter((k) => k !== 'id').join(', ')})`,
  },

  // ===== edit =====
  {
    id: 'update_element',
    category: 'edit',
    titleKo: '요소 수정',
    icon: 'pencil',
    descriptionKo:
      '요소 필드 수정. kind에 맞는 필드만 사용: 벽=a/b/height/typeId, 개구부=offset/widthOverride/heightOverride/sillOverride, 슬라브=boundary/thicknessOverride, 그리드=a/b/label.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: '요소 id' },
        a: ptSchema('시작점 (벽/그리드)'),
        b: ptSchema('끝점 (벽/그리드)'),
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
    aiExposed: true,
    run: (store, a) => {
      const { id, ...patch } = a;
      const elId = asStr(id, 'id');
      if (!store.getElement(elId)) throw new Error(`element not found: ${elId}`);
      store.updateElement(elId, patch);
      return null;
    },
    summary: (a) => `요소 수정 (${Object.keys(a).filter((k) => k !== 'id').join(', ')})`,
  },
  {
    id: 'delete_elements',
    category: 'edit',
    titleKo: '삭제',
    icon: 'trash',
    descriptionKo: '요소 삭제. 벽 삭제 시 호스트된 개구부 연쇄 삭제.',
    inputSchema: {
      type: 'object',
      properties: { ids: idArrSchema('삭제할 요소 id 목록') },
      required: ['ids'],
      additionalProperties: false,
    },
    mutating: true,
    aiExposed: true,
    run: (store, a) => {
      store.deleteElements(asIds(a['ids']));
      return null;
    },
    summary: (a) => `요소 ${Array.isArray(a['ids']) ? a['ids'].length : 0}개 삭제`,
  },
  {
    id: 'move_elements',
    category: 'edit',
    titleKo: '이동',
    icon: 'move',
    descriptionKo: '요소들을 delta만큼 평행이동 (벽의 개구부는 자동 추종).',
    inputSchema: {
      type: 'object',
      properties: { ids: idArrSchema('이동할 요소 id'), delta: ptSchema('이동량 [dx, dy]') },
      required: ['ids', 'delta'],
      additionalProperties: false,
    },
    mutating: true,
    aiExposed: true,
    run: (store, a) => {
      store.moveElements(asIds(a['ids']), asPt(a['delta']));
      return null;
    },
    summary: (a) =>
      `요소 ${Array.isArray(a['ids']) ? a['ids'].length : 0}개 이동 ${fmtPt(a['delta'])}`,
  },
  {
    id: 'duplicate_elements',
    category: 'edit',
    titleKo: '복사',
    icon: 'copy',
    descriptionKo: '요소들을 delta 간격으로 복사 (개구부 포함). 생성된 id 반환.',
    inputSchema: {
      type: 'object',
      properties: { ids: idArrSchema('복사할 요소 id'), delta: ptSchema('복사 간격 [dx, dy]') },
      required: ['ids', 'delta'],
      additionalProperties: false,
    },
    mutating: true,
    aiExposed: true,
    run: (store, a) => store.duplicateElements(asIds(a['ids']), asPt(a['delta'])),
    summary: (a) =>
      `요소 ${Array.isArray(a['ids']) ? a['ids'].length : 0}개 복사 ${fmtPt(a['delta'])}`,
  },
  {
    id: 'array_elements',
    category: 'edit',
    titleKo: '배열',
    icon: 'grid-2x2',
    descriptionKo: '배열 복사 — delta 간격으로 count개 (누적). 같은 방/창을 반복 배치할 때.',
    inputSchema: {
      type: 'object',
      properties: {
        ids: idArrSchema('복사할 요소 id'),
        delta: ptSchema('간격 [dx, dy]'),
        count: { type: 'integer', description: '복사 개수 (원본 제외)' },
      },
      required: ['ids', 'delta', 'count'],
      additionalProperties: false,
    },
    mutating: true,
    aiExposed: true,
    run: (store, a) =>
      store.arrayElements(asIds(a['ids']), asPt(a['delta']), asNum(a['count'], 'count')),
    summary: (a) => `배열 복사 ×${a['count']} ${fmtPt(a['delta'])}`,
  },
  {
    id: 'mirror_elements',
    category: 'edit',
    titleKo: '대칭',
    icon: 'flip-horizontal',
    descriptionKo: '대칭 복사 — axisA→axisB 직선을 축으로 반사 (개구부 flip 토글).',
    inputSchema: {
      type: 'object',
      properties: {
        ids: idArrSchema('대칭 복사할 요소 id'),
        axisA: ptSchema('대칭축 점 1'),
        axisB: ptSchema('대칭축 점 2'),
      },
      required: ['ids', 'axisA', 'axisB'],
      additionalProperties: false,
    },
    mutating: true,
    aiExposed: true,
    run: (store, a) => store.mirrorElements(asIds(a['ids']), asPt(a['axisA']), asPt(a['axisB'])),
    summary: (a) => `대칭 복사 (축 ${fmtPt(a['axisA'])}→${fmtPt(a['axisB'])})`,
  },
  {
    id: 'rotate_elements',
    category: 'edit',
    titleKo: '회전',
    icon: 'rotate-cw',
    descriptionKo: '제자리 회전 — center 기준 angleDeg도(반시계+).',
    inputSchema: {
      type: 'object',
      properties: {
        ids: idArrSchema('회전할 요소 id'),
        center: ptSchema('회전 중심'),
        angleDeg: { type: 'number', description: '각도 (도, 반시계+)' },
      },
      required: ['ids', 'center', 'angleDeg'],
      additionalProperties: false,
    },
    mutating: true,
    aiExposed: true,
    run: (store, a) => {
      store.rotateElements(
        asIds(a['ids']),
        asPt(a['center']),
        (asNum(a['angleDeg'], 'angleDeg') * Math.PI) / 180,
      );
      return null;
    },
    summary: (a) => `회전 ${a['angleDeg']}° (중심 ${fmtPt(a['center'])})`,
  },
  {
    id: 'split_wall',
    category: 'edit',
    titleKo: '분할',
    icon: 'scissors',
    descriptionKo:
      '벽 분할 — point의 중심선 투영 지점에서 두 벽으로 (개구부는 가까운 쪽 재호스트). 끝 100mm 이내면 실패. 기존 벽 id는 사라지고 새 벽 2개 id 반환.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string', description: '분할할 벽 id' }, point: ptSchema('분할점') },
      required: ['id', 'point'],
      additionalProperties: false,
    },
    mutating: true,
    aiExposed: true,
    run: (store, a) => {
      const result = store.splitWall(asStr(a['id'], 'id'), asPt(a['point']));
      if (!result) throw new Error('split failed (끝 100mm 이내거나 벽이 너무 짧음)');
      return result;
    },
    summary: (a) => `벽 분할 ${fmtPt(a['point'])}`,
  },
  {
    id: 'trim_extend_wall',
    category: 'edit',
    titleKo: '연장/자르기',
    icon: 'move-horizontal',
    descriptionKo:
      "연장/자르기 — 벽의 end('a'|'b') 끝을 다른 벽의 무한 중심선까지 이동. 평행이면 실패.",
    inputSchema: {
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
    aiExposed: true,
    run: (store, a) => {
      const target = store.getElement(asStr(a['targetWallId'], 'targetWallId'));
      if (target?.kind !== 'wall') throw new Error('target wall not found');
      const ok = store.trimExtendWall(asStr(a['id'], 'id'), a['end'] === 'b' ? 'b' : 'a', {
        a: target.a,
        b: target.b,
      });
      if (!ok) throw new Error('trim/extend failed (평행하거나 퇴화)');
      return null;
    },
    summary: (a) => `벽 연장/자르기 (${a['end']}끝)`,
  },
];
