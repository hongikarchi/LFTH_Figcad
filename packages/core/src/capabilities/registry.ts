import type { DocStore } from '../store';
import { CAPABILITIES } from './catalog';
import type { Capability, CapabilityCategory } from './types';

/** id → Capability. 단일 조회 표면 */
export const REGISTRY: Map<string, Capability> = new Map(CAPABILITIES.map((c) => [c.id, c]));

export function getCapability(id: string): Capability | undefined {
  return REGISTRY.get(id);
}

export function listCapabilities(filter?: {
  category?: CapabilityCategory;
  aiExposed?: boolean;
}): Capability[] {
  let out = CAPABILITIES;
  if (filter?.category) out = out.filter((c) => c.category === filter.category);
  if (filter?.aiExposed !== undefined) out = out.filter((c) => c.aiExposed === filter.aiExposed);
  return out;
}

/** Anthropic 도구 정의 형태 (현 AI_TOOLS 형태 보존 — agent.ts가 그대로 매핑) */
export interface AiToolDef {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
  mutating: boolean;
}

/**
 * AI 도구 정의 생성. categories 지정 시 부분 노출(토큰 절약) 가능 —
 * 단 agent.ts의 system+tools ephemeral 캐시가 부분집합 변경 시 깨지므로 기본은 전체.
 */
export function buildAiTools(opts?: { categories?: CapabilityCategory[] }): AiToolDef[] {
  return CAPABILITIES.filter(
    (c) => c.aiExposed && (!opts?.categories || opts.categories.includes(c.category)),
  ).map((c) => ({
    name: c.id,
    description: c.descriptionKo,
    input_schema: c.inputSchema,
    mutating: c.mutating,
  }));
}

export function isMutatingCapability(id: string): boolean {
  return REGISTRY.get(id)?.mutating ?? false;
}

/** op 실행 — 미존재 시 'unknown op' throw (구 executeOp 계약 보존) */
export function runCapability(
  store: DocStore,
  id: string,
  args: Record<string, unknown>,
): unknown {
  const cap = REGISTRY.get(id);
  if (!cap) throw new Error(`unknown op: ${id}`);
  return cap.run(store, args);
}

export function capabilitySummary(id: string, args: Record<string, unknown>): string {
  const cap = REGISTRY.get(id);
  return cap?.summary ? cap.summary(args) : id;
}
