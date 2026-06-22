// federation 오버레이 로컬 실증 — puppeteer로 룸 열고 glTF 오버레이(BlobStore blob) 추가 + 스크린샷.
// 사용: BLOB_KEY=federation/<room>/<hash>.glb PORT=8788 ROOM=<room> node apps/web/scripts/fed-overlay-demo.mjs
// 전제: node-server/dev.mjs에 dist 서빙 + 룸에 프레임 + blob 업로드(?op=fed-upload). __figcad 노출 빌드 필요(vite DEV 또는 임시 노출).
import puppeteer from 'puppeteer-core';

const PORT = process.env.PORT ?? '8788';
const room = process.env.ROOM ?? 'g13b';
const blobKey = process.env.BLOB_KEY; // federation/g13b/<hash>.glb
const url = `http://localhost:${PORT}/?p=${room}`;

const browser = await puppeteer.launch({
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  headless: 'new',
  args: ['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist', '--window-size=1600,1000'],
});
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1600, height: 1000 });
  page.on('dialog', (d) => d.accept('데모'));
  page.on('console', (m) => { const t = m.text(); if (/error|fail|federation|gltf|reference/i.test(t)) console.log('[page]', t); });
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__figcad?.store, { timeout: 15000 });

  // 프레임 로드 대기 (서버 sync)
  await page.waitForFunction(() => (window.__figcad.store.listElements?.().length ?? 0) > 100, { timeout: 20000 }).catch(() => {});
  const before = await page.evaluate(() => window.__figcad.store.listElements().length);

  // glTF federation source 추가 (이미 R2 업로드된 blob 재사용)
  const ref = `${new URL(url).origin}/parties/doc/${room}?op=fed-blob&key=${encodeURIComponent(blobKey)}`;
  await page.evaluate((ref) => {
    const st = window.__figcad.store;
    const cur = st.listFederationSources?.() ?? [];
    if (cur.length === 0) st.addFederationSource({ name: '260617 전체(glTF)', sourceType: 'gltf', ref, visible: true, addedBy: '데모' });
  }, ref);

  // reconciler가 73MB glTF 페치·파싱·로드 대기 (status ready 또는 ReferenceLayer에 메시)
  await page.waitForFunction(() => {
    const f = window.__figcad.federation; const rl = window.__figcad.referenceLayer;
    const list = rl?.list?.() ?? [];
    return list.length > 0;
  }, { timeout: 120000 }).catch(() => {});

  // 줌핏 — 원좌표(-1.9M) 모델로 카메라 이동 + 멀리서 전체. rig 카메라 직접 배치.
  const camInfo = await page.evaluate(() => {
    const st = window.__figcad.store;
    let minx=1e15,miny=1e15,maxx=-1e15,maxy=-1e15;
    for (const e of st.listElements()) {
      const pts = e.a&&e.b ? [e.a,e.b] : e.boundary ? e.boundary : e.at ? [e.at] : [];
      for (const p of pts){ minx=Math.min(minx,p[0]);miny=Math.min(miny,p[1]);maxx=Math.max(maxx,p[0]);maxy=Math.max(maxy,p[1]); }
    }
    const cx=(minx+maxx)/2, cy=(miny+maxy)/2, w=(maxx-minx)/1000, h=(maxy-miny)/1000;
    const r=window.__figcad.rig, eng=window.__figcad.engine;
    r?.focusOn?.(cx/1000, 5, cy/1000);
    // 카메라를 멀찍이 위/뒤로 (전체 폭 보이게)
    const cam = eng?.camera ?? r?.active;
    const dist = Math.max(w,h)*0.9;
    if (cam && cam.position){ cam.position.set(cx/1000 - dist*0.5, dist*0.6, cy/1000 + dist*0.8); cam.lookAt?.(cx/1000,5,cy/1000); cam.updateProjectionMatrix?.(); }
    eng?.requestRender?.();
    // 레퍼런스(glTF) 메시 월드 bbox — 프레임과 정합 확인
    let rb=null;
    try{ const THREE=window.__figcad.THREE; }catch(e){}
    return { cx, cy, w, h };
  });
  await new Promise((r) => setTimeout(r, 5000));

  const status = await page.evaluate(() => {
    const rl = window.__figcad.referenceLayer;
    const srcs = window.__figcad.store.listFederationSources?.() ?? [];
    const f = window.__figcad.federation;
    return { refList: rl?.list?.() ?? [], sources: srcs.map(s=>({name:s.name,type:s.sourceType,vis:s.visible})),
             statuses: srcs.map(s=>f?.statusOf?.(s.id)), errs: srcs.map(s=>f?.errorOf?.(s.id)) };
  });
  const after = await page.evaluate(() => window.__figcad.store.listElements().length);
  await page.screenshot({ path: 'apps/web/scripts/fed-overlay.png' });
  console.log(JSON.stringify({ before, after, ...status }, null, 2));
  console.log('screenshot → apps/web/scripts/fed-overlay.png');
} finally {
  await browser.close();
}
