r"""SketchUp .skp → glb 변환기 (Figcad import 업그레이드, iter-3).

SketchUp는 브라우저용 WASM 파서가 없다(독점 포맷). 그러나 공식 **SketchUp C SDK**(SketchUpAPI.dll)
+ CPython 바인딩(sketchup.cpXXX.pyd)으로 .skp를 읽고 면을 **테셀레이션**할 수 있다 → glTF로 변환 →
Figcad "+연동 모델"에 glTF로 업로드(이미 지원). Rhino .3dm은 rhino3dm이 면 테셀 불가라 와이어프레임뿐이지만,
SketchUp SDK는 솔리드 메시를 준다. (라이노 커넥터와 같은 "외부툴→glTF→Figcad" 사상의 구체 구현.)

준비:
  1) Python 3.11 또는 3.13 (바인딩 .pyd ABI). 예: `uv python install 3.13`.
  2) SketchUp SDK 파일이 있는 폴더(SketchUpAPI.dll + sketchup.cpXXX-win_amd64.pyd).
     SketchUp 공식 SDK 다운로드, 또는 blender sketchup_importer 폴더에 동봉됨.
     경로 = 인자 3 또는 환경변수 SKETCHUP_SDK_DIR.

사용:
  python skp2glb.py <in.skp> <out.glb> [sdk_dir] [max_tris]
  예) py -3.13 skp2glb.py model.skp model.glb C:\path\to\sketchup_importer

결과 glb를 Figcad "+연동 모델 → 파일 업로드"로 올리면 솔리드 오버레이로 보인다.
한계: 머티리얼/텍스처 미보존(단색 오버레이) · 대형은 max_tris(기본 2M)로 절단 · 좌표는 SU Z-up→glTF Y-up.
"""
import os
import sys
import struct
import json
import time
import array

IN_TO_M = 0.0254  # SketchUp 내부 단위 = 인치 → 미터
IDENT = [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]]


def _matmul(a, b):
    return [[a[r][0] * b[0][c] + a[r][1] * b[1][c] + a[r][2] * b[2][c] + a[r][3] * b[3][c] for c in range(4)] for r in range(4)]


def convert(skp_path, out_path, sketchup_module, max_tris):
    t0 = time.time()
    model = sketchup_module.Model.from_file(skp_path)
    print("opened %dMB in %.1fs" % (os.path.getsize(skp_path) // 1048576, time.time() - t0))
    pos = array.array("f")
    st = {"tris": 0, "capped": False, "faces": 0}

    def emit(ent, M, depth):
        if st["capped"] or depth > 12:
            return
        m0, m1, m2 = M[0], M[1], M[2]
        for f in ent.faces:
            if getattr(f, "hidden", False):
                continue
            try:
                vs, tri = f.tessfaces[:2]  # SDK 테셀: vs=정점, tri=삼각형 인덱스
            except Exception:
                continue
            st["faces"] += 1
            wv = []
            for p in vs:
                x, y, z = p[0], p[1], p[2]
                wx = m0[0] * x + m0[1] * y + m0[2] * z + m0[3]
                wy = m1[0] * x + m1[1] * y + m1[2] * z + m1[3]
                wz = m2[0] * x + m2[1] * y + m2[2] * z + m2[3]
                # inch→m + SU Z-up(x동·y북·z상) → glTF Y-up: (x, z, -y)
                wv.append((wx * IN_TO_M, wz * IN_TO_M, -wy * IN_TO_M))
            for t in tri:
                if st["tris"] >= max_tris:
                    st["capped"] = True
                    return
                pos.extend(wv[t[0]])
                pos.extend(wv[t[1]])
                pos.extend(wv[t[2]])
                st["tris"] += 1
        for g in ent.groups:
            emit(g.entities, _matmul(M, g.transform), depth + 1)
        for ins in ent.instances:
            emit(ins.definition.entities, _matmul(M, ins.transform), depth + 1)

    emit(model.entities, IDENT, 0)
    model.close()
    print("faces %d tris %d capped=%s in %.1fs" % (st["faces"], st["tris"], st["capped"], time.time() - t0))
    if st["tris"] == 0:
        raise SystemExit("표시할 삼각형 없음 (.skp에 면이 없거나 전부 숨김)")

    n = len(pos)
    mn = [1e30, 1e30, 1e30]
    mx = [-1e30, -1e30, -1e30]
    for i in range(0, n, 3):
        for k in range(3):
            v = pos[i + k]
            if v < mn[k]:
                mn[k] = v
            if v > mx[k]:
                mx[k] = v
    bin_blob = pos.tobytes()
    while len(bin_blob) % 4:
        bin_blob += b"\x00"
    gltf = {
        "asset": {"version": "2.0", "generator": "figcad-skp2glb"},
        "buffers": [{"byteLength": len(bin_blob)}],
        "bufferViews": [{"buffer": 0, "byteOffset": 0, "byteLength": len(bin_blob), "target": 34962}],
        "accessors": [{"bufferView": 0, "componentType": 5126, "count": n // 3, "type": "VEC3", "min": mn, "max": mx}],
        "meshes": [{"primitives": [{"attributes": {"POSITION": 0}, "mode": 4}]}],
        "nodes": [{"mesh": 0}],
        "scenes": [{"nodes": [0]}],
        "scene": 0,
    }
    json_blob = json.dumps(gltf).encode("utf-8")
    while len(json_blob) % 4:
        json_blob += b" "
    total = 12 + 8 + len(json_blob) + 8 + len(bin_blob)
    with open(out_path, "wb") as fp:
        fp.write(struct.pack("<III", 0x46546C67, 2, total))  # 'glTF', ver2, total
        fp.write(struct.pack("<II", len(json_blob), 0x4E4F534A))  # JSON chunk
        fp.write(json_blob)
        fp.write(struct.pack("<II", len(bin_blob), 0x004E4942))  # BIN chunk
        fp.write(bin_blob)
    print("wrote %s (%.1fMB) bbox m: [%.1f,%.1f,%.1f]..[%.1f,%.1f,%.1f]%s" % (
        out_path, os.path.getsize(out_path) / 1048576, mn[0], mn[1], mn[2], mx[0], mx[1], mx[2],
        "  [capped at %d tris]" % max_tris if st["capped"] else ""))


def main():
    if len(sys.argv) < 3:
        raise SystemExit(__doc__)
    skp_path, out_path = sys.argv[1], sys.argv[2]
    sdk_dir = sys.argv[3] if len(sys.argv) > 3 else os.environ.get("SKETCHUP_SDK_DIR")
    max_tris = int(sys.argv[4]) if len(sys.argv) > 4 else 2_000_000
    if not sdk_dir or not os.path.isdir(sdk_dir):
        raise SystemExit("SketchUp SDK 폴더 필요 (인자 3 또는 SKETCHUP_SDK_DIR) — SketchUpAPI.dll + sketchup.cpXXX.pyd")
    os.add_dll_directory(sdk_dir)
    sys.path.insert(0, sdk_dir)
    import sketchup  # noqa: E402 (SDK dir 등록 후 import)
    print("SketchUp API", sketchup.get_API_version())
    convert(skp_path, out_path, sketchup, max_tris)


if __name__ == "__main__":
    main()
