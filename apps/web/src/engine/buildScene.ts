import * as THREE from 'three';

/**
 * 환경 씬 — 라이트 테마 (ArchiCAD/Apple 풍 화이트 모델 룩).
 * 모델 요소는 SceneManager가 문서에서 파생해 채운다.
 * 머티리얼은 Lambert 고정 (Phong은 iPad에서 3배 비용).
 */
export function buildScene(scene: THREE.Scene): void {
  scene.background = new THREE.Color(0xf2f3f5);

  const hemi = new THREE.HemisphereLight(0xffffff, 0xc8ccd2, 1.25);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffffff, 1.1);
  sun.position.set(15, 30, 10);
  scene.add(sun);

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(200, 200),
    new THREE.MeshLambertMaterial({ color: 0xfafafa }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.01;
  scene.add(ground);

  // 1m 간격 그리드 (스냅 그리드 100mm의 시각 보조) — 연한 회색
  const grid = new THREE.GridHelper(100, 100, 0xc4c8cd, 0xe2e4e8);
  scene.add(grid);
}
