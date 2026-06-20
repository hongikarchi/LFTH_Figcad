import { rebaseSnapshot, type DocSnapshot, type DocStore, type DrawingView } from '@figcad/core';

// export = 외부 핸드오프(Revit/ArchiCAD/Rhino는 부지좌표 기대) → projectOrigin 복원(+1).
// 모든 풀모델 exporter가 이 한 곳을 거친다(advisor: 무누락). origin 없으면 no-op.
const restore = (s: DocSnapshot): DocSnapshot => rebaseSnapshot(s, 1);

/**
 * 외부 포맷 export/import 클라이언트 — 무거운 라이브러리(web-ifc/rhino3dm WASM,
 * dxf)를 전부 동적 import. 버튼을 눌렀을 때만, 포맷별 독립 청크로 로드한다
 * (초기 번들·iPad 메모리 보호 — 불변 규칙: 핫패스 밖). 서브엔트리(@figcad/interop/ifc
 * 등)로 import해 IFC만 쓸 때 rhino3dm/dxf가 딸려오지 않게 분리.
 */

export interface ImportResult {
  snapshot: DocSnapshot;
  skipped: Record<string, number>;
}

function triggerDownload(data: BlobPart, filename: string, mime: string): void {
  const blob = new Blob([data], { type: mime });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

// --- IFC (web-ifc WASM) ---
let ifcApiPromise: Promise<import('web-ifc').IfcAPI> | null = null;
/** 단일 web-ifc IfcAPI 인스턴스 (WASM 1회 Init, 실패 시 캐시 비워 재시도). federation 추출기도 공유. */
export async function getIfcApi(): Promise<import('web-ifc').IfcAPI> {
  if (!ifcApiPromise) {
    // 실패 시 캐시 비워 재시도 가능하게 (rejected promise 고착 방지)
    ifcApiPromise = (async () => {
      const WebIFC = await import('web-ifc');
      const wasmUrl = (await import('web-ifc/web-ifc.wasm?url')).default;
      const api = new WebIFC.IfcAPI();
      await api.Init(() => wasmUrl, true);
      return api;
    })().catch((e) => {
      ifcApiPromise = null;
      throw e;
    });
  }
  return ifcApiPromise;
}

export async function exportIfcBytes(snapshot: DocSnapshot): Promise<Uint8Array> {
  const [{ exportIfc }, api] = await Promise.all([import('@figcad/interop/ifc'), getIfcApi()]);
  return exportIfc(api, restore(snapshot));
}
export async function downloadIfc(snapshot: DocSnapshot): Promise<void> {
  const bytes = await exportIfcBytes(snapshot);
  triggerDownload(bytes as BlobPart, `${snapshot.meta.projectName || 'figcad'}.ifc`, 'application/x-step');
}
export async function parseIfc(bytes: Uint8Array): Promise<ImportResult> {
  const [{ importIfc }, api] = await Promise.all([import('@figcad/interop/ifc'), getIfcApi()]);
  return importIfc(api, bytes);
}

// --- Rhino .3dm (rhino3dm WASM) — wasm URL을 vite ?url로 주입 ---
async function rhinoWasmUrl(): Promise<string> {
  return (await import('rhino3dm/rhino3dm.wasm?url')).default;
}
export async function exportRhinoBytes(snapshot: DocSnapshot): Promise<Uint8Array> {
  const [{ exportRhino }, wasmUrl] = await Promise.all([import('@figcad/interop/rhino'), rhinoWasmUrl()]);
  return exportRhino(restore(snapshot), { wasmUrl });
}
export async function downloadRhino(snapshot: DocSnapshot): Promise<void> {
  const bytes = await exportRhinoBytes(snapshot);
  triggerDownload(bytes as BlobPart, `${snapshot.meta.projectName || 'figcad'}.3dm`, 'application/octet-stream');
}
export async function parseRhino(bytes: Uint8Array): Promise<ImportResult> {
  const [{ importRhino }, wasmUrl] = await Promise.all([import('@figcad/interop/rhino'), rhinoWasmUrl()]);
  return importRhino(bytes, { wasmUrl });
}

// --- DXF (2D, 텍스트) ---
export async function exportDxfText(snapshot: DocSnapshot): Promise<string> {
  const { exportDxf } = await import('@figcad/interop/dxf');
  return exportDxf(restore(snapshot));
}
export async function downloadDxf(snapshot: DocSnapshot): Promise<void> {
  triggerDownload(await exportDxfText(snapshot), `${snapshot.meta.projectName || 'figcad'}.dxf`, 'application/dxf');
}
export async function parseDxf(text: string): Promise<ImportResult> {
  const { importDxf } = await import('@figcad/interop/dxf');
  return importDxf(text);
}

/** 도면 뷰 DXF 다운로드 (M11) — 전체모델 export와 다른 뷰별 cut 도면 */
export async function downloadDrawingDxf(view: DrawingView, store: DocStore, name: string): Promise<void> {
  const { exportDrawingDxf } = await import('@figcad/interop/dxf');
  triggerDownload(exportDrawingDxf(view, store), `${name || 'drawing'}.dxf`, 'application/dxf');
}
