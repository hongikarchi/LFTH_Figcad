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
        sagitta: {
          type: 'integer',
          description:
            '곡선 중심선 새지타 mm (현 a→b에서 호 정점까지 수직거리, 부호 = 휘는 쪽 / 생략·0 = 직선)',
        },
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
        ...(optNum(a['sagitta']) !== undefined ? { sagitta: optNum(a['sagitta'])! } : {}),
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
    id: 'create_zone',
    category: 'structure',
    titleKo: '존',
    icon: 'box',
    descriptionKo:
      '존(공간/룸) 생성. boundary는 단순 폴리곤 꼭짓점, name은 공간 이름. 면적·부피는 자동 계산(IfcSpace 대응). 타입 없음.',
    inputSchema: {
      type: 'object',
      properties: {
        levelId: { type: 'string', description: '레벨 id' },
        boundary: {
          type: 'array',
          items: { type: 'array', items: { type: 'integer' } },
          description: '폴리곤 꼭짓점 [[x,y],...] mm — 3개 이상, 자가교차 금지',
        },
        name: { type: 'string', description: '공간 이름 (예: 거실, 침실)' },
        number: { type: 'string', description: '실 번호 (선택)' },
        height: { type: 'integer', description: '공간 높이 mm (선택, 기본 = 층고)' },
      },
      required: ['levelId', 'boundary', 'name'],
      additionalProperties: false,
    },
    mutating: true,
    aiExposed: true,
    run: (store, a) => {
      const raw = a['boundary'];
      if (!Array.isArray(raw)) throw new Error('boundary must be [[x,y],...]');
      return store.createZone({
        levelId: asStr(a['levelId'], 'levelId'),
        boundary: raw.map(asPt),
        name: asStr(a['name'], 'name'),
        ...(a['number'] !== undefined ? { number: String(a['number']) } : {}),
        ...(optNum(a['height']) !== undefined ? { height: optNum(a['height'])! } : {}),
      });
    },
    summary: (a) => `존 생성 "${a['name'] ?? ''}" (꼭짓점 ${Array.isArray(a['boundary']) ? a['boundary'].length : 0}개)`,
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
  {
    id: 'create_column',
    category: 'structure',
    titleKo: '기둥',
    icon: 'column',
    descriptionKo:
      '기둥 생성 — at(평면 중심점 mm)에 typeId 단면(사각/원)으로 수직 압출. 높이 생략 시 레벨 층고. 그리드 교차점에 배치하는 것이 일반적.',
    inputSchema: {
      type: 'object',
      properties: {
        levelId: { type: 'string', description: '배치할 레벨(층) id' },
        typeId: { type: 'string', description: '기둥 타입 id (문서의 types에서 kind=column)' },
        at: ptSchema('단면 중심점'),
        height: { type: 'integer', description: '기둥 높이 mm (생략 시 레벨 층고)' },
      },
      required: ['levelId', 'typeId', 'at'],
      additionalProperties: false,
    },
    mutating: true,
    aiExposed: true,
    run: (store, a) =>
      store.createColumn({
        levelId: asStr(a['levelId'], 'levelId'),
        typeId: asStr(a['typeId'], 'typeId'),
        at: asPt(a['at']),
        ...(optNum(a['height']) !== undefined ? { height: optNum(a['height'])! } : {}),
      }),
    summary: (a) => `기둥 생성 ${fmtPt(a['at'])}`,
  },
  {
    id: 'create_beam',
    category: 'structure',
    titleKo: '보',
    icon: 'beam',
    descriptionKo:
      '보 생성 — a→b 중심축(mm)을 따라 typeId 단면 압출. zOffset(레벨 바닥 기준 중심축 높이) 생략 시 상단을 천장에 맞춤. 보통 기둥 머리를 잇는다.',
    inputSchema: {
      type: 'object',
      properties: {
        levelId: { type: 'string', description: '배치할 레벨(층) id' },
        typeId: { type: 'string', description: '보 타입 id (문서의 types에서 kind=beam)' },
        a: ptSchema('중심축 시작점'),
        b: ptSchema('중심축 끝점'),
        zOffset: { type: 'integer', description: '중심축 높이 mm (레벨 바닥 기준, 생략 시 천장 정렬)' },
      },
      required: ['levelId', 'typeId', 'a', 'b'],
      additionalProperties: false,
    },
    mutating: true,
    aiExposed: true,
    run: (store, a) =>
      store.createBeam({
        levelId: asStr(a['levelId'], 'levelId'),
        typeId: asStr(a['typeId'], 'typeId'),
        a: asPt(a['a']),
        b: asPt(a['b']),
        ...(optNum(a['zOffset']) !== undefined ? { zOffset: optNum(a['zOffset'])! } : {}),
      }),
    summary: (a) => `보 생성 ${fmtPt(a['a'])}→${fmtPt(a['b'])}${fmtLen(a['a'], a['b'])}`,
  },
  {
    id: 'create_curtainwall',
    category: 'structure',
    titleKo: '커튼월',
    icon: 'window',
    descriptionKo:
      '커튼월 생성 — a→b 베이스라인(mm)에 typeId(kind=curtainwall) 멀리언 단면으로 uSpacing(수직)·vSpacing(수평) 그리드 프레임. height 생략 시 층고.',
    inputSchema: {
      type: 'object',
      properties: {
        levelId: { type: 'string', description: '배치할 레벨 id' },
        typeId: { type: 'string', description: '커튼월 타입 id (kind=curtainwall)' },
        a: ptSchema('베이스라인 시작'),
        b: ptSchema('베이스라인 끝'),
        uSpacing: { type: 'integer', description: '수직 멀리언 간격 mm (베이스라인 방향)' },
        vSpacing: { type: 'integer', description: '수평 멀리언 간격 mm (높이 방향)' },
        height: { type: 'integer', description: '높이 mm (생략 시 층고)' },
        baseOffset: { type: 'integer', description: '바닥 높이 mm (레벨 기준, 생략 시 0)' },
      },
      required: ['levelId', 'typeId', 'a', 'b', 'uSpacing', 'vSpacing'],
      additionalProperties: false,
    },
    mutating: true,
    aiExposed: true,
    run: (store, a) =>
      store.createCurtainWall({
        levelId: asStr(a['levelId'], 'levelId'),
        typeId: asStr(a['typeId'], 'typeId'),
        a: asPt(a['a']),
        b: asPt(a['b']),
        uSpacing: optNum(a['uSpacing']) ?? 1500,
        vSpacing: optNum(a['vSpacing']) ?? 1500,
        ...(optNum(a['height']) !== undefined ? { height: optNum(a['height'])! } : {}),
        ...(optNum(a['baseOffset']) !== undefined ? { baseOffset: optNum(a['baseOffset'])! } : {}),
      }),
    summary: (a) => `커튼월 생성 ${fmtPt(a['a'])}→${fmtPt(a['b'])}${fmtLen(a['a'], a['b'])}`,
  },
  {
    id: 'create_stair',
    category: 'structure',
    titleKo: '계단',
    icon: 'stair',
    descriptionKo:
      '직선 계단 생성 — a(하단)→b(상단 평면 투영) 주행을 따라 한 층(level.height)을 오름. 단수는 주행÷타입 목표 단너비로 결정, 폭은 타입. baseOffset 생략 시 레벨 바닥.',
    inputSchema: {
      type: 'object',
      properties: {
        levelId: { type: 'string', description: '배치할 레벨(층) id — 이 층 높이만큼 오름' },
        typeId: { type: 'string', description: '계단 타입 id (kind=stair)' },
        a: ptSchema('주행 시작점(하단)'),
        b: ptSchema('주행 끝점(상단 평면 투영) — 방향+주행 길이'),
        baseOffset: { type: 'integer', description: '하단 바닥 높이 mm (레벨 기준, 생략 시 0)' },
      },
      required: ['levelId', 'typeId', 'a', 'b'],
      additionalProperties: false,
    },
    mutating: true,
    aiExposed: true,
    run: (store, a) =>
      store.createStair({
        levelId: asStr(a['levelId'], 'levelId'),
        typeId: asStr(a['typeId'], 'typeId'),
        a: asPt(a['a']),
        b: asPt(a['b']),
        ...(optNum(a['baseOffset']) !== undefined ? { baseOffset: optNum(a['baseOffset'])! } : {}),
      }),
    summary: (a) => `계단 생성 ${fmtPt(a['a'])}→${fmtPt(a['b'])}${fmtLen(a['a'], a['b'])}`,
  },
  {
    id: 'create_railing',
    category: 'structure',
    titleKo: '난간',
    icon: 'railing',
    descriptionKo:
      '난간 생성 — a→b 직선을 따라 포스트 균등 반복 + 상부레일. 높이·포스트 간격은 타입. baseOffset 생략 시 레벨 바닥.',
    inputSchema: {
      type: 'object',
      properties: {
        levelId: { type: 'string', description: '배치할 레벨(층) id' },
        typeId: { type: 'string', description: '난간 타입 id (kind=railing)' },
        a: ptSchema('시작점'),
        b: ptSchema('끝점'),
        baseOffset: { type: 'integer', description: '바닥 높이 mm (레벨 기준, 생략 시 0)' },
      },
      required: ['levelId', 'typeId', 'a', 'b'],
      additionalProperties: false,
    },
    mutating: true,
    aiExposed: true,
    run: (store, a) =>
      store.createRailing({
        levelId: asStr(a['levelId'], 'levelId'),
        typeId: asStr(a['typeId'], 'typeId'),
        a: asPt(a['a']),
        b: asPt(a['b']),
        ...(optNum(a['baseOffset']) !== undefined ? { baseOffset: optNum(a['baseOffset'])! } : {}),
      }),
    summary: (a) => `난간 생성 ${fmtPt(a['a'])}→${fmtPt(a['b'])}${fmtLen(a['a'], a['b'])}`,
  },
  {
    id: 'create_roof',
    category: 'structure',
    titleKo: '지붕',
    icon: 'roof',
    descriptionKo:
      '지붕 슬라브 생성 — boundary 폴리곤이 벽 위(level.elevation+height)에 놓임. slope 지정 시 단경사(dir=경사 방향 벡터, pitch=1000mm당 상승 mm), 생략 시 평지붕.',
    inputSchema: {
      type: 'object',
      properties: {
        levelId: { type: 'string', description: '레벨 id — 지붕은 이 층 벽 위에 놓임' },
        typeId: { type: 'string', description: '지붕 타입 id (kind=roof)' },
        boundary: {
          type: 'array',
          items: { type: 'array', items: { type: 'integer' } },
          description: '폴리곤 꼭짓점 [[x,y],...] mm — 3개 이상, 자가교차 금지',
        },
        baseOffset: { type: 'integer', description: '벽 위 기준 추가 오프셋 mm (생략 시 0)' },
        thicknessOverride: { type: 'integer', description: '두께 오버라이드 mm' },
        slope: {
          type: 'object',
          description: '단경사 — 생략 시 평지붕',
          properties: {
            dir: { type: 'array', items: { type: 'integer' }, description: '경사 방향 벡터 [x,y]' },
            pitch: { type: 'integer', description: '1000mm당 상승 mm (예: 200 = 1/5 경사)' },
          },
          required: ['dir', 'pitch'],
          additionalProperties: false,
        },
      },
      required: ['levelId', 'typeId', 'boundary'],
      additionalProperties: false,
    },
    mutating: true,
    aiExposed: true,
    run: (store, a) => {
      const raw = a['boundary'];
      if (!Array.isArray(raw)) throw new Error('boundary must be [[x,y],...]');
      let slope: { dir: [number, number]; pitch: number } | undefined;
      const s = a['slope'];
      if (s && typeof s === 'object') {
        const so = s as Record<string, unknown>;
        slope = { dir: asPt(so['dir']), pitch: asNum(so['pitch'], 'slope.pitch') };
      }
      return store.createRoof({
        levelId: asStr(a['levelId'], 'levelId'),
        typeId: asStr(a['typeId'], 'typeId'),
        boundary: raw.map(asPt),
        ...(optNum(a['baseOffset']) !== undefined ? { baseOffset: optNum(a['baseOffset'])! } : {}),
        ...(optNum(a['thicknessOverride']) !== undefined
          ? { thicknessOverride: optNum(a['thicknessOverride'])! }
          : {}),
        ...(slope !== undefined ? { slope } : {}),
      });
    },
    summary: (a) => {
      const n = Array.isArray(a['boundary']) ? a['boundary'].length : 0;
      return `지붕 생성 (꼭짓점 ${n}개${a['slope'] ? ', 경사' : ', 평'})`;
    },
  },

  // ===== annotation =====
  {
    id: 'create_dimension',
    category: 'annotation',
    titleKo: '치수',
    icon: 'dimension',
    descriptionKo:
      '치수선 생성 — a→b 두 점 측정. a/b가 요소 끝점(벽·기둥 등)과 mm-정확 일치하면 자동으로 바인딩되어 그 요소가 이동하면 치수도 따라간다(추종). 정확 좌표는 get_document로 확인. offset=치수선의 수직 standoff mm(부호, 기본 500).',
    inputSchema: {
      type: 'object',
      properties: {
        levelId: { type: 'string', description: '배치할 레벨(층) id' },
        a: ptSchema('측정 시작점 — 요소 끝점과 정확히 같으면 바인딩'),
        b: ptSchema('측정 끝점'),
        offset: { type: 'integer', description: '치수선 수직 거리 mm (부호, 생략 시 500)' },
      },
      required: ['levelId', 'a', 'b'],
      additionalProperties: false,
    },
    mutating: true,
    aiExposed: true,
    run: (store, a) =>
      store.createDimension({
        levelId: asStr(a['levelId'], 'levelId'),
        a: asPt(a['a']),
        b: asPt(a['b']),
        ...(optNum(a['offset']) !== undefined ? { offset: optNum(a['offset'])! } : {}),
      }),
    summary: (a) => `치수 ${fmtPt(a['a'])}→${fmtPt(a['b'])}${fmtLen(a['a'], a['b'])}`,
  },
  {
    id: 'create_text',
    category: 'annotation',
    titleKo: '텍스트',
    icon: 'text',
    descriptionKo:
      '텍스트 주석 생성 — 평면 한 점(at)에 문자열. 방 이름·메모 등. size=글자 크기 mm(생략 시 200).',
    inputSchema: {
      type: 'object',
      properties: {
        levelId: { type: 'string', description: '배치할 레벨(층) id' },
        at: ptSchema('텍스트 위치'),
        text: { type: 'string', description: '표시할 문자열' },
        size: { type: 'integer', description: '글자 크기 mm (생략 시 200)' },
      },
      required: ['levelId', 'at', 'text'],
      additionalProperties: false,
    },
    mutating: true,
    aiExposed: true,
    run: (store, a) =>
      store.createText({
        levelId: asStr(a['levelId'], 'levelId'),
        at: asPt(a['at']),
        text: asStr(a['text'], 'text'),
        ...(optNum(a['size']) !== undefined ? { size: optNum(a['size'])! } : {}),
      }),
    summary: (a) => `텍스트 '${a['text']}' ${fmtPt(a['at'])}`,
  },
  {
    id: 'create_label',
    category: 'annotation',
    titleKo: '레이블',
    icon: 'pencil',
    descriptionKo:
      '레이블(Revit 태그) 생성 — 참조 요소(targetId)의 속성 자동 표기. template: name=요소 이름/타입명, area=존/슬라브/지붕 면적(㎡), custom=customText. leader=지시선. 예: "이 존 면적 라벨" → targetId=존id, template=area.',
    inputSchema: {
      type: 'object',
      properties: {
        levelId: { type: 'string', description: '배치할 레벨(층) id' },
        at: ptSchema('레이블 위치'),
        targetId: { type: 'string', description: '참조 요소 id (생략 시 자유 custom 노트)' },
        template: {
          type: 'string',
          enum: ['name', 'area', 'custom'],
          description: 'name=이름/타입명, area=면적㎡(존/슬라브/지붕), custom=customText',
        },
        customText: { type: 'string', description: 'custom 템플릿 또는 고아 fallback 텍스트' },
        leader: { type: 'boolean', description: '지시선(at→타깃 중심) 표시' },
      },
      required: ['levelId', 'at', 'template'],
      additionalProperties: false,
    },
    mutating: true,
    aiExposed: true,
    run: (store, a) =>
      store.createLabel({
        levelId: asStr(a['levelId'], 'levelId'),
        at: asPt(a['at']),
        template: asStr(a['template'], 'template') as 'name' | 'area' | 'custom',
        ...(a['targetId'] !== undefined ? { targetId: String(a['targetId']) } : {}),
        ...(a['customText'] !== undefined ? { customText: String(a['customText']) } : {}),
        ...(a['leader'] !== undefined ? { leader: a['leader'] === true } : {}),
      }),
    summary: (a) => `레이블 (${a['template']}) ${fmtPt(a['at'])}`,
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
      '요소 필드 수정. kind에 맞는 필드만 사용: 벽=a/b/height/typeId, 개구부=offset/widthOverride/heightOverride/sillOverride, 슬라브=boundary/thicknessOverride, 그리드=a/b/label, 기둥=at/height/typeId.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: '요소 id' },
        a: ptSchema('시작점 (벽/그리드)'),
        b: ptSchema('끝점 (벽/그리드)'),
        at: ptSchema('단면 중심점 (기둥)'),
        height: { type: 'integer', description: '벽/기둥 높이 mm' },
        sagitta: { type: 'integer', description: '벽 곡선 새지타 mm (부호=휘는 쪽 / 0=직선)' },
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
