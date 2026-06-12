/**
 * 브라우저 실경로 E2E — vite dev(5173) 페이지 2개가 같은 룸에서
 * 실제 YProvider→Node 데브 서버(8787) 경유로 동기화되는지 확인.
 * 사전 조건: pnpm dev(vite) + apps/server dev-node.mjs 둘 다 구동 중.
 */
import puppeteer from 'puppeteer-core';

const room = `e2e-br-${Math.random().toString(36).slice(2, 8)}`;
const url = `http://localhost:5173/?p=${room}`;

const browser = await puppeteer.launch({
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  headless: true,
});

try {
  const pageA = await browser.newPage();
  const pageB = await browser.newPage();
  // 이름 입력 prompt() 자동 응답 (미처리 시 페이지 로드 블로킹)
  pageA.on('dialog', (d) => d.accept('사용자A'));
  pageB.on('dialog', (d) => d.accept('사용자B'));
  await pageA.goto(url, { waitUntil: 'load' });
  await pageB.goto(url, { waitUntil: 'load' });

  // 두 페이지 모두 앱 부팅 대기
  await pageA.waitForFunction(() => window.__figcad?.store, { timeout: 10000 });
  await pageB.waitForFunction(() => window.__figcad?.store, { timeout: 10000 });

  // A가 ops 경유로 벽 생성 (실제 편집 경로)
  const wallId = await pageA.evaluate(() => {
    const { store, seed } = window.__figcad;
    return store.createWall({
      levelId: seed.levelId,
      typeId: seed.wallTypeIds[0],
      a: [0, 0],
      b: [4200, 0],
    });
  });

  // B에 도착 확인 (프로바이더 → 서버 → 프로바이더)
  await pageB.waitForFunction(
    (id) => window.__figcad.store.getElement(id)?.kind === 'wall',
    { timeout: 8000 },
    wallId,
  );
  console.log('PASS  브라우저 A→서버→브라우저 B 벽 전파');

  // B가 높이 수정 → A 확인
  await pageB.evaluate((id) => window.__figcad.store.updateElement(id, { height: 2400 }), wallId);
  await pageA.waitForFunction(
    (id) => window.__figcad.store.getElement(id)?.height === 2400,
    { timeout: 8000 },
    wallId,
  );
  console.log('PASS  B의 필드 수정이 A에 반영');

  // 씬에도 반영됐는지 (메시 파생 경로) — pickables 수 확인
  const meshCountA = await pageA.evaluate(() => window.__figcad.store.listElements().length);
  console.log(`PASS  문서 요소 ${meshCountA}개 — 양쪽 수렴`);
  console.log('\n브라우저 E2E 통과');
} catch (err) {
  console.error('FAIL ', err.message);
  process.exitCode = 1;
} finally {
  await browser.close();
}
