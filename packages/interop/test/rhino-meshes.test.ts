import { describe, expect, it } from 'vitest';
import rhino3dm from 'rhino3dm';
import { import3dmMeshes } from '../src/rhino3dm';

// M13.6 D — .3dm federation 오버레이 메시 추출 게이트.
// 좌표 변환 검증: rhino mm·Z-up [east,north,height] → Figcad world m·Y-up [east,height,north] = [x,z,y]*.001.

describe('import3dmMeshes — Z-up mm → Figcad world Y-up m', () => {
  it('알려진 정점 삼각형: [x,y,z]mm → world [x,z,y]/1000', async () => {
    const rhino = await rhino3dm();
    const mesh = new rhino.Mesh();
    // Z-up mm: (east, north, height)
    mesh.vertices().add(1000, 2000, 3000);
    mesh.vertices().add(4000, 2000, 3000);
    mesh.vertices().add(1000, 5000, 3000);
    mesh.faces().addTriFace(0, 1, 2);
    const doc = new rhino.File3dm();
    // @ts-expect-error rhino3dm .d.ts는 1인자로 표기하나 런타임은 (mesh, attributes) 2인자 요구
    doc.objects().addMesh(mesh, null);
    const bytes = new Uint8Array(doc.toByteArray());

    const { meshes, skipped } = await import3dmMeshes(bytes);
    expect(skipped).toBe(0);
    expect(meshes).toHaveLength(1);
    const p = meshes[0]!.positions;
    expect(p).toHaveLength(9); // 1 tri = 3 verts × 3
    // v0 (1000,2000,3000) → world [east/1000, height/1000, north/1000] = [1, 3, 2]
    expect([p[0], p[1], p[2]]).toEqual([1, 3, 2]);
    // v1 (4000,2000,3000) → [4, 3, 2]
    expect([p[3], p[4], p[5]]).toEqual([4, 3, 2]);
    // v2 (1000,5000,3000) → [1, 3, 5]
    expect([p[6], p[7], p[8]]).toEqual([1, 3, 5]);
  });

  it('quad → 2 삼각형 (6 verts)', async () => {
    const rhino = await rhino3dm();
    const mesh = new rhino.Mesh();
    mesh.vertices().add(0, 0, 0);
    mesh.vertices().add(1000, 0, 0);
    mesh.vertices().add(1000, 1000, 0);
    mesh.vertices().add(0, 1000, 0);
    mesh.faces().addQuadFace(0, 1, 2, 3);
    const doc = new rhino.File3dm();
    // @ts-expect-error 런타임 2인자
    doc.objects().addMesh(mesh, null);
    const { meshes } = await import3dmMeshes(new Uint8Array(doc.toByteArray()));
    expect(meshes[0]!.positions).toHaveLength(18); // 2 tri × 3 × 3
  });

  it('Mesh 아닌 객체(곡선)는 skip+count (raw Brep=v1.5)', async () => {
    const rhino = await rhino3dm();
    const doc = new rhino.File3dm();
    const line = new rhino.LineCurve([0, 0, 0], [1000, 0, 0]);
    // @ts-expect-error 런타임 2인자
    doc.objects().addCurve(line, null);
    const { meshes, skipped } = await import3dmMeshes(new Uint8Array(doc.toByteArray()));
    expect(meshes).toHaveLength(0);
    expect(skipped).toBe(1);
  });
});
