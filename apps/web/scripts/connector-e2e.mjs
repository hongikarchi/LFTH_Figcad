/**
 * M10 connector E2E — ?op=apply 라이브쓰기 broadcast + ?op=pull + 부분실패 + 무인 영속.
 * 사전: vite dev + miniflare dev.mjs(8787, 실 Doc DO). dev-node는 broadcast 미보장 → dev.mjs 필수.
 * 사용: node connector-e2e.mjs [vite포트=5173] [서버포트=8787]
 */
import puppeteer from 'puppeteer-core';

const vitePort = process.argv[2] ?? '5173';
const srv = `http://localhost:${process.argv[3] ?? '8787'}`;
const room = `e2e-conn-${Math.random().toString(36).slice(2, 8)}`;

const apply = (ops) =>
  fetch(`${srv}/parties/doc/${room}?op=apply`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ops }),
  }).then((r) => r.json());

const browser = await puppeteer.launch({
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  headless: true,
});

try {
  const page = await browser.newPage();
  page.on('dialog', (d) => d.accept('커넥터'));
  await page.goto(`http://localhost:${vitePort}/?p=${room}`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__figcad?.store, { timeout: 10000 });
  await new Promise((r) => setTimeout(r, 1500)); // 시드 + 서버 동기 대기
  const seed = await page.evaluate(() => {
    const s = window.__figcad.seed;
    return { levelId: s.levelId, typeId: s.wallTypeIds[0] };
  });

  // 1) ?op=pull — 서버가 클라 시드를 동기받아 라이브 스냅샷 반환
  const snap = await fetch(`${srv}/parties/doc/${room}?op=pull`).then((r) => r.json());
  if (!snap.levels?.length || !snap.types?.length)
    throw new Error(`pull 스냅샷에 시드 없음(미동기): ${JSON.stringify(snap).slice(0, 200)}`);
  console.log(`PASS  ?op=pull 라이브 스냅샷 (레벨 ${snap.levels.length}·타입 ${snap.types.length})`);

  // 2) ?op=apply — 벽 oplog POST → 서버 mutate → broadcast → 접속 클라 수신
  const res = await apply([
    { op: 'create_wall', args: { levelId: seed.levelId, typeId: seed.typeId, a: [0, 0], b: [4200, 0] } },
  ]);
  if (res.applied !== 1 || !res.createdIds?.length) throw new Error(`apply 실패: ${JSON.stringify(res)}`);
  const wallId = res.createdIds[0];
  await page.waitForFunction(
    (id) => window.__figcad.store.getElement(id)?.kind === 'wall',
    { timeout: 8000 },
    wallId,
  );
  console.log(`PASS  ?op=apply → broadcast → 접속 클라 수신 (벽 ${wallId})`);

  // 3) 부분 실패 보고 — 0길이 벽(createWall throw)은 failed로 격리, 나머지는 적용
  const bad = await apply([
    { op: 'create_wall', args: { levelId: seed.levelId, typeId: seed.typeId, a: [0, 0], b: [0, 0] } },
  ]);
  if (bad.failed?.length !== 1 || bad.applied !== 0)
    throw new Error(`0길이 벽이 failed로 안 잡힘: ${JSON.stringify(bad)}`);
  console.log(`PASS  부분 실패 보고 (failed ${bad.failed.length}, applied ${bad.applied})`);

  // 3b) DoS 방어 — count 폭탄(array_elements count=1e9)은 실행 전 413
  const bomb = await fetch(`${srv}/parties/doc/${room}?op=apply`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ops: [{ op: 'array_elements', args: { ids: [], delta: [0, 0], count: 1e9 } }] }),
  });
  if (bomb.status !== 413) throw new Error(`count 폭탄이 ${bomb.status} (413 기대 — DoS 방어 실패)`);
  console.log('PASS  count 폭탄 → 413 (배치 작업 예산 방어)');

  // 4) 무인 영속 — 유일 클라 닫고 apply → 새 클라가 기존+신규 둘 다 봄 (onSave + onLoad)
  await page.close();
  await new Promise((r) => setTimeout(r, 600));
  const res2 = await apply([
    { op: 'create_wall', args: { levelId: seed.levelId, typeId: seed.typeId, a: [0, 3000], b: [4200, 3000] } },
  ]);
  const wall2 = res2.createdIds?.[0];
  if (!wall2) throw new Error(`무인 apply 실패: ${JSON.stringify(res2)}`);
  const page2 = await browser.newPage();
  page2.on('dialog', (d) => d.accept('새클라'));
  await page2.goto(`http://localhost:${vitePort}/?p=${room}`, { waitUntil: 'load' });
  await page2.waitForFunction(() => window.__figcad?.store, { timeout: 10000 });
  await page2.waitForFunction(
    (id) => window.__figcad.store.getElement(id)?.kind === 'wall',
    { timeout: 8000 },
    wall2,
  );
  const both = await page2.evaluate(
    (a, b) => ({ a: !!window.__figcad.store.getElement(a), b: !!window.__figcad.store.getElement(b) }),
    wallId,
    wall2,
  );
  if (!both.a || !both.b) throw new Error(`무인 apply 후 상태 손실(클로버): ${JSON.stringify(both)}`);
  console.log('PASS  무인 apply → onSave 영속 → 새 클라가 기존+신규 둘 다 봄');

  console.log('\n커넥터 E2E 통과');
} catch (err) {
  console.error('FAIL ', err.message);
  process.exitCode = 1;
} finally {
  await browser.close();
}
