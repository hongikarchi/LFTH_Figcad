/**
 * M8-D1b 스모크 — 계단/난간/지붕: 도구 배치 + 제네릭 렌더 + lint + IFC.
 * 사전: vite dev. 사용: node scripts/d1b-smoke.mjs [vite 포트=5173]
 */
import puppeteer from 'puppeteer-core';

const port = process.argv[2] ?? '5173';
const room = `e2e-d1b-${Math.random().toString(36).slice(2, 8)}`;

const browser = await puppeteer.launch({
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  headless: true,
});

try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });
  page.on('dialog', (d) => d.accept('구조테스터'));
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 200)); });
  await page.goto(`http://localhost:${port}/?p=${room}`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__figcad?.ui, { timeout: 10000 });

  await page.evaluate(() => window.__figcad.ui.getState().setViewMode('plan'));
  await new Promise((r) => setTimeout(r, 300));

  const countKind = (k) =>
    page.evaluate((kind) => window.__figcad.store.listElements().filter((e) => e.kind === kind).length, k);

  // 1) 계단 도구 — 2점 배치
  await page.evaluate(() => window.__figcad.ui.getState().setTool('stair'));
  await new Promise((r) => setTimeout(r, 200));
  await page.mouse.click(500, 400);
  await new Promise((r) => setTimeout(r, 80));
  await page.mouse.click(740, 400);
  await new Promise((r) => setTimeout(r, 150));
  if (await countKind('stair') !== 1) throw new Error(`계단 2점 배치 실패 (${await countKind('stair')})`);
  console.log('PASS  계단 도구 2점 배치');

  // 2) 난간 도구 — 2점 배치
  await page.evaluate(() => window.__figcad.ui.getState().setTool('railing'));
  await new Promise((r) => setTimeout(r, 200));
  await page.mouse.click(500, 500);
  await new Promise((r) => setTimeout(r, 80));
  await page.mouse.click(760, 500);
  await new Promise((r) => setTimeout(r, 150));
  // 난간은 체인 — Esc로 종료
  await page.keyboard.press('Escape');
  if (await countKind('railing') < 1) throw new Error('난간 배치 실패');
  console.log('PASS  난간 도구 2점 배치');

  // 3) 지붕 — store 직접(폴리곤 도구는 클릭 좌표 변환 까다로워 store 경유로 렌더만 검증)
  await page.evaluate(() => {
    const { store, seed } = window.__figcad;
    store.createRoof({ levelId: seed.levelId, typeId: seed.roofTypeId, boundary: [[-2000, -2000], [4000, -2000], [4000, 3000], [-2000, 3000]] });
    // 경사 지붕도 하나
    store.createRoof({ levelId: seed.levelId, typeId: seed.roofTypeId, boundary: [[6000, -2000], [10000, -2000], [10000, 3000], [6000, 3000]], slope: { dir: [1000, 0], pitch: 300 } });
  });
  await new Promise((r) => setTimeout(r, 150));
  if (await countKind('roof') !== 2) throw new Error(`지붕 생성 실패 (${await countKind('roof')})`);
  console.log('PASS  지붕 생성(평+경사) + SceneManager 제네릭 렌더');

  // 4) lint 클린
  const findings = await page.evaluate(() => window.__figcad.lint(window.__figcad.store).length);
  if (findings !== 0) throw new Error(`lint 경고 ${findings}건`);
  console.log('PASS  lint 클린');

  // 5) 3D 전환 — 렌더 에러 없는지
  await page.evaluate(() => window.__figcad.ui.getState().setViewMode('3d'));
  await new Promise((r) => setTimeout(r, 250));

  // 6) IFC export — IFCSTAIR / IFCRAILING 포함
  const ifc = await page.evaluate(async () => {
    const bytes = await window.__figcad.ifc.exportIfcBytes(window.__figcad.store.snapshot());
    return new TextDecoder().decode(bytes);
  });
  if (!ifc.includes('IFCSTAIR')) throw new Error('IFC에 IFCSTAIR 없음');
  if (!ifc.includes('IFCRAILING')) throw new Error('IFC에 IFCRAILING 없음');
  console.log('PASS  IFC export에 IFCSTAIR + IFCRAILING 포함');

  if (errors.length) throw new Error(`콘솔/페이지 에러: ${errors.slice(0, 3).join(' | ')}`);
  console.log('\nD1b 스모크 통과');
} catch (err) {
  console.error('FAIL ', err.message);
  process.exitCode = 1;
} finally {
  await browser.close();
}
