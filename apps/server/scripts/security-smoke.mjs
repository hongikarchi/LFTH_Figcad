/**
 * Node 백엔드 보안/강건성 통합 스모크 (broad review-3 [0][2][17]).
 * 사전: `corepack pnpm -F @figcad/server build:node` (node-dist/server.mjs 필요).
 * 실행: node apps/server/scripts/security-smoke.mjs
 *
 * 검증: (0) `/parties/doc/%ZZ` WS upgrade + HTTP가 프로세스를 죽이지 않음(URIError 크래시 DoS),
 *       (2) 상한 초과 본문 → 413 + 서버 생존(통짜 버퍼 OOM 방지).
 */
import { spawn } from 'node:child_process';
import net from 'node:net';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const srvPath = path.join(here, '..', 'node-dist', 'server.mjs');
if (!fs.existsSync(srvPath)) {
  console.error('node-dist/server.mjs 없음 — 먼저 `corepack pnpm -F @figcad/server build:node`');
  process.exit(2);
}
const PORT = 8799;
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'figcad-sec-'));
const child = spawn(process.execPath, [srvPath], { env: { ...process.env, PORT: String(PORT), DATA_DIR: dataDir }, stdio: ['ignore', 'pipe', 'pipe'] });
let log = '';
child.stdout.on('data', (d) => (log += d));
child.stderr.on('data', (d) => (log += d));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const get = (u) => new Promise((res) => { http.get(u, (r) => { r.resume(); res(r.statusCode); }).on('error', () => res(0)); });
const rawUpgrade = (p) => new Promise((res) => {
  const s = net.connect(PORT, '127.0.0.1', () => s.write(`GET ${p} HTTP/1.1\r\nHost: x\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n\r\n`));
  s.on('data', () => {}); s.on('close', () => res()); s.on('error', () => res());
  setTimeout(() => { s.destroy(); res(); }, 800);
});
const postBig = (p, bytes) => new Promise((res) => {
  const req = http.request({ host: '127.0.0.1', port: PORT, path: p, method: 'POST', headers: { 'content-type': 'application/json' } }, (r) => { r.resume(); res(r.statusCode); });
  req.on('error', () => res(0));
  const chunk = Buffer.alloc(1024 * 1024, 0x20); let sent = 0;
  const pump = () => { while (sent < bytes) { sent += chunk.length; if (!req.write(chunk)) { req.once('drain', pump); return; } } req.end(); };
  pump();
});
const pass = [], fail = [];
try {
  await wait(1500);
  if ((await get(`http://127.0.0.1:${PORT}/`)) !== 200) { fail.push('서버 기동 실패'); throw new Error('no server'); }
  pass.push('서버 기동');
  await rawUpgrade('/parties/doc/%ZZ'); await wait(300);
  ((await get(`http://127.0.0.1:${PORT}/`)) === 200 ? pass : fail).push('[0] %ZZ WS upgrade 후 생존');
  await get(`http://127.0.0.1:${PORT}/parties/doc/%ZZ?op=pull`);
  ((await get(`http://127.0.0.1:${PORT}/`)) === 200 ? pass : fail).push('[0] %ZZ HTTP 후 생존');
  ((await postBig(`/parties/doc/secroom?op=apply`, 7 * 1024 * 1024)) === 413 ? pass : fail).push('[2] 7MB 본문 → 413');
  ((await get(`http://127.0.0.1:${PORT}/`)) === 200 ? pass : fail).push('대형 본문 후 생존');
  console.log('PASS(' + pass.length + '): ' + pass.join(' · '));
  if (fail.length) { console.log('FAIL: ' + fail.join(' · ') + '\n' + log.slice(-1200)); process.exitCode = 1; }
  else console.log('ALL PASS — server security smoke');
} catch (e) { console.error('THREW', e.message, '\n', log.slice(-1200)); process.exitCode = 1; }
finally { child.kill(); try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch {} }
