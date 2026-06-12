/**
 * 로컬 데브 서버 — miniflare 직접 구동.
 *
 * wrangler dev를 쓰지 않는 이유: wrangler 4.x의 데브 프록시(ProxyWorker)가
 * 이 환경(Windows)에서 클라이언트→서버 바이너리 WebSocket 페이로드를 0바이트로
 * 비워버린다 (텍스트/서버→클라 바이너리는 정상 — echo-probe로 확인).
 * Yjs sync는 바이너리 프로토콜이라 치명적. miniflare는 workerd가 포트에 직접
 * 리슨하므로 프록시 레이어가 없다. wrangler는 deploy 전용으로 유지.
 *
 * 실행: node dev.mjs  (포트 8787, ../web/dist 정적 서빙 + DO 룸)
 */
import { Miniflare } from 'miniflare';
import * as esbuild from 'esbuild';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));

const built = await esbuild.build({
  entryPoints: [path.join(here, 'src/server.ts')],
  bundle: true,
  format: 'esm',
  write: false,
  external: ['cloudflare:*'],
  conditions: ['workerd', 'worker', 'browser'],
});

const mf = new Miniflare({
  modules: true,
  script: built.outputFiles[0].text,
  scriptPath: 'server.js',
  compatibilityDate: '2026-04-01',
  durableObjects: { Doc: { className: 'Doc', useSQLite: true } },
  // DO storage를 디스크에 영속화 — 데브 재시작에도 문서 유지
  durableObjectsPersist: path.join(here, '.mf-do'),
  assets: {
    directory: path.join(here, '../web/dist'),
    binding: 'ASSETS',
    // 에셋 미스 시 워커로 폴스루 (없으면 에셋 라우터가 404로 끝냄)
    routerConfig: { has_user_worker: true },
  },
  host: '0.0.0.0', // LAN(iPad) 접속 허용
  port: 8787,
});

const url = await mf.ready;
console.log(`figcad dev server ready: ${url}`);
console.log('(LAN 접속: http://<이-컴퓨터-IP>:8787)');
