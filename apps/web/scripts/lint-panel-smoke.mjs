/**
 * M5 검사 패널 스모크 — 결함 주입 → 배지 카운트 → 패널 목록 → 원클릭 수정 → 요소 점프.
 * 사전 조건: vite dev(5173) + apps/server dev-node.mjs(8787) 구동 중.
 * 사용: node scripts/lint-panel-smoke.mjs [vite 포트=5173]
 */
import puppeteer from 'puppeteer-core';

const port = process.argv[2] ?? '5173';
const room = `e2e-lint-${Math.random().toString(36).slice(2, 8)}`;
const url = `http://localhost:${port}/?p=${room}`;

const browser = await puppeteer.launch({
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  headless: true,
});

try {
  const page = await browser.newPage();
  page.on('dialog', (d) => d.accept('검사테스터'));
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__figcad?.store, { timeout: 10000 });

  // 결함 주입: ① 15mm 갭 미접합 ② 완전 중복 벽
  await page.evaluate(() => {
    const { store, seed } = window.__figcad;
    store.createWall({ levelId: seed.levelId, typeId: seed.wallTypeIds[0], a: [0, 0], b: [3000, 0] });
    store.createWall({ levelId: seed.levelId, typeId: seed.wallTypeIds[0], a: [3015, 0], b: [3015, 3000] });
    store.createWall({ levelId: seed.levelId, typeId: seed.wallTypeIds[0], a: [0, 0], b: [3000, 0] }); // 중복
  });

  // 배지에 발견 수 표시 (중복 1 + 미접합 ≥1)
  await page.waitForFunction(
    () => /검사 \d+/.test(document.querySelector('.qo-lint')?.textContent ?? ''),
    { timeout: 5000 },
  );
  const badge = await page.evaluate(() => document.querySelector('.qo-lint').textContent);
  console.log(`PASS  배지 카운트 표시 — "${badge}"`);

  // 패널 열기 → 항목 확인
  await page.click('.qo-lint');
  await page.waitForSelector('.lint-panel', { timeout: 5000 });
  const items = await page.evaluate(() =>
    [...document.querySelectorAll('.lint-item .lint-msg')].map((m) => m.textContent),
  );
  if (items.length < 2) throw new Error(`발견 ${items.length}건 — 2건 이상 기대`);
  console.log(`PASS  패널 발견 ${items.length}건:`);
  for (const s of items) console.log('      · ' + s);
  if (!items.some((s) => s.includes('중복'))) throw new Error('중복 발견 누락');
  if (!items.some((s) => s.includes('15mm'))) throw new Error('미접합 갭 발견 누락');

  // 원클릭 수정 (중복 삭제) → 발견 수 감소 + 문서에서 실제 삭제
  const before = await page.evaluate(() => window.__figcad.store.listElements().length);
  await page.click('.lint-fix');
  await page.waitForFunction(
    (n) => window.__figcad.store.listElements().length === n - 1,
    { timeout: 5000 },
    before,
  );
  const itemsAfter = await page.evaluate(() => document.querySelectorAll('.lint-item').length);
  if (itemsAfter !== items.length - 1) throw new Error(`수정 후 ${itemsAfter}건 — ${items.length - 1}건 기대`);
  console.log(`PASS  원클릭 수정 — 중복 삭제, 발견 ${items.length}→${itemsAfter}건`);

  // 요소 점프 — 행 클릭 시 해당 요소 선택
  await page.click('.lint-item');
  const selected = await page.evaluate(() => {
    // zustand 스토어는 모듈 내부 — 선택 결과는 store 요소 존재 여부로 간접 확인 불가하므로
    // InfoBox에 선택 컨텍스트가 뜨는지로 검증
    return document.querySelector('.infobox')?.textContent ?? '';
  });
  if (!selected.includes('벽')) throw new Error(`점프 후 InfoBox에 벽 선택 미표시: "${selected}"`);
  console.log('PASS  행 클릭 → 요소 선택(InfoBox 컨텍스트 표시)');

  console.log('\n검사 패널 스모크 통과');
} catch (err) {
  console.error('FAIL ', err.message);
  process.exitCode = 1;
} finally {
  await browser.close();
}
