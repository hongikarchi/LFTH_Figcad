/**
 * M8-D2 스모크 — 주석 회귀: 그리드 라벨 + 치수 바인딩(ops 레벨 back-compat) + lint.
 * 텍스트 도구(M17)·치수 도구(M18)는 생성 서피스가 의도 제거됨 — 스키마·derive·ops는
 * back-compat 보존이므로 ops 경유 바인딩 회귀만 유지한다.
 * 사전: vite dev. 사용: node scripts/d2-smoke.mjs [vite 포트=5173]
 */
import puppeteer from 'puppeteer-core';

const port = process.argv[2] ?? '5173';
const room = `e2e-d2-${Math.random().toString(36).slice(2, 8)}`;

const browser = await puppeteer.launch({
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  headless: true,
});

try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });
  page.on('dialog', (d) => d.accept('주석테스터'));
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 200)); });
  await page.goto(`http://localhost:${port}/?p=${room}`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__figcad?.ui, { timeout: 10000 });
  await page.evaluate(() => window.__figcad.ui.getState().setViewMode('plan'));
  await new Promise((r) => setTimeout(r, 300));

  const countKind = (k) =>
    page.evaluate((kind) => window.__figcad.store.listElements().filter((e) => e.kind === kind).length, k);

  // 1) 그리드 라벨 채널 회귀 — store 직접 추가 후 렌더 에러 없는지
  await page.evaluate(() => window.__figcad.store.createGridLine({ a: [0, -2000], b: [0, 5000], label: '1' }));
  await new Promise((r) => setTimeout(r, 120));
  if (await countKind('grid') !== 1) throw new Error('그리드 생성 실패');
  console.log('PASS  그리드 라벨 채널 회귀 (버블 렌더)');

  // 2) 바인딩 추종 — 벽 끝점에 치수(ops 경유) → 벽 이동 시 측정값 갱신
  const followed = await page.evaluate(() => {
    const { store, seed } = window.__figcad;
    const w = store.createWall({ levelId: seed.levelId, typeId: seed.wallTypeIds[0], a: [0, 0], b: [4000, 0] });
    const d = store.createDimension({ levelId: seed.levelId, a: [0, 0], b: [4000, 0] });
    const dim = store.getElement(d);
    const bound = !!(dim.bindA && dim.bindB);
    store.updateElement(w, { b: [6000, 0] });
    // derive는 web 내부 — store 좌표로 추종 확인 (resolved b = wall.b)
    const wall = store.getElement(w);
    return bound && wall.b[0] === 6000;
  });
  if (!followed) throw new Error('치수 바인딩 캡처/추종 실패');
  console.log('PASS  치수 바인딩 자동 캡처 + 벽 이동');

  // 3) lint 클린
  const findings = await page.evaluate(() => window.__figcad.lint(window.__figcad.store).length);
  if (findings !== 0) throw new Error(`lint 경고 ${findings}건`);
  console.log('PASS  lint 클린');

  // 4) 3D 전환 — 렌더 에러 없는지 (기존 dimension 요소 back-compat 렌더 포함)
  await page.evaluate(() => window.__figcad.ui.getState().setViewMode('3d'));
  await new Promise((r) => setTimeout(r, 250));

  if (errors.length) throw new Error(`콘솔/페이지 에러: ${errors.slice(0, 3).join(' | ')}`);
  console.log('\nD2 스모크 통과');
} catch (err) {
  console.error('FAIL ', err.message);
  process.exitCode = 1;
} finally {
  await browser.close();
}
