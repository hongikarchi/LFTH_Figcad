/**
 * M11 Phase 1a 스모크 — 도면 시트 패널: views ops + deriveDrawing 캔버스 렌더.
 * 사전: vite dev. 사용: node scripts/drawing-smoke.mjs [vite 포트=5173]
 */
import puppeteer from 'puppeteer-core';

const port = process.argv[2] ?? '5173';
const room = `e2e-draw-${Math.random().toString(36).slice(2, 8)}`;

const browser = await puppeteer.launch({
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  headless: true,
});

try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });
  page.on('dialog', (d) => d.accept('도면테스터'));
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text().slice(0, 200));
  });
  await page.goto(`http://localhost:${port}/?p=${room}`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__figcad?.ui, { timeout: 10000 });

  // 1) 방 하나(벽 4개 박스) — 절단면(1200)에 걸리도록 기본 높이
  await page.evaluate(() => {
    const { store, seed } = window.__figcad;
    const L = seed.levelId;
    const t = seed.wallTypeIds[0];
    store.createWall({ levelId: L, typeId: t, a: [0, 0], b: [6000, 0] });
    store.createWall({ levelId: L, typeId: t, a: [6000, 0], b: [6000, 4000] });
    store.createWall({ levelId: L, typeId: t, a: [6000, 4000], b: [0, 4000] });
    store.createWall({ levelId: L, typeId: t, a: [0, 4000], b: [0, 0] });
    store.createColumn({ levelId: L, typeId: seed.columnTypeId, at: [3000, 2000] });
  });
  await new Promise((r) => setTimeout(r, 150));

  // 2) views ops — createView/list
  const viewId = await page.evaluate(() => {
    const { store, seed, ui } = window.__figcad;
    const id = store.createView({ name: '1층 평면', type: 'plan', levelId: seed.levelId, cutHeight: 1200 });
    ui.getState().setActiveViewId(id);
    ui.getState().setDrawingOpen(true);
    return id;
  });
  if (!viewId) throw new Error('createView 실패');
  const nViews = await page.evaluate(() => window.__figcad.store.listViews().length);
  if (nViews !== 1) throw new Error(`listViews=${nViews}`);
  console.log('PASS  views 채널 ops (createView/list)');

  // 3) 패널 + 캔버스 마운트, 렌더 대기
  await page.waitForSelector('canvas[data-drawing]', { timeout: 4000 });
  await new Promise((r) => setTimeout(r, 400));

  // 4) 캔버스에 라인워크가 실제로 그려졌나 — 비흰색 픽셀 존재 확인
  const drawn = await page.evaluate(() => {
    const c = document.querySelector('canvas[data-drawing]');
    if (!c || !c.width || !c.height) return { ok: false, reason: 'no canvas/size' };
    const ctx = c.getContext('2d');
    const { data } = ctx.getImageData(0, 0, c.width, c.height);
    let dark = 0;
    for (let i = 0; i < data.length; i += 4) {
      // 흰 배경(255,255,255) 아닌 픽셀 = 그려진 선
      if (data[i] < 200 || data[i + 1] < 200 || data[i + 2] < 200) dark++;
    }
    return { ok: dark > 50, dark, w: c.width, h: c.height };
  });
  if (!drawn.ok) throw new Error(`캔버스 비어있음 (${JSON.stringify(drawn)})`);
  console.log(`PASS  도면 캔버스 렌더 (그려진 픽셀 ${drawn.dark})`);

  // 5) 빈 레벨(절단면 위 벽만) → 빈 도면이어도 에러 없이 처리
  await page.evaluate(() => {
    const { store, seed, ui } = window.__figcad;
    const id = store.createView({ name: '빈 평면', type: 'plan', levelId: seed.levelId, cutHeight: 999999 });
    ui.getState().setActiveViewId(id);
  });
  await new Promise((r) => setTimeout(r, 300));
  console.log('PASS  절단면 위(빈 도면) 에러 없음');

  if (errors.length) throw new Error(`콘솔/페이지 에러: ${errors.slice(0, 3).join(' | ')}`);
  console.log('\n도면 스모크 통과');
} catch (err) {
  console.error('FAIL ', err.message);
  process.exitCode = 1;
} finally {
  await browser.close();
}
