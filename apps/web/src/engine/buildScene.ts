import * as THREE from 'three';

/**
 * 환경 씬: 배경 + 조명 + 지면 + 그리드.
 * 모델 요소는 SceneManager가 문서에서 파생해 채운다.
 * 머티리얼은 Lambert 고정 (Phong은 iPad에서 3배 비용).
 */
export function buildScene(scene: THREE.Scene): void {
  scene.background = new THREE.Color(0x1a1d21);

  const hemi = new THREE.HemisphereLight(0xffffff, 0x445566, 1.1);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffffff, 1.4);
  sun.position.set(15, 30, 10);
  scene.add(sun);

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(200, 200),
    new THREE.MeshLambertMaterial({ color: 0x23272c }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.01;
  scene.add(ground);

  // 1m 간격 그리드 (스냅 그리드 100mm의 시각 보조)
  const grid = new THREE.GridHelper(100, 100, 0x3d444d, 0x2c3239);
  scene.add(grid);
}
