import { CORS, isSafeRoom, json } from './version';
import type { BlobStore } from './blobStore';

/**
 * M13-F — Federation 소스 페이로드 저장/서빙 (BlobStore, `federation/` 프리픽스).
 *
 * 업로드한 외부 모델(.glb/.ifc)이 협업자 *전원*에게 페치 가능해야 허브가 성립 — 클라 로컬
 * object-URL은 올린 사람만 봄. 콘텐츠 해시 키 = dedup + 불변(출신툴 무손실 회수 = Lane-2 보관).
 * 불변①: 페이로드는 *별도 표현*(불투명 bytes, 지오 아님) — federation 채널엔 이 blob URL(ref)만,
 * Y.Doc엔 지오 미진입. derive·store 밖.
 *
 *   POST ?op=fed-upload&ext=glb   body=bytes  → put(federation/<room>/<hash>.<ext>) → { key, url }
 *   GET  ?op=fed-blob&key=<key>               → get → bytes (content-type by ext)
 */

const MAX_FED_BYTES = 100 * 1024 * 1024; // 100MB — 모델 업로드 상한

const CONTENT_TYPE: Record<string, string> = {
  glb: 'model/gltf-binary',
  gltf: 'model/gltf+json',
  ifc: 'application/x-step',
  '3dm': 'application/octet-stream',
};

async function sha256HexBytes(buf: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', buf);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function handleFederationBlob(
  request: Request,
  room: string,
  store: BlobStore | undefined,
  roomKey: string | undefined,
): Promise<Response> {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (!isSafeRoom(room)) return json(400, { error: '허용되지 않는 룸 이름 (A-Za-z0-9_- 1~64자)' });
  if (!store) return json(503, { error: 'blob 저장소 미구성 — federation 업로드 불가' });
  const url = new URL(request.url);
  const op = url.searchParams.get('op');
  const prefix = `federation/${room}/`;

  // 쓰기(업로드)만 ROOM_KEY 게이트. 읽기(blob)는 키 자체가 콘텐츠해시 = unguessable + 프리픽스 제한.
  if (op === 'fed-upload' && request.method === 'POST') {
    if (roomKey && url.searchParams.get('key') !== roomKey) return json(401, { error: 'invalid key' });
    const len = Number(request.headers.get('content-length') ?? '0');
    if (len > MAX_FED_BYTES) return json(413, { error: `파일이 너무 큼 (최대 ${MAX_FED_BYTES}바이트)` });
    const buf = await request.arrayBuffer();
    if (buf.byteLength === 0) return json(400, { error: '빈 본문' });
    if (buf.byteLength > MAX_FED_BYTES) return json(413, { error: '파일이 너무 큼' });
    const ext = (url.searchParams.get('ext') ?? 'bin').replace(/[^a-z0-9]/gi, '').slice(0, 8) || 'bin';
    const hash = await sha256HexBytes(buf);
    const key = `${prefix}${hash}.${ext}`;
    await store.put(key, buf, CONTENT_TYPE[ext] ?? 'application/octet-stream');
    return json(200, { key, url: `?op=fed-blob&key=${encodeURIComponent(key)}` });
  }

  if (op === 'fed-blob' && request.method === 'GET') {
    const key = url.searchParams.get('key') ?? '';
    // 보안: 이 룸의 federation 프리픽스만 — 커밋 blob 등 임의 BlobStore 키 읽기 차단.
    if (!key.startsWith(prefix) || key.includes('..')) return json(400, { error: '허용되지 않는 key' });
    const obj = await store.get(key);
    if (!obj) return json(404, { error: 'not found' });
    const ext = key.split('.').pop() ?? 'bin';
    const bytes = await obj.arrayBuffer();
    return new Response(bytes, {
      status: 200,
      headers: { ...CORS, 'content-type': CONTENT_TYPE[ext] ?? 'application/octet-stream' },
    });
  }

  return json(400, { error: 'op은 fed-upload(POST)/fed-blob(GET) 중 하나' });
}
