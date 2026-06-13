import type { DocSnapshot } from '@figcad/core';

/**
 * IFC export/import 클라이언트 — web-ifc(WASM ~1.2MB)는 무거우므로 전부 동적 import.
 * 사용자가 버튼을 눌렀을 때만 로드 (초기 번들·iPad 메모리 보호 — 불변 규칙: 핫패스 밖).
 */

let apiPromise: Promise<import('web-ifc').IfcAPI> | null = null;

async function getApi(): Promise<import('web-ifc').IfcAPI> {
  if (!apiPromise) {
    apiPromise = (async () => {
      const WebIFC = await import('web-ifc');
      const wasmUrl = (await import('web-ifc/web-ifc.wasm?url')).default;
      const api = new WebIFC.IfcAPI();
      // 단일 스레드(mt/worker wasm 회피) + vite가 served한 wasm URL로 로드
      await api.Init(() => wasmUrl, true);
      return api;
    })();
  }
  return apiPromise;
}

/** 문서 스냅샷 → IFC 바이트 (다운로드 없이 — 테스트/프로그램 경로) */
export async function exportIfcBytes(snapshot: DocSnapshot): Promise<Uint8Array> {
  const [{ exportIfc }, api] = await Promise.all([import('@figcad/interop'), getApi()]);
  return exportIfc(api, snapshot);
}

/** 문서 스냅샷 → IFC 파일 다운로드 */
export async function downloadIfc(snapshot: DocSnapshot): Promise<void> {
  const bytes = await exportIfcBytes(snapshot);
  const blob = new Blob([bytes as BlobPart], { type: 'application/x-step' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${snapshot.meta.projectName || 'figcad'}.ifc`;
  a.click();
  URL.revokeObjectURL(a.href);
}

/** IFC 파일 바이트 → 문서 스냅샷 + 무시 카운트 */
export async function parseIfc(
  bytes: Uint8Array,
): Promise<{ snapshot: DocSnapshot; skipped: Record<string, number> }> {
  const [{ importIfc }, api] = await Promise.all([import('@figcad/interop'), getApi()]);
  return importIfc(api, bytes);
}
