import { beforeAll, describe, expect, it } from 'vitest';
import * as WebIFC from 'web-ifc';
import { DocStore, seedDocument, SEED_IDS } from '@figcad/core';
import { exportIfc, importIfcMeshes } from '../src';

/**
 * Track A5b gate — IFC 메시 추출의 단위·축 정합성 + 자기일관성.
 *
 * ⚠️ 이 라운드트립이 증명하는 것 / 못하는 것 (정직하게):
 *   ✅ 증명: (1) web-ifc가 모델 길이단위를 미터로 스케일해 돌려준다는 것
 *            (4000mm 벽이 4000이 아니라 ~4미터로 추출 = mm-not-scaled 1000× 버그 차단),
 *           (2) IFC Z-up → Three Y-up 축교환의 **부호**가 맞다는 것
 *            (signed bbox로 남북 거울반전을 잡는다 — 절댓값 extent만 보면 못 잡음),
 *           (3) Figcad export↔extract 자기일관성 (footprint 범위 일치).
 *   ❌ 못 증명: 실제 Revit/ArchiCAD가 쓴 IFC의 축/placement 정합성.
 *            그 파일들은 IfcMapConversion·다른 좌표 관례·진북 회전 등이 있어
 *            실에셋 시각 검증이 필요하다 (CI에 실 IFC 에셋 없음).
 */

let api: WebIFC.IfcAPI;
beforeAll(async () => {
  api = new WebIFC.IfcAPI();
  await api.Init();
});

// 세 축 길이를 전부 다르게: 동서 4m · 남북 3m · 높이 2m. 같으면(예 north==height)
// 축 permutation·sign 버그를 bbox가 못 잡는다(advisor 지적 — "옆으로 누운 건물"도 통과).
const EAST = 4000; // x(동) — Three X 기대
const NORTH = 3000; // y(북) — Three Z 기대 (+부호)
const HEIGHT = 2000; // 높이 — Three Y(up) 기대 (+부호)

/** 4m(동) × 3m(북) 풋프린트 벽 4개, 높이 2m (세 축 distinct). */
function footprintRoom(): DocStore {
  const s = new DocStore();
  seedDocument(s);
  const L = SEED_IDS.level;
  const T = SEED_IDS.wall200;
  // 평면 [x(동), y(북)] mm. (0,0)→(EAST,0)→(EAST,NORTH)→(0,NORTH) 닫힌 사각.
  s.createWall({ levelId: L, typeId: T, a: [0, 0], b: [EAST, 0], height: HEIGHT });
  s.createWall({ levelId: L, typeId: T, a: [EAST, 0], b: [EAST, NORTH], height: HEIGHT });
  s.createWall({ levelId: L, typeId: T, a: [EAST, NORTH], b: [0, NORTH], height: HEIGHT });
  s.createWall({ levelId: L, typeId: SEED_IDS.wall100, a: [0, NORTH], b: [0, 0], height: HEIGHT });
  return s;
}

interface BBox {
  min: [number, number, number];
  max: [number, number, number];
  vertexCount: number;
}

/** 추출 메시 전체의 월드(미터) bbox + 정점 수. */
function worldBBox(meshes: { positions: Float32Array }[]): BBox {
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  let count = 0;
  for (const mesh of meshes) {
    const p = mesh.positions;
    for (let i = 0; i < p.length; i += 3) {
      count++;
      for (let a = 0; a < 3; a++) {
        const v = p[i + a]!;
        if (v < min[a]!) min[a] = v;
        if (v > max[a]!) max[a] = v;
      }
    }
  }
  return { min, max, vertexCount: count };
}

describe('IFC 메시 추출 (federation 오버레이)', () => {
  it('단위·축 정합 + footprint 자기일관성 (동4m · 북3m · 높이2m, 세 축 distinct)', () => {
    const s = footprintRoom();
    const bytes = exportIfc(api, s.snapshot());
    const meshes = importIfcMeshes(api, bytes);
    const bb = worldBBox(meshes);

    const ext = {
      x: bb.max[0] - bb.min[0],
      y: bb.max[1] - bb.min[1],
      z: bb.max[2] - bb.min[2],
    };
    // 진단 — 스케일 실측치(mm이면 ~4000, 미터면 ~4) + 축 분포.
    // eslint-disable-next-line no-console
    console.log('[ifc-meshes gate] bbox min', bb.min, 'max', bb.max, 'extent', ext, 'verts', bb.vertexCount);

    // 두께 여유 (벽 200mm = 0.2m, 중심선 기준 ±0.1m).
    const TOL = 0.3;
    const near = (v: number, target: number) => Math.abs(v - target) <= TOL;
    const E = EAST / 1000; // 4
    const N = NORTH / 1000; // 3
    const H = HEIGHT / 1000; // 2

    // (a) 정점 > 0.
    expect(bb.vertexCount).toBeGreaterThan(0);

    // (b) 스케일 = METER (1~50). mm-not-scaled 1000× 버그면 ~4000으로 터진다.
    expect(ext.x).toBeGreaterThan(1);
    expect(ext.x).toBeLessThan(50);

    // (c) 축 permutation + (d) 부호를 동시에 고정 — 세 축 길이가 전부 달라 유일 식별.
    //   Three X = east(4): min≈0, max≈4.
    expect(near(bb.min[0], 0)).toBe(true);
    expect(near(ext.x, E)).toBe(true);
    //   Three Y(up) = height(2): min≈0(바닥), max≈2. **양수** — 옆으로 누우면(north=3) 터진다.
    expect(near(bb.min[1], 0)).toBe(true);
    expect(near(ext.y, H)).toBe(true);
    //   Three Z = north(3): min≈0, max≈3. **양수** — 거울반전이면 [−3,0]으로 떨어져 터진다.
    expect(near(bb.min[2], 0)).toBe(true);
    expect(near(ext.z, N)).toBe(true);

    // 명시: 세 extent가 서로 다른 값(4≠3≠2)이라야 이 테스트가 의미있다.
    expect(near(ext.x, E) && near(ext.y, H) && near(ext.z, N)).toBe(true);
  });

  it('객체 정체성 — expressId·ifcType이 메시에 실려온다 (스냅/라벨/AI용)', () => {
    const s = footprintRoom();
    const bytes = exportIfc(api, s.snapshot());
    const meshes = importIfcMeshes(api, bytes);
    expect(meshes.length).toBeGreaterThan(0);
    for (const m of meshes) {
      expect(typeof m.expressId).toBe('number'); // flatMesh.expressID 관통
    }
    // 타입명은 web-ifc API(GetLineType/GetNameFromTypeCode) 가용 시 채워진다 — 현 버전 기준 단언.
    // (미래 API 드리프트 시 name/ifcType은 undefined로 열화 — 그건 별도 완화 경로라 여기선 존재를 고정.)
    const typed = meshes.filter((m) => typeof m.ifcType === 'string' && m.ifcType.toUpperCase().includes('IFC'));
    expect(typed.length).toBeGreaterThan(0);
  });
});
