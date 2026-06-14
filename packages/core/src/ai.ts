import type { DocStore } from './store';
import type { Id } from './schema';
import { lint, type LintFinding } from './lint';
import {
  buildAiTools,
  isMutatingCapability,
  runCapability,
  capabilitySummary,
} from './capabilities/registry';

/**
 * M4 AI 모드 — Capability Registry 어댑터 + 드라이런/재생 공용 실행기.
 *
 * M8부터 도구 카탈로그는 capabilities/로 이전됨. 이 파일은 (a) 기존 AI_TOOLS/executeOp/
 * isMutatingOp/opSummary 이름·시그니처를 레지스트리에서 자동 파생하는 어댑터와
 * (b) 드라이런→재생 id 재매핑 로직(applyOpLog)을 유지한다 — agent.ts·AiPanel 무수정.
 *
 * 흐름: 서버가 문서 스냅샷으로 드라이런 DocStore를 만들고, Claude의 tool_use를
 * executeOp로 실제 적용하면서 OpLogEntry를 기록한다(모델이 일관된 세계를 봄).
 * 클라이언트는 승인 시 applyOpLog로 자기 스토어에 같은 op들을 재생한다 —
 * 재생 시 새로 발급되는 id가 다르므로 드라이런 id → 실제 id 재매핑을 수행한다.
 *
 * 불변 규칙 2 준수: 모든 변경은 DocStore ops 경유 (capability.run도 raw Y.Map 쓰기 없음).
 */

export interface OpLogEntry {
  op: string;
  /** 드라이런 시점 인자 (드라이런 id 포함 — 재생 시 재매핑) */
  args: Record<string, unknown>;
  /** 드라이런 실행 결과 (생성 id 등) — 재생 결과와 짝지어 id 매핑 구축 */
  result?: unknown;
}

/** AI 도구 정의 — 레지스트리에서 자동 생성 (aiExposed 필터). agent.ts가 그대로 매핑 */
export const AI_TOOLS = buildAiTools();

export function isMutatingOp(op: string): boolean {
  return isMutatingCapability(op);
}

/**
 * op 하나를 스토어에 실행 — 서버 드라이런과 클라이언트 재생이 같은 코드를 탄다.
 * 실패는 throw (서버는 tool_result is_error로 모델에 반환). 레지스트리로 위임.
 */
export function executeOp(store: DocStore, op: string, args: Record<string, unknown>): unknown {
  return runCapability(store, op, args);
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

/** opLog 엔트리 → 계획 카드용 한 줄 한글 요약 (레지스트리 summary 위임) */
export function opSummary(entry: OpLogEntry): string {
  return capabilitySummary(entry.op, entry.args);
}

// --- lint-in-loop critic (H3/H4) ---

/** opLog가 만든/건드린 요소 id 수집 (result 전체 + args.id/ids) — critic 범위 한정. */
function touchedFromOpLog(log: OpLogEntry[]): Set<string> {
  const out = new Set<string>();
  const walk = (v: unknown): void => {
    if (typeof v === 'string') out.add(v);
    else if (Array.isArray(v)) for (const x of v) walk(x);
    else if (v && typeof v === 'object') {
      const o = v as Record<string, unknown>;
      if (typeof o.id === 'string') out.add(o.id);
      if (Array.isArray(o.ids)) for (const x of o.ids) if (typeof x === 'string') out.add(x);
    }
  };
  for (const entry of log) {
    walk(entry.result);
    const a = entry.args;
    if (typeof a.id === 'string') out.add(a.id);
    if (Array.isArray(a.ids)) for (const x of a.ids) if (typeof x === 'string') out.add(x);
  }
  return out;
}

export interface Critique {
  errors: LintFinding[];
  warnings: LintFinding[];
}

/**
 * lint-in-loop critic 코어 — 결정적 lint로 스토어를 검사하되 opLog가 이번 턴
 * 건드린 요소만 비평한다(기존 이슈 잔소리 금지). 외부 결정적 검증자만 — LLM 판사 없음.
 * lint 예외는 빈 결과로 흡수(critic은 additive, 계획을 깨면 안 됨). 읽기전용 순수.
 */
export function critiqueOpLog(store: DocStore, log: OpLogEntry[]): Critique {
  if (log.length === 0) return { errors: [], warnings: [] };
  const touched = touchedFromOpLog(log);
  if (touched.size === 0) return { errors: [], warnings: [] };
  let findings: LintFinding[];
  try {
    findings = lint(store);
  } catch {
    return { errors: [], warnings: [] };
  }
  const mine = findings.filter((f) => f.elementIds.some((id) => touched.has(id)));
  return {
    errors: mine.filter((f) => f.severity === 'error'),
    warnings: mine.filter((f) => f.severity !== 'error'),
  };
}
