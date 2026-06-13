/**
 * M11 Phase 3 fork 스모크 — 한 룸의 스냅샷을 localStorage로 핸드오프 → 새 룸이
 * 로드 시 importSnapshot으로 그 콘텐츠를 채우는지(클라 주도 fork) 검증.
 * 사전: vite dev. 사용: node scripts/fork-smoke.mjs [포트=5173]
 */
import puppeteer from 'puppeteer-core';

const port = process.argv[2] ?? '5173';
const srcRoom = `fork-src-${Math.random().toString(36).slice(2, 7)}`;
const dstRoom = `fork-dst-${Math.random().toString(36).slice(2, 7)}`;

const browser = await puppeteer.launch({
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  headless: true,
});

try {
  const page = await browser.newPage();
  page.on('dialog', (d) => d.accept('fork테스터'));
  const errors = [];
  const ignore = (t) => /WebSocket|ERR_CONNECTION_REFUSED|parties\/doc/.test(t);
  page.on('pageerror', (e) => !ignore(e.message) && errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && !ignore(m.text()) && errors.push(m.text().slice(0, 200)));

  // 1) 소스 룸에 콘텐츠 생성 + 스냅샷을 dst 룸 fork 핸드오프로 localStorage에 저장
  await page.goto(`http://localhost:${port}/?p=${srcRoom}`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__figcad?.store, { timeout: 10000 });
  await page.evaluate((dst) => {
    const { store, seed } = window.__figcad;
    store.createWall({ levelId: seed.levelId, typeId: seed.wallTypeIds[0], a: [0, 0], b: [5000, 0] });
    store.createWall({ levelId: seed.levelId, typeId: seed.wallTypeIds[0], a: [5000, 0], b: [5000, 4000] });
    store.createZone({ levelId: seed.levelId, boundary: [[0, 0], [5000, 0], [5000, 4000], [0, 4000]], name: '거실' });
    localStorage.setItem(`figcad.fork:${dst}`, JSON.stringify(store.snapshot()));
  }, dstRoom);
  console.log('PASS  소스 룸 콘텐츠 + fork 핸드오프 저장 (벽2+존1)');

  // 2) 대상 룸(새 프로젝트)으로 이동 → main.ts가 sync/타임아웃 후 importSnapshot
  await page.goto(`http://localhost:${port}/?p=${dstRoom}`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__figcad?.store, { timeout: 10000 });
  // 2.5s 폴백 임포트 대기
  await page.waitForFunction(
    () => {
      const els = window.__figcad.store.listElements();
      return els.filter((e) => e.kind === 'wall').length === 2 && els.some((e) => e.kind === 'zone');
    },
    { timeout: 6000 },
  );
  const counts = await page.evaluate(() => {
    const els = window.__figcad.store.listElements();
    return { walls: els.filter((e) => e.kind === 'wall').length, zones: els.filter((e) => e.kind === 'zone').length };
  });
  if (counts.walls !== 2 || counts.zones !== 1) throw new Error(`fork 콘텐츠 불일치 ${JSON.stringify(counts)}`);
  console.log(`PASS  새 룸에 fork 콘텐츠 채워짐 (벽 ${counts.walls}, 존 ${counts.zones})`);

  // 3) 핸드오프 키 소비됨 (재import 방지)
  const consumed = await page.evaluate((dst) => localStorage.getItem(`figcad.fork:${dst}`) === null, dstRoom);
  if (!consumed) throw new Error('fork localStorage 키 미소비');
  console.log('PASS  fork 핸드오프 키 소비됨');

  if (errors.length) throw new Error(`콘솔/페이지 에러: ${errors.slice(0, 3).join(' | ')}`);
  console.log('\nfork 스모크 통과');
} catch (err) {
  console.error('FAIL ', err.message);
  process.exitCode = 1;
} finally {
  await browser.close();
}
