import type { DocSnapshot } from '@figcad/core';

/**
 * M6 버전 관리 클라이언트 — Doc DO 룸 HTTP (?op=commit/log/show).
 * 데브: vite(5173)와 별개인 miniflare(8787)로 — AI 라우트와 동일한 분기.
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
  commits: CommitMeta[];
}

function roomUrl(op: string, extra?: Record<string, string>): string {
  const params = new URLSearchParams(location.search);
  const projectId = params.get('p') ?? '';
  const key = params.get('key');
  const host = import.meta.env.DEV ? `${location.protocol}//${location.hostname}:8787` : '';
  const q = new URLSearchParams({ op, ...(key ? { key } : {}), ...(extra ?? {}) });
  return `${host}/parties/doc/${encodeURIComponent(projectId)}?${q.toString()}`;
}

async function checked<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body.error) detail = body.error;
    } catch {
      /* JSON 아님 — 상태코드로 충분 */
    }
    throw new Error(detail);
  }
  return (await res.json()) as T;
}

export async function commitVersion(message: string): Promise<{ skipped: boolean; meta?: CommitMeta }> {
  const author = localStorage.getItem('figcad.userName') ?? '익명';
  const res = await fetch(roomUrl('commit'), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ message, author }),
  });
  return checked(res);
}

export async function fetchLog(): Promise<CommitLog> {
  return checked(await fetch(roomUrl('log')));
}

export async function fetchCommit(hash: string): Promise<DocSnapshot> {
  return checked(await fetch(roomUrl('show', { hash })));
}
