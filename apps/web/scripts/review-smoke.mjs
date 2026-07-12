/**
 * 리뷰 기능 스모크 — M17/M18 배포됐지만 브라우저 미검증인 4개 리뷰 기능.
 *   1) MeasureTool(줄자): 3D 메시 피처 스냅 두 클릭 → hud-chip mm 값
 *   2) Viewpoints: 저장(.vp-save) → 카메라 이동 → 점프(.vp-open) → 포즈 복원 + store 채널
 *   3) diffOverlay(버전 3D 비교): 커밋 → 변경 → 비교 → 씬 오버레이(초록/주황/빨강) → 토글 off
 *   4) ViewGizmo: Top → plan 직교 탑다운, Front → 3D theta=π/phi=π/2
 * 사전: vite dev :5173 + 백엔드 :8787 (버전 API). 사용: node apps/web/scripts/review-smoke.mjs [포트]
 */
import puppeteer from 'puppeteer-core';

const port = process.argv[2] ?? '5173';
const room = `review-smoke-${Math.random().toString(36).slice(2, 8)}`;
const EPS = 1e-4;

const browser = await puppeteer.launch({
  executablePath: process.env.CHROME ?? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  headless: true,
  args: ['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist', '--window-size=1300,1000'],
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1300, height: 1000 });
  page.on('dialog', (d) => d.accept('스모크'));
  const errors = [];
  const ignore = (t) => /WebSocket|ERR_CONNECTION_REFUSED|parties\/doc|Failed to load resource/.test(t);
  page.on('pageerror', (e) => { if (!ignore(e.message)) errors.push(e.message); });
  page.on('console', (m) => { if (m.type() === 'error' && !ignore(m.text())) errors.push(m.text().slice(0, 200)); });

  await page.goto(`http://localhost:${port}/?p=${room}`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__figcad?.store && window.__figcad?.seed, { timeout: 20000 });

  // ============================================================
  // 1) MeasureTool — 벽 생성 → 3D iso → 줄자 두 클릭(윗모서리 코너) → 치수칩
  // ============================================================
  const meas = await page.evaluate(() => {
    const F = window.__figcad;
    const { store, seed, ui, rig, engine } = F;
    const wid = store.createWall({ levelId: seed.levelId, typeId: seed.wallTypeIds[0], a: [0, 0], b: [4000, 0] });
    ui.getState().setViewMode('3d'); // 기본값이 3d지만 명시 (measure는 viewMode 전환 시 cancel됨)
    rig.setView('iso');
    rig.tick(2); // S3 트윈 즉시 완료 — fitBounds의 인터럽트(동결)가 iso 포즈를 t=0에서 죽이지 않게(리뷰)
    rig.fitBounds({ x: -4, y: -1, z: -6 }, { x: 8, y: 4, z: 6 }); // 벽을 캔버스 중앙부(WorkRail 우측)에
    engine.requestRender();
    // 벽 메시 union bbox — SceneManager 파생 지오메트리는 월드 m(identity transform)
    const mn = [Infinity, Infinity, Infinity];
    const mx = [-Infinity, -Infinity, -Infinity];
    engine.scene.traverse((o) => {
      if (o.userData?.elementId !== wid || !o.isMesh) return;
      const p = o.geometry?.getAttribute?.('position');
      if (!p) return;
      for (let i = 0; i < p.count; i++) {
        const v = [p.getX(i), p.getY(i), p.getZ(i)];
        for (let k = 0; k < 3; k++) {
          mn[k] = Math.min(mn[k], v[k]);
          mx[k] = Math.max(mx[k], v[k]);
        }
      }
    });
    if (!isFinite(mn[0])) return { err: '벽 메시를 씬에서 못 찾음' };
    const cam = rig.active;
    cam.updateMatrixWorld(true);
    const proj = (x, y, z) => {
      const e = cam.matrixWorldInverse.elements;
      const p = cam.projectionMatrix.elements;
      const vx = e[0] * x + e[4] * y + e[8] * z + e[12];
      const vy = e[1] * x + e[5] * y + e[9] * z + e[13];
      const vz = e[2] * x + e[6] * y + e[10] * z + e[14];
      const vw = e[3] * x + e[7] * y + e[11] * z + e[15];
      const cx = p[0] * vx + p[4] * vy + p[8] * vz + p[12] * vw;
      const cy = p[1] * vx + p[5] * vy + p[9] * vz + p[13] * vw;
      const cw = p[3] * vx + p[7] * vy + p[11] * vz + p[15] * vw;
      return { px: (cx / cw * 0.5 + 0.5) * window.innerWidth, py: (-cy / cw * 0.5 + 0.5) * window.innerHeight };
    };
    // iso 카메라는 +x+z 사분면 → +z(front) 면이 보임. 윗모서리 코너에서 5cm 안쪽(면 위 확실 히트,
    // 코너 꼭짓점은 12px 스냅 톨러런스 안 → vertex 스냅 기대).
    const inset = 0.05;
    const zF = mx[2];
    const A = proj(mn[0] + inset, mx[1] - inset, zF);
    const B = proj(mx[0] - inset, mx[1] - inset, zF);
    ui.getState().setTool('measure');
    return { wid, A, B, bb: { mn, mx }, lenM: mx[0] - mn[0] };
  });
  if (meas.err) throw new Error(`측정 준비 실패: ${meas.err}`);
  console.log(`  벽 bbox=${JSON.stringify(meas.bb)} A=(${meas.A.px | 0},${meas.A.py | 0}) B=(${meas.B.px | 0},${meas.B.py | 0})`);
  await sleep(200);
  await page.mouse.click(meas.A.px, meas.A.py);
  await sleep(150);
  await page.mouse.move(meas.B.px, meas.B.py); // move 경로(라이브 칩) 겸 마커B 갱신
  await sleep(100);
  await page.mouse.click(meas.B.px, meas.B.py);
  await sleep(300);
  const chip = await page.evaluate(() => {
    const el = document.querySelector('.hud-chip');
    if (!el) return { shown: false };
    return { shown: el.style.display !== 'none', text: el.textContent };
  });
  if (!chip.shown) throw new Error('줄자 두 클릭 후 치수칩(.hud-chip)이 안 보임');
  const mm = Number(String(chip.text).replace(/[^\d]/g, ''));
  // 벽 길이 4000mm — vertex 스냅이면 정확히 4000, edge/face 히트여도 코너 5cm 안쪽 = ±200mm 내
  if (!(mm >= 3600 && mm <= 4400)) throw new Error(`치수칩 값 비정상: "${chip.text}" (기대 ≈4000mm)`);
  console.log(`PASS  줄자(MeasureTool) — 3D 벽 모서리 두 클릭 → 치수칩 ${chip.text}mm (기대 4000)`);
  // 도구 복귀 → MeasureTool 비주얼 정리(칩 숨김) 확인
  await page.evaluate(() => window.__figcad.ui.getState().setTool('select'));
  await sleep(150);

  // ============================================================
  // 2) Viewpoints — 포즈 A 저장(.vp-save) → 포즈 B로 이동 → 점프(.vp-open) → A 복원
  // ============================================================
  const poseA = await page.evaluate(() => {
    const F = window.__figcad;
    F.ui.getState().setMode('review'); // 기본값이지만 명시 — WorkRail에 ViewpointPanel 렌더
    F.rig.setPose({ target: [2, 1, 0], distance: 12, theta: 0.9, phi: 1.0 });
    F.engine.requestRender();
    return F.rig.getPose();
  });
  await page.waitForSelector('.vp-save', { timeout: 5000 });
  await page.click('.vp-save');
  await page.waitForFunction(() => window.__figcad.store.listViewpoints().length === 1, { timeout: 5000 });
  const vp = await page.evaluate(() => {
    const v = window.__figcad.store.listViewpoints()[0];
    return { name: v.name, author: v.author, viewMode: v.viewMode, camera: v.camera, hasClip: 'clip' in v };
  });
  if (!vp.camera || !Array.isArray(vp.camera.target) || typeof vp.camera.theta !== 'number')
    throw new Error(`뷰포인트 camera 필드 이상: ${JSON.stringify(vp)}`);
  if (vp.viewMode !== '3d') throw new Error(`뷰포인트 viewMode 기대 3d, 실제 ${vp.viewMode}`);
  const camDiff = Math.abs(vp.camera.theta - poseA.theta) + Math.abs(vp.camera.phi - poseA.phi) + Math.abs(vp.camera.distance - poseA.distance);
  if (camDiff > EPS) throw new Error(`저장된 camera ≠ 저장 시점 포즈 (diff ${camDiff})`);
  console.log(`PASS  뷰포인트 저장 — store 채널에 camera+viewMode 기록 (name="${vp.name}", author="${vp.author}")`);

  // 카메라를 딴 데로 → 점프 → 포즈 A 복원
  await page.evaluate(() => {
    window.__figcad.rig.setPose({ target: [20, 5, 15], distance: 40, theta: 2.4, phi: 0.5 });
    window.__figcad.engine.requestRender();
  });
  const moved = await page.evaluate(() => window.__figcad.rig.getPose());
  if (Math.abs(moved.theta - poseA.theta) < 0.5) throw new Error('카메라 이동이 적용 안 됨(테스트 자체 결함)');
  await page.click('.vp-item .vp-open');
  await sleep(150);
  await page.evaluate(() => { window.__figcad.rig.tick(2); window.__figcad.engine.requestRender(); }); // 점프 트윈(§C-5 auto) 즉시 완료
  await sleep(100);
  const after = await page.evaluate(() => ({
    pose: window.__figcad.rig.getPose(),
    viewMode: window.__figcad.ui.getState().viewMode,
  }));
  const jumpDiff =
    Math.abs(after.pose.theta - poseA.theta) + Math.abs(after.pose.phi - poseA.phi) +
    Math.abs(after.pose.distance - poseA.distance) +
    Math.abs(after.pose.target[0] - poseA.target[0]) + Math.abs(after.pose.target[2] - poseA.target[2]);
  if (jumpDiff > EPS) throw new Error(`점프 후 포즈 ≠ 저장 포즈 (diff ${jumpDiff}): ${JSON.stringify(after.pose)}`);
  if (after.viewMode !== '3d') throw new Error(`점프 후 viewMode 기대 3d, 실제 ${after.viewMode}`);
  console.log(`PASS  뷰포인트 점프 — 포즈 B→A 복원 (diff ${jumpDiff.toExponential(1)}) + viewMode 재현`);

  // ============================================================
  // 3) diffOverlay — 커밋 → (벽 수정 + 벽 추가) → 비교 → 3D 오버레이 → 토글 off
  // ============================================================
  await page.waitForSelector('.ver-commit', { timeout: 5000 });
  await page.type('.ver-commit input', '리뷰 스모크 기준 커밋');
  await page.click('.ver-commit button');
  await page.waitForFunction(() => document.querySelectorAll('.ver-item').length === 1, { timeout: 10000 });
  console.log('PASS  버전 커밋 → 타임라인 1건');

  await page.evaluate((wid) => {
    const { store, seed } = window.__figcad;
    store.updateElement(wid, { b: [5000, 0] }); // 변경(주황) — 기존 측정용 벽 연장
    store.createWall({ levelId: seed.levelId, typeId: seed.wallTypeIds[0], a: [0, 3000], b: [4000, 3000] }); // 추가(초록)
  }, meas.wid);
  await sleep(300);
  // 커밋 항목 '비교' 클릭 → fetchCommit + previewDiff(snap)
  await page.evaluate(() => {
    const item = document.querySelector('.ver-item');
    [...item.querySelectorAll('button')].find((b) => b.textContent === '비교').click();
  });
  await page.waitForSelector('.ver-diff', { timeout: 10000 });
  const diffText = await page.evaluate(() => document.querySelector('.ver-diff').textContent);
  await sleep(200);
  // DiffOverlay 마커: 윤곽 LineSegments renderOrder=6(depthTest off) + 고스트 Mesh renderOrder=5
  const countOverlay = () =>
    page.evaluate(() => {
      let edges = 0, fills = 0;
      window.__figcad.engine.scene.traverse((o) => {
        if (o.isLineSegments && o.renderOrder === 6 && o.material?.depthTest === false) edges++;
        if (o.isMesh && o.renderOrder === 5 && o.material?.transparent && o.material?.opacity < 0.5) fills++;
      });
      return { edges, fills };
    });
  const on = await countOverlay();
  // 기대: 추가 벽 윤곽(초록) + 변경 벽 현재 윤곽(주황) + 변경 벽 옛 상태 고스트(주황 fill+윤곽) ⇒ 윤곽 ≥3, 고스트 ≥1
  if (on.edges < 3 || on.fills < 1)
    throw new Error(`diff 오버레이 미표시/부족: edges=${on.edges} fills=${on.fills} (기대 edges≥3 fills≥1)`);
  if (!/\+\s*1|추가/.test(diffText)) throw new Error(`diff 텍스트에 추가 내역 없음: "${diffText}"`);
  console.log(`PASS  버전 3D 비교 — diffOverlay 표시 (윤곽 ${on.edges} · 고스트 ${on.fills}) diff="${diffText.trim().slice(0, 60)}"`);

  // 토글 off — 같은 '비교' 재클릭 = previewDiff(null)
  await page.evaluate(() => {
    const item = document.querySelector('.ver-item');
    [...item.querySelectorAll('button')].find((b) => b.textContent === '비교').click();
  });
  await sleep(300);
  const off = await countOverlay();
  if (off.edges !== 0 || off.fills !== 0)
    throw new Error(`비교 토글 off 후 오버레이 잔존: edges=${off.edges} fills=${off.fills}`);
  console.log('PASS  버전 비교 토글 off — 오버레이 정리 (0/0)');

  // ============================================================
  // 4) ViewGizmo — Top → plan 탑다운(직교), Front → 3D 표준 방위(theta=π, phi=π/2)
  // ============================================================
  await page.waitForSelector('.view-gizmo', { timeout: 5000 });
  const clickGizmo = (label) =>
    page.evaluate((l) => {
      const b = [...document.querySelectorAll('.view-gizmo button')].find((x) => x.textContent === l);
      if (!b) return false;
      b.click();
      return true;
    }, label);
  if (!(await clickGizmo('Top'))) throw new Error('ViewGizmo Top 버튼 없음');
  await sleep(150);
  await page.evaluate(() => { window.__figcad.rig.tick(2); window.__figcad.engine.requestRender(); }); // 트윈 즉시 완료
  await sleep(150);
  const top = await page.evaluate(() => ({
    mode: window.__figcad.rig.mode,
    viewMode: window.__figcad.ui.getState().viewMode,
    pose: window.__figcad.rig.getPose(),
    ortho: window.__figcad.rig.active?.isOrthographicCamera === true,
  }));
  if (top.mode !== 'plan' || top.viewMode !== 'plan') throw new Error(`Top 후 mode 기대 plan: rig=${top.mode} ui=${top.viewMode}`);
  if (top.pose.phi > 0.06) throw new Error(`Top 후 phi 기대 ≈0.05(탑다운), 실제 ${top.pose.phi}`);
  if (!top.ortho) throw new Error('Top(평면) 후 활성 카메라가 직교가 아님');
  console.log(`PASS  뷰 기즈모 Top — plan 직교 탑다운 (phi=${top.pose.phi.toFixed(3)}, ortho=${top.ortho})`);

  if (!(await clickGizmo('Front'))) throw new Error('ViewGizmo Front 버튼 없음');
  await sleep(150);
  await page.evaluate(() => { window.__figcad.rig.tick(2); window.__figcad.engine.requestRender(); }); // S3 포즈 트윈 즉시 완료
  await sleep(100);
  const front = await page.evaluate(() => {
    const cam = window.__figcad.rig.active;
    cam.updateMatrixWorld();
    // 동쪽(+X 5m) 점의 NDC x — 남측 입면에서 동=화면 오른쪽(>0)이어야 실세계·plan과 일치(chirality)
    const V = cam.matrixWorldInverse.elements, P = cam.projectionMatrix.elements;
    const mul = (M, v) => [0, 1, 2, 3].map((r) => M[r] * v[0] + M[r + 4] * v[1] + M[r + 8] * v[2] + M[r + 12] * v[3]);
    const c = mul(P, mul(V, [5, 0, 0, 1]));
    return {
      mode: window.__figcad.rig.mode,
      viewMode: window.__figcad.ui.getState().viewMode,
      pose: window.__figcad.rig.getPose(),
      ortho: cam.isOrthographicCamera === true,
      eastNdcX: c[0] / c[3],
    };
  });
  if (front.mode !== '3d' || front.viewMode !== '3d') throw new Error(`Front 후 mode 기대 3d: rig=${front.mode} ui=${front.viewMode}`);
  if (Math.abs(front.pose.theta - Math.PI) > 1e-3) throw new Error(`Front 후 theta 기대 π, 실제 ${front.pose.theta}`);
  if (Math.abs(front.pose.phi - Math.PI / 2) > 1e-3) throw new Error(`Front 후 phi 기대 π/2(수평), 실제 ${front.pose.phi}`);
  if (!front.ortho) throw new Error('Front(입면) 후 활성 카메라가 직교가 아님 — 8b true ortho 회귀');
  if (!(front.eastNdcX > 0)) throw new Error(`Front 입면 chirality 반전 — 동쪽이 화면 왼쪽 (ndcX=${front.eastNdcX})`);
  console.log(`PASS  뷰 기즈모 Front — 남측 입면 true ortho·동=오른쪽 (phi=${front.pose.phi.toFixed(3)}, eastNdcX=${front.eastNdcX.toFixed(3)})`);

  // 입면 ortho → Iso 복귀 = 원근 재개 (projection 잔존 회귀 가드)
  if (!(await clickGizmo('Iso'))) throw new Error('ViewGizmo Iso 버튼 없음');
  await sleep(150);
  await page.evaluate(() => { window.__figcad.rig.tick(2); window.__figcad.engine.requestRender(); });
  await sleep(100);
  const iso = await page.evaluate(() => ({
    ortho: window.__figcad.rig.active?.isOrthographicCamera === true,
    pose: window.__figcad.rig.getPose(),
  }));
  if (iso.ortho) throw new Error('Iso 복귀 후에도 직교 잔존');
  console.log(`PASS  뷰 기즈모 Iso 복귀 — 원근 재개 (phi=${iso.pose.phi.toFixed(3)})`);

  if (errors.length) throw new Error(`콘솔/페이지 에러: ${errors.slice(0, 3).join(' | ')}`);
  console.log('\n리뷰 기능 스모크 통과 (줄자 · 뷰포인트 · 버전 3D 비교 · 뷰 기즈모)');
} catch (err) {
  console.error('FAIL ', err.message);
  process.exitCode = 1;
} finally {
  await browser.close();
}
