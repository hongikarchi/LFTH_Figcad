import type * as Y from 'yjs';
import YProvider from 'y-partyserver/provider';
import { IndexeddbPersistence } from 'y-indexeddb';
import { nanoid } from 'nanoid';
import { backendHost, backendWsProtocol } from '../config/backend';

export interface CollabSession {
  provider: YProvider;
  projectId: string;
  persistence: IndexeddbPersistence;
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

  // IDB 리플레이는 이 클라 자신의 캐시(원격 피어 편집 아님) → main서 registerLocalOrigin(persistence)로
  // 등록해야 '원격 머지' 배너 오탐 방지.
  const persistence = new IndexeddbPersistence(`figcad-${projectId}`, ydoc);

  // 백엔드 = config/backend (VITE_BACKEND_URL > DEV 8787 > 동일 origin). LAN iPad = hostname 기반.
  const provider = new YProvider(backendHost(), projectId, ydoc, {
    party: 'doc',
    protocol: backendWsProtocol(),
    ...(key ? { params: { key } } : {}),
  });

  return { provider, projectId, persistence };
}
