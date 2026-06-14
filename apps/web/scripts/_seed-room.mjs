/**
 * 테스트용 룸 시드 — DEV 앱으로 룸 하나에 벽·슬라브 생성(miniflare 영속). Rhino 커넥터 왕복 검증용.
 * 사용: node _seed-room.mjs [vite포트=5173] [room=rhino-rt]
 */
import puppeteer from 'puppeteer-core';

const vitePort = process.argv[2] ?? '5173';
const room = process.argv[3] ?? 'rhino-rt';
const browser = await puppeteer.launch({
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  headless: true,
});
try {
  const page = await browser.newPage();
  page.on('dialog', (d) => d.accept('시드'));
  await page.goto(`http://localhost:${vitePort}/?p=${room}`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__figcad?.store, { timeout: 10000 });
  const r = await page.evaluate(() => {
    const { store, seed } = window.__figcad;
    const L = seed.levelId, T = seed.wallTypeIds[0], S = seed.slabTypeId;
    const ids = [];
    ids.push(store.createWall({ levelId: L, typeId: T, a: [0, 0], b: [6000, 0] }));
    ids.push(store.createWall({ levelId: L, typeId: T, a: [6000, 0], b: [6000, 4000] }));
    ids.push(store.createSlab({ levelId: L, typeId: S, boundary: [[0, 0], [6000, 0], [6000, 4000], [0, 4000]] }));
    return { L, T, S, ids, count: store.listElements().length };
  });
  console.log('SEEDED', room, JSON.stringify(r));
  await new Promise((res) => setTimeout(res, 1800)); // 서버 동기 대기
} finally {
  await browser.close();
}
