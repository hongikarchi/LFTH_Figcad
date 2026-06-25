// plan 뷰 방향 실증 — 네이티브 벽으로 L자 마커 그려 +X(동)/+Y(북)이 화면 어디로 가나 확인.
// CAD 표준 = +X 오른쪽, +Y 위. Figcad plan이 미러/회전인지 판정.
import puppeteer from 'puppeteer-core';
const PORT = process.env.PORT ?? '5179';
const browser = await puppeteer.launch({
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  headless: 'new',
  args: ['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist', '--window-size=1200,1200'],
});
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1200, height: 1200 });
  page.on('pageerror', (e) => console.log('ERR', e));
  await page.goto(`http://localhost:${PORT}/?p=orientZ9`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__figcad?.store && window.__figcad?.seed, { timeout: 20000 });

  await page.evaluate(() => {
    const F = window.__figcad, st = F.store, seed = F.seed;
    const wt = seed.wallTypeIds[0], lv = seed.levelId;
    // +X 축(동) 6m + 끝 마커, +Y 축(북) 6m + 끝 마커
    st.createWall({ levelId: lv, typeId: wt, a: [0, 0], b: [6000, 0] });       // +X
    st.createWall({ levelId: lv, typeId: wt, a: [6000, 0], b: [6000, 1500] });  // +X 끝 마커(위로)
    st.createWall({ levelId: lv, typeId: wt, a: [0, 0], b: [0, 6000] });       // +Y
    st.createWall({ levelId: lv, typeId: wt, a: [0, 6000], b: [1500, 6000] }); // +Y 끝 마커(오른쪽)
    F.rig.setNorthUp();
    F.engine.requestRender();
  });
  // 3D 뷰(기본) — 동/북 위치 확인
  await new Promise((r) => setTimeout(r, 400));
  await page.evaluate(() => { const F = window.__figcad; F.rig.fitBounds({ x: -1, y: -1, z: -1 }, { x: 8, y: 3, z: 8 }); F.engine.requestRender(); });
  await new Promise((r) => setTimeout(r, 600));
  await page.screenshot({ path: 'apps/web/scripts/orient-3d.png' });
  // plan 뷰 north-up
  await page.evaluate(() => {
    const F = window.__figcad;
    F.rig.setMode('plan'); F.rig.setNorthUp(); F.rig.tick(2);
    F.rig.fitBounds({ x: -1, y: -1, z: -1 }, { x: 8, y: 1, z: 8 });
    F.engine.requestRender();
  });
  await new Promise((r) => setTimeout(r, 800));
  const diag = await page.evaluate(() => {
    const c = window.__figcad.rig.active;
    return { projX: c.projectionMatrix.elements[0], type: c.type };
  });
  console.log('projectionMatrix.elements[0]:', JSON.stringify(diag), '(음수=X반사 적용됨)');
  await page.screenshot({ path: 'apps/web/scripts/orient-test.png' });
  console.log('마커: +X축(동) 끝에 위로, +Y축(북) 끝에 오른쪽(+X방향). CAD표준=+X오른쪽/+Y위. 3D=orient-3d.png, plan=orient-test.png');
} finally {
  await browser.close();
}
