import { describe, expect, it } from 'vitest';
import rhino3dm from 'rhino3dm';
import { import3dmRefs } from '../src/rhino3dm';

// iter-3 회귀: import3dmRefs는 블록(InstanceReference) 안의 Mesh 정의 멤버에서 크래시했었다
// (정의 멤버가 top에도 들어가 emit이 delete → InstanceReference 재귀가 삭제된 객체 재사용 = use-after-delete).
// 블록 많은 .3dm(견본주택 등)이 정확히 그 형태 → 회귀 가드.

/** 단위 쿼드(1m) Z-up 메시 — 픽스처 공용. */
function unitQuad(rhino: Awaited<ReturnType<typeof rhino3dm>>) {
  const mesh = new rhino.Mesh();
  mesh.vertices().add(0, 0, 0);
  mesh.vertices().add(1000, 0, 0);
  mesh.vertices().add(1000, 1000, 0);
  mesh.vertices().add(0, 1000, 0);
  mesh.faces().addQuadFace(0, 1, 2, 3);
  return mesh;
}

async function buildMeshBlockDoc() {
  const rhino = await rhino3dm();
  // 원점 정의 멤버
  const mesh = unitQuad(rhino);
  const doc = new rhino.File3dm();
  const idefIdx = doc
    .instanceDefinitions()
    .add('blk', '', '', '', [0, 0, 0], [mesh], [new rhino.ObjectAttributes()]) as number;
  const defId = doc.instanceDefinitions().get(idefIdx).id;
  // 같은 정의를 2번 배치(멀티 인스턴스) — 서로 다른 위치. (런타임 ctor (id, transform); .d.ts는 0인자 표기)
  // @ts-expect-error rhino3dm .d.ts InstanceReference 시그니처 느슨
  const ir1 = new rhino.InstanceReference(defId, rhino.Transform.translationXYZ(10000, 0, 0)); // 동 10m
  // @ts-expect-error
  const ir2 = new rhino.InstanceReference(defId, rhino.Transform.translationXYZ(0, 20000, 0)); // 북 20m
  // @ts-expect-error 런타임 (geometry, attributes)
  doc.objects().addInstanceObject(ir1, new rhino.ObjectAttributes());
  // @ts-expect-error
  doc.objects().addInstanceObject(ir2, new rhino.ObjectAttributes());
  return new Uint8Array(doc.toByteArray());
}

describe('import3dmRefs — 블록(InstanceReference) Mesh 정의 멤버 (회귀)', () => {
  it('mesh-in-block 2회 배치 = 크래시 없음 + 변환 적용 + 미변환 중복 없음', async () => {
    const bytes = await buildMeshBlockDoc();
    const { meshes, edges } = await import3dmRefs(bytes); // 예전엔 여기서 use-after-delete throw
    expect(meshes).toHaveLength(1);
    const p = meshes[0]!.positions;
    // 쿼드=2삼각형×3정점×3 = 18 float. 인스턴스 2개 = 36. (정의 멤버가 원점에 추가로 그려지면 54 = 버그)
    expect(p).toHaveLength(36);
    expect(edges).toHaveLength(0);
    // 인스턴스1 = 동 10m: world x∈[10,11]. 인스턴스2 = 북 20m: world z∈[20,21].
    const xs: number[] = [];
    const zs: number[] = [];
    for (let i = 0; i < p.length; i += 3) { xs.push(p[i]!); zs.push(p[i + 2]!); }
    expect(Math.max(...xs)).toBeGreaterThan(9.9); // 인스턴스1 변환됨(동 10m)
    expect(Math.max(...zs)).toBeGreaterThan(19.9); // 인스턴스2 변환됨(북 20m)
  });

  it('객체 정체성 groups — 정렬·연속·범위 + 블록 def-name 폴백', async () => {
    const bytes = await buildMeshBlockDoc();
    const { meshes } = await import3dmRefs(bytes);
    expect(meshes).toHaveLength(1);
    const m = meshes[0]!;
    const totalTris = m.positions.length / 9;
    const groups = m.groups!;
    expect(groups).toHaveLength(2); // 인스턴스 2개 = top 객체 2개
    // 정렬·연속·버퍼 안 (start 오름차순, 방출 순서 = tris 단조 증가)
    let cursor = 0;
    for (const g of groups) {
      expect(g.start).toBe(cursor);
      expect(g.count).toBeGreaterThan(0);
      cursor = g.start + g.count;
    }
    expect(cursor).toBeLessThanOrEqual(totalTris);
    // 무명 InstanceReference → 인스턴스 정의(블록) 이름 폴백
    for (const g of groups) expect(g.name).toBe('blk');
  });

  it('객체 정체성 groups — 이름·레이어 있는 일반 Mesh 객체', async () => {
    const rhino = await rhino3dm();
    const doc = new rhino.File3dm();
    const layer = new rhino.Layer();
    layer.name = 'L-STRUCT';
    doc.layers().add(layer);
    const at = new rhino.ObjectAttributes();
    at.name = 'wall-A';
    at.layerIndex = 0;
    // @ts-expect-error 런타임 (mesh, attributes) — .d.ts는 1인자 표기 (addInstanceObject와 동일 사정)
    doc.objects().addMesh(unitQuad(rhino), at);
    const bytes = new Uint8Array(doc.toByteArray());
    const { meshes } = await import3dmRefs(bytes);
    const groups = meshes[0]!.groups!;
    expect(groups).toHaveLength(1);
    expect(groups[0]!.name).toBe('wall-A');
    expect(groups[0]!.layer).toBe('L-STRUCT');
    expect(typeof groups[0]!.id).toBe('string'); // uuid 발급됨
  });
});
