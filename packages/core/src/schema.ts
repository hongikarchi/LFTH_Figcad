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

export const LevelSchema = z.object({
  id: z.string(),
  name: z.string(),
  elevation: mm, // 레벨 바닥 높이 (전역 Z)
  height: mm, // 기본 층고 — 벽 height 미지정 시 사용
  order: z.number().int(),
});
export type Level = z.infer<typeof LevelSchema>;

export const WallTypeSchema = z.object({
  id: z.string(),
  kind: z.literal('wall'),
  name: z.string(),
  thickness: mm,
  color: z.string(), // 렌더 힌트 (#rrggbb)
  // IFC 무손실 export용 예약: materialLayers, axisCurve('line'|'arc')
});
export type WallType = z.infer<typeof WallTypeSchema>;

export const ElemTypeSchema = z.discriminatedUnion('kind', [WallTypeSchema]);
export type ElemType = z.infer<typeof ElemTypeSchema>;

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

export const ElementSchema = z.discriminatedUnion('kind', [WallElementSchema]);
export type Element = z.infer<typeof ElementSchema>;

export interface DocMeta {
  schemaVersion: number;
  projectName: string;
  units: 'mm';
}

/** 파생 입력의 스냅샷 — derive 함수는 이것만 본다 (순수성 보장) */
export interface WallDeriveInput {
  wall: WallElement;
  type: WallType;
  level: Level;
  /** 끝점 공유 이웃 (L자 마이터용). null = 자유 끝(사각 캡) */
  joins?: {
    a: import('./geometry/joins').JoinInfo | null;
    b: import('./geometry/joins').JoinInfo | null;
  };
}
