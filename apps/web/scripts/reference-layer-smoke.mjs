/**
 * F6 Phase 0 스모크 — 읽기전용 레퍼런스 채널(ReferenceLayer)이 외부 메시를 씬에
 * 렌더하되 문서(store) 밖에 있음을 증명. 사전: vite dev. 사용: node scripts/reference-layer-smoke.mjs [포트=5173]
 */
import puppeteer from 'puppeteer-core';

const port = process.argv[2] ?? '5173';
const room = `e2e-ref-${Math.random().toString(36).slice(2, 8)}`;

const browser = await puppeteer.launch({
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  headless: true,
});

try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });
  const errors = [];
  const ignore = (t) => /WebSocket|ERR_CONNECTION_REFUSED|parties\/doc/.test(t);
  page.on('pageerror', (e) => { if (!ignore(e.message)) errors.push(e.message); });
  page.on('console', (m) => { if (m.type() === 'error' && !ignore(m.text())) errors.push(m.text().slice(0, 200)); });

  await page.goto(`http://localhost:${port}/?p=${room}`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__figcad?.referenceLayer, { timeout: 10000 });

  // 외부 모델(데모 박스 2개) 로드 → 씬에 렌더, 그러나 문서엔 안 들어감
  const r = await page.evaluate(() => {
    const { referenceLayer, store, engine } = window.__figcad;
    const elemsBefore = store.listElements().length;
    referenceLayer.addDemo();
    // 'figcad-reference' 그룹 안의 레퍼런스 메시 수
    let refMeshes = 0;
    let refGroup = null;
    engine.scene.traverse((o) => {
      if (o.name === 'figcad-reference') refGroup = o;
      if (o.isMesh && o.userData?.figcadReference) refMeshes++;
    });
    return {
      list: referenceLayer.list(),
      refMeshes,
      hasGroup: !!refGroup,
      elemsBefore,
      elemsAfter: store.listElements().length, // 불변: 변화 없어야 함
    };
  });

  if (!r.hasGroup) throw new Error('figcad-reference 그룹이 씬에 없음');
  if (!r.list.includes('demo')) throw new Error(`레퍼런스 소스 목록 불량: ${JSON.stringify(r.list)}`);
  if (r.refMeshes < 2) throw new Error(`레퍼런스 메시 ${r.refMeshes}개 (기대 ≥2)`);
  console.log(`PASS  외부 모델 로드 → 씬에 레퍼런스 메시 ${r.refMeshes}개`);

  if (r.elemsAfter !== r.elemsBefore)
    throw new Error(`레퍼런스가 문서를 변경함: ${r.elemsBefore}→${r.elemsAfter} (불변① 위반)`);
  console.log(`PASS  문서 밖 — store.listElements() 불변 (${r.elemsAfter}개, 레퍼런스는 클라 로컬 뷰)`);

  // 가시성 토글
  const vis = await page.evaluate(() => {
    const { referenceLayer, engine } = window.__figcad;
    referenceLayer.setVisible('demo', false);
    let g = null;
    engine.scene.traverse((o) => { if (o.name === 'reference:demo') g = o; });
    const hidden = g ? g.visible : null;
    referenceLayer.setVisible('demo', true);
    const shown = g ? g.visible : null;
    return { hidden, shown };
  });
  if (vis.hidden !== false || vis.shown !== true)
    throw new Error(`가시성 토글 불량: ${JSON.stringify(vis)}`);
  console.log('PASS  가시성 토글 (숨김/표시)');

  // clear → 비고 dispose
  const cleared = await page.evaluate(() => {
    const { referenceLayer } = window.__figcad;
    referenceLayer.clear();
    return referenceLayer.list().length;
  });
  if (cleared !== 0) throw new Error(`clear 후 소스 ${cleared}개 남음`);
  console.log('PASS  clear → 소스 0개 (dispose)');

  if (errors.length) throw new Error(`콘솔/페이지 에러: ${errors.slice(0, 3).join(' | ')}`);
  console.log('\n레퍼런스 채널 스모크 통과');
} catch (err) {
  console.error('FAIL ', err.message);
  process.exitCode = 1;
} finally {
  await browser.close();
}
