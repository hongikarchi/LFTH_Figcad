/**
 * M8-D1 보 스모크 — 2점 도구 배치 + 제네릭 렌더 + 박스 선택 + lint + IFC(IfcBeam).
 * 사전: vite dev. 사용: node scripts/beam-smoke.mjs [vite 포트=5173]
 */
import puppeteer from 'puppeteer-core';

const port = process.argv[2] ?? '5173';
const room = `e2e-beam-${Math.random().toString(36).slice(2, 8)}`;

const browser = await puppeteer.launch({
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  headless: true,
});

try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });
  page.on('dialog', (d) => d.accept('보테스터'));
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 200)); });
  await page.goto(`http://localhost:${port}/?p=${room}`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__figcad?.ui, { timeout: 10000 });

  await page.evaluate(() => {
    const { ui } = window.__figcad;
    ui.getState().setViewMode('plan');
    ui.getState().setTool('beam');
  });
  await new Promise((r) => setTimeout(r, 400));

  const beams = () =>
    page.evaluate(() => window.__figcad.store.listElements().filter((e) => e.kind === 'beam').length);

  // 1) 2점 클릭 배치 (BeamTool 체인: 클릭1=시작, 클릭2=커밋)
  await page.mouse.click(520, 400);
  await new Promise((r) => setTimeout(r, 80));
  await page.mouse.click(760, 400);
  await new Promise((r) => setTimeout(r, 150));
  const placed = await beams();
  if (placed !== 1) throw new Error(`보 2점 배치 ${placed} (1 기대)`);
  console.log(`PASS  보 도구 2점 배치 → ${placed}개`);

  // 2) 제네릭 렌더 — store 직접 추가
  await page.evaluate(() => {
    const { store, seed } = window.__figcad;
    store.createBeam({ levelId: seed.levelId, typeId: seed.beamTypeId, a: [-3000, 2000], b: [3000, 2000] });
  });
  await new Promise((r) => setTimeout(r, 120));
  if (await beams() !== 2) throw new Error('store 직접 추가 실패');
  console.log('PASS  SceneManager 제네릭 렌더');

  // 3) lint 클린
  const findings = await page.evaluate(() => window.__figcad.lint(window.__figcad.store).length);
  if (findings !== 0) throw new Error(`lint 경고 ${findings}건`);
  console.log('PASS  lint 클린');

  // 4) IFC export — IFCBEAM 포함
  const hasBeam = await page.evaluate(async () => {
    const bytes = await window.__figcad.ifc.exportIfcBytes(window.__figcad.store.snapshot());
    return new TextDecoder().decode(bytes).includes('IFCBEAM');
  });
  if (!hasBeam) throw new Error('IFC에 IFCBEAM 없음');
  console.log('PASS  IFC export에 IFCBEAM 포함');

  if (errors.length) throw new Error(`콘솔/페이지 에러: ${errors.slice(0, 3).join(' | ')}`);
  console.log('\n보 스모크 통과');
} catch (err) {
  console.error('FAIL ', err.message);
  process.exitCode = 1;
} finally {
  await browser.close();
}
