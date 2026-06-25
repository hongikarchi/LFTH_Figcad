// 반사 카메라 픽킹 검증 — 벽 그리고 plan뷰서 그 벽 위치 클릭 → 선택되나(렌더↔raycaster 일관성).
import puppeteer from 'puppeteer-core';
const PORT = process.env.PORT ?? '5182';
const browser = await puppeteer.launch({
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', headless: 'new',
  args: ['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist', '--window-size=1300,1000'],
});
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1300, height: 1000 });
  await page.goto(`http://localhost:${PORT}/?p=pickZ9`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__figcad?.store && window.__figcad?.seed, { timeout: 20000 });

  // 벽 1개 + plan뷰, 벽 중점 월드→화면px 계산
  const target = await page.evaluate(() => {
    const F = window.__figcad, st = F.store, seed = F.seed;
    const id = st.createWall({ levelId: seed.levelId, typeId: seed.wallTypeIds[0], a: [-3000, 2000], b: [3000, 2000] });
    F.rig.setMode('plan'); F.rig.tick(2);
    F.rig.fitBounds({ x: -5, y: -1, z: -1 }, { x: 5, y: 1, z: 5 });
    F.engine.requestRender();
    // 벽 중점 (0, 0.05, 2) 미터 → NDC → 뷰포트 px
    const cam = F.rig.active; cam.updateMatrixWorld(true);
    const e = cam.matrixWorldInverse.elements, p = cam.projectionMatrix.elements;
    const x=0, y=0.05, z=2;
    const vx=e[0]*x+e[4]*y+e[8]*z+e[12], vy=e[1]*x+e[5]*y+e[9]*z+e[13], vz=e[2]*x+e[6]*y+e[10]*z+e[14], vw=e[3]*x+e[7]*y+e[11]*z+e[15];
    const cx=(p[0]*vx+p[4]*vy+p[8]*vz+p[12]*vw), cy=(p[1]*vx+p[5]*vy+p[9]*vz+p[13]*vw), cw=(p[3]*vx+p[7]*vy+p[11]*vz+p[15]*vw);
    const ndcX=cx/cw, ndcY=cy/cw;
    return { id, px: (ndcX*0.5+0.5)*window.innerWidth, py: (-ndcY*0.5+0.5)*window.innerHeight, ndcX:+ndcX.toFixed(3), ndcY:+ndcY.toFixed(3) };
  });
  console.log('벽 중점 화면px:', JSON.stringify(target));

  // 그 px 클릭 (실제 입력 파이프라인 → SelectTool → Picker raycaster)
  await page.mouse.click(target.px, target.py);
  await new Promise((r) => setTimeout(r, 400));
  const sel = await page.evaluate(() => {
    const ui = window.__figcad.ui?.getState?.();
    return { selection: ui?.selection ?? null, selLen: (ui?.selection ?? []).length };
  });
  console.log('클릭 후 선택:', JSON.stringify(sel), sel.selLen > 0 && sel.selection.includes(target?.id) ? '' : '');
  console.log(sel.selLen > 0 ? '✓ 벽 선택됨 = 픽킹 정상(렌더↔raycaster 일치)' : '✗ 선택 안 됨 = 픽킹 깨짐');
  await page.screenshot({ path: 'apps/web/scripts/pick-test.png' });
} finally { await browser.close(); }
