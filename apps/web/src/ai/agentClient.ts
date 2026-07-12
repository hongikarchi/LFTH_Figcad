import type { DocSnapshot, OpLogEntry } from '@figcad/core';
import type { ImportsManifest } from './importsManifest';
import { backendOrigin } from '../config/backend';

/**
 * /api/agent SSE 클라이언트 — 서버가 드라이런으로 만든 계획(opLog)을 받아온다.
 * 키는 서버 secret — 브라우저는 절대 Anthropic을 직접 호출하지 않는다.
 */

export interface TranscriptTurn {
  role: 'user' | 'assistant';
  text: string;
}

/** 서버 lint-in-loop critic이 직렬화해 보내는 결정적 검증 결과 (LintFinding 미러). */
export interface AiLintFinding {
  code: string;
  severity: 'error' | 'warning' | 'info';
  message: string;
  elementIds: string[];
  fix?: { label: string; deleteIds: string[] };
}

/** ui-action(B-P1) — 서버가 이름→id 해소를 마친 정규화 payload. 실행은 uiActionExecutor. */
export interface UiActionEntry {
  action: string;
  params: Record<string, unknown>;
  summary: string;
  /** 이 뷰 액션 시점까지의 문서 op 수 — 혼합 계획에서 승인 후 실행 순서 판단용 */
  opIndex: number;
}

export interface AgentResult {
  opLog: OpLogEntry[];
  stopReason: string;
  note?: string;
  /** 승인 게이트 직전 검증 결과 (warning/info + 미해결 error). */
  lintFindings?: AiLintFinding[];
  /** ui-action(뷰 조작) — opLog와 분리: 비영속·비undo. 순수 뷰 응답이면 즉시, 혼합이면 승인 후 실행. */
  uiActions?: UiActionEntry[];
}

function agentUrl(): string {
  const key = new URL(location.href).searchParams.get('key');
  return `${backendOrigin()}/api/agent${key ? `?key=${encodeURIComponent(key)}` : ''}`;
}

/** 손그림 스케치 첨부 — PNG base64 + 문서공간 mm 좌표 프레임 */
export interface SketchAttachment {
  dataB64: string;
  mediaType: 'image/png' | 'image/jpeg';
  frame: { x0: number; y0: number; x1: number; y1: number };
}

export async function runAgent(opts: {
  snapshot: DocSnapshot;
  transcript: TranscriptTurn[];
  onText: (delta: string) => void;
  onOp: (summary: string) => void;
  onUiAction?: (summary: string) => void; // 뷰 조작 진행 표시(라이브) — 실행은 done의 uiActions로
  onThinking?: (delta: string) => void; // 생각 과정(요약) — 임시 표시용, transcript 미저장
  onLint?: (round: number, findings: AiLintFinding[]) => void;
  sketch?: SketchAttachment | null;
  image?: { dataB64: string; mediaType: 'image/jpeg' | 'image/png' | 'image/webp' } | null;
  /** 연동 모델 매니페스트 — null/생략 = 필드 부재(구서버 동일 동작, sketch/image 패턴) */
  imports?: ImportsManifest | null;
  model?: string;
  signal?: AbortSignal;
}): Promise<AgentResult> {
  const res = await fetch(agentUrl(), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      snapshot: opts.snapshot,
      transcript: opts.transcript,
      ...(opts.sketch ? { sketch: opts.sketch } : {}),
      ...(opts.image ? { image: opts.image } : {}),
      ...(opts.imports ? { imports: opts.imports } : {}),
      ...(opts.model ? { model: opts.model } : {}),
    }),
    signal: opts.signal,
  });
  if (!res.ok || !res.body) {
    let msg = `요청 실패 (${res.status})`;
    try {
      const j = (await res.json()) as { error?: string };
      if (j.error) msg = j.error;
    } catch {
      /* JSON 아님 — 상태 코드 메시지 유지 */
    }
    throw new Error(msg);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  let result: AgentResult | null = null;

  const handle = (line: string) => {
    if (!line.startsWith('data: ')) return;
    const ev = JSON.parse(line.slice(6)) as Record<string, unknown>;
    switch (ev['type']) {
      case 'text':
        opts.onText(String(ev['text'] ?? ''));
        break;
      case 'op':
        opts.onOp(String(ev['summary'] ?? ev['op'] ?? ''));
        break;
      case 'ui':
        opts.onUiAction?.(String(ev['summary'] ?? ev['action'] ?? ''));
        break;
      case 'thinking':
        opts.onThinking?.(String(ev['text'] ?? ''));
        break;
      case 'lint':
        opts.onLint?.(
          Number(ev['round'] ?? 0),
          Array.isArray(ev['findings']) ? (ev['findings'] as AiLintFinding[]) : [],
        );
        break;
      case 'done':
        result = {
          opLog: (ev['opLog'] as OpLogEntry[]) ?? [],
          stopReason: String(ev['stopReason'] ?? 'end_turn'),
          ...(ev['note'] ? { note: String(ev['note']) } : {}),
          ...(Array.isArray(ev['lintFindings']) && ev['lintFindings'].length
            ? { lintFindings: ev['lintFindings'] as AiLintFinding[] }
            : {}),
          ...(Array.isArray(ev['uiActions']) && ev['uiActions'].length
            ? { uiActions: ev['uiActions'] as UiActionEntry[] }
            : {}),
        };
        break;
      case 'error':
        throw new Error(String(ev['error'] ?? 'agent error'));
    }
  };

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let idx;
    while ((idx = buf.indexOf('\n\n')) >= 0) {
      handle(buf.slice(0, idx).trim());
      buf = buf.slice(idx + 2);
    }
  }
  if (buf.trim()) handle(buf.trim());

  if (!result) throw new Error('스트림이 완료 이벤트 없이 종료됨');
  return result;
}
