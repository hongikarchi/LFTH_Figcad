import type { DocSnapshot } from '@figcad/core';

/**
 * M6 git식 버전 관리 — 커밋 저장/조회 (R2).
 *
 * 커밋 = 문서 스냅샷(canonical JSON)의 SHA-256 콘텐츠 해시 blob.
 *   projects/<room>/commits/<hash>.json  스냅샷 본문 (해시 dedup — 같은 내용 = 같은 키)
 *   projects/<room>/log.json             { head, commits: [메타…] } — 타임라인
 * Doc DO가 커밋 권위(자기 룸 요청을 직렬화)라 log.json read-modify-write가 안전하다.
 * 복원은 클라이언트가 스냅샷을 받아 importSnapshot — 서버는 읽기만 제공.
 */

export interface CommitMeta {
  hash: string;
  parent: string | null;
  author: string;
  message: string;
  ts: number;
  elements: number;
}

export interface CommitLog {
  head: string | null;
  commits: CommitMeta[]; // 생성 순서 (UI가 역순 표시)
}

const MAX_MESSAGE = 200;
const MAX_AUTHOR = 40;
const MAX_LOG_COMMITS = 500; // log.json 비대화 방지 — 초과 시 오래된 메타부터 잘림 (blob은 유지)

/**
 * R2 키가 `projects/<room>/...` 템플릿이므로 room에 '/' 등이 들어오면
 * 다른 프로젝트 네임스페이스로 경로 주입이 가능하다 — 안전 문자만 허용.
 * (프로바이더가 만드는 룸 id는 nanoid URL-safe 알파벳이라 전부 통과)
 */
export const isSafeRoom = (room: string): boolean => /^[A-Za-z0-9_-]{1,64}$/.test(room);

const logKey = (room: string): string => `projects/${room}/log.json`;
const commitKey = (room: string, hash: string): string => `projects/${room}/commits/${hash}.json`;

/**
 * 결정론 직렬화 — 객체 키 정렬 + 컬렉션(id 정렬).
 * 같은 문서 내용이면 클라이언트 편집 순서와 무관하게 같은 해시가 나와야
 * 콘텐츠 주소화(dedup)가 성립한다.
 */
export function canonicalSnapshotJson(snap: DocSnapshot): string {
  const sortKeys = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(sortKeys);
    if (v && typeof v === 'object') {
      const o = v as Record<string, unknown>;
      return Object.fromEntries(
        Object.keys(o)
          .sort()
          .map((k) => [k, sortKeys(o[k])]),
      );
    }
    return v;
  };
  const byId = <T extends { id: string }>(arr: T[]): T[] =>
    [...arr].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return JSON.stringify(
    sortKeys({
      meta: snap.meta,
      levels: byId(snap.levels),
      types: byId(snap.types),
      elements: byId(snap.elements),
    }),
  );
}

export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function readLog(bucket: R2Bucket, room: string): Promise<CommitLog> {
  const obj = await bucket.get(logKey(room));
  if (!obj) return { head: null, commits: [] };
  try {
    return (await obj.json()) as CommitLog;
  } catch {
    return { head: null, commits: [] };
  }
}

/** 커밋 생성 — 내용 무변경(head 해시 동일)이면 스킵 */
export async function createCommit(
  bucket: R2Bucket,
  room: string,
  snap: DocSnapshot,
  author: string,
  message: string,
): Promise<{ skipped: boolean; meta?: CommitMeta; hash: string }> {
  const canonical = canonicalSnapshotJson(snap);
  const hash = await sha256Hex(canonical);
  const log = await readLog(bucket, room);
  if (log.head === hash) return { skipped: true, hash };

  // blob은 콘텐츠 주소 — 복원→재커밋으로 같은 해시가 재등장해도 같은 내용 덮어쓰기라 무해
  await bucket.put(commitKey(room, hash), canonical, {
    httpMetadata: { contentType: 'application/json' },
  });
  const meta: CommitMeta = {
    hash,
    parent: log.head,
    author: author.slice(0, MAX_AUTHOR) || '익명',
    message: message.slice(0, MAX_MESSAGE) || '(메시지 없음)',
    ts: Date.now(),
    elements: snap.elements.length,
  };
  log.commits.push(meta);
  if (log.commits.length > MAX_LOG_COMMITS) log.commits = log.commits.slice(-MAX_LOG_COMMITS);
  log.head = hash;
  await bucket.put(logKey(room), JSON.stringify(log), {
    httpMetadata: { contentType: 'application/json' },
  });
  return { skipped: false, meta, hash };
}

// 데브에서 vite(5173)와 서버(8787)가 다른 origin — 접근 통제는 ?key=가 담당하므로
// CORS는 개방 (iPad LAN 데브 접속도 같은 경로)
const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  'access-control-allow-headers': 'content-type',
};

const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...CORS },
  });

/**
 * 룸 HTTP 라우트 (Doc DO onRequest):
 *   POST ?op=commit  {message, author} → {skipped, meta?}
 *   GET  ?op=log               → CommitLog
 *   GET  ?op=show&hash=<hash>  → 스냅샷 JSON
 */
export async function handleVersionRequest(
  request: Request,
  room: string,
  bucket: R2Bucket | undefined,
  snapshot: () => DocSnapshot,
  roomKey: string | undefined,
): Promise<Response> {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  const url = new URL(request.url);
  if (roomKey && url.searchParams.get('key') !== roomKey) return json(401, { error: 'invalid key' });
  if (!bucket) return json(503, { error: '버전 관리 미설정 — R2 바인딩(COMMITS) 없음' });
  if (!isSafeRoom(room)) return json(400, { error: '허용되지 않는 룸 이름 (A-Za-z0-9_- 1~64자)' });

  const op = url.searchParams.get('op');
  if (op === 'commit' && request.method === 'POST') {
    let body: { message?: string; author?: string };
    try {
      body = (await request.json()) as { message?: string; author?: string };
    } catch {
      body = {};
    }
    const result = await createCommit(
      bucket,
      room,
      snapshot(),
      String(body.author ?? ''),
      String(body.message ?? ''),
    );
    return json(200, result);
  }
  if (op === 'log' && request.method === 'GET') {
    return json(200, await readLog(bucket, room));
  }
  if (op === 'show' && request.method === 'GET') {
    const hash = url.searchParams.get('hash') ?? '';
    if (!/^[0-9a-f]{64}$/.test(hash)) return json(400, { error: 'bad hash' });
    const obj = await bucket.get(commitKey(room, hash));
    if (!obj) return json(404, { error: 'no such commit' });
    return new Response(obj.body, {
      headers: { 'content-type': 'application/json; charset=utf-8', ...CORS },
    });
  }
  return json(400, { error: 'op은 commit(POST)/log(GET)/show(GET) 중 하나' });
}
