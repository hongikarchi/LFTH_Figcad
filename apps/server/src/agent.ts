import Anthropic from '@anthropic-ai/sdk';
import {
  DocStore,
  AI_TOOLS,
  executeOp,
  isMutatingOp,
  opSummary,
  type DocSnapshot,
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
 * API 키는 Cloudflare secret(ANTHROPIC_API_KEY) — 브라우저 노출 금지.
 */

interface AgentEnv {
  ANTHROPIC_API_KEY?: string;
  ROOM_KEY?: string;
}

interface TranscriptTurn {
  role: 'user' | 'assistant';
  text: string;
}

interface AgentRequestBody {
  snapshot: DocSnapshot;
  transcript: TranscriptTurn[];
}

const MODEL = 'claude-opus-4-8';
const MAX_ITERATIONS = 12;
const MAX_TOKENS = 16000;

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
평면 레이아웃·벽·문/창·슬라브·구조 그리드·레벨까지만. 입면 디자인/재료 미학 판단/구조 계산은 정중히 거절하고 범위를 안내하라.`;

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
  messages.push({
    role: 'user',
    content: `<현재_문서_상태>\n${JSON.stringify(body.snapshot)}\n</현재_문서_상태>\n\n${last.text}`,
  });

  const tools: Anthropic.ToolUnion[] = AI_TOOLS.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.input_schema as Anthropic.Tool.InputSchema,
    strict: true,
  }));

  const opLog: OpLogEntry[] = [];
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
          model: MODEL,
          max_tokens: MAX_TOKENS,
          thinking: { type: 'adaptive' },
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
        const msg = await stream.finalMessage();

        if (msg.stop_reason === 'pause_turn') {
          messages.push({ role: 'assistant', content: msg.content });
          continue;
        }
        if (msg.stop_reason !== 'tool_use') {
          await send({ type: 'done', opLog, stopReason: msg.stop_reason });
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
          await send({
            type: 'done',
            opLog,
            stopReason: 'max_iterations',
            note: '루프 상한 도달 — 계획이 잘렸을 수 있음',
          });
        }
      }
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
