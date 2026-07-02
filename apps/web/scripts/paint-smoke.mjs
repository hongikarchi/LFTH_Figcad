// 재질 페인트 스모크 — 네이티브(타입 color/opacity → SceneManager 단일 해석점·고스트 사이클 보존·undo)
// + PaintTool 클릭 e2e(칠하기/지우기) + 임포트 오버라이드(materials 채널 → ReferenceLayer 재질 배열/coalesce).
// 임포트 픽스처 = 합성 ReferenceLayer.add (refObject/refGroups userData 계약 직접 구동 — 백엔드 불필요).
//
// 전제: vite dev :5173 실행 중. 사용: node apps/web/scripts/paint-smoke.mjs [포트=5173]
import puppeteer from 'puppeteer-core';

const PORT = process.argv[2] ?? process.env.PORT ?? '5173';
const ROOM = `paint-smoke-${Math.random().toString(36).slice(2, 8)}`;

let pass = 0;
let fail = 0;
const failures = [];
function check(ok, label, detail = '') {
  if (ok) {
    pass++;
    console.log(`PASS  ${label}`);
  } else {
    fail++;
    failures.push(label);
    console.log(`FAIL  ${label}${detail ? ` — ${detail}` : ''}`);
  }
  return ok;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: process.env.CHROME ?? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  headless: 'new',
  args: ['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist', '--window-size=1400,1000'],
});

try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1400, height: 1000 });
  page.on('dialog', (d) => d.accept().catch(() => {}));
  const errors = [];
  const ignore = (t) => /WebSocket|ERR_CONNECTION_REFUSED|parties\/doc|favicon/.test(t);
  page.on('pageerror', (e) => { if (!ignore(e.message)) errors.push(e.message); });
  page.on('console', (m) => { if (m.type() === 'error' && !ignore(m.text())) errors.push(m.text().slice(0, 200)); });

  await page.goto(`http://localhost:${PORT}/?p=${ROOM}`, { waitUntil: 'load' });
  await page.waitForFunction(
    () => window.__figcad?.store && window.__figcad?.seed && window.__figcad?.ui && window.__figcad?.referenceLayer,
    { timeout: 20000 },
  );

  // ---------- 0) 셋업: 벽 1 + 레벨 2F (undo 캡처 분리 위해 페인트와 시간 간격) ----------
  const setup = await page.evaluate(() => {
    const F = window.__figcad;
    const wallId = F.store.createWall({
      levelId: F.seed.levelId,
      typeId: F.seed.wallTypeIds[0],
      a: [0, 0],
      b: [4000, 0],
    });
    const l2 = F.store.addLevel({ name: '스모크2F', elevation: 3200, height: 2800, order: 2 });
    const seedColor = F.store.getType(F.seed.wallTypeIds[0]).color;
    return { wallId, l2, typeId: F.seed.wallTypeIds[0], seedColor };
  });
  await sleep(500); // undo captureTimeout(350ms) 분리 — 셋업과 페인트가 한 스텝으로 안 뭉치게

  const matOf = (elementId) =>
    page.evaluate((id) => {
      let out = null;
      window.__figcad.engine.scene.traverse((o) => {
        if (o.isMesh && o.userData && o.userData['elementId'] === id && !Array.isArray(o.material)) {
          const m = o.material;
          out = { color: `#${m.color.getHexString()}`, opacity: m.opacity, transparent: m.transparent, depthWrite: m.depthWrite };
        }
      });
      return out;
    }, elementId);

  // ---------- 1) 네이티브 페인트 (ops 경로) — 타입 opacity → 재질 반영 ----------
  await page.evaluate((t) => window.__figcad.store.updateType(t, { color: '#ff3b30', opacity: 0.5 }), setup.typeId);
  await sleep(200);
  let m = await matOf(setup.wallId);
  check(!!m && m.color === '#ff3b30' && m.opacity === 0.5 && m.transparent === true && m.depthWrite === false,
    '타입 도색(색+0.5) → 벽 재질 반영 (transparent·depthWrite off)', JSON.stringify(m));

  // ---------- 2) 고스트 사이클 보존 — plan+레벨 전환 후 페인트 opacity 유지 (복원 하드코딩 버그 가드) ----------
  await page.evaluate((s) => {
    const ui = window.__figcad.ui.getState();
    ui.setViewMode('plan');
    ui.setActiveLevel(s.l2);
  }, setup);
  await sleep(200);
  m = await matOf(setup.wallId);
  check(!!m && Math.abs(m.opacity - 0.12) < 1e-6, '비활성 레벨 고스트 (opacity 0.12)', JSON.stringify(m));
  await page.evaluate((s) => {
    const F = window.__figcad;
    const ui = F.ui.getState();
    ui.setActiveLevel(F.seed.levelId);
    ui.setViewMode('3d');
  }, setup);
  await sleep(200);
  m = await matOf(setup.wallId);
  check(!!m && m.opacity === 0.5, '고스트 복원 = 페인트 0.5 유지 (1.0 하드코딩 아님)', JSON.stringify(m));

  // ---------- 3) undo — 페인트만 1스텝 되돌림 ----------
  await page.mouse.click(700, 500); // 캔버스 포커스
  await sleep(400);
  await page.keyboard.down('Control');
  await page.keyboard.press('z');
  await page.keyboard.up('Control');
  await sleep(300);
  const afterUndo = await page.evaluate((t) => {
    const type = window.__figcad.store.getType(t);
    return { color: type.color, hasOpacity: 'opacity' in type };
  }, setup.typeId);
  check(afterUndo.color === setup.seedColor && !afterUndo.hasOpacity,
    'Ctrl+Z = 타입 도색만 되돌림 (색 복원·opacity 키 제거)', JSON.stringify(afterUndo));
  m = await matOf(setup.wallId);
  check(!!m && m.opacity === 1 && m.depthWrite === true, 'undo 후 재질 불투명 복원', JSON.stringify(m));
  await sleep(500);

  // ---------- 4) PaintTool 클릭 e2e — 칠하기/지우기 ----------
  const screenPos = await page.evaluate((wid) => {
    const F = window.__figcad;
    // 벽 중심 월드점 → 화면 px (Vector3 인스턴스는 카메라 position clone으로 확보 — THREE 미노출)
    const cam = F.rig.active;
    cam.updateMatrixWorld();
    const v = cam.position.clone().set(2, 1.2, 0).project(cam);
    if (v.z < -1 || v.z > 1) return null;
    return { x: ((v.x + 1) / 2) * window.innerWidth, y: ((1 - v.y) / 2) * window.innerHeight, ndc: { x: v.x, y: v.y } };
  }, setup.wallId);
  if (check(!!screenPos, '벽 중심 화면 투영 (PaintTool 클릭 좌표)')) {
    await page.evaluate(() => {
      const ui = window.__figcad.ui.getState();
      ui.setPaintStyle({ color: '#34c759', opacity: 0.7 });
      ui.setPaintMode('paint');
      ui.setTool('paint');
    });
    await page.mouse.click(screenPos.x, screenPos.y);
    await sleep(300);
    const painted = await page.evaluate((t) => {
      const type = window.__figcad.store.getType(t);
      return { color: type.color, opacity: type.opacity };
    }, setup.typeId);
    check(painted.color === '#34c759' && painted.opacity === 0.7,
      'PaintTool 클릭 = 타입 도색 (색+0.7)', JSON.stringify(painted));
    // 지우기 모드 — 불투명 복원(opacity 키 제거)
    await page.evaluate(() => window.__figcad.ui.getState().setPaintMode('erase'));
    await page.mouse.click(screenPos.x, screenPos.y);
    await sleep(300);
    const erased = await page.evaluate((t) => 'opacity' in window.__figcad.store.getType(t), setup.typeId);
    check(erased === false, 'PaintTool 지우기 = 불투명 복원 (opacity 키 제거)');
    await page.evaluate(() => window.__figcad.ui.getState().setPaintMode('paint'));
  }

  // ---------- 5) 임포트 refObject (glTF/IFC/room 형태) — 소스전체/카테고리 오버라이드 ----------
  await page.evaluate(() => {
    const F = window.__figcad;
    const quad = (x0) => {
      // 두 삼각형 쿼드 (x0..x0+1, y 0..1, z 0)
      const p = [x0, 0, 0, x0 + 1, 0, 0, x0 + 1, 1, 0, x0, 0, 0, x0 + 1, 1, 0, x0, 1, 0];
      return new Float32Array(p);
    };
    window.__paintSmoke = { quad };
    F.referenceLayer.add('synobj', { meshes: [{ positions: quad(10), name: 'obj1', category: 'IFCWALL' }] });
  });
  const refMat = (srcId) =>
    page.evaluate((id) => {
      let out = null;
      window.__figcad.referenceLayer.root.traverse((o) => {
        if (o.isMesh && o.userData && o.userData['refSourceId'] === id) {
          const arr = Array.isArray(o.material);
          const m = arr ? o.material : [o.material];
          out = {
            isArray: arr,
            mats: m.map((x) => ({ color: `#${x.color.getHexString()}`, opacity: x.opacity, transparent: x.transparent })),
            groups: o.geometry.groups.map((g) => ({ start: g.start, count: g.count, mi: g.materialIndex })),
          };
        }
      });
      return out;
    }, srcId);

  await page.evaluate(() =>
    window.__figcad.store.setMaterialOverride({ sourceId: 'synobj', color: '#5856d6', opacity: 1 }));
  await sleep(200);
  let r = await refMat('synobj');
  check(!!r && !r.isArray && r.mats[0].color === '#5856d6' && r.mats[0].transparent === false,
    'refObject 소스전체 도색 (glTF 시나리오)', JSON.stringify(r));
  await page.evaluate(() =>
    window.__figcad.store.setMaterialOverride({ sourceId: 'synobj', category: 'IFCWALL', color: '#ffcc00', opacity: 0.4 }));
  await sleep(200);
  r = await refMat('synobj');
  check(!!r && r.mats[0].color === '#ffcc00' && r.mats[0].opacity === 0.4,
    'refObject 카테고리(IFCWALL) 오버라이드가 소스전체보다 우선', JSON.stringify(r));
  await page.evaluate(() => window.__figcad.store.clearMaterialOverrides('synobj'));
  await sleep(200);
  r = await refMat('synobj');
  check(!!r && r.mats[0].color === '#dedee2', 'refObject 전체 지우기 = 클레이 복원', JSON.stringify(r));

  // ---------- 6) 임포트 refGroups (.3dm 병합 메시) — 재질 배열 + run coalesce ----------
  await page.evaluate(() => {
    const F = window.__figcad;
    const q = window.__paintSmoke.quad;
    // 레이어-연속(정렬된 interop 출력 형태): LA=tri 0..2 (오브젝트 2개), LB=tri 2..4
    const pos = new Float32Array(4 * 9 * 2 / 2); // 4 tris × 9 float — 쿼드 2개
    pos.set(q(20), 0);
    pos.set(q(22), 18);
    F.referenceLayer.add('syn3dm', {
      meshes: [{
        positions: pos,
        groups: [
          { start: 0, count: 1, name: 'a1', category: 'LA' },
          { start: 1, count: 1, name: 'a2', category: 'LA' },
          { start: 2, count: 2, name: 'b1', category: 'LB' },
        ],
      }],
    });
  });
  await page.evaluate(() =>
    window.__figcad.store.setMaterialOverride({ sourceId: 'syn3dm', category: 'LB', color: '#ff9500', opacity: 0.5 }));
  await sleep(200);
  r = await refMat('syn3dm');
  check(!!r && r.isArray && r.mats.length === 2 && r.groups.length === 2,
    '.3dm 레이어 도색 = 재질 배열 2 + 그룹 2 (LA 2오브젝트 coalesce)', JSON.stringify(r));
  if (r && r.groups.length === 2) {
    const [g0, g1] = r.groups;
    check(g0.start === 0 && g0.count === 6 && g0.mi === 0 && g1.start === 6 && g1.count === 6 && g1.mi === 1,
      '.3dm 그룹 range = LA[0,6)클레이 · LB[6,12)도색 (tri×3 정점 단위)', JSON.stringify(r.groups));
    check(r.mats[1].color === '#ff9500' && r.mats[1].opacity === 0.5 && r.mats[1].transparent === true,
      '.3dm 도색 재질 = 색·0.5·transparent', JSON.stringify(r.mats[1]));
  }
  // 도색 undo — materials 채널 undo 추적 확인 (yMaterials가 UndoManager 배열에)
  await sleep(500);
  await page.keyboard.down('Control');
  await page.keyboard.press('z');
  await page.keyboard.up('Control');
  await sleep(300);
  const undoneImport = await page.evaluate(() => window.__figcad.store.listMaterialOverrides('syn3dm').length);
  check(undoneImport === 0, '임포트 도색 Ctrl+Z = 오버라이드 제거 (undo 추적)');
  r = await refMat('syn3dm');
  check(!!r && !r.isArray && r.groups.length === 0 && r.mats[0].color === '#dedee2',
    'undo 후 .3dm = 단일 클레이 재질·그룹 0 (draw call 원복)', JSON.stringify(r));

  // ---------- 7) 콘솔/페이지 에러 ----------
  check(errors.length === 0, '콘솔/페이지 에러 없음', errors.join(' | '));
} finally {
  await browser.close();
}

console.log(`\n페인트 스모크: ${pass} PASS / ${fail} FAIL${fail ? ` — ${failures.join(', ')}` : ''}`);
process.exit(fail ? 1 : 0);
