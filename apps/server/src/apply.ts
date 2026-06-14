import { applyOpLog, type DocStore, type OpLogEntry } from '@figcad/core';
import { CORS, isSafeRoom, json } from './version';

/**
 * M10 connector — 라이브 쓰기/읽기 API (Doc DO onRequest 경유).
 *   GET  ?op=pull            → 현재 라이브 문서 스냅샷 (commit 아님 — this.document 그대로)
 *   POST ?op=apply {ops}     → oplog를 서버측 DocStore에 적용 → onSave 영속 → {applied,failed,createdIds}
 *
 * 메커니즘(M9-C 검증): 서버측 `new DocStore(this.document)`(캐시) → applyOpLog → 변경이
 * YServer update 핸들러로 접속 WS 클라 전원에 전파(broadcast 스파이크). 무인 룸은 onSave로 영속.
 * MCP/JSON-RPC 군더더기 없는 평범한 oplog POST — Rhino 플러그인(D2)이 소비자.
 *
 * 안전: ?key= 게이트(WS 접속과 동일) · isSafeRoom · 단일스레드 DO 프리즈 방지 바운드
 * (ops≤2000 · body≤2MB · arg 배열≤4096). applyOpLog가 op마다 zod+런타임 검증(최종 방어선).
 *
 * 주의: applyOpLog는 op마다 별도 transact — 후속 op가 선행 op의 미러(예: 치수 바인딩의
 * bindFor, 개구부 hostId)를 봐야 하므로 단일 transact로 묶지 않는다(미러는 transact 끝에 갱신).
 */

const MAX_OPS = 2000;
const MAX_BODY = 2 * 1024 * 1024; // 2MB
const MAX_ARRAY = 4096; // 단일 op 인자 배열 길이 상한 (10만점 boundary 등 DO 프리즈 차단)

/** op 인자 안에 과도하게 긴 배열(점 폭탄)이 없나 — 단일스레드 DO 보호 */
function argsBounded(args: Record<string, unknown>): boolean {
  for (const v of Object.values(args)) {
    if (Array.isArray(v) && v.length > MAX_ARRAY) return false;
  }
  return true;
}

export async function handleConnectorRequest(
  request: Request,
  room: string,
  store: DocStore,
  persist: () => Promise<void>,
  roomKey: string | undefined,
): Promise<Response> {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  const url = new URL(request.url);
  if (roomKey && url.searchParams.get('key') !== roomKey) return json(401, { error: 'invalid key' });
  if (!isSafeRoom(room)) return json(400, { error: '허용되지 않는 룸 이름 (A-Za-z0-9_- 1~64자)' });

  const op = url.searchParams.get('op');

  // 라이브 스냅샷 읽기 (커넥터 Pull)
  if (op === 'pull' && request.method === 'GET') {
    return json(200, store.snapshot());
  }

  // oplog 적용 (커넥터 Push / 라이브 쓰기)
  if (op === 'apply' && request.method === 'POST') {
    const len = Number(request.headers.get('content-length') ?? '0');
    if (len > MAX_BODY) return json(413, { error: `요청 본문이 너무 큼 (최대 ${MAX_BODY}바이트)` });
    let body: { ops?: unknown };
    try {
      body = (await request.json()) as { ops?: unknown };
    } catch {
      return json(400, { error: '본문은 JSON {ops:[...]} 여야 함' });
    }
    const ops = body.ops;
    if (!Array.isArray(ops)) return json(400, { error: 'ops는 배열이어야 함' });
    if (ops.length > MAX_OPS) return json(413, { error: `op이 너무 많음 (최대 ${MAX_OPS})` });

    const log: OpLogEntry[] = [];
    for (const e of ops) {
      if (!e || typeof e !== 'object') return json(400, { error: '각 op = {op:string, args:object}' });
      const rec = e as Record<string, unknown>;
      const opName = rec['op'];
      const args = rec['args'];
      if (typeof opName !== 'string' || typeof args !== 'object' || args === null || Array.isArray(args))
        return json(400, { error: '각 op = {op:string, args:object}' });
      if (!argsBounded(args as Record<string, unknown>))
        return json(413, { error: `op 인자 배열이 너무 김 (최대 ${MAX_ARRAY})` });
      log.push({ op: opName, args: args as Record<string, unknown>, result: rec['result'] });
    }

    // op마다 별도 transact(applyOpLog 내부) — 후속 op가 선행 결과를 미러로 봄.
    // 비뮤테이팅 op는 applyOpLog가 스킵. 개별 실패는 failed로 보고(계속).
    const result = applyOpLog(store, log);
    await persist(); // 무인 룸도 즉시 영속 (접속 클라 없으면 자동 체크포인트 안 도므로)
    return json(200, result);
  }

  return json(400, { error: 'op은 apply(POST)/pull(GET) 중 하나' });
}
