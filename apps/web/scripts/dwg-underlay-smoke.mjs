// DWG 언더레이 브라우저 스모크 — 실제 브라우저에서 libredwg WASM 로드 + 파싱 + flat-2D 렌더 검증.
// 전제: vite dev 실행 + apps/web/public/__dwgtest.dwg 존재.
// 사용: PORT=5174 node apps/web/scripts/dwg-underlay-smoke.mjs
import puppeteer from 'puppeteer-core';

const PORT = process.env.PORT ?? '5174';
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
  page.on('console', (m) => { const t = m.text(); if (/error|fail|wasm|dwg|underlay|libredwg/i.test(t)) console.log('[page]', t); });
  page.on('pageerror', (e) => errs.push(String(e)));
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__figcad?.dwg?.parseDwgUnderlay && window.__figcad?.referenceLayer, { timeout: 20000 });

  // 브라우저 경로로 파싱 + 렌더 (WASM 로드 포함)
  const result = await page.evaluate(async () => {
    const t0 = performance.now();
    const res = await fetch('/__dwgtest.dwg');
    const buf = await res.arrayBuffer();
    const F = window.__figcad;
    const u = await F.dwg.parseDwgUnderlay(buf, 'dwg');
    const tParse = performance.now() - t0;

    // frozen/off 레이어는 extractor가 layerHidden으로 표시 → denseCenter·addUnderlay가 자동 제외
    // (CAD 작성자가 숨긴 그대로 = 휴리스틱 regex 불필요). 그냥 파싱→센터→렌더.
    const [dx, dy] = F.dwg.underlayDenseCenter(u);
    F.referenceLayer.addUnderlay('smoke', u, { origin: [-dx, -dy], rotation: 0, scale: 1 }, 0);

    let visible = 0, hidden = 0, hiddenLayers = 0;
    for (let i = 0; i < u.layerHidden.length; i++) if (u.layerHidden[i]) hiddenLayers++;
    for (let i = 0; i < u.segments.length; i += 4)
      (u.layerHidden[u.segLayer[i / 4]] ? hidden++ : visible++);
    return {
      tParse: Math.round(tParse),
      segments: u.segments.length / 4,
      visibleSegments: visible,
      hiddenSegments: hidden,
      hiddenLayers,
      totalLayers: u.layers.length,
      denseCenter: [Math.round(dx), Math.round(dy)],
      refList: F.referenceLayer.list(),
    };
  });

  // 3/4 perspective 줌인 한 장
  await page.evaluate(() => {
    const F = window.__figcad;
    F.rig?.fitBounds?.({ x: -35, y: -3, z: -35 }, { x: 35, y: 3, z: 35 });
    F.engine?.requestRender?.();
  });
  await new Promise((r) => setTimeout(r, 1200));
  await page.screenshot({ path: 'apps/web/scripts/dwg-underlay-persp.png' });

  // plan(top-down ortho) 뷰 — 빽도면 본연의 모습. setMode 트윈 대기.
  await page.evaluate(() => {
    const F = window.__figcad;
    F.rig?.setMode?.('plan');
    F.engine?.requestRender?.();
  });
  await new Promise((r) => setTimeout(r, 1800));
  await page.evaluate(() => {
    const F = window.__figcad;
    F.rig?.fitBounds?.({ x: -35, y: -3, z: -35 }, { x: 35, y: 3, z: 35 });
    F.engine?.requestRender?.();
  });
  await new Promise((r) => setTimeout(r, 1200));
  await page.screenshot({ path: 'apps/web/scripts/dwg-underlay-smoke.png' });

  console.log(JSON.stringify({ ...result, pageErrors: errs }, null, 2));
  console.log('screenshot → apps/web/scripts/dwg-underlay-smoke.png');
} finally {
  await browser.close();
}
