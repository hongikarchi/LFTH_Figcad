/**
 * M11.5 UX 스모크 — 네비게이터 2D 뷰 클릭→도면열림(item 1), 온스크린 클러스터 스토리 스테퍼(item 2),
 * 줌버튼 제거(item 3). 사전: vite dev. 사용: node scripts/ux-smoke.mjs [포트=5173]
 * NOTE: UI/UX 재구성 P1 Slice7에서 하단 QuickOptions 바가 우하단 ViewportCluster로 대체됨
 *       (스토리 select → 스테퍼, 줌 버튼 제거). 이 스모크는 현행 ViewportCluster를 검증.
 */
import puppeteer from 'puppeteer-core';

const port = process.argv[2] ?? '5173';
const room = `e2e-ux-${Math.random().toString(36).slice(2, 8)}`;

const browser = await puppeteer.launch({
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  headless: true,
});

try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });
  page.on('dialog', (d) => d.accept('UX테스터'));
  const errors = [];
  const ignore = (t) => /WebSocket|ERR_CONNECTION_REFUSED|parties\/doc/.test(t);
  page.on('pageerror', (e) => { if (!ignore(e.message)) errors.push(e.message); });
  page.on('console', (m) => { if (m.type() === 'error' && !ignore(m.text())) errors.push(m.text().slice(0, 200)); });

  await page.goto(`http://localhost:${port}/?p=${room}`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__figcad?.store, { timeout: 10000 });

  // 두 번째 스토리 추가 (스위처 옵션 확인용)
  await page.evaluate(() => {
    const { store } = window.__figcad;
    store.addLevel({ name: '2층', elevation: 3000, height: 3000, order: 1 });
  });
  await new Promise((r) => setTimeout(r, 150));

  // item 3 — 온스크린 컨트롤 클러스터(QuickOptions 대체)에 줌 ± 버튼 없음
  const cluster = await page.evaluate(() => {
    const c = document.querySelector('.viewport-cluster');
    if (!c) return null;
    return [...c.querySelectorAll('button')].filter((b) => /줌|확대|축소/.test(b.title)).length;
  });
  if (cluster === null) throw new Error('뷰포트 컨트롤 클러스터(.viewport-cluster) 없음 (item 3)');
  if (cluster !== 0) throw new Error(`줌 버튼 ${cluster}개 남아있음 (제거 실패)`);
  console.log('PASS  온스크린 컨트롤 클러스터 줌 ± 버튼 제거됨 (item 3)');

  // item 2 — 온스크린 클러스터 스토리 스테퍼: 현재 스토리 표시 + 위/아래 버튼으로 활성 스토리 전환.
  //   시드(1층, order 0) + 위에서 추가한 2층(order 1) → 스테퍼가 두 스토리를 알고 전환 가능해야 함.
  const storyBefore = await page.evaluate(
    () => document.querySelector('.viewport-cluster .vc-story')?.textContent ?? null,
  );
  if (storyBefore !== '1층') throw new Error(`스토리 스테퍼 초기값 불량(예상 1층): ${JSON.stringify(storyBefore)}`);
  const stepped = await page.evaluate(() => {
    const up = [...document.querySelectorAll('.viewport-cluster button')].find((b) => b.title === '위 스토리');
    if (!up) return { ok: false, reason: '버튼 없음' };
    if (up.disabled) return { ok: false, reason: '비활성(스토리 1개로 인식)' };
    up.click();
    return { ok: true };
  });
  if (!stepped.ok) throw new Error(`위 스토리 버튼 전환 불가: ${stepped.reason}`);
  await new Promise((r) => setTimeout(r, 150));
  const story = await page.evaluate(() => {
    const levels = [...window.__figcad.store.listLevels()].sort((a, b) => a.order - b.order);
    return {
      label: document.querySelector('.viewport-cluster .vc-story')?.textContent ?? null,
      active: window.__figcad.ui.getState().activeLevelId,
      secondId: levels[1]?.id ?? null,
    };
  });
  if (story.label !== '2층' || story.active !== story.secondId)
    throw new Error(`스토리 스테퍼 전환 실패: ${JSON.stringify(story)}`);
  console.log('PASS  온스크린 스토리 스테퍼 전환 (1층 → 2층, 활성레벨 동기화) (item 2)');

  // 활성 스토리 변경이 viewMode를 안 건드림 (3D 유지) — store 동작 보증
  await page.evaluate(() => {
    const ui = window.__figcad.ui.getState();
    ui.setViewMode('3d');
    const lv = window.__figcad.store.listLevels();
    ui.setActiveLevel(lv[1].id);
  });
  const vm = await page.evaluate(() => window.__figcad.ui.getState().viewMode);
  if (vm !== '3d') throw new Error(`스토리 전환이 viewMode를 바꿈: ${vm}`);
  console.log('PASS  스토리 전환이 3D 뷰 유지 (item 2)');

  // item 1 — 도면 뷰 생성 → 네비게이터(모델 모드 ProjectMap)에 나타남 → 클릭 시 drawingOpen + 캔버스
  //   네비게이터는 P1 Slice5 이후 WorkRail 모델 모드에서만 렌더(기본 랜딩=review) → 모드 전환 필요.
  await page.evaluate(() => {
    const { store, seed, ui } = window.__figcad;
    ui.getState().setMode('model');
    store.createView({ name: '평면 · 1층', type: 'plan', levelId: seed.levelId, cutHeight: 1200 });
  });
  await new Promise((r) => setTimeout(r, 250));
  const clicked = await page.evaluate(() => {
    const btns = [...document.querySelectorAll('.navigator button')];
    const b = btns.find((x) => /평면 · 1층/.test(x.textContent || ''));
    if (!b) return { found: false };
    b.click();
    return { found: true };
  });
  if (!clicked.found) throw new Error('네비게이터에 도면 뷰 버튼 없음 (item 1)');
  await new Promise((r) => setTimeout(r, 300));
  const opened = await page.evaluate(() => ({
    drawingOpen: window.__figcad.ui.getState().drawingOpen,
    canvas: !!document.querySelector('canvas[data-drawing]'),
  }));
  if (!opened.drawingOpen || !opened.canvas)
    throw new Error(`도면 뷰 클릭이 도면 안 엶: ${JSON.stringify(opened)}`);
  console.log('PASS  네비게이터 도면 뷰 클릭 → 도면 자동 열림 (item 1)');

  // item 6 — 커튼월 유리 패널: 반투명 자식 메시(opacity 0.3)가 씬에 + 픽 가능
  const glass = await page.evaluate(() => {
    const { store, seed, ui } = window.__figcad;
    ui.getState().setViewMode('3d');
    const id = store.createCurtainWall({
      levelId: seed.levelId, typeId: seed.curtainWallTypeId,
      a: [0, 0], b: [6000, 0], uSpacing: 1500, vSpacing: 1500,
    });
    return id;
  });
  await new Promise((r) => setTimeout(r, 300));
  const glassOk = await page.evaluate((id) => {
    let found = null;
    window.__figcad.engine.scene.traverse((m) => {
      if (m.userData && m.userData.elementId === id && m.material && m.material.transparent && m.material.opacity < 0.6 && m.geometry?.attributes?.position?.count > 0) {
        found = m.material.opacity;
      }
    });
    return found;
  }, glass);
  if (glassOk === null) throw new Error('커튼월 유리 패널 메시 없음 (item 6)');
  console.log(`PASS  커튼월 유리 패널 (반투명 메시 opacity ${glassOk}) (item 6)`);

  // item 7a — 슬라브 정점 드래그(그립): down(정점0)→move(새 위치)→up. 도구 직접 구동.
  const vtx = await page.evaluate(() => {
    const { store, seed, ui, tools } = window.__figcad;
    ui.getState().setTool('select');
    const id = store.createSlab({
      levelId: seed.levelId, typeId: seed.slabTypeId,
      boundary: [[0, 0], [4000, 0], [4000, 3000], [0, 3000]],
    });
    ui.getState().setSelection([id]);
    const t = tools.active;
    const info = (doc) => ({ doc, clientX: 100, clientY: 100, mmPerPixel: 5 });
    t.down(info([0, 0])); // 정점0 그립 픽 (doc=정점)
    t.move(info([500, 500])); // 새 위치로
    t.up(info([500, 500]));
    return store.getElement(id).boundary[0];
  });
  if (!(vtx[0] === 500 && vtx[1] === 500)) throw new Error(`정점 편집 실패: boundary[0]=${JSON.stringify(vtx)}`);
  console.log(`PASS  슬라브 정점 드래그 → boundary[0]=${JSON.stringify(vtx)} (item 7)`);

  // item 7b — 커튼월 끝점 핸들 드래그
  const cwEnd = await page.evaluate(() => {
    const { store, seed, ui, tools } = window.__figcad;
    ui.getState().setTool('select');
    const id = store.createCurtainWall({
      levelId: seed.levelId, typeId: seed.curtainWallTypeId,
      a: [0, 0], b: [6000, 0], uSpacing: 1500, vSpacing: 1500,
    });
    ui.getState().setSelection([id]);
    const t = tools.active;
    const info = (doc) => ({ doc, clientX: 100, clientY: 100, mmPerPixel: 5 });
    t.down(info([0, 0])); // 끝점 a
    t.move(info([0, 1500]));
    t.up(info([0, 1500]));
    return store.getElement(id).a;
  });
  if (cwEnd[0] === 0 && cwEnd[1] === 0) throw new Error(`커튼월 끝점 이동 안 됨: a=${JSON.stringify(cwEnd)}`);
  console.log(`PASS  커튼월 끝점 핸들 드래그 → a=${JSON.stringify(cwEnd)} (item 7)`);

  // 편집 액션 move — EditActionController 위임 검증: 기준점→목표 두 down, 이동 후 action 해제
  const mv = await page.evaluate(() => {
    const { store, seed, ui, tools } = window.__figcad;
    ui.getState().setTool('select');
    const id = store.createSlab({
      levelId: seed.levelId, typeId: seed.slabTypeId,
      boundary: [[0, 0], [2000, 0], [2000, 2000], [0, 2000]],
    });
    ui.getState().setSelection([id]);
    ui.getState().setEditAction('move');
    const t = tools.active;
    const info = (doc) => ({ doc, clientX: 100, clientY: 100, mmPerPixel: 5 });
    t.down(info([0, 0])); // 기준점 수집
    t.down(info([1000, 1000])); // 목표 → moveElements + 종료
    return { v0: store.getElement(id).boundary[0], action: ui.getState().editAction };
  });
  if (!(mv.v0[0] === 1000 && mv.v0[1] === 1000)) throw new Error(`편집액션 move 실패: v0=${JSON.stringify(mv.v0)}`);
  if (mv.action !== null) throw new Error(`move 후 editAction 미해제: ${mv.action}`);
  console.log(`PASS  편집액션 move → boundary[0]=${JSON.stringify(mv.v0)}, action 해제 (EditActionController)`);

  // per-tool 핫키 레이어(Slice 11) — 실 keydown 디스패치 경로: W=벽(모델), 1=협업·리뷰 모드, 게이팅(리뷰서 W 무반응)
  const hk = await page.evaluate(() => {
    const ui = window.__figcad.ui;
    const press = (key) => window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
    ui.getState().setMode('model');
    ui.getState().setTool('select');
    press('w');
    const wallTool = ui.getState().activeTool;
    press('1');
    const mode1 = ui.getState().activeMode;
    press('w'); // 리뷰 모드 — 팔레트에 벽 없음 = 무반응
    const reviewTool = ui.getState().activeTool;
    press('c'); // 리뷰 오버라이드 = 코멘트
    const commentTool = ui.getState().activeTool;
    ui.getState().setMode('review');
    return { wallTool, mode1, reviewTool, commentTool };
  });
  if (hk.wallTool !== 'wall') throw new Error(`핫키 W 실패: ${hk.wallTool}`);
  if (hk.mode1 !== 'review') throw new Error(`핫키 1(모드) 실패: ${hk.mode1}`);
  if (hk.reviewTool === 'wall') throw new Error('핫키 게이팅 실패: 리뷰 모드서 벽 활성');
  if (hk.commentTool !== 'comment') throw new Error(`핫키 C(리뷰=코멘트) 실패: ${hk.commentTool}`);
  console.log('PASS  핫키 레이어 — W=벽, 1=리뷰 모드, 게이팅, C=코멘트 (Slice 11)');

  if (errors.length) throw new Error(`콘솔/페이지 에러: ${errors.slice(0, 3).join(' | ')}`);
  console.log('\nUX 스모크 통과');
} catch (err) {
  console.error('FAIL ', err.message);
  process.exitCode = 1;
} finally {
  await browser.close();
}
