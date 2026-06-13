/**
 * M7 IFC 브라우저 스모크 — 실제 브라우저에서 WASM(?url) 로드 + export→import 라운드트립.
 * node 라운드트립 테스트(vitest)와 별개로 브라우저 WASM 로딩 경로를 확인한다.
 * 사용: node scripts/ifc-smoke.mjs [vite 포트=5173]
 */
import puppeteer from 'puppeteer-core';

const port = process.argv[2] ?? '5173';
const room = `e2e-ifc-${Math.random().toString(36).slice(2, 8)}`;

const browser = await puppeteer.launch({
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  headless: true,
});

try {
  const page = await browser.newPage();
  page.on('dialog', (d) => d.accept('IFC테스터'));
  await page.goto(`http://localhost:${port}/?p=${room}`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__figcad?.ifc, { timeout: 15000 });

  // 방 하나 + 문 + 슬라브
  await page.evaluate(() => {
    const { store, seed } = window.__figcad;
    const L = seed.levelId;
    const T = seed.wallTypeIds[0];
    const s = store.createWall({ levelId: L, typeId: T, a: [0, 0], b: [4000, 0] });
    store.createWall({ levelId: L, typeId: T, a: [4000, 0], b: [4000, 3000] });
    store.createWall({ levelId: L, typeId: T, a: [4000, 3000], b: [0, 3000] });
    store.createWall({ levelId: L, typeId: T, a: [0, 3000], b: [0, 0] });
    store.createOpening({ hostId: s, typeId: seed.doorTypeId, offset: 2000 });
    store.createSlab({ levelId: L, typeId: seed.slabTypeId, boundary: [[0, 0], [4000, 0], [4000, 3000], [0, 3000]] });
  });

  // 브라우저 WASM export → import 라운드트립 (ifcClient 실제 경로 — Vite가 web-ifc 해석)
  const rt = await page.evaluate(async () => {
    const { store, ifc } = window.__figcad;
    const bytes = await ifc.exportIfcBytes(store.snapshot());
    const header = new TextDecoder().decode(bytes.slice(0, 12));
    const parsed = await ifc.parseIfc(bytes);
    const els = parsed.snapshot.elements;
    return {
      header,
      bytes: bytes.length,
      walls: els.filter((e) => e.kind === 'wall').length,
      slabs: els.filter((e) => e.kind === 'slab').length,
      openings: els.filter((e) => e.kind === 'opening').length,
      snapshot: parsed.snapshot,
    };
  });
  if (rt.header !== 'ISO-10303-21') throw new Error(`IFC 헤더 불량: ${rt.header}`);
  if (rt.walls !== 4 || rt.slabs !== 1 || rt.openings !== 1)
    throw new Error(`복원 불일치 벽${rt.walls}/슬라브${rt.slabs}/개구부${rt.openings}`);
  console.log(`PASS  브라우저 WASM export→import — ${rt.bytes}B, 벽4/슬라브1/개구부1 복원`);

  // importSnapshot으로 문서 교체 → 씬 반영
  await page.evaluate((snap) => window.__figcad.store.importSnapshot(snap), rt.snapshot);
  const after = await page.evaluate(() => window.__figcad.store.listElements().length);
  if (after !== rt.walls + rt.slabs + rt.openings)
    throw new Error(`importSnapshot 후 ${after}개`);
  console.log(`PASS  importSnapshot 적용 — 문서 요소 ${after}개`);

  console.log('\nIFC 스모크 통과');
} catch (err) {
  console.error('FAIL ', err.message);
  process.exitCode = 1;
} finally {
  await browser.close();
}
