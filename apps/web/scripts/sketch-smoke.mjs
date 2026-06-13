/**
 * M9-A 스케치 캡처 스모크 (API 무관) — 펜/마우스 손그림 → 문서공간 스트로크 → 래스터화 + mm 프레임.
 * 실제 vision 호출은 프로덕션 E2E(별도). 여기선 캡처·래스터·UI 배선만.
 * 사전: vite dev. 사용: node scripts/sketch-smoke.mjs [vite 포트=5173]
 */
import puppeteer from 'puppeteer-core';

const port = process.argv[2] ?? '5173';
const room = `e2e-sketch-${Math.random().toString(36).slice(2, 8)}`;

const browser = await puppeteer.launch({
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  headless: true,
});

try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 200)); });
  await page.goto(`http://localhost:${port}/?p=${room}`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__figcad?.sketch, { timeout: 10000 });

  // 1) 스케치 도구 선택 → AI 패널 자동 표시
  await page.evaluate(() => {
    window.__figcad.ui.getState().setViewMode('plan');
    window.__figcad.ui.getState().setTool('sketch');
  });
  await new Promise((r) => setTimeout(r, 300));
  const aiOpen = await page.evaluate(() => window.__figcad.ui.getState().aiOpen);
  if (!aiOpen) throw new Error('스케치 도구가 AI 패널을 안 열음');
  console.log('PASS  스케치 도구 → AI 패널 자동 표시');

  // 2) 마우스로 사각형 손그림 (4변 = 4 스트로크)
  const seg = async (x1, y1, x2, y2) => {
    await page.mouse.move(x1, y1);
    await page.mouse.down();
    const N = 6;
    for (let i = 1; i <= N; i++) {
      await page.mouse.move(x1 + ((x2 - x1) * i) / N, y1 + ((y2 - y1) * i) / N);
    }
    await page.mouse.up();
    await new Promise((r) => setTimeout(r, 30));
  };
  await seg(500, 350, 760, 350);
  await seg(760, 350, 760, 560);
  await seg(760, 560, 500, 560);
  await seg(500, 560, 500, 350);

  const nStrokes = await page.evaluate(() => window.__figcad.sketch.getStrokes().length);
  if (nStrokes < 4) throw new Error(`스트로크 ${nStrokes} (4 기대)`);
  if (!(await page.evaluate(() => window.__figcad.sketch.hasSketch())))
    throw new Error('hasSketch false');
  console.log(`PASS  손그림 ${nStrokes}선 캡처 (문서공간 스트로크)`);

  // 3) 래스터화 → PNG base64 + mm 프레임
  const ras = await page.evaluate(() => {
    const r = window.__figcad.sketch.rasterizeSketch();
    if (!r) return null;
    return {
      hasData: typeof r.dataB64 === 'string' && r.dataB64.length > 100,
      media: r.mediaType,
      frame: r.frame,
      w: r.frame.x1 - r.frame.x0,
      h: r.frame.y1 - r.frame.y0,
    };
  });
  if (!ras || !ras.hasData) throw new Error('래스터화 실패(빈 데이터)');
  if (ras.media !== 'image/png') throw new Error(`mediaType ${ras.media}`);
  if (!(ras.w > 0 && ras.h > 0)) throw new Error(`프레임 크기 비정상 ${ras.w}×${ras.h}`);
  console.log(`PASS  래스터화 PNG + mm 프레임 (${Math.round(ras.w)}×${Math.round(ras.h)}mm)`);

  // 4) AI 패널 스케치 칩 표시
  const chip = await page.evaluate(() =>
    [...document.querySelectorAll('.ai-sketch-chip')].some((e) => e.textContent.includes('스케치')),
  );
  if (!chip) throw new Error('AI 패널 스케치 칩 미표시');
  console.log('PASS  AI 패널 스케치 첨부 칩');

  // 5) 지우기 → hasSketch false + 칩 사라짐
  await page.evaluate(() => window.__figcad.sketch.clearSketch());
  await new Promise((r) => setTimeout(r, 150));
  if (await page.evaluate(() => window.__figcad.sketch.hasSketch()))
    throw new Error('clearSketch 후에도 hasSketch true');
  console.log('PASS  스케치 지우기');

  if (errors.length) throw new Error(`콘솔/페이지 에러: ${errors.slice(0, 3).join(' | ')}`);
  console.log('\n스케치 스모크 통과');
} catch (err) {
  console.error('FAIL ', err.message);
  process.exitCode = 1;
} finally {
  await browser.close();
}
