import * as WebIFC from 'web-ifc';

/**
 * IFC → 충실한 디스플레이 메시 (web-ifc geometry streaming).
 *
 * **importIfc(ifcImport.ts)와 다름**: 저건 파라메트릭 재구성(IfcWallStandardCase Axis +
 * 프로필 → 벽/슬라브/기둥/보)이라 자유형 B-rep을 버린다. 이건 federation 읽기전용
 * 오버레이용 — web-ifc가 테셀레이트한 *전체* 삼각망을 그대로 추출(자유형 포함).
 * 불변① 정합: Figcad 네이티브 요소가 아니라 별도 표현(외부 읽기전용 메시).
 *
 * 출력 = non-indexed 삼각형, **월드 미터 + Three Y-up** (ReferenceMesh 규약).
 *
 * ── 좌표 변환 (위험 지점, 실측으로 확정) ───────────────────────────────────
 * web-ifc의 추출 정점은 (gate 테스트가 bbox로 실증):
 *   (1) **모델 길이단위 = 미터로 이미 스케일됨**. exportIfc는 MILLI·METRE 단위로
 *       mm 정수를 기록하지만 web-ifc가 ×0.001 해서 미터로 돌려준다
 *       (4000mm 벽 → 추출 extent ≈ 4미터, NOT 4000 = mm-not-scaled 1000× 버그 차단).
 *   (2) **flatTransformation이 이미 Y-up 변환(−90°X)을 굽는다**. 정점을
 *       placedGeometry.flatTransformation으로 변환하면 결과가 raw IFC (x,y,z_up)이 아니라
 *       이미 (east, height, −north) = web-ifc 내부 Y-up 좌표다. (실측: dir3(0,0,1)로
 *       양(+)으로 압출한 벽 높이가 변환 후 음(−)축에 떨어졌다 — −90°X 회전의 흔적).
 * Figcad 렌더 관례(CLAUDE.md): `world = [x*0.001, elevation*0.001, y*0.001]`
 *   = IFC (east, north, height) → Three (east, height, +north). 즉 Three Z = +north.
 * web-ifc 변환 결과 (wx, wy, wz) = (east, height, −north)이므로,
 *   추가로 **세 번째 축만 부호 반전**: Three = (wx, wy, **−wz**) = (east, height, +north).
 *   축 재교환(swap) 아님 — flatTransformation이 이미 Y-up을 했으므로 위치만 그대로,
 *   north 부호만 +로 돌린다. 이래야 extractFigcadRoom(+north 규약)과 거울반전 없이 일치.
 *
 * 따라서 IFC 정점 →[flatTransformation]→ (wx,wy,wz) → Three (wx·s, wy·s, −wz·s),
 *   s = METER_SCALE (=1, web-ifc가 이미 미터).
 */

/** web-ifc 정점 stride: [px, py, pz, nx, ny, nz] = 6 float/정점. */
const FLOATS_PER_VERTEX = 6;

/**
 * web-ifc는 모델 길이단위를 미터로 내부 스케일해 정점을 돌려준다 (검증: ifc-meshes.test.ts).
 * 그래서 추가 스케일 불필요 (=1). 만약 미래 web-ifc 버전이 raw 파일단위(mm)를 돌려주면
 * gate 테스트의 extent가 ~4000으로 터지고, 그때 이 값을 0.001로 바꾼다.
 */
const METER_SCALE = 1;

export interface ExtractedMesh {
  positions: Float32Array;
  normals: Float32Array;
  /** IFC 엔티티 expressID (배치된 제품) — 임포트 객체 식별(스냅/라벨/AI 매니페스트)용 */
  expressId?: number;
  /** IfcRoot.Name — 없으면 무명 */
  name?: string;
  /** IFC 타입명 ('IFCWALL' 등) — refDisplayName 폴백/카테고리 */
  ifcType?: string;
}

/**
 * IFC 바이트 → 추출 메시 배열 (월드 미터, Three Y-up, non-indexed 삼각형).
 * @param api Init() 완료된 web-ifc IfcAPI (호출자 주입 — WASM 로딩 node/browser 분리)
 * @param bytes IFC STEP 파일 바이트
 */
export function importIfcMeshes(api: WebIFC.IfcAPI, bytes: Uint8Array): ExtractedMesh[] {
  const modelID = api.OpenModel(bytes);
  const out: ExtractedMesh[] = [];

  // 제품(expressID)당 Name·타입명 1회 조회 캐시 — 정체성은 스냅/라벨/AI용, 실패=무명(throw 금지).
  // web-ifc API 표면이 버전마다 달라(GetLineType/GetNameFromTypeCode) 전부 방어적으로 감싼다.
  const metaCache = new Map<number, { name?: string; type?: string }>();
  const metaOf = (eid: number): { name?: string; type?: string } => {
    let meta = metaCache.get(eid);
    if (meta === undefined) {
      let name: string | undefined;
      let type: string | undefined;
      try {
        const line = api.GetLine(modelID, eid) as { Name?: { value?: unknown } } | undefined;
        const nv = line?.Name?.value;
        name = typeof nv === 'string' && nv.length > 0 ? nv : undefined;
      } catch {
        /* 무명 허용 */
      }
      try {
        const a = api as unknown as {
          GetLineType?: (m: number, e: number) => number;
          GetNameFromTypeCode?: (c: number) => string;
        };
        const code = a.GetLineType?.(modelID, eid);
        const tn = code !== undefined ? a.GetNameFromTypeCode?.(code) : undefined;
        type = typeof tn === 'string' && tn.length > 0 ? tn : undefined;
      } catch {
        /* 타입 무명 허용 */
      }
      meta = { name, type };
      metaCache.set(eid, meta);
    }
    return meta;
  };

  try {
    api.StreamAllMeshes(modelID, (flatMesh: WebIFC.FlatMesh) => {
      const geoms = flatMesh.geometries;
      const eid = flatMesh.expressID;
      const meta = metaOf(eid);
      for (let gi = 0; gi < geoms.size(); gi++) {
        const placed = geoms.get(gi);
        const m = placed.flatTransformation; // flat 4x4, column-major
        const geo = api.GetGeometry(modelID, placed.geometryExpressID);
        const verts = api.GetVertexArray(geo.GetVertexData(), geo.GetVertexDataSize());
        const idx = api.GetIndexArray(geo.GetIndexData(), geo.GetIndexDataSize());
        geo.delete(); // WASM 힙 해제 (대형 모델 누수 방지)

        const vertexCount = verts.length / FLOATS_PER_VERTEX;
        if (vertexCount === 0 || idx.length === 0) continue;

        // 정점을 placedGeometry.flatTransformation으로 변환 → web-ifc Y-up 공간
        // (이미 미터·Y-up, (east, height, −north)). column-major 4x4:
        // world_r = m[r]*x + m[4+r]*y + m[8+r]*z + m[12+r].
        const wx = new Float64Array(vertexCount);
        const wy = new Float64Array(vertexCount);
        const wz = new Float64Array(vertexCount);
        for (let v = 0; v < vertexCount; v++) {
          const base = v * FLOATS_PER_VERTEX;
          const x = verts[base]!;
          const y = verts[base + 1]!;
          const z = verts[base + 2]!;
          wx[v] = m[0]! * x + m[4]! * y + m[8]! * z + m[12]!;
          wy[v] = m[1]! * x + m[5]! * y + m[9]! * z + m[13]!;
          wz[v] = m[2]! * x + m[6]! * y + m[10]! * z + m[14]!;
        }

        // de-index → non-indexed 삼각형. Three = (wx, wy, −wz) (north 부호만 +로).
        const triCount = idx.length;
        const positions = new Float32Array(triCount * 3);
        for (let i = 0; i < triCount; i++) {
          const vi = idx[i]!;
          positions[i * 3] = wx[vi]! * METER_SCALE; // east → Three X
          positions[i * 3 + 1] = wy[vi]! * METER_SCALE; // height → Three Y (up)
          positions[i * 3 + 2] = -wz[vi]! * METER_SCALE; // −north → +north = Three Z
        }
        // 노멀은 생략 — 좌표 축교환은 반사라 winding이 뒤집힌다. ReferenceLayer 머티리얼이
        // DoubleSide + computeVertexNormals이라 flat normal로 충분 (정확도 무관 디스플레이).
        const normals = new Float32Array(0);
        out.push({ positions, normals, expressId: eid, name: meta.name, ifcType: meta.type });
      }
      // flatMesh는 StreamAllMeshes 콜백이 소유하는 임시 뷰 — delete() 없음(LoadAllGeometry의
      // Vector<FlatMesh>와 다름). 해제할 WASM 핸들은 GetGeometry의 IfcGeometry뿐(위에서 delete).
    });
  } finally {
    api.CloseModel(modelID);
  }

  return out;
}
