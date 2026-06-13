import { z } from 'zod';

/**
 * 문서 스키마 v1.
 * 단위: mm 정수 (좌표·치수 전부 — float 드리프트 방지, 파생 결정론).
 * 좌표계: 레벨 로컬 XY 평면. 렌더(Three, Y-up/m)로의 변환은 렌더 경계에서만.
 * 불변 규칙: 지오메트리는 여기 없다 — 항상 파라미터에서 파생.
 */

export const CORE_SCHEMA_VERSION = 1;

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

export const ElemTypeSchema = z.discriminatedUnion('kind', [
  WallTypeSchema,
  OpeningTypeSchema,
  SlabTypeSchema,
  ColumnTypeSchema,
  BeamTypeSchema,
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

export const ElementSchema = z.discriminatedUnion('kind', [
  WallElementSchema,
  OpeningElementSchema,
  SlabElementSchema,
  GridLineSchema,
  ColumnElementSchema,
  BeamElementSchema,
]);
export type Element = z.infer<typeof ElementSchema>;

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
