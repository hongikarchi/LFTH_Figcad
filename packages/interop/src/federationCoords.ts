// federation 오버레이 좌표 변환 (순수, 의존성 0 — apps/web extractGltf가 static import).
//
// **Figcad world 규약 = Three Y-up, Z = +north** (extractFigcadRoom·importIfcMeshes 일치).
// 외부 glTF(Rhino·SketchUp 등 Z-up 툴 export)는 GLTFLoader 로드 시 north가 **-Z** (표준 Y-up
// 우수좌표: 툴 Z(up)→glTF +Y, 툴 Y(north)→glTF -Z). → Figcad와 north 부호가 거울반전.
//
// **박스 실험으로 측정 확정**(2026-06-22): 알려진 Rhino 박스 east[10,11]·north[20,22]·height[0,3]m를
// Rhino -_Export glb → GLTFLoader 로드 → world bbox = X[10,11]·Y[0,3]·**Z[-22,-20]**. 즉 X(east)·
// Y(height) 정합, **Z(north)만 부호반전**. swap·scale 없음. → 보정 = Z negate 하나뿐.
// (검증: flip 후 reconciler offset -originY와 합성 → overlay world Z = (north-originY)/1000 =
//  docY/1000 = recenter 프레임 Z. 정확 정합.)

/**
 * GLTFLoader가 낸 glTF world 좌표(north=-Z) → Figcad world(north=+Z). Z축만 부호반전.
 * 새 Float32Array 반환(원본 불변). 길이는 3의 배수(xyz triplet) 가정.
 */
export function gltfPositionsToFigcad(positions: Float32Array): Float32Array {
  const out = new Float32Array(positions.length);
  for (let i = 0; i + 2 < positions.length; i += 3) {
    out[i] = positions[i]!;
    out[i + 1] = positions[i + 1]!;
    out[i + 2] = -positions[i + 2]!; // north 부호 반전 (glTF -Z → Figcad +Z)
  }
  return out;
}
