// M18 임포트(연동 모델) 상호작용 스모크 — refIdentity(userData 정체성) · refSnap(꼭짓점>에지>면) ·
// 라벨 프리필(refDisplayName + blur 취소 함정) · 빽도면 끝점 스냅(underlaySnapCandidates) · AI importsManifest.
//
// 픽스처(최소 발명 원칙):
//  - 3D 오버레이 = figcad-room 소스: 두 번째 룸에 벽+이름있는 존을 실 WS 경로로 시드 → ?op=pull 추출.
//  - 2D 언더레이 = 실 DWG(apps/web/public/__dwgtest.dwg) fed-upload 라운드트립(dwg-e2e 경로).
//
// 전제: vite dev :5173 + 백엔드 :8787 이미 실행 중. 사용: node apps/web/scripts/ref-interact-smoke.mjs [포트=5173]
import puppeteer from 'puppeteer-core';

const PORT = process.argv[2] ?? process.env.PORT ?? '5173';
const BACKEND = 'http://localhost:8787';
const rand = Math.random().toString(36).slice(2, 8);
const ROOM = `ref-smoke-${rand}`;
const SRC_ROOM = `ref-smoke-${rand}-src`;
const SHOT = (n) => `apps/web/scripts/_ref-smoke-${n}.png`;

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
function skip(label, why) {
  console.log(`SKIP  ${label} — ${why}`);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: process.env.CHROME ?? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  headless: 'new',
  args: ['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist', '--window-size=1400,1000'],
});

try {
  // ---------- 0) 소스 룸 시드 (두 번째 페이지, 실 WS 동기화 경로) ----------
  const seedPage = await browser.newPage();
  await seedPage.setViewport({ width: 900, height: 700 });
  await seedPage.goto(`http://localhost:${PORT}/?p=${SRC_ROOM}`, { waitUntil: 'load' });
  await seedPage.waitForFunction(() => window.__figcad?.store && window.__figcad?.seed, { timeout: 20000 });
  const seeded = await seedPage.evaluate(() => {
    const F = window.__figcad;
    const wallId = F.store.createWall({
      levelId: F.seed.levelId,
      typeId: F.seed.wallTypeIds[0],
      a: [0, 0],
      b: [4000, 0],
    });
    const zoneId = F.store.createZone({
      levelId: F.seed.levelId,
      boundary: [[500, 800], [3500, 800], [3500, 2600], [500, 2600]],
      name: '회의실',
    });
    return { wallId, zoneId };
  });
  console.log(`소스 룸 시드: ${SRC_ROOM} wall=${seeded.wallId} zone=${seeded.zoneId}`);

  // WS → 서버 반영 대기 (?op=pull 스냅샷에 두 요소 등장할 때까지 폴)
  let synced = false;
  for (let i = 0; i < 60 && !synced; i++) {
    await sleep(500);
    try {
      const res = await fetch(`${BACKEND}/parties/doc/${SRC_ROOM}?op=pull`);
      if (res.ok) {
        const txt = await res.text();
        synced = txt.includes(seeded.wallId) && txt.includes(seeded.zoneId);
      }
    } catch { /* 서버 기동 지연 등 — 계속 폴 */ }
  }
  await seedPage.close();
  if (!check(synced, '소스 룸 서버 동기화 (?op=pull에 벽+존 반영)')) throw new Error('소스 룸 동기화 실패 — 이후 블록 무의미');

  // ---------- 메인 룸 ----------
  const page = await browser.newPage();
  await page.setViewport({ width: 1400, height: 1000 });
  page.on('dialog', (d) => d.accept().catch(() => {}));
  const errors = [];
  const ignore = (t) => /WebSocket|ERR_CONNECTION_REFUSED|parties\/doc|favicon/.test(t);
  page.on('pageerror', (e) => { if (!ignore(e.message)) errors.push(e.message); });
  page.on('console', (m) => { if (m.type() === 'error' && !ignore(m.text())) errors.push(m.text().slice(0, 200)); });

  await page.goto(`http://localhost:${PORT}/?p=${ROOM}`, { waitUntil: 'load' });
  await page.waitForFunction(
    () => {
      const F = window.__figcad;
      return F?.store && F?.federation && F?.referenceLayer && F?.dwg && F?.ui && F?.rig && F?.engine;
    },
    { timeout: 20000 },
  );

  // ---------- 1) refIdentity — figcad-room 오버레이 userData 정체성 ----------
  const elemsBefore = await page.evaluate(() => window.__figcad.store.listElements().length);
  const fedId = await page.evaluate((srcRoom) => {
    return window.__figcad.store.addFederationSource({
      name: '연동룸(스모크)',
      sourceType: 'figcad-room',
      ref: srcRoom,
      visible: true,
      addedBy: 'ref-smoke',
    });
  }, SRC_ROOM);
  const loaded = await page
    .waitForFunction((id) => window.__figcad.referenceLayer.list().includes(id), { timeout: 30000 }, fedId)
    .then(() => true)
    .catch(() => false);
  if (!loaded) {
    const err = await page.evaluate((id) => window.__figcad.federation.errorOf?.(id), fedId);
    check(false, 'figcad-room 오버레이 로드 (reconciler pull→derive→ReferenceLayer)', `status err=${err}`);
    throw new Error('오버레이 미로드 — 이후 블록 무의미');
  }
  check(true, 'figcad-room 오버레이 로드 (reconciler pull→derive→ReferenceLayer)');

  const ident = await page.evaluate(({ id, wallId, zoneId }) => {
    const F = window.__figcad;
    const meshes = [];
    F.referenceLayer.root.traverse((o) => {
      if (o.isMesh && o.userData?.refSourceId === id) {
        meshes.push({
          refSourceId: o.userData.refSourceId,
          refObject: o.userData.refObject ?? null,
          hasGroups: Array.isArray(o.userData.refGroups),
        });
      }
    });
    const wall = meshes.find((m) => m.refObject?.objectId === wallId) ?? null;
    const zone = meshes.find((m) => m.refObject?.objectId === zoneId) ?? null;
    const srcName = F.store.getFederationSource(id)?.name ?? null;
    return { count: meshes.length, wall, zone, srcName, elemsNow: F.store.listElements().length };
  }, { id: fedId, wallId: seeded.wallId, zoneId: seeded.zoneId });

  check(ident.count >= 2, `오버레이 메시에 refSourceId 스탬프 (${ident.count}개)`);
  check(
    ident.wall !== null && ident.wall.refObject.category === '벽',
    'refIdentity: 벽 메시 refObject { objectId=원본 el.id, category=KIND_LABEL 벽 }',
    JSON.stringify(ident.wall),
  );
  check(
    ident.zone !== null && ident.zone.refObject.name === '회의실' && ident.zone.refObject.category === '존',
    'refIdentity: 존 메시 refObject.name=회의실 (objectName 경로)',
    JSON.stringify(ident.zone),
  );
  check(ident.srcName === '연동룸(스모크)', 'refDisplayName 폴백 체인 재료: getFederationSource(id).name 해석');
  check(ident.elemsNow === elemsBefore, `오버레이는 문서 밖 (listElements ${elemsBefore}→${ident.elemsNow}, 불변①)`);
  skip('refGroups(.3dm 병합 버퍼 faceIndex 이진탐색) 경로', 'Mesh 있는 .3dm 바이너리 픽스처 부재 — refObject(단일 객체) 경로로 정체성 관통은 검증됨');

  // ---------- 2) refSnap — 꼭짓점 스냅 (LabelTool 3D 호버 마커 = refSnapAt 실경로) ----------
  await page.evaluate((id) => {
    const F = window.__figcad;
    F.ui.getState().setTool('label');
    const b = F.federation.worldBoundsOf(id);
    F.rig.fitBounds({ x: b.min[0], y: b.min[1], z: b.min[2] }, { x: b.max[0], y: b.max[1], z: b.max[2] });
    F.rig.tick(2);
    F.engine.requestRender();
  }, fedId);
  await sleep(400);
  await page.screenshot({ path: SHOT('overlay') });

  const mode = await page.evaluate(() => window.__figcad.ui.getState().viewMode);
  check(mode === '3d', `viewMode=3d (refSnap 경로 게이트) — 현재 ${mode}`);

  // 벽 메시의 고유 꼭짓점 중 카메라에 가깝고 화면상 고립된 후보들 + 안쪽(centroid 방향) 커서 오프셋
  const cands = await page.evaluate(({ id, wallId }) => {
    const F = window.__figcad;
    let mesh = null;
    F.referenceLayer.root.traverse((o) => {
      if (!mesh && o.isMesh && o.userData?.refSourceId === id && o.userData?.refObject?.objectId === wallId) mesh = o;
    });
    if (!mesh) return { error: '벽 메시 못 찾음' };
    const cam = F.rig.active;
    cam.updateMatrixWorld(true);
    cam.matrixWorldInverse.copy(cam.matrixWorld).invert();
    const proto = F.engine.scene.position.clone(); // THREE 미노출 → 기존 Vector3 clone으로 인스턴스 확보
    mesh.updateWorldMatrix(true, false);
    const pos = mesh.geometry.getAttribute('position');
    const uniq = new Map();
    for (let i = 0; i < pos.count; i++) {
      const v = proto.clone().fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld);
      const k = `${Math.round(v.x * 1000)},${Math.round(v.y * 1000)},${Math.round(v.z * 1000)}`;
      if (!uniq.has(k)) uniq.set(k, v);
    }
    const verts = [...uniq.values()];
    const camPos = cam.getWorldPosition(proto.clone());
    const scr = (v) => {
      const p = v.clone().project(cam);
      return { x: (p.x * 0.5 + 0.5) * innerWidth, y: (-p.y * 0.5 + 0.5) * innerHeight, z: p.z };
    };
    // 화면 중심(메시 평균점) — 커서를 꼭짓점에서 살짝 안쪽으로 밀어 실루엣 밖 레이 미스 방지
    const centroid = verts.reduce((a, v) => a.add(v), proto.clone().set(0, 0, 0)).multiplyScalar(1 / verts.length);
    const cs = scr(centroid);
    const scored = verts
      .map((v) => ({ v, s: scr(v), d: v.distanceTo(camPos) }))
      .filter((c) => Math.abs(c.s.z) < 0.98 && c.s.x > 40 && c.s.x < innerWidth - 40 && c.s.y > 40 && c.s.y < innerHeight - 40)
      .sort((a, b) => a.d - b.d);
    const out = [];
    for (const c of scored) {
      // 화면상 고립: 다른 고유 꼭짓점이 30px 안에 있으면 스냅 대상 모호 → 제외
      const near = scored.some((o) => o !== c && Math.hypot(o.s.x - c.s.x, o.s.y - c.s.y) < 30);
      if (near) continue;
      const dx = cs.x - c.s.x;
      const dy = cs.y - c.s.y;
      const n = Math.hypot(dx, dy) || 1;
      out.push({
        vx: c.v.x, vy: c.v.y, vz: c.v.z,
        px: c.s.x, py: c.s.y,
        cx: c.s.x + (dx / n) * 4, cy: c.s.y + (dy / n) * 4,
      });
      if (out.length >= 5) break;
    }
    return { cands: out, total: verts.length };
  }, { id: fedId, wallId: seeded.wallId });
  if (cands.error || !cands.cands?.length) throw new Error(`꼭짓점 후보 산출 실패: ${JSON.stringify(cands)}`);

  // 후보 순회: 호버 → 스냅 마커가 정확히 그 꼭짓점(±2mm)에 서는 후보 채택
  let hit = null;
  for (const c of cands.cands) {
    await page.mouse.move(c.cx - 2, c.cy); // 스로틀(33ms) 통과용 2회 이동
    await sleep(60);
    await page.mouse.move(c.cx, c.cy);
    await sleep(80);
    const m = await page.evaluate(({ vx, vy, vz }) => {
      const F = window.__figcad;
      let best = null;
      F.engine.scene.traverse((o) => {
        if (o.isMesh && o.visible && o.geometry?.type === 'SphereGeometry') {
          const d = Math.hypot(o.position.x - vx, o.position.y - vy, o.position.z - vz);
          if (best === null || d < best.d) best = { d, color: o.material?.color?.getHex?.() ?? -1 };
        }
      });
      return best;
    }, c);
    if (m && m.d < 0.002) { hit = { cand: c, marker: m }; break; }
  }
  check(
    hit !== null,
    'refSnap: 3D 호버 스냅 마커 = 꼭짓점 정좌표 (vertex가 edge/face 이김)',
    `후보 ${cands.cands.length}개 모두 미스`,
  );
  if (hit) {
    // vertex 마커색 = REF_MARKER_COLORS.vertex(0xff9500). (LabelTool face 색도 주황이라 색은 보조,
    // 위치 정합(±2mm)이 결정적 판정 — face/edge 히트면 커서 오프셋만큼 어긋남.)
    check(hit.marker.color === 0xff9500, `refSnap: 마커색 vertex 주황(0xff9500) — 실제 0x${hit.marker.color.toString(16)}`);
  }

  // ---------- 3) 라벨 프리필 — 임포트 객체 클릭 → refDisplayName 프리필 + blur 취소 함정 ----------
  if (hit) {
    const c = hit.cand;
    const vertMm = [Math.round(c.vx * 1000), Math.round(c.vz * 1000)];
    // 클릭2 = 벽 메시 화면 중심(전면 히트 보장 — 지면 레이는 지평선 위로 나가면 miss).
    // LeaderCapture.up 클릭2는 메시 히트도 수락(textZ 경로) → 완료 확실.
    const ground = await page.evaluate(({ id, wallId }) => {
      const F = window.__figcad;
      let mesh = null;
      F.referenceLayer.root.traverse((o) => {
        if (!mesh && o.isMesh && o.userData?.refSourceId === id && o.userData?.refObject?.objectId === wallId) mesh = o;
      });
      const cam = F.rig.active;
      cam.updateMatrixWorld(true);
      cam.matrixWorldInverse.copy(cam.matrixWorld).invert();
      const proto = F.engine.scene.position.clone();
      mesh.updateWorldMatrix(true, false);
      const pos = mesh.geometry.getAttribute('position');
      const centroid = proto.clone().set(0, 0, 0);
      for (let i = 0; i < pos.count; i++) centroid.add(proto.clone().fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld));
      centroid.multiplyScalar(1 / pos.count);
      const p = centroid.clone().project(cam);
      return { x: (p.x * 0.5 + 0.5) * innerWidth, y: (-p.y * 0.5 + 0.5) * innerHeight, ndc: Math.abs(p.z) };
    }, { id: fedId, wallId: seeded.wallId });

    const runLeader = async () => {
      await page.mouse.move(c.cx - 2, c.cy);
      await sleep(60);
      await page.mouse.move(c.cx, c.cy);
      await sleep(60);
      await page.mouse.click(c.cx, c.cy); // 클릭1 = 앵커(임포트 꼭짓점)
      await sleep(150);
      await page.mouse.click(ground.x, ground.y); // 클릭2 = 텍스트 위치(빈 지면)
      await sleep(250);
      return page.evaluate(() => {
        const inputs = [...document.querySelectorAll('input[type="text"]')].filter((i) => i.style.position === 'fixed');
        const el = inputs[inputs.length - 1] ?? null;
        return el ? { value: el.value, focused: document.activeElement === el } : null;
      });
    };

    const p1 = await runLeader();
    check(p1 !== null, '라벨 도구 2클릭 → 프리필 입력창 표시', 'promptText input 미등장 (클릭2 지면 미스?)');
    if (p1) {
      check(p1.value === '벽', `라벨 프리필 = refDisplayName ('벽' 기대, 실제 '${p1.value}')`);
      check(p1.focused, '프리필 입력창 포커스');

      // blur 함정(수정 확인): 프리필 상태에서 무타이핑 blur = 취소(라벨 생성 금지)
      await page.evaluate(() => {
        const inputs = [...document.querySelectorAll('input[type="text"]')].filter((i) => i.style.position === 'fixed');
        inputs[inputs.length - 1]?.blur();
      });
      await sleep(250);
      const afterBlur = await page.evaluate(() => ({
        labels: window.__figcad.store.listElements().filter((e) => e.kind === 'label').length,
        inputLeft: [...document.querySelectorAll('input[type="text"]')].some((i) => i.style.position === 'fixed'),
      }));
      check(afterBlur.labels === 0 && !afterBlur.inputLeft, '프리필 blur = 취소 (라벨 미생성 — 스팸 방지 함정 수정 유지)');

      // 재시도 → Enter = 프리필 그대로 수락 → 라벨 생성 + leaderAt = 꼭짓점 mm 정좌표(vertex 스냅 증명)
      const p2 = await runLeader();
      check(p2 !== null && p2.value === '벽', '재시도 프리필 재현');
      await page.keyboard.press('Enter');
      await sleep(300);
      const label = await page.evaluate(() =>
        window.__figcad.store.listElements().find((e) => e.kind === 'label') ?? null,
      );
      const la = label?.leaderAt ?? label?.anchor ?? null;
      const dAnchor = la ? Math.max(Math.abs(la[0] - vertMm[0]), Math.abs(la[1] - vertMm[1])) : Infinity;
      check(
        label !== null && label.template === 'custom' && label.customText === '벽',
        `라벨 생성 (Enter=프리필 수락): ${JSON.stringify({ template: label?.template, customText: label?.customText })}`,
      );
      check(
        dAnchor <= 2,
        `라벨 leaderAt = 스냅 꼭짓점 doc mm (오차 ${dAnchor}mm ≤ 2) — vertex 스냅이 문서까지 관통`,
        `leaderAt=${JSON.stringify(la)} 기대=${JSON.stringify(vertMm)}`,
      );
    }
  } else {
    skip('라벨 프리필 블록', '꼭짓점 스냅 후보 확보 실패 — 위 refSnap FAIL 참조');
  }
  await page.evaluate(() => window.__figcad.ui.getState().setTool('select'));

  // ---------- 4) 빽도면(DWG) 끝점 스냅 — fed-upload → underlaySnapCandidates ----------
  const dwgUp = await page.evaluate(async ({ BACKEND, ROOM }) => {
    const F = window.__figcad;
    try {
      const fres = await fetch('/__dwgtest.dwg');
      const buf = fres.ok ? await fres.arrayBuffer() : null;
      // DWG 매직 "AC10xx" — vite 404/SPA 폴백 바디가 파서·업로드로 흘러가는 것 차단
      const magic = buf && buf.byteLength >= 2 ? String.fromCharCode(...new Uint8Array(buf.slice(0, 2))) : '';
      if (!buf || magic !== 'AC') return { missing: true };
      const u = await F.dwg.parseDwgUnderlay(buf, 'dwg');
      const [dx, dy] = F.dwg.underlayDenseCenter(u);
      // 기대 끝점: 첫 가시 세그먼트의 시작점 → 배치(origin=[-dx,-dy], rot 0, scale 1) 적용 = doc mm
      let expected = null;
      for (let i = 0; i < u.segments.length; i += 4) {
        if (u.layerHidden[u.segLayer[i / 4]]) continue;
        expected = [Math.round(u.segments[i] - dx), Math.round(u.segments[i + 1] - dy)];
        break;
      }
      const res = await fetch(`${BACKEND}/parties/doc/${ROOM}?op=fed-upload&ext=dwg`, { method: 'POST', body: buf });
      if (!res.ok) return { error: `fed-upload ${res.status}: ${await res.text()}` };
      const { url } = await res.json();
      const levelId = F.ui.getState().activeLevelId ?? F.seed.levelId;
      const id = F.store.addFederationSource({
        name: '빽도면(스모크)',
        sourceType: 'dwg',
        ref: `${BACKEND}/parties/doc/${ROOM}${url}`,
        visible: true,
        addedBy: 'ref-smoke',
        underlay: { levelId, origin: [-dx, -dy], rotation: 0, scale: 1 },
      });
      return { id, levelId, expected, segs: u.segments.length / 4 };
    } catch (e) {
      return { error: String(e) };
    }
  }, { BACKEND, ROOM });

  if (dwgUp.missing) {
    skip('DWG 언더레이 블록(끝점 스냅)', '픽스처 없음: apps/web/public/__dwgtest.dwg (gitignore 머신로컬 — dwg-underlay/dwg-e2e SKIP 규약과 동일)');
  } else if (dwgUp.error || !dwgUp.expected) {
    check(false, 'DWG 언더레이 업로드/파싱', dwgUp.error ?? '가시 세그먼트 없음');
    skip('underlaySnapCandidates 검증', '언더레이 픽스처 실패');
  } else {
    const dwgReady = await page
      .waitForFunction((id) => window.__figcad.federation.statusOf?.(id) === 'ready', { timeout: 30000 }, dwgUp.id)
      .then(() => true)
      .catch(() => false);
    const dwgErr = dwgReady ? null : await page.evaluate((id) => window.__figcad.federation.errorOf?.(id), dwgUp.id);
    check(dwgReady, `DWG 언더레이 ready (${dwgUp.segs}세그)`, `err=${dwgErr}`);
    if (dwgReady) {
      const snap = await page.evaluate(({ id, levelId, expected }) => {
        const F = window.__figcad;
        const near = F.federation.underlaySnapCandidates(levelId, expected, 500);
        const exact = near.some((p) => Math.abs(p[0] - expected[0]) <= 1 && Math.abs(p[1] - expected[1]) <= 1);
        // 다른 레벨 id로는 후보 0 (레벨 게이트)
        const other = F.federation.underlaySnapCandidates('__no-such-level__', expected, 500);
        void id;
        return { count: near.length, exact, otherLevel: other.length, sample: near.slice(0, 3) };
      }, dwgUp);
      check(
        snap.exact,
        `underlaySnapCandidates: 기대 끝점 ${JSON.stringify(dwgUp.expected)} ±1mm 포함 (반경내 ${snap.count}개)`,
        `sample=${JSON.stringify(snap.sample)}`,
      );
      check(snap.otherLevel === 0, '언더레이 스냅 레벨 게이트 (타 레벨 = 후보 0)');
    }
  }

  // ---------- 5) AI importsManifest — vite dev 모듈 직접 import (훅 미노출 → 실모듈 실인자) ----------
  const manifest = await page.evaluate(async () => {
    try {
      const mod = await import('/src/ai/importsManifest.ts');
      const F = window.__figcad;
      return { m: mod.buildImportsManifest(F.store, F.federation) };
    } catch (e) {
      return { error: String(e) };
    }
  });
  if (manifest.error) {
    check(false, 'importsManifest 모듈 로드(vite dev /src import)', manifest.error);
  } else {
    const m = manifest.m;
    const room = m?.sources.find((s) => s.sourceType === 'figcad-room');
    const dwg = m?.sources.find((s) => s.sourceType === 'dwg');
    check(m !== null && m.sources.length >= 1, `buildImportsManifest: 소스 ${m?.sources.length}개`);
    check(
      !!room && room.status === 'ready' && (room.objects ?? []).some((o) => o.name === '회의실'),
      'manifest figcad-room: status=ready + objects에 존 이름(회의실)',
      JSON.stringify(room?.objects),
    );
    check(
      !!room && (room.objects ?? []).some((o) => o.name === '벽'),
      'manifest figcad-room: 무명 벽 = 카테고리 폴백(벽)',
    );
    check(
      !!room?.bboxMm && room.bboxMm.x[0] <= 100 && room.bboxMm.x[1] >= 3900,
      `manifest bboxMm(doc mm 프레임): x=${JSON.stringify(room?.bboxMm?.x)} (벽 0..4000 포괄)`,
    );
    if (dwg) {
      check(
        dwg.status === 'ready' && (dwg.layers ?? []).length > 0,
        `manifest dwg: status=ready + layers ${dwg.layers?.length}개 (textSamples ${dwg.textSamples?.length ?? 0}개)`,
      );
    } else {
      skip('manifest dwg 소스 검증', dwgUp.missing ? 'DWG 픽스처 없음 (위 블록 SKIP)' : '위 DWG 블록 실패로 소스 부재');
    }
    skip('AI dock 전송 경로(body.imports 주입)', 'AI 키/패널 의존 — buildImportsManifest 실모듈+실인자(store/federation) 직접 검증으로 갈음');
  }

  await page.screenshot({ path: SHOT('final') });

  if (errors.length) {
    check(false, `콘솔/페이지 에러 0건`, errors.slice(0, 3).join(' | '));
  } else {
    check(true, '콘솔/페이지 에러 0건');
  }
} catch (err) {
  fail++;
  failures.push(String(err.message ?? err));
  console.error('FAIL  (중단)', err.message ?? err);
} finally {
  await browser.close();
}

console.log(`\n${fail === 0 ? 'PASS' : 'FAIL'} — ${pass} pass / ${fail} fail${failures.length ? `\n  실패: ${failures.join('\n  실패: ')}` : ''}`);
process.exitCode = fail === 0 ? 0 : 1;
