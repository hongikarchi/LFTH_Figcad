import { defineConfig } from 'vitest/config';

// apps/web 단위 테스트 — DOM 없는 순수 로직(CameraRig 수학 등)만.
// window 의존은 test/setup.ts의 최소 스텁으로 충족(jsdom 불필요 — 렌더/레이아웃 미사용).
// 브라우저 실경로 검증은 scripts/*-smoke.mjs (run-smokes.mjs 러너).
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    setupFiles: ['test/setup.ts'],
  },
});
