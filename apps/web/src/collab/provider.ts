import type * as Y from 'yjs';
import YProvider from 'y-partyserver/provider';
import { IndexeddbPersistence } from 'y-indexeddb';
import { nanoid } from 'nanoid';

export interface CollabSession {
  provider: YProvider;
  projectId: string;
}

/**
 * 프로젝트 룸 연결: URL ?p=<projectId> (없으면 생성 후 주소창에 반영 — 공유 = URL 복사).
 * ?key= 토큰은 서버 ROOM_KEY 설정 시에만 검사된다.
 * y-indexeddb = 로컬 캐시 전용 (iPadOS 7일 삭제 전제, 서버가 진실의 원천).
 */
export function setupCollab(ydoc: Y.Doc): CollabSession {
  const url = new URL(location.href);
  let projectId = url.searchParams.get('p');
  if (!projectId) {
    projectId = nanoid(10);
    url.searchParams.set('p', projectId);
    history.replaceState(null, '', url.toString());
  }
  const key = url.searchParams.get('key');

  new IndexeddbPersistence(`figcad-${projectId}`, ydoc);

  // vite dev(5173)에서는 같은 머신의 데브 동기화 서버(8787)로 — hostname 기준이라
  // 데스크톱(localhost)과 LAN의 iPad(PC IP) 둘 다 동작. 배포에서는 같은 호스트.
  const host = import.meta.env.DEV ? `${location.hostname}:8787` : location.host;
  const provider = new YProvider(host, projectId, ydoc, {
    party: 'doc',
    protocol: location.protocol === 'https:' ? 'wss' : 'ws',
    ...(key ? { params: { key } } : {}),
  });

  return { provider, projectId };
}
