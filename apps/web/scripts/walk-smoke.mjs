/**
 * 걷기(walk) 모드 스모크 — 진입 착지·WASD 이동·시선 룩·렌즈 fov·종료 오빗 복원을
 * 실제 브라우저 경로(__figcad 훅 + 합성 키/포인터)로 검증.
 * 사전: vite dev. 사용: node scripts/walk-smoke.mjs [vite 포트=5173]
 */
import puppeteer from 'puppeteer-core';

const port = process.argv[2] ?? '5173';
const room = `e2e-walk-${Math.random().toString(36).slice(2, 8)}`;

const browser = await puppeteer.launch({
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  headless: true,
});

const fail = (msg) => {
  console.error(`FAIL: ${msg}`);
  process.exitCode = 1;
};

try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });
  const errors = [];
  const ignore = (t) => /WebSocket|ERR_CONNECTION_REFUSED|parties\/doc/.test(t);
  page.on('pageerror', (e) => { if (!ignore(e.message)) errors.push(e.message); });
  page.on('console', (m) => { if (m.type() === 'error' && !ignore(m.text())) errors.push(m.text().slice(0, 200)); });

  await page.goto(`http://localhost:${port}/?p=${room}`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__figcad?.walk && window.__figcad?.ui, { timeout: 10000 });

  // 0) 사전: 리뷰 모드 + 3D + 벽 하나(지면 스냅 대상은 seed 슬래브/지면 무관 — 착지는 레벨고도)
  const pre = await page.evaluate(() => {
    const { ui, rig } = window.__figcad;
    ui.getState().setMode('review');
    ui.getState().setViewMode('3d');
    return { pose: rig.getPose(), fov: rig.active.fov };
  });
  if (Math.abs(pre.fov - 55) > 0.01) fail(`기본 fov 55 아님: ${pre.fov}`);

  // 1) 걷기 진입 — 눈높이 1.6m 착지(레벨 0 고도) + persp 유지 + walking 플래그
  await page.evaluate(() => window.__figcad.ui.getState().setWalkActive(true));
  await new Promise((r) => setTimeout(r, 150)); // React 플러시 대기 (zustand→React는 비동기 배치)
  const entered = await page.evaluate(() => {
    const { rig, walk } = window.__figcad;
    return {
      active: walk.active,
      walking: rig.isWalking,
      camY: rig.active.position.y,
      fov: rig.active.fov,
      controlShown: !!document.querySelector('.walk-control'),
      bodyClass: document.body.classList.contains('walk-active'),
    };
  });
  if (!entered.active || !entered.walking) fail('걷기 진입 실패 (walk.active/rig.isWalking)');
  if (Math.abs(entered.camY - 1.6) > 0.01) fail(`착지 눈높이 1.6m 아님: ${entered.camY}`);
  if (Math.abs(entered.fov - 55.06) > 0.2) fail(`렌즈 23mm→fov≈55.06 아님: ${entered.fov}`);
  if (!entered.controlShown) fail('WalkControl 미표시');
  if (!entered.bodyClass) fail('body.walk-active 미토글');

  // 2) WASD 전진 — W 600ms 홀드 → 위치 이동 (ticker 적분·가감속 경유)
  const p0 = await page.evaluate(() => {
    const p = window.__figcad.rig.active.position;
    return { x: p.x, y: p.y, z: p.z };
  });
  await page.keyboard.down('w');
  await new Promise((r) => setTimeout(r, 600));
  await page.keyboard.up('w');
  await new Promise((r) => setTimeout(r, 400)); // 감속 잔여
  const p1 = await page.evaluate(() => {
    const p = window.__figcad.rig.active.position;
    return { x: p.x, y: p.y, z: p.z };
  });
  const moved = Math.hypot(p1.x - p0.x, p1.z - p0.z);
  if (moved < 0.3) fail(`W 전진 미동작 (이동 ${moved.toFixed(3)}m)`);

  // 3) 시선 룩 — 마우스 LMB 드래그 >3px → 카메라 방향 회전 (도구 미발동)
  const q0 = await page.evaluate(() => window.__figcad.rig.active.quaternion.toArray());
  await page.mouse.move(640, 450);
  await page.mouse.down();
  await page.mouse.move(760, 480, { steps: 6 });
  await page.mouse.up();
  const q1 = await page.evaluate(() => window.__figcad.rig.active.quaternion.toArray());
  const qDelta = q0.reduce((s, v, i) => s + Math.abs(v - q1[i]), 0);
  if (qDelta < 0.005) fail('LMB 드래그 룩 미동작 (quaternion 무변화)');

  // 4) 렌즈 — 50mm → fov ≈ 2·atan(12/50) ≈ 27.0°
  const fov50 = await page.evaluate(() => {
    window.__figcad.ui.getState().setLensMm(50);
    return window.__figcad.rig.active.fov;
  });
  if (Math.abs(fov50 - 26.99) > 0.2) fail(`50mm → fov≈27.0 아님: ${fov50}`);

  // 5) 조이스틱 벡터 직구동 — setJoystick 전진 300ms
  const j0 = await page.evaluate(() => {
    const p = window.__figcad.rig.active.position;
    window.__figcad.walk.setJoystick(0, 1);
    return { x: p.x, z: p.z };
  });
  await new Promise((r) => setTimeout(r, 300));
  const j1 = await page.evaluate(() => {
    window.__figcad.walk.setJoystick(0, 0);
    const p = window.__figcad.rig.active.position;
    return { x: p.x, z: p.z };
  });
  const jMoved = Math.hypot(j1.x - j0.x, j1.z - j0.z);
  if (jMoved < 0.15) fail(`조이스틱 전진 미동작 (이동 ${jMoved.toFixed(3)}m)`);

  // 6) 걷기 중 뷰포인트 포즈 합성 — getPose가 유한 오빗 포즈 반환
  const pose = await page.evaluate(() => window.__figcad.rig.getPose());
  if (!isFinite(pose.distance) || !isFinite(pose.phi) || !isFinite(pose.theta)) fail('걷기 중 getPose 비유한');

  // 7) Esc 종료 — 오빗 복원(walking=false) + fov 기본 복원 + 카메라 위치 보존(점프 없음)
  const exitCam = await page.evaluate(() => {
    const p = window.__figcad.rig.active.position;
    return { x: p.x, y: p.y, z: p.z };
  });
  await page.keyboard.press('Escape');
  await new Promise((r) => setTimeout(r, 150)); // React 플러시 대기
  const exited = await page.evaluate(() => {
    const { rig, ui, walk } = window.__figcad;
    const p = rig.active.position;
    return {
      walking: rig.isWalking,
      walkActive: ui.getState().walkActive,
      active: walk.active,
      fov: rig.active.fov,
      pos: { x: p.x, y: p.y, z: p.z },
      controlShown: !!document.querySelector('.walk-control'),
      bodyClass: document.body.classList.contains('walk-active'),
    };
  });
  if (exited.walking || exited.walkActive || exited.active) fail('Esc 종료 실패');
  if (Math.abs(exited.fov - 55) > 0.01) fail(`종료 후 fov 55 복원 안 됨: ${exited.fov}`);
  const jump = Math.hypot(exited.pos.x - exitCam.x, exited.pos.y - exitCam.y, exited.pos.z - exitCam.z);
  if (jump > 0.01) fail(`종료 시 카메라 점프 ${jump.toFixed(3)}m`);
  if (exited.controlShown || exited.bodyClass) fail('종료 후 WalkControl/body 클래스 잔존');

  // 7b) 수평 시선(pitch=0, phi 클램프 케이스) 종료 — 위치 점프 0 검증 (walkToOrbit 클램프-역산 회귀 가드)
  await page.evaluate(() => window.__figcad.ui.getState().setWalkActive(true));
  const lv0 = await page.evaluate(() => {
    const p = window.__figcad.rig.active.position;
    return { x: p.x, y: p.y, z: p.z };
  });
  await page.keyboard.press('Escape');
  const lv1 = await page.evaluate(() => {
    const p = window.__figcad.rig.active.position;
    return { x: p.x, y: p.y, z: p.z };
  });
  const lvJump = Math.hypot(lv1.x - lv0.x, lv1.y - lv0.y, lv1.z - lv0.z);
  if (lvJump > 0.01) fail(`수평 시선 종료 점프 ${lvJump.toFixed(3)}m (phi 클램프 역산 회귀)`);

  // 8) 모드 이탈 커플링 — 걷기 재진입 후 모델 탭 전환 = 자동 종료
  const coupled = await page.evaluate(() => {
    const { ui, rig } = window.__figcad;
    ui.getState().setWalkActive(true);
    ui.getState().setMode('model');
    return { walking: rig.isWalking, walkActive: ui.getState().walkActive };
  });
  if (coupled.walking || coupled.walkActive) fail('모드 이탈 시 걷기 자동 종료 실패');

  if (errors.length) fail(`페이지 에러: ${errors.join(' | ')}`);

  // ---- 터치 경로 (iPad 시뮬: hasTouch — device-class는 'desktop' 유지, any-pointer 게이트 검증) ----
  const tpage = await browser.newPage();
  await tpage.setViewport({ width: 1024, height: 768, hasTouch: true });
  tpage.on('pageerror', (e) => { if (!ignore(e.message)) errors.push(e.message); });
  await tpage.goto(`http://localhost:${port}/?p=${room}-t`, { waitUntil: 'load' });
  await tpage.waitForFunction(() => window.__figcad?.walk, { timeout: 10000 });

  await tpage.evaluate(() => {
    const { ui } = window.__figcad;
    ui.getState().setMode('review');
    ui.getState().setViewMode('3d');
    ui.getState().setWalkActive(true);
  });
  await new Promise((r) => setTimeout(r, 150));
  const touchEntered = await tpage.evaluate(() => ({
    device: window.__figcad.ui.getState().device,
    zoneShown: document.querySelector('.walk-zone')?.style.display !== 'none',
  }));
  if (touchEntered.device !== 'desktop') fail(`iPad 시뮬 device-class 'desktop' 아님: ${touchEntered.device}`);
  if (!touchEntered.zoneShown) fail('터치 기기서 조이스틱 존 미표시 (any-pointer 게이트)');

  // 걷기 중에도 리뷰 레일(WorkRail)이 존 위에서 탭 가능해야 함 — z-index 회귀 가드
  const railHit = await tpage.evaluate(() => {
    const el = document.elementFromPoint(150, 620);
    return { rail: !!el?.closest('.work-rail'), zone: !!el?.closest('.walk-zone') };
  });
  if (!railHit.rail || railHit.zone) fail(`걷기 중 좌레일 탭이 존에 먹힘 (rail=${railHit.rail}, zone=${railHit.zone})`);

  // 존 드래그 = 이동 (플로팅 스폰 → 위로 드래그 = 전진).
  // 터치점 x=340 = WorkRail(x≤300, z20 — 걷기 중에도 탭 가능해야 함) 오른쪽·존(38vw=389px) 안.
  const t0 = await tpage.evaluate(() => {
    const p = window.__figcad.rig.active.position;
    return { x: p.x, z: p.z };
  });
  const client = await tpage.createCDPSession();
  const touch = (type, points) => client.send('Input.dispatchTouchEvent', { type, touchPoints: points });
  await touch('touchStart', [{ x: 340, y: 620, id: 1 }]);
  await touch('touchMove', [{ x: 340, y: 560, id: 1 }]); // 위로 60px = 전진
  await new Promise((r) => setTimeout(r, 350));
  await touch('touchEnd', []);
  await new Promise((r) => setTimeout(r, 250));
  const t1 = await tpage.evaluate(() => {
    const p = window.__figcad.rig.active.position;
    return { x: p.x, z: p.z };
  });
  const tMoved = Math.hypot(t1.x - t0.x, t1.z - t0.z);
  if (tMoved < 0.1) fail(`존 드래그 전진 미동작 (이동 ${tMoved.toFixed(3)}m)`);

  // 캔버스 1지 드래그 = 룩
  const tq0 = await tpage.evaluate(() => window.__figcad.rig.active.quaternion.toArray());
  await touch('touchStart', [{ x: 700, y: 380, id: 2 }]);
  await touch('touchMove', [{ x: 780, y: 400, id: 2 }]);
  await touch('touchMove', [{ x: 860, y: 420, id: 2 }]);
  await touch('touchEnd', []);
  const tq1 = await tpage.evaluate(() => window.__figcad.rig.active.quaternion.toArray());
  const tqDelta = tq0.reduce((s, v, i) => s + Math.abs(v - tq1[i]), 0);
  if (tqDelta < 0.005) fail('터치 1지 드래그 룩 미동작');

  // 2지 핀치아웃 = 망원 (lensMm 증가)
  const lens0 = await tpage.evaluate(() => window.__figcad.ui.getState().lensMm);
  await touch('touchStart', [{ x: 600, y: 400, id: 3 }, { x: 700, y: 400, id: 4 }]);
  await touch('touchMove', [{ x: 560, y: 400, id: 3 }, { x: 760, y: 400, id: 4 }]);
  await touch('touchMove', [{ x: 500, y: 400, id: 3 }, { x: 840, y: 400, id: 4 }]);
  await touch('touchEnd', []);
  const lens1 = await tpage.evaluate(() => window.__figcad.ui.getState().lensMm);
  if (lens1 <= lens0) fail(`핀치아웃 망원 미동작 (${lens0} → ${lens1})`);

  if (errors.length) fail(`터치 페이지 에러: ${errors.join(' | ')}`);
  if (process.exitCode !== 1)
    console.log('WALK SMOKE PASS — 데스크톱(진입·WASD·룩·렌즈·조이스틱·포즈·Esc·커플링) + 터치(존 이동·룩·핀치 렌즈)');
} finally {
  await browser.close();
}
