import Anthropic from '@anthropic-ai/sdk';
import {
  DocStore,
  AI_TOOLS,
  critiqueOpLog,
  executeOp,
  isMutatingOp,
  opSummary,
  type DocSnapshot,
  type LintFinding,
  type OpLogEntry,
} from '@figcad/core';

/**
 * M4 AI 모드 — 스테이트리스 에이전트 엔드포인트 (POST /api/agent).
 *
 * 드라이런 계획 패턴: 문서 스냅샷으로 인메모리 DocStore를 만들고, Claude의
 * 도구 호출을 거기에 실제 적용하면서 opLog를 기록한다(모델이 자기 변경이 반영된
 * 일관된 세계를 봄). 문서 자체는 건드리지 않는다 — 클라이언트가 계획을 승인하면
 * 자기 스토어에 opLog를 재생하고 Yjs가 전파한다.
 *
 * 응답: SSE 스트림 — {type:'text'|'op'|'done'|'error'} 이벤트.
 * API 키는 서버 환경변수/secret(ANTHROPIC_API_KEY) — 브라우저 노출 금지.
 */

interface AgentEnv {
  ANTHROPIC_API_KEY?: string;
  ROOM_KEY?: string;
}

interface TranscriptTurn {
  role: 'user' | 'assistant';
  text: string;
}

interface SketchAttachment {
  dataB64: string;
  mediaType: 'image/png' | 'image/jpeg';
  frame: { x0: number; y0: number; x1: number; y1: number };
}

interface AgentRequestBody {
  snapshot: DocSnapshot;
  transcript: TranscriptTurn[];
  sketch?: SketchAttachment;
  model?: string; // allowlist 검증, 미지정/불허 시 DEFAULT_MODEL
  maxTokens?: number; // [1024, per-model 상한] clamp
}

const MAX_SKETCH_B64 = 8_000_000; // ~6MB 디코드 — 클라는 ≤1024px PNG라 훨씬 작음

const MAX_ITERATIONS = 12;
const DEFAULT_MODEL = 'claude-opus-4-8';
const DEFAULT_MAX_TOKENS = 16000;
// 모델 allowlist (보안 — 임의 model 문자열 거부, fallback opus). 속도 = 모델 선택.
// 빠름(Haiku 4.5)은 adaptive thinking 미지원 → disabled (4.6+만 adaptive).
const MODEL_ALLOWLIST = {
  'claude-opus-4-8': { thinking: { type: 'adaptive', display: 'summarized' }, maxOut: 128000 },
  'claude-sonnet-4-6': { thinking: { type: 'adaptive', display: 'summarized' }, maxOut: 64000 },
  'claude-haiku-4-5-20251001': { thinking: { type: 'disabled' }, maxOut: 64000 },
} as const;
// lint-in-loop critic — 모델이 끝났다고 선언하면 결정적 lint로 자기 변경을 검사하고
// error가 있으면 재프롬프트한다. 이 상한이 무한 critic 루프를 막는다 (H3/H4: 외부
// 결정적 검증자만 사용, LLM 판사 없음 — CRITIC/Kamoi 근거).
const MAX_CRITIC_ROUNDS = 2;

const SYSTEM_PROMPT = `당신은 Figcad(웹 기반 협업 건축 BIM 모델러)의 AI 모델링 어시스턴트다. 한국 소규모 건축사무소의 건축사들이 사용한다.

## 문서 모델
- 단위: 전부 mm 정수. 평면 좌표 [x, y] — x는 동쪽(오른쪽), y는 북쪽(위).
- 벽: 중심선 a→b + 높이. 두께/색은 벽 타입(typeId)이 결정.
- 벽 끝점이 다른 벽 끝점과 정확히 일치하면 자동 마이터 조인 — 방을 만들 땐 모서리 좌표를 정확히 공유시켜라.
- 개구부(문/창): 벽에 호스트, offset = 벽 a끝→개구부 중심 거리. 문 타입은 sillHeight 0, 창은 900 등.
- 슬라브: 단순 폴리곤 boundary, 상면이 레벨 elevation.
- 레벨(층): elevation = 바닥 전역 높이. 2층 elevation = 1층 층고.
- 요소 생성 시 문서에 이미 있는 levelId/typeId를 사용하라 (get_document 결과나 제공된 스냅샷 참조).

## 작업 방식
- 사용자의 요청이 치수·위치·층 등에서 애매하면 도구를 호출하지 말고 먼저 한국어로 구체적인 역질문을 하라 (예: "천장고는 2400로 할까요?"). 단, 일반적인 관례로 합리적 기본값을 정할 수 있으면 가정을 명시하고 진행하라.
- 도구 호출은 즉시 적용되지 않는다 — 사용자가 계획을 검토 후 승인해야 실제 문서에 반영된다. 따라서 안심하고 전체 작업을 도구 호출로 구성하라.
- 한국 주거 관례 참고: 벽 높이(층고) 2800~3000, 천장고 2300~2400, 문 900×2100, 창대 900, 복도 폭 1200+, 침실 3000×3000+.
- 응답은 한국어로 간결하게. 작업을 마치면 무엇을 만들었는지 치수와 함께 1~3문장으로 요약하라.

## 범위
평면 레이아웃·벽·문/창·슬라브·구조 그리드·레벨까지만. 입면 디자인/재료 미학 판단/구조 계산은 정중히 거절하고 범위를 안내하라.

## 손그림 스케치 (이미지 첨부 시)
- 첨부 이미지는 손으로 그린 평면 스케치다. 선 = 벽 중심선으로 해석하라.
- 함께 주어지는 mm 좌표 프레임으로 스케일·위치를 맞춰라: 이미지 가로 범위 x∈[x0,x1]mm(왼→오른=동), 세로 범위 y∈[y0,y1]mm(아래→위=북). 이미지는 북쪽이 위로 오도록 그려져 있다.
- 스케치는 손그림이라 부정확하다 — 직각·평행·정렬을 합리적으로 정돈하고, 방 모서리에서 벽 끝점 좌표를 정확히 공유시켜 마이터 조인이 되게 하라. 명백히 닫힌 방이면 닫아라.
- 치수가 적혀 있으면 그 값을 우선하고, 없으면 프레임 스케일로 추정하되 한국 주거 관례로 합리화하라.`;

const sseHeaders = {
  'content-type': 'text/event-stream; charset=utf-8',
  'cache-control': 'no-cache',
  connection: 'keep-alive',
};

const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });

const serializeFinding = (f: LintFinding) => ({
  code: f.code,
  severity: f.severity,
  message: f.message,
  elementIds: f.elementIds,
  fix: f.fix ? { label: f.fix.label, deleteIds: f.fix.deleteIds } : undefined,
});

/** critic 재프롬프트 — error finding을 관찰로 환류 (lint message는 이미 한국어). */
function criticPrompt(errors: LintFinding[]): string {
  const lines = errors
    .map(
      (f) =>
        `- [${f.code}] ${f.message} · 요소 id: ${f.elementIds.join(', ')}${
          f.fix ? ` · 제안: ${f.fix.label}` : ''
        }`,
    )
    .join('\n');
  return `<자동검증_lint>\n방금 만들거나 수정한 요소에서 결정적 규칙 위반(error)이 발견됐다. 아래를 실제로 고친 뒤 작업을 마쳐라(좌표·호스트·중복을 도구 호출로 수정 — 추측 금지). 정말 못 고치면 한국어로 이유를 한 줄 설명하라:\n${lines}\n</자동검증_lint>`;
}

export async function handleAgentRequest(request: Request, env: AgentEnv): Promise<Response> {
  if (request.method !== 'POST') return json(405, { error: 'POST only' });

  // 룸과 동일한 공유 키 검사 (?key=)
  if (env.ROOM_KEY) {
    const key = new URL(request.url).searchParams.get('key');
    if (key !== env.ROOM_KEY) return json(401, { error: 'invalid key' });
  }

  if (!env.ANTHROPIC_API_KEY) {
    return json(503, {
      error: 'AI 모드 미설정 — 서버에 ANTHROPIC_API_KEY secret이 없습니다 (wrangler secret put ANTHROPIC_API_KEY)',
    });
  }

  let body: AgentRequestBody;
  try {
    body = (await request.json()) as AgentRequestBody;
    if (!body.snapshot || !Array.isArray(body.transcript) || body.transcript.length === 0)
      throw new Error('bad body');
    if (body.transcript[body.transcript.length - 1]!.role !== 'user')
      throw new Error('last turn must be user');
  } catch {
    return json(400, { error: 'body must be { snapshot, transcript: [...] } (마지막 턴 user)' });
  }

  // 모델 resolve — allowlist 검증(임의 문자열 거부) + maxTokens clamp
  const model =
    typeof body.model === 'string' && body.model in MODEL_ALLOWLIST
      ? (body.model as keyof typeof MODEL_ALLOWLIST)
      : DEFAULT_MODEL;
  const modelCfg = MODEL_ALLOWLIST[model];
  const maxTokens = Math.max(
    1024,
    Math.min(modelCfg.maxOut, Number.isFinite(body.maxTokens) ? Number(body.maxTokens) : DEFAULT_MAX_TOKENS),
  );

  // 드라이런 스토어 — 요청마다 독립, 문서 원본은 무변경
  let dryStore: DocStore;
  try {
    dryStore = DocStore.fromSnapshot(body.snapshot);
  } catch (e) {
    return json(400, { error: `snapshot 파싱 실패: ${e instanceof Error ? e.message : e}` });
  }

  const anthropic = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });

  // 대화 재구성: 과거 턴은 텍스트만(도구 블록 재전송 없음 — 단순·캐시 친화),
  // 마지막 user 턴에 현재 문서 스냅샷을 동봉 (항상 최신 상태 기준으로 계획).
  const turns = body.transcript;
  const messages: Anthropic.MessageParam[] = turns.slice(0, -1).map((t) => ({
    role: t.role,
    content: t.text,
  }));
  const last = turns[turns.length - 1]!;
  const docBlock = `<현재_문서_상태>\n${JSON.stringify(body.snapshot)}\n</현재_문서_상태>`;

  // 스케치 첨부 검증 — 유효하면 이미지 블록을 먼저(권장 순서), 텍스트에 좌표 프레임 동봉
  const sk = body.sketch;
  const sketchOk =
    sk &&
    (sk.mediaType === 'image/png' || sk.mediaType === 'image/jpeg') &&
    typeof sk.dataB64 === 'string' &&
    sk.dataB64.length > 0 &&
    sk.dataB64.length < MAX_SKETCH_B64 &&
    sk.frame &&
    [sk.frame.x0, sk.frame.y0, sk.frame.x1, sk.frame.y1].every((n) => Number.isFinite(n));

  if (sketchOk) {
    const f = sk!.frame;
    const frameNote = `<스케치_좌표_프레임>\n이미지 범위: x∈[${f.x0}, ${f.x1}]mm (왼→오른=동), y∈[${f.y0}, ${f.y1}]mm (아래→위=북). 이미지는 북쪽이 위. 선을 벽 중심선으로 해석해 이 mm 좌표로 생성하라.\n</스케치_좌표_프레임>`;
    messages.push({
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: sk!.mediaType, data: sk!.dataB64 } },
        { type: 'text', text: `${docBlock}\n\n${frameNote}\n\n${last.text}` },
      ],
    });
  } else {
    messages.push({ role: 'user', content: `${docBlock}\n\n${last.text}` });
  }

  // strict:true 미사용 — 도구 16종 합산 시 "compiled grammar is too large" 400.
  // 어차피 executeOp가 zod+런타임 검증을 전부 하고 실패는 tool_result로 모델에
  // 돌아가 재시도되므로 스키마 강제 없이도 안전하다.
  const tools: Anthropic.ToolUnion[] = AI_TOOLS.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.input_schema as Anthropic.Tool.InputSchema,
  }));

  const opLog: OpLogEntry[] = [];
  let criticRounds = 0;
  let sentDone = false; // 스트림이 done 없이 닫히면 클라가 throw — 모든 종료 경로 커버 안전망
  const encoder = new TextEncoder();
  const { readable, writable } = new TransformStream<Uint8Array>();
  const writer = writable.getWriter();
  const send = (event: Record<string, unknown>) =>
    writer.write(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));

  // 루프는 백그라운드에서 — 응답 스트림은 즉시 반환
  (async () => {
    try {
      for (let i = 0; i < MAX_ITERATIONS; i++) {
        const stream = anthropic.messages.stream({
          model,
          max_tokens: maxTokens,
          thinking: modelCfg.thinking,
          system: [
            {
              type: 'text',
              text: SYSTEM_PROMPT,
              // tools → system 순서로 렌더 — 여기 브레이크포인트가 둘 다 캐시
              cache_control: { type: 'ephemeral' },
            },
          ],
          tools,
          messages,
        });
        stream.on('text', (delta) => {
          void send({ type: 'text', text: delta });
        });
        // 생각 과정(요약) 스트림 — 클라가 임시 표시(transcript 미저장). adaptive(opus/sonnet)만 발화.
        stream.on('thinking', (delta) => {
          void send({ type: 'thinking', text: delta });
        });
        const msg = await stream.finalMessage();

        if (msg.stop_reason === 'pause_turn') {
          messages.push({ role: 'assistant', content: msg.content });
          continue;
        }
        if (msg.stop_reason !== 'tool_use') {
          // lint-in-loop critic — 모델이 끝났다 선언: 승인 게이트 직전 결정적 검증.
          // 마지막 iteration(i===MAX-1)에선 재프롬프트 금지 — 고칠 예산이 없는데
          // continue하면 루프가 done 없이 종료된다. 대신 미해결 error를 done에 실어 통지.
          const critique = critiqueOpLog(dryStore, opLog);
          if (
            critique.errors.length > 0 &&
            criticRounds < MAX_CRITIC_ROUNDS &&
            i < MAX_ITERATIONS - 1
          ) {
            criticRounds++;
            await send({
              type: 'lint',
              round: criticRounds,
              findings: critique.errors.map(serializeFinding),
            });
            messages.push({ role: 'assistant', content: msg.content });
            messages.push({ role: 'user', content: criticPrompt(critique.errors) });
            continue; // 모델에 수정 기회 (end-of-loop 재프롬프트)
          }
          await send({
            type: 'done',
            opLog,
            stopReason: msg.stop_reason,
            lintFindings: [...critique.errors, ...critique.warnings].map(serializeFinding),
          });
          sentDone = true;
          break;
        }

        // 도구 호출 → 드라이런 스토어에 적용 + opLog 기록
        messages.push({ role: 'assistant', content: msg.content });
        const results: Anthropic.ToolResultBlockParam[] = [];
        for (const block of msg.content) {
          if (block.type !== 'tool_use') continue;
          const args = (block.input ?? {}) as Record<string, unknown>;
          try {
            const result = executeOp(dryStore, block.name, args);
            if (isMutatingOp(block.name)) {
              const entry: OpLogEntry = { op: block.name, args, result };
              opLog.push(entry);
              await send({ type: 'op', op: block.name, summary: opSummary(entry) });
            }
            results.push({
              type: 'tool_result',
              tool_use_id: block.id,
              content: result === null ? 'ok' : JSON.stringify(result),
            });
          } catch (e) {
            results.push({
              type: 'tool_result',
              tool_use_id: block.id,
              content: e instanceof Error ? e.message : String(e),
              is_error: true,
            });
          }
        }
        messages.push({ role: 'user', content: results });

        if (i === MAX_ITERATIONS - 1) {
          const critique = critiqueOpLog(dryStore, opLog);
          await send({
            type: 'done',
            opLog,
            stopReason: 'max_iterations',
            note: '루프 상한 도달 — 계획이 잘렸을 수 있음',
            lintFindings: [...critique.errors, ...critique.warnings].map(serializeFinding),
          });
          sentDone = true;
        }
      }
      // 안전망 — 어떤 종료 경로도 done을 못 보냈으면(예: 마지막 턴 pause_turn) 여기서 보냄
      if (!sentDone) await send({ type: 'done', opLog, stopReason: 'incomplete' });
    } catch (e) {
      await send({ type: 'error', error: e instanceof Error ? e.message : String(e) }).catch(
        () => {},
      );
    } finally {
      await writer.close().catch(() => {});
    }
  })();

  return new Response(readable, { headers: sseHeaders });
}
