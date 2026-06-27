// DWG 언더레이 2D plan 뷰 — libredwg WASM 파싱 + frozen 존중 + ortho top-down, 건물 축 정렬.
// 전제: vite dev + apps/web/public/__dwgtest.dwg. 사용: PORT=5179 node apps/web/scripts/dwg-underlay-smoke.mjs
import puppeteer from 'puppeteer-core';

const PORT = process.env.PORT ?? '5179';
const url = `http://localhost:${PORT}/?p=dwgsmoke`;

const browser = await puppeteer.launch({
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  headless: 'new',
  args: ['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist', '--window-size=1600,1100'],
});
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1600, height: 1100 });
  const errs = [];
  page.on('console', (m) => { const t = m.text(); if (/error|fail|wasm|libredwg/i.test(t)) console.log('[page]', t); });
  page.on('pageerror', (e) => errs.push(String(e)));
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__figcad?.dwg?.parseDwgUnderlay && window.__figcad?.referenceLayer, { timeout: 20000 });

  const result = await page.evaluate(async () => {
    const F = window.__figcad;
    const u = await F.dwg.parseDwgUnderlay(await (await fetch('/__dwgtest.dwg')).arrayBuffer(), 'dwg');
    const [dx, dy] = F.dwg.underlayDenseCenter(u);
    F.referenceLayer.addUnderlay('smoke', u, { origin: [-dx, -dy], rotation: 0, scale: 1 }, 0);

    // 지배 벽 각도(벽=직교 → 90° 폴드, 길이가중) — 뷰 정렬용
    const bins = new Float64Array(90);
    let vis = 0;
    for (let i = 0; i < u.segments.length; i += 4) {
      if (u.layerHidden[u.segLayer[i / 4]]) continue;
      vis++;
      const ax = u.segments[i + 2] - u.segments[i], ay = u.segments[i + 3] - u.segments[i + 1];
      const len = Math.hypot(ax, ay);
      if (len > 300) { let deg = ((Math.atan2(ay, ax) * 180 / Math.PI) % 90 + 90) % 90; bins[Math.min(89, Math.floor(deg))] += len; }
    }
    let dom = 0; for (let k = 1; k < 90; k++) if (bins[k] > bins[dom]) dom = k;
    window.__dom = dom;
    return { visibleSegs: vis, dominantWallDeg: dom };
  });

  // ortho plan 모드 (tick으로 트윈 강제 완료)
  await page.evaluate(() => { const F = window.__figcad; F.rig.setMode('plan'); F.rig.tick(2); F.engine.requestRender(); });

  // 뷰를 건물 축에 정렬 — setNorthUp(θ=π) 후 지배각만큼 회전(rotate: θ -= dx*0.005, plan=θ만)
  await page.evaluate(() => {
    const F = window.__figcad, dom = window.__dom * Math.PI / 180;
    F.rig.setNorthUp();
    F.rig.rotate(dom / 0.005, 0); // θ를 dom만큼 — 기운 벽을 수평/수직으로
    F.referenceLayer.setPlanFlipped(true); // plan X-반사 상쇄(텍스트 정방향) — 실앱 경로
    F.sceneManager?.setViewContext?.('plan', null);
    F.rig.tick(2);
    F.engine.requestRender();
  });
  await new Promise((r) => setTimeout(r, 500));

  const shot = async (half, name) => {
    await page.evaluate((h) => { window.__figcad.rig.fitBounds({ x: -h, y: -3, z: -h }, { x: h, y: 3, z: h }); window.__figcad.engine.requestRender(); }, half);
    await new Promise((r) => setTimeout(r, 700));
    await page.screenshot({ path: `apps/web/scripts/${name}.png` });
  };
  await shot(45, 'dwg-underlay-zoom'); // 빌딩 전체
  await shot(7, 'dwg-underlay-1f');    // 방 몇 개 — 텍스트(방이름·치수) 가독 확인

  console.log(JSON.stringify({ ...result, pageErrors: errs }, null, 2));
} finally {
  await browser.close();
}
