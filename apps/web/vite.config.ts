import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
  },
  build: {
    target: 'es2022',
  },
  // libredwg-web(DWG WASM)는 글루가 `new URL('libredwg-web.wasm', import.meta.url)`로 wasm을 찾고
  // exports 맵에 wasm 서브경로가 없어 ?url import 불가 → esbuild 프리번들 제외해야 import.meta.url
  // 에셋 해석이 깨지지 않는다(web-ifc/rhino3dm은 ?url 가능해 다름).
  optimizeDeps: {
    exclude: ['@mlightcad/libredwg-web'],
  },
});
