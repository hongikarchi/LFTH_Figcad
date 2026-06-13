/**
 * 2K 요소 스트레스 — 벽 2000개(방 500개) 생성 후 성능 측정 (데스크톱 프록시;
 * iPad 실기기 수치는 별도 — 같은 룸 URL을 iPad에서 열어 체감 확인).
 * 측정: 생성 시간 / 궤도 회전 중 프레임 시간(120프레임) / lint 1회 시간 / JS 힙.
 * 예산 (플랜): 60fps(≈16.7ms/frame), 힙 ≤150MB.
 * 사전 조건: vite dev + dev-node.mjs 구동. 사용: node scripts/stress-2k.mjs [vite 포트=5173]
 */
import puppeteer from 'puppeteer-core';

const port = process.argv[2] ?? '5173';
const room = `stress-${Math.random().toString(36).slice(2, 8)}`;

const browser = await puppeteer.launch({
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  headless: true,
  args: ['--enable-precise-memory-info'],
});

try {
  const page = await browser.newPage();
  page.on('dialog', (d) => d.accept('스트레스'));
  await page.setViewport({ width: 1280, height: 800 });
  await page.goto(`http://localhost:${port}/?p=${room}`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__figcad?.engine, { timeout: 10000 });

  // 방 500개 = 벽 2000개 생성 (20×25 그리드)
  const createMs = await page.evaluate(() => {
    const { store, seed } = window.__figcad;
    const t = performance.now();
    const T = seed.wallTypeIds[0];
    const L = seed.levelId;
    for (let r = 0; r < 500; r++) {
      const x = (r % 20) * 5000;
      const y = Math.floor(r / 20) * 4000;
      store.createWall({ levelId: L, typeId: T, a: [x, y], b: [x + 4000, y] });
      store.createWall({ levelId: L, typeId: T, a: [x + 4000, y], b: [x + 4000, y + 3000] });
      store.createWall({ levelId: L, typeId: T, a: [x + 4000, y + 3000], b: [x, y + 3000] });
      store.createWall({ levelId: L, typeId: T, a: [x, y + 3000], b: [x, y] });
    }
    return Math.round(performance.now() - t);
  });
  const count = await page.evaluate(() => window.__figcad.store.listElements().length);
  console.log(`생성: 벽 ${count}개, ${createMs}ms (씬 파생 포함)`);

  // 씬 반영 + 워밍업
  await new Promise((r) => setTimeout(r, 1500));

  // 궤도 회전 120프레임 — rAF 델타
  const frames = await page.evaluate(
    () =>
      new Promise((res) => {
        const { engine, rig } = window.__figcad;
        const deltas = [];
        let last = performance.now();
        let n = 0;
        const tick = () => {
          rig.rotate(4, 1);
          engine.requestRender();
          const now = performance.now();
          deltas.push(now - last);
          last = now;
          if (++n < 120) requestAnimationFrame(tick);
          else res(deltas.slice(10)); // 워밍업 10프레임 제외
        };
        requestAnimationFrame(tick);
      }),
  );
  const avg = frames.reduce((a, b) => a + b, 0) / frames.length;
  const p95 = [...frames].sort((a, b) => a - b)[Math.floor(frames.length * 0.95)];
  console.log(`프레임: 평균 ${avg.toFixed(1)}ms (${(1000 / avg).toFixed(0)}fps), p95 ${p95.toFixed(1)}ms — 예산 16.7ms`);

  // lint 1회 (O(n²) 검사가 2K에서 견디는지 — 배지가 변경마다 실행)
  const lintMs = await page.evaluate(() => {
    const { lint, store } = window.__figcad;
    const t = performance.now();
    const findings = lint(store);
    return { ms: Math.round(performance.now() - t), n: findings.length };
  });
  console.log(`lint: ${lintMs.ms}ms, 발견 ${lintMs.n}건`);

  const heap = await page.evaluate(() => performance.memory?.usedJSHeapSize ?? 0);
  console.log(`JS 힙: ${(heap / 1048576).toFixed(0)}MB — 예산 150MB`);

  const fail =
    avg > 16.7 * 2 /* 데스크톱에서 2배 초과면 iPad 가망 없음 */ ||
    heap > 150 * 1048576 ||
    lintMs.ms > 500;
  console.log(fail ? '\n스트레스 예산 초과 — 최적화 필요' : '\n2K 스트레스 통과 (데스크톱 기준)');
  if (fail) process.exitCode = 1;
} catch (err) {
  console.error('FAIL ', err.message);
  process.exitCode = 1;
} finally {
  await browser.close();
}
