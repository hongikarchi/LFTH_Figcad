import { DurableObject } from 'cloudflare:workers';
import { routePartykitRequest, type Connection, type ConnectionContext } from 'partyserver';
import { YServer } from 'y-partyserver';
import * as Y from 'yjs';
import { handleAgentRequest } from './agent';

interface Env {
  Doc: DurableObjectNamespace;
  AgentRunner: DurableObjectNamespace;
  ASSETS: Fetcher;
  ROOM_KEY?: string;
  ANTHROPIC_API_KEY?: string;
}

// SQLite DO storage 값 크기 한계(2MB) 대비 — 안전한 청크 크기
const CHUNK_SIZE = 128 * 1024;
const CHUNK_PREFIX = 'doc:';

/**
 * 프로젝트(문서)당 Durable Object 룸 하나. y-partyserver가 Yjs sync + awareness
 * 프로토콜을 처리하고, onLoad/onSave 훅으로 DO storage에 문서를 영속화한다
 * (YServer는 자동 영속화 없음 — 훅 구현 필수).
 *
 * 접속: wss://<host>/parties/doc/<projectId>?key=<ROOM_KEY>
 */
export class Doc extends YServer<Env> {
  override async onConnect(conn: Connection, ctx: ConnectionContext): Promise<void> {
    const expected = this.env.ROOM_KEY;
    if (expected) {
      const key = new URL(ctx.request.url).searchParams.get('key');
      if (key !== expected) {
        conn.close(4001, 'invalid key');
        return;
      }
    }
    await super.onConnect(conn, ctx);
  }

  override async onLoad(): Promise<void> {
    const stored = await this.ctx.storage.list<Uint8Array>({ prefix: CHUNK_PREFIX });
    if (stored.size === 0) return;
    // doc:0, doc:1, ... 순서로 이어붙여 복원
    const chunks: Uint8Array[] = [];
    for (let i = 0; i < stored.size; i++) {
      const c = stored.get(`${CHUNK_PREFIX}${i}`);
      if (!c) break;
      chunks.push(c);
    }
    const total = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
    let off = 0;
    for (const c of chunks) {
      total.set(c, off);
      off += c.length;
    }
    Y.applyUpdate(this.document, total);
  }

  override async onSave(): Promise<void> {
    const update = Y.encodeStateAsUpdate(this.document);
    const writes: Record<string, Uint8Array> = {};
    let count = 0;
    for (let off = 0; off < update.length; off += CHUNK_SIZE) {
      writes[`${CHUNK_PREFIX}${count++}`] = update.slice(off, off + CHUNK_SIZE);
    }
    // 문서가 줄어 청크 수가 감소했을 때 잔여 키 정리
    const existing = await this.ctx.storage.list<Uint8Array>({ prefix: CHUNK_PREFIX });
    const stale = [...existing.keys()].filter((k) => !(k in writes));
    if (stale.length) await this.ctx.storage.delete(stale);
    if (count > 0) await this.ctx.storage.put(writes);
  }
}

/**
 * AI 에이전트 실행 전용 DO — 미국(wnam)에 위치 고정.
 *
 * 워커 fetch 핸들러는 사용자 근접 PoP에서 실행되는데, 아시아에서는 egress가
 * 홍콩으로 잡히는 경우가 있고 Anthropic은 미지원 지역 요청을 403
 * "Request not allowed"로 차단한다 (직접 호출은 정상인데 워커만 403이던 원인).
 * DO의 서브리퀘스트는 DO가 떠 있는 콜로에서 나가므로, 지원 지역에 고정된
 * 이 DO를 경유하면 결정적으로 회피된다 (Smart Placement는 휴리스틱이라 비채택).
 */
export class AgentRunner extends DurableObject<Env> {
  override async fetch(request: Request): Promise<Response> {
    return handleAgentRequest(request, this.env);
  }
}

/** 단일 인스턴스 — 자연스러운 직렬화 지점 (추후 레이트리밋 자리) */
function agentRunnerStub(env: Env): { fetch: (req: Request) => Promise<Response> } {
  const id = env.AgentRunner.idFromName('global');
  // locationHint는 최초 생성 시에만 적용 — 이후엔 그 콜로에 상주
  return env.AgentRunner.get(id, { locationHint: 'wnam' }) as unknown as {
    fetch: (req: Request) => Promise<Response>;
  };
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (new URL(request.url).pathname === '/api/agent') {
      return agentRunnerStub(env).fetch(request);
    }
    const party = await routePartykitRequest(request, env as unknown as Record<string, unknown>);
    if (party) return party;
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
