// node-server.ts → node-dist/server.mjs (self-contained 번들). Railway 등 Node 호스트용.
// @figcad/core·interop(TS, 미빌드)을 번들에 포함 → Railway서 .ts 해석 불필요. node:* 만 external.
import * as esbuild from 'esbuild';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));

await esbuild.build({
  entryPoints: [path.join(here, 'src/node-server.ts')],
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node22',
  outfile: path.join(here, 'node-dist/server.mjs'),
  external: ['node:*'], // 나머지(ws·yjs·y-protocols·lib0·@anthropic·@figcad)는 번들 포함
  // ESM 번들서 require 호환 (@anthropic-ai/sdk 등 CJS 의존 대비)
  banner: {
    js: "import{createRequire as __cr}from'node:module';const require=__cr(import.meta.url);",
  },
  logLevel: 'info',
});
console.log('node-server 번들 완료 → node-dist/server.mjs');
