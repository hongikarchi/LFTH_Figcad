import {
  applyOpLog,
  createOpContentKey,
  elementContentKey,
  type DocStore,
  type OpLogEntry,
} from '@figcad/core';
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
 * (ops≤2000 · body≤2MB · 최상위 arg 배열≤2000 · **배치 총작업 예산**). applyOpLog가 op마다
 * zod+런타임 검증(최종 방어선). DoS 핵심: 바운드는 차원별 독립이라 곱(ops×ids×count)이 폭발 →
 * opWork 예산으로 배치 총 반복/생성 수를 사전 캡(array_elements count 폭탄·2000×ids 곱 차단).
 *
 * 주의: applyOpLog는 op마다 별도 transact — 후속 op가 선행 op의 미러(예: 치수 바인딩의
 * bindFor, 개구부 hostId)를 봐야 하므로 단일 transact로 묶지 않는다(미러는 transact 끝에 갱신).
 *
 * 한계(의도): 커넥터 쓰기는 user-less·**undo 불가**(LOCAL_ORIGIN 아님 — 클라 Ctrl+Z 추적 안 됨).
 * delete 포함 파괴적 op도 적용됨. 복구 = M6 버전 복원. 결정적 커넥터 surface라 수용.
 * 레이트리밋·per-room 쿼터 = v1.5.
 */

const MAX_OPS = 2000;
const MAX_BODY = 2 * 1024 * 1024; // 2MB
const MAX_ARRAY = 2000; // 최상위 arg 배열 길이 상한 (boundary 점수·ids — isSimplePolygon O(n²) 캡)
const WORK_BUDGET = 50_000; // 배치 총 작업(생성·반복) 상한 — count·ids·ops 곱 폭발 차단

/** **최상위** array 인자만 검사 (카탈로그의 array 인자 = ids/boundary 전부 최상위). 중첩 배열은
 *  asPt 등이 op별로 거부. 진짜 폭주 방어는 MAX_BODY + opWork 예산. */
function argsBounded(args: Record<string, unknown>): boolean {
  for (const v of Object.values(args)) {
    if (Array.isArray(v) && v.length > MAX_ARRAY) return false;
  }
  return true;
}

/** op의 보수적 작업량 상한 — 배치 총합이 WORK_BUDGET 넘으면 거부(실행 전). */
function opWork(op: string, args: Record<string, unknown>): number {
  const ids = Array.isArray(args['ids']) ? (args['ids'] as unknown[]).length : 0;
  const boundary = Array.isArray(args['boundary']) ? (args['boundary'] as unknown[]).length : 0;
  if (op === 'array_elements') {
    const count = typeof args['count'] === 'number' ? (args['count'] as number) : 1;
    return Math.max(ids, 1) * Math.max(count, 1); // 빈 ids도 count번 반복(transformCopy([]))
  }
  if (op === 'duplicate_elements' || op === 'mirror_elements') return Math.max(ids, 1);
  return 1 + boundary; // create/update — boundary는 MAX_ARRAY로 별도 캡
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

  // 프로젝트 원점 offset (M13 recenter+기억) — 커넥터가 Push 전 빼고/Pull 후 더할 양 저장·조회.
  if (op === 'origin') {
    if (request.method === 'GET') return json(200, { origin: store.getProjectOrigin() });
    if (request.method === 'POST') {
      let body: { x?: unknown; y?: unknown };
      try {
        body = (await request.json()) as { x?: unknown; y?: unknown };
      } catch {
        return json(400, { error: '본문은 {x:number, y:number}' });
      }
      if (typeof body.x !== 'number' || typeof body.y !== 'number')
        return json(400, { error: '{x,y} 숫자 필요' });
      store.setProjectOrigin([body.x, body.y]);
      await persist();
      return json(200, { origin: store.getProjectOrigin() });
    }
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
    let totalWork = 0;
    for (const e of ops) {
      if (!e || typeof e !== 'object') return json(400, { error: '각 op = {op:string, args:object}' });
      const rec = e as Record<string, unknown>;
      const opName = rec['op'];
      const args = rec['args'];
      if (typeof opName !== 'string' || typeof args !== 'object' || args === null || Array.isArray(args))
        return json(400, { error: '각 op = {op:string, args:object}' });
      const a = args as Record<string, unknown>;
      if (!argsBounded(a)) return json(413, { error: `op 인자 배열이 너무 김 (최대 ${MAX_ARRAY})` });
      totalWork += opWork(opName, a);
      if (totalWork > WORK_BUDGET)
        return json(413, { error: `배치 총 작업이 너무 큼 (예산 ${WORK_BUDGET} — count·ids 곱 확인)` });
      log.push({ op: opName, args: a, result: rec['result'] });
    }

    // 멱등화(iter-2 2, opt-in ?dedup=1) — figcadpushbreps 재푸시 정확중첩 차단:
    //   기존 요소와 content(종류+레벨+타입+좌표)가 같은 create 옵 스킵. 배치 내 중복도 1개만.
    //   PushBreps만 opt-in(writeback 없음). Push()는 createdIds 순서 writeback이라 dedup 비활성.
    let toApply = log;
    let deduped = 0;
    if (url.searchParams.get('dedup') === '1') {
      const seen = new Set<string>();
      for (const el of store.listElements()) seen.add(elementContentKey(el));
      const filtered: OpLogEntry[] = [];
      for (const entry of log) {
        const key = createOpContentKey(entry.op, entry.args as Record<string, unknown>);
        if (key !== null) {
          if (seen.has(key)) {
            deduped++;
            continue;
          }
          seen.add(key);
        }
        filtered.push(entry);
      }
      toApply = filtered;
    }

    // op마다 별도 transact(applyOpLog 내부) — 후속 op가 선행 결과를 미러로 봄.
    // 비뮤테이팅 op는 applyOpLog가 스킵. 개별 실패는 failed로 보고(계속).
    const result = applyOpLog(store, toApply);
    // 커넥터 푸시 상태 누계 기록 (허브 UI 표시 — iter-2 F2)
    const prev = store.getConnectorPush();
    store.setConnectorPush({
      count: (prev?.count ?? 0) + result.applied,
      deduped: (prev?.deduped ?? 0) + deduped,
      ts: Date.now(),
    });
    await persist(); // 무인 룸도 즉시 영속 (접속 클라 없으면 자동 체크포인트 안 도므로)
    return json(200, { ...result, deduped });
  }

  return json(400, { error: 'op은 apply(POST)/pull(GET) 중 하나' });
}
