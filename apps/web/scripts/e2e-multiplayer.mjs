/**
 * M2 멀티플레이어 엔드투엔드 검증 — 로컬 Node/Railway/Cloudflare 호환 Yjs 프로토콜
 * 수동 클라이언트 2개를 붙여 동시 편집/필드 병합/삭제 승리/awareness/영속화 확인.
 * (Node에서 y-websocket 기반 YProvider가 불안정해 y-protocols로 직접 구현 —
 *  와이어 포맷은 동일: varint 메시지 타입 0=sync, 1=awareness)
 * 실행: node apps/web/scripts/e2e-multiplayer.mjs
 */
import * as Y from 'yjs';
import * as syncProtocol from 'y-protocols/sync';
import * as awarenessProtocol from 'y-protocols/awareness';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';

// 기본 = 로컬 데브 서버. 배포 검증: FIGCAD_HOST=lfthfigcad-production.up.railway.app FIGCAD_WSS=1
const HOST = process.env.FIGCAD_HOST ?? '127.0.0.1:8787';
const PROTO = process.env.FIGCAD_WSS ? 'wss' : 'ws';
const ROOM = `e2e-${Math.random().toString(36).slice(2, 10)}`;
const results = [];

function check(name, ok) {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function until(fn, timeout = 5000) {
  return new Promise((resolve, reject) => {
    const t0 = Date.now();
    const iv = setInterval(() => {
      if (fn()) {
        clearInterval(iv);
        resolve();
      } else if (Date.now() - t0 > timeout) {
        clearInterval(iv);
        reject(new Error('condition timeout'));
      }
    }, 40);
  });
}

class Client {
  constructor(room, name) {
    this.name = name;
    this.doc = new Y.Doc();
    this.awareness = new awarenessProtocol.Awareness(this.doc);
    this.synced = false;
    this.ws = new WebSocket(`${PROTO}://${HOST}/parties/doc/${room}`);
    this.ws.binaryType = 'arraybuffer';
    this.ws.onmessage = (ev) => this.onMessage(new Uint8Array(ev.data));
    this.doc.on('update', (update, origin) => {
      if (origin === this) return;
      const enc = encoding.createEncoder();
      encoding.writeVarUint(enc, 0);
      syncProtocol.writeUpdate(enc, update);
      this.send(encoding.toUint8Array(enc));
    });
    this.ready = new Promise((resolve, reject) => {
      this.ws.onopen = () => {
        const enc = encoding.createEncoder();
        encoding.writeVarUint(enc, 0);
        syncProtocol.writeSyncStep1(enc, this.doc);
        this.send(encoding.toUint8Array(enc));
        resolve();
      };
      this.ws.onerror = (e) => reject(new Error(`ws error (${name})`));
    });
  }

  send(u8) {
    if (this.ws.readyState === WebSocket.OPEN) this.ws.send(u8);
  }

  onMessage(data) {
    const dec = decoding.createDecoder(data);
    const type = decoding.readVarUint(dec);
    if (type === 0) {
      const enc = encoding.createEncoder();
      encoding.writeVarUint(enc, 0);
      const msgType = syncProtocol.readSyncMessage(dec, enc, this.doc, this);
      if (encoding.length(enc) > 1) this.send(encoding.toUint8Array(enc));
      if (msgType === syncProtocol.messageYjsSyncStep2) this.synced = true;
    } else if (type === 1) {
      awarenessProtocol.applyAwarenessUpdate(
        this.awareness,
        decoding.readVarUint8Array(dec),
        this,
      );
    }
  }

  setAwareness(state) {
    this.awareness.setLocalState(state);
    const enc = encoding.createEncoder();
    encoding.writeVarUint(enc, 1);
    encoding.writeVarUint8Array(
      enc,
      awarenessProtocol.encodeAwarenessUpdate(this.awareness, [this.doc.clientID]),
    );
    this.send(encoding.toUint8Array(enc));
  }

  close() {
    this.ws.close();
  }
}

function addWall(client, id, a, b) {
  client.doc.transact(() => {
    const w = new Y.Map();
    w.set('id', id);
    w.set('kind', 'wall');
    w.set('levelId', 'L-001');
    w.set('typeId', 'T-w200');
    w.set('a', a);
    w.set('b', b);
    client.doc.getMap('elements').set(id, w);
  });
}

try {
  const A = new Client(ROOM, 'A');
  const B = new Client(ROOM, 'B');
  await Promise.all([A.ready, B.ready]);
  await until(() => A.synced && B.synced, 8000);
  check('A/B 룸 접속 + 초기 동기화(syncStep2 수신)', true);

  // --- A가 벽 생성 → B에 도착 ---
  addWall(A, 'w1', [0, 0], [4000, 0]);
  await until(() => B.doc.getMap('elements').has('w1'));
  check('A의 벽 생성이 B에 실시간 전파', true);

  // --- 동시 편집 다른 필드: A 끝점 + B 높이 → 둘 다 생존 ---
  A.doc.transact(() => A.doc.getMap('elements').get('w1').set('b', [5000, 0]));
  B.doc.transact(() => B.doc.getMap('elements').get('w1').set('height', 2400));
  await until(
    () =>
      B.doc.getMap('elements').get('w1')?.get('b')?.[0] === 5000 &&
      A.doc.getMap('elements').get('w1')?.get('height') === 2400,
  );
  check('필드별 병합: A 끝점 + B 높이 둘 다 생존', true);

  // --- awareness ---
  A.setAwareness({ user: { name: 'A', color: '#0a84ff' }, cursor: [1, 0, 2] });
  await until(() => {
    for (const [id, s] of B.awareness.getStates()) {
      if (id !== B.doc.clientID && s?.user?.name === 'A') return true;
    }
    return false;
  });
  check('awareness(presence) 전파', true);

  // --- 삭제 승리 ---
  A.doc.transact(() => A.doc.getMap('elements').get('w1').set('height', 2700));
  B.doc.transact(() => B.doc.getMap('elements').delete('w1'));
  await until(
    () => !A.doc.getMap('elements').has('w1') && !B.doc.getMap('elements').has('w1'),
  );
  check('삭제가 편집을 이김 (양쪽 수렴)', true);

  // --- 영속화: 벽 생성 → onSave 디바운스 대기 → 전원 퇴장 → 새 클라이언트 복원 ---
  addWall(A, 'w2', [0, 0], [3000, 3000]);
  await until(() => B.doc.getMap('elements').has('w2'));
  await sleep(3000); // onSave 디바운스 여유
  A.close();
  B.close();
  await sleep(1000);

  const C = new Client(ROOM, 'C');
  await C.ready;
  await until(() => C.doc.getMap('elements').has('w2'), 8000);
  check('서버 영속화: 전원 퇴장 후 새 클라이언트가 문서 복원', true);
  C.close();
} catch (err) {
  check(`실패: ${err.message}`, false);
}

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} 통과`);
process.exit(failed ? 1 : 0);
