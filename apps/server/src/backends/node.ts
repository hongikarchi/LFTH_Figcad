/**
 * Figcad 프로덕션 Node 서버 (Railway 등 평면호스트 — Cloudflare DO/R2 대체).
 *
 * dev-node.mjs의 WS Yjs 동기화(y-protocols, 클라 provider 호환)를 토대로 + CF Worker가 하던
 * HTTP 라우트(?op=apply/pull/origin·fed-upload/fed-blob·commit/log/show·/api/agent)를 배선.
 * 순수 핸들러(apply/federation/version/agent = Web-standard Request/Response)를 그대로 재사용 —
 * R2 대신 DiskBlobStore(볼륨), DO storage 대신 .bin 파일, commitChain 대신 룸별 mutex.
 *
 * env: PORT · DATA_DIR(영속 볼륨 — 룸 .bin + blob) · ROOM_KEY(선택) · ANTHROPIC_API_KEY(AI).
 * 단일 인스턴스(룸 Y.Doc 메모리 보유) — 내부툴 규모엔 충분, 수평확장 금지.
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, type WebSocket } from 'ws';
import * as Y from 'yjs';
import * as syncProtocol from 'y-protocols/sync';
import * as awarenessProtocol from 'y-protocols/awareness';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';
import { DocStore } from '@figcad/core';
import { handleConnectorRequest } from '../handlers/apply';
import { handleFederationBlob } from '../handlers/federation';
import { handleVersionRequest, createCommit, isSafeRoom } from '../handlers/version';
import { handleAgentRequest } from '../handlers/agent';
import { DiskBlobStore } from '../blob/disk';

const PORT = Number(process.env.PORT ?? 8787);
const ROOM_KEY = process.env.ROOM_KEY || undefined;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || undefined;
const here = path.dirname(fileURLToPath(import.meta.url));
// 빌드 후 node-dist/에서 실행 → ../../web/dist. WEB_DIST(상대/절대) 덮어쓰기. **절대경로로 정규화**
// (Windows path.join은 '\' 생성 → startsWith 비교가 상대 '/' 경로와 어긋나 정적서빙이 SPA폴백으로 샘).
const DIST = path.resolve(process.env.WEB_DIST || path.resolve(here, '../../web/dist'));
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.resolve(here, '../.data'));
const DOCS_DIR = path.join(DATA_DIR, 'docs');
const BLOB_DIR = path.join(DATA_DIR, 'blobs');
fs.mkdirSync(DOCS_DIR, { recursive: true });
fs.mkdirSync(BLOB_DIR, { recursive: true });
const blobStore = new DiskBlobStore(BLOB_DIR);

const MESSAGE_SYNC = 0;
const MESSAGE_AWARENESS = 1;
const SAVE_DEBOUNCE_MS = 2000;

interface Room {
  doc: Y.Doc;
  awareness: awarenessProtocol.Awareness;
  conns: Map<WebSocket, Set<number>>;
  saveTimer: NodeJS.Timeout | null;
  store: DocStore | null; // lazy 캐시 (observer 누수 방지 — Doc DO liveStore 패턴)
}
const rooms = new Map<string, Room>();

const docFile = (room: string) => path.join(DOCS_DIR, `${room.replace(/[^a-zA-Z0-9_-]/g, '_')}.bin`);

function saveDoc(name: string, doc: Y.Doc): void {
  fs.writeFileSync(docFile(name), Y.encodeStateAsUpdate(doc));
}

function getRoom(name: string): Room {
  const existing = rooms.get(name);
  if (existing) return existing;
  const doc = new Y.Doc({ gc: true });
  const awareness = new awarenessProtocol.Awareness(doc);
  awareness.setLocalState(null);
  const room: Room = { doc, awareness, conns: new Map(), saveTimer: null, store: null };
  rooms.set(name, room);

  let stored: Buffer | null = null;
  try {
    stored = fs.readFileSync(docFile(name));
  } catch {
    /* 새 룸(ENOENT) */
  }
  if (stored && stored.length) {
    try {
      Y.applyUpdate(doc, new Uint8Array(stored));
    } catch (e) {
      // 손상 .bin — 삼키고 빈 doc로 가면 다음 저장이 원본을 덮어써 영구 손실. 보존(.corrupt 리네임) + 경고.
      const bad = `${docFile(name)}.corrupt-${Date.now()}`;
      try { fs.renameSync(docFile(name), bad); } catch { /* 리네임 실패 무시 */ }
      console.error(`room "${name}" .bin 손상 — ${bad}로 보존, 빈 룸 시작:`, (e as Error).message);
    }
  }

  doc.on('update', (update: Uint8Array) => {
    const enc = encoding.createEncoder();
    encoding.writeVarUint(enc, MESSAGE_SYNC);
    syncProtocol.writeUpdate(enc, update);
    broadcast(room, encoding.toUint8Array(enc));
    if (room.saveTimer) clearTimeout(room.saveTimer);
    room.saveTimer = setTimeout(() => saveDoc(name, doc), SAVE_DEBOUNCE_MS);
  });
  awareness.on('update', ({ added, updated, removed }: { added: number[]; updated: number[]; removed: number[] }) => {
    const changed = added.concat(updated, removed);
    const enc = encoding.createEncoder();
    encoding.writeVarUint(enc, MESSAGE_AWARENESS);
    encoding.writeVarUint8Array(enc, awarenessProtocol.encodeAwarenessUpdate(awareness, changed));
    broadcast(room, encoding.toUint8Array(enc));
  });
  return room;
}

function liveStore(room: Room): DocStore {
  if (!room.store) room.store = new DocStore(room.doc);
  return room.store;
}

function broadcast(room: Room, buf: Uint8Array): void {
  for (const ws of room.conns.keys()) if (ws.readyState === ws.OPEN) ws.send(buf);
}

function handleConnection(ws: WebSocket, roomName: string): void {
  const room = getRoom(roomName);
  room.conns.set(ws, new Set());
  ws.on('message', (data: Buffer, isBinary: boolean) => {
    if (!isBinary) return;
    try {
      const u8 = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
      const dec = decoding.createDecoder(u8);
      const type = decoding.readVarUint(dec);
      if (type === MESSAGE_SYNC) {
        const enc = encoding.createEncoder();
        encoding.writeVarUint(enc, MESSAGE_SYNC);
        syncProtocol.readSyncMessage(dec, enc, room.doc, ws);
        if (encoding.length(enc) > 1) ws.send(encoding.toUint8Array(enc));
      } else if (type === MESSAGE_AWARENESS) {
        const update = decoding.readVarUint8Array(dec);
        const ids = room.conns.get(ws);
        if (ids) {
          const t = decoding.createDecoder(update);
          const count = decoding.readVarUint(t);
          for (let i = 0; i < count; i++) {
            ids.add(decoding.readVarUint(t));
            decoding.readVarUint(t);
            decoding.readVarString(t);
          }
        }
        awarenessProtocol.applyAwarenessUpdate(room.awareness, update, ws);
      }
    } catch (err) {
      console.error('ws message error:', (err as Error).message);
    }
  });
  ws.on('close', () => {
    const ids = room.conns.get(ws);
    room.conns.delete(ws);
    if (ids?.size) awarenessProtocol.removeAwarenessStates(room.awareness, [...ids], null);
    if (room.conns.size === 0) void checkpointIfEmpty(roomName); // 마지막 퇴장 → 자동 커밋
  });
  const enc = encoding.createEncoder();
  encoding.writeVarUint(enc, MESSAGE_SYNC);
  syncProtocol.writeSyncStep1(enc, room.doc);
  ws.send(encoding.toUint8Array(enc));
  const states = room.awareness.getStates();
  if (states.size > 0) {
    const aEnc = encoding.createEncoder();
    encoding.writeVarUint(aEnc, MESSAGE_AWARENESS);
    encoding.writeVarUint8Array(aEnc, awarenessProtocol.encodeAwarenessUpdate(room.awareness, [...states.keys()]));
    ws.send(encoding.toUint8Array(aEnc));
  }
}

// --- 룸별 직렬화(commitChain 대체) — apply/version의 read-modify-write 레이스 방지 ---
const chains = new Map<string, Promise<unknown>>();
function serialize<T>(room: string, fn: () => Promise<T>): Promise<T> {
  const prev = chains.get(room) ?? Promise.resolve();
  const next = prev.then(fn, fn);
  chains.set(room, next.then(() => {}, () => {}));
  return next as Promise<T>;
}

// --- Web Request/Response ↔ node http 어댑터 (핸들러는 Web-standard) ---
// 본문 상한 — 읽는 도중 누적 검사(핸들러 캡은 통짜 버퍼 후라 메모리 보호 못 함 = OOM DoS). 라우트별.
const MAX_AGENT_BYTES = 30 * 1024 * 1024;
const MAX_DOC_OP_BYTES = 5 * 1024 * 1024; // apply/origin/pull/commit/version
const MAX_UPLOAD_BYTES = 100 * 1024 * 1024; // fed-upload (federation blob)
/** 본문 읽기 — maxBytes 초과 시 즉시 연결 끊고 null(→ 413). 초과 본문을 RAM에 안 쌓는다. */
function readBody(req: http.IncomingMessage, maxBytes: number): Promise<Buffer | null> {
  return new Promise((res) => {
    const chunks: Buffer[] = [];
    let total = 0;
    let over = false;
    req.on('data', (c) => {
      if (over) return; // 초과 후 들어오는 청크는 버리기만(버퍼 안 쌓음=메모리 안전) — 호출부가 413 응답
      total += (c as Buffer).length;
      if (total > maxBytes) {
        over = true;
        chunks.length = 0; // 이미 쌓인 것 해제
        res(null);
        return;
      }
      chunks.push(c as Buffer);
    });
    req.on('end', () => { if (!over) res(Buffer.concat(chunks)); });
    req.on('error', () => res(null));
  });
}
function toWebRequest(req: http.IncomingMessage, body: Buffer): Request {
  const url = `http://${req.headers.host ?? 'localhost'}${req.url}`;
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) if (typeof v === 'string') headers.set(k, v);
  const init: RequestInit = { method: req.method, headers };
  if (req.method !== 'GET' && req.method !== 'HEAD' && body.length)
    init.body = new Uint8Array(body.buffer, body.byteOffset, body.byteLength) as unknown as RequestInit['body'];
  return new Request(url, init);
}
function send413(res: http.ServerResponse): void {
  res.writeHead(413, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ error: '요청 본문이 너무 큼' }));
}
async function sendWebResponse(res: http.ServerResponse, webRes: Response): Promise<void> {
  const headers: Record<string, string> = {};
  webRes.headers.forEach((v, k) => (headers[k] = v));
  res.writeHead(webRes.status, headers);
  res.end(Buffer.from(await webRes.arrayBuffer()));
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript', // ES 모듈 청크(예: pdfjs worker) — 누락 시 octet-stream→브라우저 strict-MIME 거부로 PDF import 깨짐(라이브 실측)
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
  '.json': 'application/json',
  '.wasm': 'application/wasm',
};

const roomFromPath = (pathname: string): string | null => {
  const m = pathname.match(/^\/parties\/doc\/([^/]+)$/);
  if (!m) return null;
  try {
    return decodeURIComponent(m[1]!); // 잘못된 % 이스케이프(%ZZ) → URIError. 삼키지 않으면 upgrade서 프로세스 크래시.
  } catch {
    return null;
  }
};

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? '/', 'http://x');
    const pathname = decodeURIComponent(url.pathname);

    // AI 에이전트 (인프로세스 = Railway US 리전 → Anthropic 지역차단 회피)
    if (pathname === '/api/agent') {
      const body = await readBody(req, MAX_AGENT_BYTES);
      if (body === null) return void send413(res);
      return void (await sendWebResponse(res, await handleAgentRequest(toWebRequest(req, body), { ANTHROPIC_API_KEY })));
    }

    // 룸 HTTP 라우트
    const room = roomFromPath(pathname);
    if (room) {
      if (!isSafeRoom(room)) {
        res.writeHead(400, { 'content-type': 'application/json' });
        return void res.end(JSON.stringify({ error: '허용되지 않는 룸 이름' }));
      }
      const op = url.searchParams.get('op');
      // ROOM_KEY를 getRoom(룸 영속 할당) 전에 검사 — 틀린 키가 인메모리 룸을 만들지 않게(fed-blob=공개 blob 읽기 제외).
      if (ROOM_KEY && op !== 'fed-blob' && url.searchParams.get('key') !== ROOM_KEY) {
        res.writeHead(401, { 'content-type': 'application/json' });
        return void res.end(JSON.stringify({ error: 'ROOM_KEY 필요' }));
      }
      const body = await readBody(req, op === 'fed-upload' ? MAX_UPLOAD_BYTES : MAX_DOC_OP_BYTES);
      if (body === null) return void send413(res);
      const reqW = toWebRequest(req, body);
      let out: Response;
      if (op === 'apply' || op === 'pull' || op === 'origin' || op === 'fed-register') {
        const r = getRoom(room);
        const persist = async () => saveDoc(room, r.doc);
        out = await serialize(room, () => handleConnectorRequest(reqW, room, liveStore(r), persist, ROOM_KEY));
      } else if (op === 'fed-upload' || op === 'fed-blob') {
        out = await handleFederationBlob(reqW, room, blobStore, ROOM_KEY);
      } else {
        // commit/log/show
        const r = getRoom(room);
        out = await serialize(room, () =>
          handleVersionRequest(reqW, room, blobStore, () => DocStore.snapshotOf(r.doc), ROOM_KEY),
        );
      }
      return void (await sendWebResponse(res, out));
    }

    // 정적 (web/dist + SPA 폴백)
    let p = pathname === '/' ? '/index.html' : pathname;
    const file = path.join(DIST, p);
    // 경계 검사 — startsWith(DIST)만이면 형제 디렉터리(DIST+'foo')로 탈출. path.sep 경계 요구(blob/disk 패턴).
    if ((file === DIST || file.startsWith(DIST + path.sep)) && fs.existsSync(file) && fs.statSync(file).isFile()) {
      res.writeHead(200, { 'content-type': MIME[path.extname(file)] ?? 'application/octet-stream' });
      return void res.end(fs.readFileSync(file));
    }
    const index = path.join(DIST, 'index.html');
    if (fs.existsSync(index)) {
      res.writeHead(200, { 'content-type': MIME['.html'] });
      return void res.end(fs.readFileSync(index));
    }
    res.writeHead(404);
    res.end('not found (web/dist 빌드 필요)');
  } catch (err) {
    console.error('http error:', (err as Error).message);
    if (!res.headersSent) res.writeHead(500, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'server error' }));
  }
});

const wss = new WebSocketServer({ noServer: true });
server.on('upgrade', (req, socket, head) => {
  try {
    const u = new URL(req.url ?? '/', 'http://x');
    const room = roomFromPath(u.pathname);
    if (!room || !isSafeRoom(room)) {
      socket.destroy();
      return;
    }
    // ROOM_KEY 게이트 (WS도 ?key= 검사)
    if (ROOM_KEY && u.searchParams.get('key') !== ROOM_KEY) {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => handleConnection(ws, room));
  } catch (e) {
    // 어떤 입력도 프로세스를 죽이면 안 됨(단일 인스턴스 = 전체 서비스 다운). 소켓만 끊는다.
    console.error('upgrade error:', (e as Error).message);
    socket.destroy();
  }
});

// 최후 방어선 — 처리 못 한 예외가 단일 인스턴스 프로세스를 종료시키지 않도록(전체 룸 다운 방지). 로그만.
process.on('uncaughtException', (e) => console.error('uncaughtException:', e));
process.on('unhandledRejection', (e) => console.error('unhandledRejection:', e));

// 무인 룸 자동 체크포인트: 마지막 접속자 퇴장 시 createCommit (Doc DO onClose 대응)
async function checkpointIfEmpty(room: string): Promise<void> {
  const r = rooms.get(room);
  if (!r || r.conns.size > 0 || !isSafeRoom(room)) return;
  try {
    await serialize(room, () => createCommit(blobStore, room, DocStore.snapshotOf(r.doc), '자동', '자동 체크포인트 (세션 종료)'));
  } catch {
    /* 체크포인트 실패 무시 */
  }
}
server.listen(PORT, '0.0.0.0', () => {
  console.log(`figcad node server: http://localhost:${PORT} · data: ${DATA_DIR} · dist: ${DIST}`);
});

// 종료(Railway SIGTERM=매 재배포) 시 전 룸 .bin 즉시 flush — debounce(2s) 윈도 내 편집 소실 방지.
let shuttingDown = false;
function flushAndExit(sig: string): void {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const [name, r] of rooms) {
    try {
      if (r.saveTimer) clearTimeout(r.saveTimer);
      saveDoc(name, r.doc);
    } catch {
      /* 개별 룸 저장 실패가 종료를 막지 않음 */
    }
  }
  console.log(`flushed ${rooms.size} rooms on ${sig}`);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000).unref(); // 강제 탈출 안전망
}
process.on('SIGTERM', () => flushAndExit('SIGTERM'));
process.on('SIGINT', () => flushAndExit('SIGINT'));
