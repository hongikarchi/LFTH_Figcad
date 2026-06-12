/**
 * 로컬 데브 동기화 서버 — 순수 Node (workerd 불필요).
 *
 * 역할: ① 가장 가벼운 일상 데브 서버 (재시작 빠름, 디버깅 쉬움)
 *      ② Cloudflare 이탈 시(Railway 등) 그대로 올릴 수 있는 프로덕션 대체 코드.
 * workerd 경로(dev.mjs)와 와이어 포맷 동일 — Yjs sync/awareness (y-protocols).
 * (당초 workerd 바이너리 WS 파손 우회용으로 작성 — 진짜 원인은 compat 플래그였고
 *  wrangler.jsonc/dev.mjs에 수정 반영됨. 이 서버는 위 ①② 가치로 유지.)
 *
 * 동일 URL 구조: ws://<host>:8787/parties/doc/<projectId>
 * 영속화: .dev-docs/<room>.bin (DO storage의 onSave 디바운스와 같은 의미론)
 *
 * 실행: node dev-node.mjs  (정적 ../web/dist + WS, LAN 바인딩 — iPad 테스트 가능)
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import * as Y from 'yjs';
import * as syncProtocol from 'y-protocols/sync';
import * as awarenessProtocol from 'y-protocols/awareness';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';

const PORT = 8787;
const here = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.join(here, '../web/dist');
const DOCS_DIR = path.join(here, '.dev-docs');
fs.mkdirSync(DOCS_DIR, { recursive: true });

const MESSAGE_SYNC = 0;
const MESSAGE_AWARENESS = 1;
const SAVE_DEBOUNCE_MS = 2000;

/** @type {Map<string, {doc: Y.Doc, awareness: awarenessProtocol.Awareness, conns: Map<import('ws').WebSocket, Set<number>>, saveTimer: NodeJS.Timeout|null}>} */
const rooms = new Map();

function docFile(room) {
  return path.join(DOCS_DIR, `${room.replace(/[^a-zA-Z0-9_-]/g, '_')}.bin`);
}

function getRoom(name) {
  let room = rooms.get(name);
  if (room) return room;
  const doc = new Y.Doc({ gc: true });
  const awareness = new awarenessProtocol.Awareness(doc);
  awareness.setLocalState(null);
  room = { doc, awareness, conns: new Map(), saveTimer: null };
  rooms.set(name, room);

  // 복원 (DO onLoad에 해당)
  try {
    const stored = fs.readFileSync(docFile(name));
    if (stored.length) Y.applyUpdate(doc, new Uint8Array(stored));
  } catch {}

  // 문서 업데이트 → 전체 브로드캐스트 + 디바운스 저장 (DO onSave에 해당)
  doc.on('update', (update) => {
    const enc = encoding.createEncoder();
    encoding.writeVarUint(enc, MESSAGE_SYNC);
    syncProtocol.writeUpdate(enc, update);
    broadcast(room, encoding.toUint8Array(enc));
    if (room.saveTimer) clearTimeout(room.saveTimer);
    room.saveTimer = setTimeout(() => {
      fs.writeFileSync(docFile(name), Y.encodeStateAsUpdate(doc));
    }, SAVE_DEBOUNCE_MS);
  });

  // awareness 변경 → 브로드캐스트
  awareness.on('update', ({ added, updated, removed }) => {
    const changed = added.concat(updated, removed);
    const enc = encoding.createEncoder();
    encoding.writeVarUint(enc, MESSAGE_AWARENESS);
    encoding.writeVarUint8Array(
      enc,
      awarenessProtocol.encodeAwarenessUpdate(awareness, changed),
    );
    broadcast(room, encoding.toUint8Array(enc));
  });

  return room;
}

function broadcast(room, buf) {
  for (const ws of room.conns.keys()) {
    if (ws.readyState === ws.OPEN) ws.send(buf);
  }
}

function handleConnection(ws, roomName) {
  const room = getRoom(roomName);
  room.conns.set(ws, new Set());

  ws.on('message', (data, isBinary) => {
    if (!isBinary) return; // 커스텀 문자열 메시지는 데브에서 미사용
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
        // 이 연결이 제어하는 클라이언트 id 추적 (끊김 시 정리용)
        const ids = room.conns.get(ws);
        if (ids) {
          const tmpDec = decoding.createDecoder(update);
          const count = decoding.readVarUint(tmpDec);
          for (let i = 0; i < count; i++) {
            ids.add(decoding.readVarUint(tmpDec));
            decoding.readVarUint(tmpDec); // clock
            decoding.readVarString(tmpDec); // state json
          }
        }
        awarenessProtocol.applyAwarenessUpdate(room.awareness, update, ws);
      }
    } catch (err) {
      console.error('message error:', err.message);
    }
  });

  ws.on('close', () => {
    const ids = room.conns.get(ws);
    room.conns.delete(ws);
    if (ids?.size) {
      awarenessProtocol.removeAwarenessStates(room.awareness, [...ids], null);
    }
  });

  // 접속 시: syncStep1 + 현재 awareness 전송 (YServer.onConnect와 동일)
  const enc = encoding.createEncoder();
  encoding.writeVarUint(enc, MESSAGE_SYNC);
  syncProtocol.writeSyncStep1(enc, room.doc);
  ws.send(encoding.toUint8Array(enc));
  const states = room.awareness.getStates();
  if (states.size > 0) {
    const aEnc = encoding.createEncoder();
    encoding.writeVarUint(aEnc, MESSAGE_AWARENESS);
    encoding.writeVarUint8Array(
      aEnc,
      awarenessProtocol.encodeAwarenessUpdate(room.awareness, [...states.keys()]),
    );
    ws.send(encoding.toUint8Array(aEnc));
  }
}

// --- 정적 서빙 (빌드된 web/dist — vite dev 사용 시엔 안 거침) ---
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
  '.json': 'application/json',
};

const server = http.createServer((req, res) => {
  let pathname = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (pathname === '/') pathname = '/index.html';
  const file = path.join(DIST, pathname);
  if (!file.startsWith(DIST) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
    // SPA 폴백
    const index = path.join(DIST, 'index.html');
    if (fs.existsSync(index)) {
      res.writeHead(200, { 'content-type': MIME['.html'] });
      res.end(fs.readFileSync(index));
    } else {
      res.writeHead(404);
      res.end('not found (web/dist 빌드 필요)');
    }
    return;
  }
  res.writeHead(200, { 'content-type': MIME[path.extname(file)] ?? 'application/octet-stream' });
  res.end(fs.readFileSync(file));
});

const wss = new WebSocketServer({ noServer: true });
server.on('upgrade', (req, socket, head) => {
  const match = new URL(req.url, 'http://x').pathname.match(/^\/parties\/doc\/([^/]+)$/);
  if (!match) {
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => handleConnection(ws, match[1]));
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`figcad dev sync server (Node): http://localhost:${PORT}`);
  console.log(`iPad/LAN: http://<이-컴퓨터-IP>:${PORT} · 문서 저장: ${DOCS_DIR}`);
});
