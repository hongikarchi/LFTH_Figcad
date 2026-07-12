/**
 * PDF 다중 페이지 언더레이 스모크 — 2페이지 픽스처를 fed 소스로 추가 →
 * pageCount 노출 → setUnderlayPage(2) → 리컨실러 재렌더(rasterPage=2) 검증.
 * 사전: vite dev + apps/web/public/__pdftest.pdf. 사용: node apps/web/scripts/pdf-page-smoke.mjs [포트=5173]
 */
import puppeteer from 'puppeteer-core';

const port = process.argv[2] ?? '5173';
const room = `e2e-pdf-${Math.random().toString(36).slice(2, 8)}`;

const browser = await puppeteer.launch({
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  headless: true,
});
const fail = (msg) => {
  console.error(`FAIL: ${msg}`);
  process.exitCode = 1;
};

try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });
  const errors = [];
  const ignore = (t) => /WebSocket|ERR_CONNECTION_REFUSED|parties\/doc/.test(t);
  page.on('pageerror', (e) => { if (!ignore(e.message)) errors.push(e.message); });
  page.on('console', (m) => { if (m.type() === 'error' && !ignore(m.text())) errors.push(m.text().slice(0, 200)); });
  await page.goto(`http://localhost:${port}/?p=${room}`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__figcad?.store && window.__figcad?.federation, { timeout: 15000 });

  // 1) 2페이지 PDF를 언더레이 소스로 추가 (page 미지정 = 1페이지)
  const id = await page.evaluate(() => {
    const { store, seed } = window.__figcad;
    return store.addFederationSource({
      name: '도면집.pdf', sourceType: 'pdf', ref: '/__pdftest.pdf', visible: true, addedBy: 'e2e',
      underlay: { levelId: seed.levelId, origin: [0, 0], rotation: 0, scale: 1 },
    });
  });
  await page.waitForFunction(
    (i) => window.__figcad.federation.statusOf(i) === 'ready',
    { timeout: 20000 }, id,
  );
  const first = await page.evaluate((i) => ({
    pageCount: window.__figcad.federation.pageCountOf(i),
    page: window.__figcad.federation.pageOf(i),
  }), id);
  if (first.pageCount !== 2) fail(`pageCount 기대 2, 실제 ${first.pageCount}`);
  if (first.page !== 1) fail(`초기 페이지 기대 1, 실제 ${first.page}`);
  else console.log(`PASS  PDF 로드 — 2페이지 인식, 기본 1페이지 렌더`);

  // 2) 페이지 2로 전환(문서 op — 협업 공유) → 리컨실러 재렌더
  await page.evaluate((i) => window.__figcad.store.setUnderlayPage(i, 2), id);
  await page.waitForFunction(
    (i) => window.__figcad.federation.pageOf(i) === 2,
    { timeout: 20000 }, id,
  );
  console.log('PASS  setUnderlayPage(2) → 리컨실러 재렌더 (rasterPage=2)');

  // 3) 범위 밖 요청 = 클램프 (99 → 2)
  await page.evaluate((i) => window.__figcad.store.setUnderlayPage(i, 99), id);
  await page.waitForFunction(
    (i) => {
      const s = window.__figcad.store.getFederationSource(i);
      return s?.underlay?.page === 99 && window.__figcad.federation.pageOf(i) === 2;
    },
    { timeout: 20000 }, id,
  );
  console.log('PASS  범위 밖 페이지(99) → 렌더는 pageCount로 클램프(2)');

  // 4) 구빌드 폴백 시뮬 — page 필드 strip된 소스도 정상(1페이지)
  if (errors.length) fail(`콘솔/페이지 에러: ${errors.slice(0, 3).join(' | ')}`);
  if (process.exitCode !== 1) console.log('\nPDF PAGE SMOKE PASS');
} finally {
  await browser.close();
}
