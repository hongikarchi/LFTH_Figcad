import type { DocStore } from '../store';
import type { Id, Pt, Section } from '../schema';

/**
 * Capability Registry (M8) — 모든 문서 변경/조회 기능의 단일 카탈로그.
 *
 * 기능 1개 = Capability 항목 1개. AI 도구 정의·executeOp·요약이 전부 여기서 자동 파생되고,
 * web UI(Toolbox/EditActions)는 capabilityId로 연결한다. "프론트 노출 vs AI가 꺼내쓰기"는
 * aiExposed/uiExposed 플래그로 결정 — 같은 카탈로그를 UI와 AI가 공유.
 *
 * 불변 규칙 2 준수: capability.run은 DocStore primitive(저수준 mutation)만 호출 —
 * raw Y.Map 쓰기 없음. primitive는 store.ts에 그대로 유지.
 */

export type CapabilityCategory =
  | 'query' // 비변경 조회 (get_document)
  | 'structure' // 벽·그리드·슬라브
  | 'opening' // 문·창
  | 'edit' // 이동/복사/배열/분할/연장/대칭/회전/수정/삭제
  | 'level' // 레벨(층)
  | 'annotation' // 치수·텍스트
  | 'type' // 타입(패밀리) 정의 — create_type
  | 'view'; // ui-action(B-P1) — 문서 무변경·비undo·비브로드캐스트, run=파라미터 해소만(클라 실행)
// 확장: 'interop' | 'version' (별 패키지/계약이라 강제 통합 금지)

export interface Capability {
  /** 안정 식별자 = AI 도구명·op명·UI 연결 키 (현 op 이름과 1:1, 예 'create_wall') */
  id: string;
  category: CapabilityCategory;
  /** UI 라벨 (한국어) */
  titleKo: string;
  /** AI 도구 설명 (현 AI_TOOLS description) */
  descriptionKo: string;
  /** 아이콘 키 (Phase C의 <Icon name>가 해석 — 레지스트리는 문자열만, JSX 없음) */
  icon?: string;
  /** Anthropic 도구 input_schema (손튜닝 JSON Schema — strict OFF, grammar 한도 회피) */
  inputSchema: Record<string, unknown>;
  /** true면 문서 변경 → opLog 기록 대상. false면 조회 전용 */
  mutating: boolean;
  /** AI 도구로 노출할지 (false = 의도적 범위제한, 예 타입 정의) */
  aiExposed: boolean;
  /** op 실행 — 서버 드라이런과 클라이언트 재생이 같은 코드를 탄다. 실패는 throw */
  run: (store: DocStore, args: Record<string, unknown>) => unknown;
  /** 계획 카드용 한 줄 한국어 요약 (mutating이면 권장) */
  summary?: (args: Record<string, unknown>) => string;
}

// --- JSON Schema 빌더 (현 ai.ts에서 이전) ---

export const ptSchema = (desc: string) => ({
  type: 'array',
  items: { type: 'integer' },
  description: `${desc} — [x, y] mm 정수 2개`,
});
export const idArrSchema = (desc: string) => ({
  type: 'array',
  items: { type: 'string' },
  description: desc,
});

// --- 런타임 인자 코어션 (현 ai.ts에서 이전 — float 관용: Math.round 보존) ---

export const asPt = (v: unknown): Pt => {
  if (!Array.isArray(v) || v.length !== 2 || typeof v[0] !== 'number' || typeof v[1] !== 'number')
    throw new Error('point must be [x, y]');
  return [Math.round(v[0]), Math.round(v[1])];
};
export const asIds = (v: unknown): Id[] => {
  if (!Array.isArray(v) || v.some((x) => typeof x !== 'string'))
    throw new Error('ids must be string[]');
  return v as Id[];
};
export const asStr = (v: unknown, name: string): string => {
  if (typeof v !== 'string') throw new Error(`${name} must be string`);
  return v;
};
export const asNum = (v: unknown, name: string): number => {
  if (typeof v !== 'number') throw new Error(`${name} must be number`);
  return v;
};
export const optNum = (v: unknown): number | undefined =>
  typeof v === 'number' ? v : undefined;

/** 단면 인자 코어션 — 수치는 float 관용(store가 quantize), 검증(구조·단순폴리곤)은 store가 최종 방어 */
export const asSection = (v: unknown, name: string): Section => {
  if (!v || typeof v !== 'object' || Array.isArray(v))
    throw new Error(`${name} must be a section object`);
  const o = v as Record<string, unknown>;
  switch (o['shape']) {
    case 'rect':
      return { shape: 'rect', width: asNum(o['width'], `${name}.width`), depth: asNum(o['depth'], `${name}.depth`) };
    case 'circle':
      return { shape: 'circle', diameter: asNum(o['diameter'], `${name}.diameter`) };
    case 'hsection':
      return {
        shape: 'hsection',
        width: asNum(o['width'], `${name}.width`),
        depth: asNum(o['depth'], `${name}.depth`),
        web: asNum(o['web'], `${name}.web`),
        flange: asNum(o['flange'], `${name}.flange`),
      };
    case 'polygon': {
      const raw = o['points'];
      if (!Array.isArray(raw)) throw new Error(`${name}.points must be [[x,y],...]`);
      return { shape: 'polygon', points: raw.map(asPt) };
    }
    default:
      throw new Error(`${name}.shape must be rect|circle|hsection|polygon`);
  }
};

// --- 요약 포맷 헬퍼 ---

export const fmtPt = (v: unknown): string => {
  if (Array.isArray(v) && v.length === 2) return `(${Number(v[0])}, ${Number(v[1])})`;
  return '?';
};
export const fmtLen = (a: unknown, b: unknown): string => {
  if (!Array.isArray(a) || !Array.isArray(b)) return '';
  const len = Math.hypot(Number(b[0]) - Number(a[0]), Number(b[1]) - Number(a[1]));
  return ` ${(len / 1000).toFixed(2)}m`;
};
