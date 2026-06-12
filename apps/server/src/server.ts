import { routePartykitRequest, type Connection, type ConnectionContext } from 'partyserver';
import { YServer } from 'y-partyserver';

interface Env {
  Doc: DurableObjectNamespace;
  ASSETS: Fetcher;
  ROOM_KEY?: string;
}

/**
 * 프로젝트(문서)당 Durable Object 룸 하나. y-partyserver가 Yjs sync + awareness
 * 프로토콜을 처리한다. M0은 스텁 — M2에서 DO storage 영속화(onLoad/onSave) 추가.
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
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const party = await routePartykitRequest(request, env as unknown as Record<string, unknown>);
    if (party) return party;
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
