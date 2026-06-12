/**
 * 로컬 데브 서버 — miniflare(workerd) 직접 구동. 프로덕션과 동일한 DO 경로.
 *
 * 주의: no_websocket_standard_binary_type 플래그 필수 — 없으면 서버측 WS binary가
 * Blob이 되어 partyserver가 0바이트로 침묵 파손 (프로덕션도 동일, wrangler.jsonc 참조).
 *
 * 실행: node dev.mjs  (기본 포트 8787, PORT 환경변수로 변경. ../web/dist 정적 + DO 룸)
 * 더 가벼운 대안: dev-node.mjs (순수 Node, workerd 불필요)
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
  // partyserver는 ArrayBuffer 가정 — Blob 기본값 플래그 비활성 (wrangler.jsonc와 동일)
  compatibilityFlags: ['no_websocket_standard_binary_type'],
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
  port: Number(process.env.PORT ?? 8787),
});

const url = await mf.ready;
console.log(`figcad dev server ready: ${url}`);
console.log('(LAN 접속: http://<이-컴퓨터-IP>:8787)');
