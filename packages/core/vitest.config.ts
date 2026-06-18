import { defineConfig, configDefaults } from 'vitest/config';

// 연구 스파이크(R*)는 throwaway 측정 하니스 — 빌드 게이트(pnpm test)에서 제외한다.
// 명시적으로(`vitest run <file>`)만 돌린다. 빌드 레일과 연구 레일 분리(플랜 정책).
export default defineConfig({
  test: {
    exclude: [...configDefaults.exclude, '**/*.spike.*'],
  },
});
