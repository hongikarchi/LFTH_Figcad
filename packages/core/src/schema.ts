import { z } from 'zod';

/**
 * 문서 스키마 v1.
 * 단위: mm 정수 (좌표·치수 전부 — float 드리프트 방지, 파생 결정론).
 * 좌표계: 레벨 로컬 XY 평면. 렌더(Three, Y-up/m)로의 변환은 렌더 경계에서만.
 * 불변 규칙: 지오메트리는 여기 없다 — 항상 파라미터에서 파생.
 */

export const CORE_SCHEMA_VERSION = 2; // v2 = 협업 코멘트 채널 추가 (v1 문서는 comments 부재→[] 호환)

export type Id = string;

// mm 정수 양자화 — 모든 좌표·치수는 ops 경계에서 이걸 통과한다
export const mm = z.number().int();
export const quantize = (v: number): number => Math.round(v);

export const Pt = z.tuple([mm, mm]); // [x, y] 레벨 로컬, mm
export type Pt = z.infer<typeof Pt>;

/**
 * 단면 — 기둥/보 공유 (CAD/Revit/ArchiCAD 패밀리의 프로필 개념).
 * rect = width(x)×depth(y), circle = 지름. 원은 derive에서 N각형 테셀레이션
 * (extrudeProfile 단일 경로 — CSG 불필요, 설계 원칙).
 */
export const SectionSchema = z.discriminatedUnion('shape', [
  z.object({ shape: z.literal('rect'), width: mm, depth: mm }),
  z.object({ shape: z.literal('circle'), diameter: mm }),
]);
export type Section = z.infer<typeof SectionSchema>;

export const LevelSchema = z.object({
  id: z.string(),
  name: z.string(),
  elevation: mm, // 레벨 바닥 높이 (전역 Z)
  height: mm, // 기본 층고 — 벽 height 미지정 시 사용
  order: z.number().int(),
});
export type Level = z.infer<typeof LevelSchema>;

// --- 타입 (패밀리/타입의 씨앗 — 정의 1회 저장, 인스턴스는 참조) ---

export const WallTypeSchema = z.object({
  id: z.string(),
  kind: z.literal('wall'),
  name: z.string(),
  thickness: mm,
  color: z.string(), // 렌더 힌트 (#rrggbb)
  // IFC 무손실 export용 예약: materialLayers, axisCurve('line'|'arc')
});
export type WallType = z.infer<typeof WallTypeSchema>;

export const OpeningTypeSchema = z.object({
  id: z.string(),
  kind: z.literal('opening'),
  name: z.string(),
  color: z.string(),
  opening: z.object({
    kind: z.enum(['door', 'window']),
    width: mm,
    height: mm,
    sillHeight: mm, // 문 = 0
  }),
});
export type OpeningType = z.infer<typeof OpeningTypeSchema>;

export const SlabTypeSchema = z.object({
  id: z.string(),
  kind: z.literal('slab'),
  name: z.string(),
  thickness: mm,
  color: z.string(),
});
export type SlabType = z.infer<typeof SlabTypeSchema>;

export const ColumnTypeSchema = z.object({
  id: z.string(),
  kind: z.literal('column'),
  name: z.string(),
  section: SectionSchema,
  color: z.string(),
});
export type ColumnType = z.infer<typeof ColumnTypeSchema>;

export const BeamTypeSchema = z.object({
  id: z.string(),
  kind: z.literal('beam'),
  name: z.string(),
  section: SectionSchema, // width=수평(축 직각), depth=수직(춤)
  color: z.string(),
});
export type BeamType = z.infer<typeof BeamTypeSchema>;

export const StairTypeSchema = z.object({
  id: z.string(),
  kind: z.literal('stair'),
  name: z.string(),
  width: mm, // 계단 폭
  riser: mm, // 목표 단높이 — 단수 결정 (단수 = round(총상승/riser), 실 단높이 = 총상승/단수)
  color: z.string(),
  // 디딤판 깊이(going)는 파생: 주행/단수 (a→b 길이를 단수로 나눔)
});
export type StairType = z.infer<typeof StairTypeSchema>;

export const RailingTypeSchema = z.object({
  id: z.string(),
  kind: z.literal('railing'),
  name: z.string(),
  height: mm, // 난간 높이 (상부레일 윗면)
  postSpacing: mm, // 포스트 간격 목표 — 끝맞춤 균등 재계산
  color: z.string(),
});
export type RailingType = z.infer<typeof RailingTypeSchema>;

export const RoofTypeSchema = z.object({
  id: z.string(),
  kind: z.literal('roof'),
  name: z.string(),
  thickness: mm,
  color: z.string(),
});
export type RoofType = z.infer<typeof RoofTypeSchema>;

export const ElemTypeSchema = z.discriminatedUnion('kind', [
  WallTypeSchema,
  OpeningTypeSchema,
  SlabTypeSchema,
  ColumnTypeSchema,
  BeamTypeSchema,
  StairTypeSchema,
  RailingTypeSchema,
  RoofTypeSchema,
]);
export type ElemType = z.infer<typeof ElemTypeSchema>;

// --- 요소 ---

export const WallElementSchema = z.object({
  id: z.string(),
  kind: z.literal('wall'),
  levelId: z.string(),
  typeId: z.string(),
  a: Pt, // 중심선 시작 (단일 세그먼트 — 연속 드로잉 = 벽 여러 개)
  b: Pt, // 중심선 끝
  height: mm.optional(), // 기본 = level.height
  baseOffset: mm.optional(), // 기본 0
  // props: {} — BIM pset 예약 (post-MVP)
});
export type WallElement = z.infer<typeof WallElementSchema>;

/** 개구부 — 벽에 호스트. 위치는 호스트 중심선 기준 (벽이 움직이면 따라감) */
export const OpeningElementSchema = z.object({
  id: z.string(),
  kind: z.literal('opening'),
  typeId: z.string(),
  hostId: z.string(), // 벽 id — 벽 삭제 시 연쇄 삭제
  offset: mm, // wall.a부터 개구부 중심까지 mm (파생 시 클램프)
  widthOverride: mm.optional(),
  heightOverride: mm.optional(),
  sillOverride: mm.optional(),
  flip: z.boolean().optional(), // 문 스윙 방향 (2D 도면 단계에서 사용)
});
export type OpeningElement = z.infer<typeof OpeningElementSchema>;

export const SlabElementSchema = z.object({
  id: z.string(),
  kind: z.literal('slab'),
  levelId: z.string(),
  typeId: z.string(),
  boundary: z.array(Pt).min(3), // 단순 폴리곤 (자가교차 금지 — ops에서 검증)
  thicknessOverride: mm.optional(),
});
export type SlabElement = z.infer<typeof SlabElementSchema>;

/** 구조 그리드 축선 — 레벨 무관(전 층 공통), 평면에서 표시+스냅 */
export const GridLineSchema = z.object({
  id: z.string(),
  kind: z.literal('grid'),
  label: z.string(), // 'A', 'B'… / '1', '2'…
  a: Pt,
  b: Pt,
});
export type GridLine = z.infer<typeof GridLineSchema>;

/** 기둥 — 평면 한 점(단면 중심)에서 수직 압출. 단면=타입, 위치·높이=인스턴스 */
export const ColumnElementSchema = z.object({
  id: z.string(),
  kind: z.literal('column'),
  levelId: z.string(),
  typeId: z.string(),
  at: Pt, // 단면 중심 (평면 mm)
  height: mm.optional(), // 기본 = level.height
  baseOffset: mm.optional(), // 기본 0
});
export type ColumnElement = z.infer<typeof ColumnElementSchema>;

/** 보 — 평면 두 점 사이 중심축을 따라 단면 압출. 단면=타입, 축·높이=인스턴스 */
export const BeamElementSchema = z.object({
  id: z.string(),
  kind: z.literal('beam'),
  levelId: z.string(),
  typeId: z.string(),
  a: Pt, // 중심축 시작 (평면 mm)
  b: Pt, // 중심축 끝
  zOffset: mm.optional(), // 중심축 높이(레벨 바닥 기준). 기본 = level.height - 단면높이/2 (상단을 천장에)
});
export type BeamElement = z.infer<typeof BeamElementSchema>;

/** 계단 — 평면 두 점 사이 직선 1주행. 단면 윤곽(계단 실루엣)을 폭으로 압출.
 *  단높이·단너비=타입(목표값, 단수 결정), 위치·주행=인스턴스. 총상승 = level.height */
export const StairElementSchema = z.object({
  id: z.string(),
  kind: z.literal('stair'),
  levelId: z.string(),
  typeId: z.string(),
  a: Pt, // 주행 시작 (하단 평면 mm)
  b: Pt, // 주행 끝 (상단 평면 투영) — 방향 + 주행 길이
  baseOffset: mm.optional(), // 하단 바닥 높이(레벨 기준). 기본 0
});
export type StairElement = z.infer<typeof StairElementSchema>;

/** 난간 — 평면 두 점 사이 직선. 포스트 균등 반복 + 상부레일. */
export const RailingElementSchema = z.object({
  id: z.string(),
  kind: z.literal('railing'),
  levelId: z.string(),
  typeId: z.string(),
  a: Pt,
  b: Pt,
  baseOffset: mm.optional(), // 바닥 높이(레벨 기준). 기본 0
});
export type RailingElement = z.infer<typeof RailingElementSchema>;

/** 경사 — dir=경사 방향(정수 벡터, derive에서 정규화), pitch=1000mm당 상승(mm). 평지붕=slope 생략 */
export const SlopeSchema = z.object({
  dir: Pt,
  pitch: mm,
});
export type Slope = z.infer<typeof SlopeSchema>;

/** 지붕 — 경계 폴리곤 슬라브. 벽 위(level.elevation+height)에 놓임. 평/단경사(slope). */
export const RoofElementSchema = z.object({
  id: z.string(),
  kind: z.literal('roof'),
  levelId: z.string(),
  typeId: z.string(),
  boundary: z.array(Pt).min(3), // 단순 폴리곤 (자가교차 금지 — ops 검증)
  baseOffset: mm.optional(), // 벽 위 기준 추가 오프셋. 기본 0
  thicknessOverride: mm.optional(),
  slope: SlopeSchema.optional(),
});
export type RoofElement = z.infer<typeof RoofElementSchema>;

/** 텍스트 주석 — 평면 한 점에 문자열. 타입 없음(주석은 패밀리 무관). */
export const TextElementSchema = z.object({
  id: z.string(),
  kind: z.literal('text'),
  levelId: z.string(),
  at: Pt, // 평면 위치 mm
  text: z.string(),
  size: mm.optional(), // 글자 크기 mm (기본 200)
});
export type TextElement = z.infer<typeof TextElementSchema>;

/** 치수 바인딩 — 참조 요소의 끝점(a/b)을 따라감 (이동 추종) */
export const DimBindSchema = z.object({
  id: z.string(),
  anchor: z.enum(['a', 'b']),
});
export type DimBind = z.infer<typeof DimBindSchema>;

/** 치수선 — 두 점 또는 요소 끝점 바인딩 측정. offset=치수선 수직 standoff(부호). */
export const DimensionElementSchema = z.object({
  id: z.string(),
  kind: z.literal('dimension'),
  levelId: z.string(),
  a: Pt, // 측정 시작 (바인딩 없거나 고아 시 fallback)
  b: Pt, // 측정 끝
  offset: mm.optional(), // 치수선 수직 거리(부호). 기본 500
  bindA: DimBindSchema.optional(), // a를 요소 끝점에 바인딩 (이동 추종)
  bindB: DimBindSchema.optional(),
});
export type DimensionElement = z.infer<typeof DimensionElementSchema>;

export const ElementSchema = z.discriminatedUnion('kind', [
  WallElementSchema,
  OpeningElementSchema,
  SlabElementSchema,
  GridLineSchema,
  ColumnElementSchema,
  BeamElementSchema,
  StairElementSchema,
  RailingElementSchema,
  RoofElementSchema,
  TextElementSchema,
  DimensionElementSchema,
]);
export type Element = z.infer<typeof ElementSchema>;

/**
 * 협업 코멘트 — 요소가 아닌 별도 채널(ydoc 'comments' 맵). 평면 id 엔트리:
 * 루트(parentId 없음) = 앵커 있는 코멘트, 답글 = parentId 참조.
 * 평면 구조라 동시 답글이 서로 클로버되지 않음(각 답글 = 새 키, 엔트리별 LWW).
 * 앵커: anchorId 지정 시 그 요소 끝점을 따라감(D2 resolveDimAnchor 재사용),
 * 요소 삭제(고아) 시 항상 보유한 fallback at으로 표시 — 위치 소실 없음.
 */
export const CommentSchema = z.object({
  id: z.string(),
  parentId: z.string().optional(), // 있으면 답글
  at: Pt, // fallback 위치 (mm) — 앵커 요소 삭제돼도 여기 표시
  levelId: z.string(), // 핀 높이(레벨 elevation)·평면 필터
  anchorId: z.string().optional(), // 추종할 요소 id (선택)
  anchorWhich: z.enum(['a', 'b']).optional(),
  author: z.string(),
  text: z.string(),
  ts: z.number().int(), // 작성 시각 epoch ms
  resolved: z.boolean().optional(), // 루트만 의미
});
export type Comment = z.infer<typeof CommentSchema>;

/**
 * 도면 뷰 — 요소가 아닌 별도 채널(ydoc 'views' 맵 예정). 2D 라인워크는 저장 안 함 —
 * 뷰 *정의*(절단높이·방향·범위·축척)만 파라미터로, 라인워크는 deriveDrawing으로 파생.
 * plan = 레벨 + 절단높이(평면). section/elevation = 절단선 a→b + 깊이(후속 슬라이스).
 */
export const DrawingViewSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.enum(['plan', 'section', 'elevation']),
  levelId: z.string().optional(), // plan: 절단할 레벨
  cutHeight: mm.optional(), // plan: 레벨 바닥 위 절단면 높이 (기본 1200)
  line: z.tuple([Pt, Pt]).optional(), // section/elevation: 절단/시선 선
  depth: mm.optional(), // section/elevation: 선 뒤 시야 깊이
  scale: z.number().int().optional(), // 1:N 축척 (기본 100)
});
export type DrawingView = z.infer<typeof DrawingViewSchema>;

export interface DocMeta {
  schemaVersion: number;
  projectName: string;
  units: 'mm';
}

// --- 파생 입력 스냅샷 (derive 순수성 보장) ---

export interface WallDeriveInput {
  wall: WallElement;
  type: WallType;
  level: Level;
  /** 끝점 공유 이웃 (L자 마이터용). null = 자유 끝(사각 캡) */
  joins?: {
    a: import('./geometry/joins').JoinInfo | null;
    b: import('./geometry/joins').JoinInfo | null;
  };
  /** 이 벽에 호스트된 개구부들 (구멍 + 리빌 생성) */
  openings?: { el: OpeningElement; type: OpeningType }[];
}

export interface OpeningDeriveInput {
  opening: OpeningElement;
  type: OpeningType;
  host: WallElement;
  hostType: WallType;
  level: Level;
}

export interface SlabDeriveInput {
  slab: SlabElement;
  type: SlabType;
  level: Level;
}

export interface ColumnDeriveInput {
  column: ColumnElement;
  type: ColumnType;
  level: Level;
}

export interface BeamDeriveInput {
  beam: BeamElement;
  type: BeamType;
  level: Level;
}

export interface StairDeriveInput {
  stair: StairElement;
  type: StairType;
  level: Level;
}

export interface RailingDeriveInput {
  railing: RailingElement;
  type: RailingType;
  level: Level;
}

export interface RoofDeriveInput {
  roof: RoofElement;
  type: RoofType;
  level: Level;
}

export interface TextDeriveInput {
  text: TextElement;
  level: Level;
}

export interface DimensionDeriveInput {
  dim: DimensionElement;
  level: Level;
  /** 해석된 끝점 (DeriveCache가 바인딩을 풀어 채움; 바인딩 없으면 dim.a/b) */
  a: Pt;
  b: Pt;
}

/** 개구부 유효 치수 (오버라이드 적용 + 호스트 안 클램프) — derive와 ops가 공유 */
export function resolveOpening(
  el: OpeningElement,
  type: OpeningType,
  host: WallElement,
  hostHeight: number,
): { offset: number; width: number; height: number; sill: number; hostLen: number } | null {
  const hostLen = Math.hypot(host.b[0] - host.a[0], host.b[1] - host.a[1]);
  const width = Math.min(el.widthOverride ?? type.opening.width, Math.max(hostLen - 100, 0));
  if (width < 50) return null;
  const sill = Math.max(el.sillOverride ?? type.opening.sillHeight, 0);
  const height = Math.min(el.heightOverride ?? type.opening.height, Math.max(hostHeight - sill - 50, 0));
  if (height < 50) return null;
  // 중심 offset을 벽 안쪽으로 클램프 (양끝 50mm 여유)
  const half = width / 2;
  const offset = Math.min(Math.max(el.offset, half + 50), Math.max(hostLen - half - 50, half + 50));
  return { offset, width, height, sill, hostLen };
}
