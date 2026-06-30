/**
 * M6 버전 관리 스모크 — 커밋 → 타임라인 → 무변경 스킵 → 수정 → 재커밋 → 비교 → 복원.
 * 사전 조건: vite dev + apps/server dev.mjs(miniflare — R2 에뮬레이션 포함).
 * 사용: node scripts/version-smoke.mjs [vite 포트=5173]
 */
import puppeteer from 'puppeteer-core';

const port = process.argv[2] ?? '5173';
const room = `e2e-ver-${Math.random().toString(36).slice(2, 8)}`;

const browser = await puppeteer.launch({
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  headless: true,
});

try {
  const page = await browser.newPage();
  page.on('dialog', (d) => d.accept('버전테스터')); // 이름 prompt + 복원 confirm 둘 다 수락
  await page.goto(`http://localhost:${port}/?p=${room}`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__figcad?.store, { timeout: 10000 });

  // 벽 2개 생성 후 패널 열고 첫 커밋
  await page.evaluate(() => {
    const { store, seed } = window.__figcad;
    store.createWall({ levelId: seed.levelId, typeId: seed.wallTypeIds[0], a: [0, 0], b: [4000, 0] });
    store.createWall({ levelId: seed.levelId, typeId: seed.wallTypeIds[0], a: [4000, 0], b: [4000, 3000] });
  });
  // iter-2 reorg: 버전 패널은 '협업·리뷰' 모드 WorkRail에 임베드된 섹션(.rail-section)으로 이동.
  // 기존 .quick-options '버전' 버튼은 제거됨 → 모드를 review로 두면 패널이 렌더된다(기본값도 review).
  await page.evaluate(() => {
    window.__figcad.ui.getState().setMode('review');
  });
  await page.waitForSelector('.ver-commit', { timeout: 5000 });
  await page.type('.ver-commit input', '벽 2개 — 첫 커밋');
  await page.click('.ver-commit button');
  await page.waitForFunction(
    () => document.querySelectorAll('.ver-item').length === 1,
    { timeout: 10000 },
  );
  console.log('PASS  첫 커밋 → 타임라인 1건');

  // 무변경 재커밋 → 스킵
  await page.type('.ver-commit input', '같은 내용');
  await page.click('.ver-commit button');
  await page.waitForFunction(
    () => document.querySelector('.ver-notice')?.textContent.includes('스킵'),
    { timeout: 10000 },
  );
  const items1 = await page.evaluate(() => document.querySelectorAll('.ver-item').length);
  if (items1 !== 1) throw new Error(`스킵인데 타임라인 ${items1}건`);
  console.log('PASS  무변경 커밋 → 해시 dedup 스킵');

  // 벽 추가 → 재커밋 → 2건
  await page.evaluate(() => {
    const { store, seed } = window.__figcad;
    store.createWall({ levelId: seed.levelId, typeId: seed.wallTypeIds[0], a: [4000, 3000], b: [0, 3000] });
  });
  await page.type('.ver-commit input', '벽 추가');
  await page.click('.ver-commit button');
  await page.waitForFunction(
    () => document.querySelectorAll('.ver-item').length === 2,
    { timeout: 10000 },
  );
  console.log('PASS  변경 후 재커밋 → 타임라인 2건');

  // 첫 커밋과 비교 — "이후 변경 +1"
  await page.evaluate(() => {
    const items = [...document.querySelectorAll('.ver-item')];
    [...items[1].querySelectorAll('button')].find((b) => b.textContent === '비교').click();
  });
  await page.waitForSelector('.ver-diff', { timeout: 10000 });
  const diffText = await page.evaluate(() => document.querySelector('.ver-diff').textContent);
  if (!diffText.includes('+1')) throw new Error(`diff에 +1 기대: "${diffText}"`);
  console.log(`PASS  시맨틱 diff — "${diffText.trim()}"`);

  // 첫 커밋으로 복원 → 요소 수 3 → 2 (+ undo로 되돌리기 확인)
  await page.evaluate(() => {
    const items = [...document.querySelectorAll('.ver-item')];
    [...items[1].querySelectorAll('button')].find((b) => b.textContent === '복원').click();
  });
  await page.waitForFunction(
    () => window.__figcad.store.listElements().length === 2,
    { timeout: 10000 },
  );
  console.log('PASS  복원 → 요소 3→2개');

  console.log('\n버전 관리 스모크 통과');
} catch (err) {
  console.error('FAIL ', err.message);
  process.exitCode = 1;
} finally {
  await browser.close();
}
