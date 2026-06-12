import * as THREE from 'three';

/**
 * M0 플레이스홀더 씬: 그리드 + 조명 + 매싱 박스.
 * M1에서 문서→씬 reconciler(SceneManager)로 대체된다.
 * 머티리얼은 Lambert 고정 (Phong은 iPad에서 3배 비용).
 */
export function buildScene(scene: THREE.Scene): void {
  scene.background = new THREE.Color(0x1a1d21);

  // 조명
  const hemi = new THREE.HemisphereLight(0xffffff, 0x445566, 1.1);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffffff, 1.4);
  sun.position.set(15, 30, 10);
  scene.add(sun);

  // 지면 + 그리드 (1m 간격, 10m 굵은 선)
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(200, 200),
    new THREE.MeshLambertMaterial({ color: 0x23272c }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.01;
  scene.add(ground);

  const grid = new THREE.GridHelper(100, 100, 0x3d444d, 0x2c3239);
  scene.add(grid);

  // 플레이스홀더 매싱: 작은 2층 덩어리
  const wallMat = new THREE.MeshLambertMaterial({ color: 0xd8d2c4 });
  const slabMat = new THREE.MeshLambertMaterial({ color: 0x9a958a });
  const edgeMat = new THREE.LineBasicMaterial({ color: 0x16181b });

  const addBox = (
    w: number,
    h: number,
    d: number,
    x: number,
    y: number,
    z: number,
    mat: THREE.Material,
  ) => {
    const geo = new THREE.BoxGeometry(w, h, d);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, y + h / 2, z);
    scene.add(mesh);
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geo), edgeMat);
    edges.position.copy(mesh.position);
    scene.add(edges);
  };

  addBox(10, 3, 8, 0, 0, 0, wallMat); // 1층
  addBox(10, 0.2, 8, 0, 3, 0, slabMat); // 슬라브
  addBox(6, 3, 8, -2, 3.2, 0, wallMat); // 2층 (셋백)
  addBox(6, 0.2, 8, -2, 6.2, 0, slabMat); // 지붕 슬라브
}
