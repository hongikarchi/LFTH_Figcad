// 백엔드(서버) URL 단일 소스 — WS 동기화·federation·version·AI 전부 여기서.
// 우선순위: VITE_BACKEND_URL(빌드 주입) > DEV(로컬 8787) > prod 동일 origin(Node가 dist 서빙).
//
// - Railway(Node가 dist+API 1서비스): VITE_BACKEND_URL 불필요 — location.origin이 곧 백엔드.
// - web/API 분리 호스트: VITE_BACKEND_URL=https://<api-host> 로 빌드.
// - 로컬 dev(vite 5173): DEV → localhost:8787(dev-node 또는 node-server). VITE_BACKEND_URL로 덮어쓰기 가능.

/** 백엔드 origin (예 'https://figcad.up.railway.app'). 끝 슬래시 없음. */
export function backendOrigin(): string {
  const env = (import.meta.env.VITE_BACKEND_URL as string | undefined)?.trim();
  if (env) return env.replace(/\/+$/, '');
  if (import.meta.env.DEV) return `${location.protocol}//${location.hostname}:8787`;
  return location.origin;
}

/** y-partyserver provider용 host:port. */
export function backendHost(): string {
  return new URL(backendOrigin()).host;
}

/** WS 프로토콜 (백엔드가 https면 wss). */
export function backendWsProtocol(): 'ws' | 'wss' {
  return backendOrigin().startsWith('https') ? 'wss' : 'ws';
}
