import { extractDwgUnderlay, underlayDenseCenter, type DwgUnderlay } from '@figcad/interop/dwg-underlay';

/**
 * DWG/DXF → 2D 언더레이(빽도면) 클라이언트 — libredwg(@mlightcad/libredwg-web) WASM을 동적 import.
 *
 * DWG는 닫힌 바이너리라 브라우저 파서가 없었으나 libredwg WASM이 클라에서 직접 파싱 →
 * 서버 변환기·ODA 불필요(interop.md "DWG 배제" 뒤집음), iPad 가능. web-ifc/rhino3dm과 동급 hot-path 밖.
 *
 * WASM 로딩: 이 패키지는 exports 맵에 .wasm 서브경로가 없어 web-ifc식 `?url` import 불가.
 * 대신 글루가 `new URL('libredwg-web.wasm', import.meta.url)`로 찾고, vite는 그 패턴을 에셋으로
 * 리라이트한다 → `LibreDwg.create()` no-arg + `optimizeDeps.exclude`(vite.config)로 해결.
 */

// 단일 LibreDwg 인스턴스(WASM 1회 로드). 실패 시 캐시 비워 재시도.
let libPromise: Promise<{ dwg_read_data: (b: ArrayBuffer, t: number) => number | undefined; convert: (p: number) => unknown; dwg_free: (p: number) => void }> | null = null;
async function getLib() {
  if (!libPromise) {
    libPromise = (async () => {
      const { LibreDwg } = await import('@mlightcad/libredwg-web');
      return (await LibreDwg.create()) as never;
    })().catch((e) => {
      libPromise = null;
      throw e;
    });
  }
  return libPromise;
}

/** DWG/DXF 바이트 → 평면 언더레이(세그먼트·라벨·레이어·skip). */
export async function parseDwgUnderlay(bytes: ArrayBuffer, kind: 'dwg' | 'dxf' = 'dwg'): Promise<DwgUnderlay> {
  const mod = await import('@mlightcad/libredwg-web');
  const lib = await getLib();
  const fileType = kind === 'dxf' ? mod.Dwg_File_Type.DXF : mod.Dwg_File_Type.DWG;
  const handle = lib.dwg_read_data(bytes, fileType);
  if (!handle) throw new Error(`${kind.toUpperCase()} 파싱 실패 (libredwg)`);
  try {
    const db = lib.convert(handle);
    return extractDwgUnderlay(db as Parameters<typeof extractDwgUnderlay>[0]);
  } finally {
    lib.dwg_free(handle);
  }
}

export { underlayDenseCenter };
export type { DwgUnderlay };
