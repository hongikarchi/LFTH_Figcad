import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist';
// vite ?url — pdf.js 워커를 별 청크로(핫패스 미로드). libredwg와 달리 ?url 가능.
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

GlobalWorkerOptions.workerSrc = workerUrl;

export interface RenderedPdf {
  canvas: HTMLCanvasElement;
  /** 페이지 실척 (pt, scale=1 viewport) — 실세계 mm 환산용 (pt × 25.4/72). 렌더 해상도와 무관. */
  ptWidth: number;
  ptHeight: number;
  /** 문서 총 페이지 수 — UI 페이지 스테퍼 상한 */
  pageCount: number;
  /** 실제 렌더된 페이지(1-base) — 요청이 범위 밖이면 클램프된 값 */
  page: number;
}

/**
 * PDF 지정 페이지를 캔버스로 래스터 렌더 (참조 언더레이용 — iter-3 import + 다중 페이지).
 * 긴 변 ~2000px 타깃(줌 가독, 3배 상한). 동적 import로만 들어옴(핫패스 미로드).
 * 페이지는 1-base, 범위 밖 요청은 [1, pageCount]로 클램프. 벡터 추출은 후속.
 */
export async function renderPdfPage(bytes: ArrayBuffer, pageNo = 1): Promise<RenderedPdf> {
  const task = getDocument({ data: new Uint8Array(bytes) });
  try {
    // 로딩 실패(손상 PDF)도 finally destroy에 잡히게 — await를 try 안으로(리뷰: 재시도마다 태스크 누수)
    const doc = await task.promise;
    const pageCount = doc.numPages;
    const n = Math.min(Math.max(1, Math.round(pageNo)), Math.max(1, pageCount));
    const page = await doc.getPage(n);
    const base = page.getViewport({ scale: 1 });
    const renderScale = Math.min(3, 2000 / Math.max(base.width, base.height, 1));
    const viewport = page.getViewport({ scale: renderScale });
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('canvas 2d context 없음');
    await page.render({ canvas, canvasContext: ctx, viewport }).promise; // pdfjs v6: canvas 필수
    return { canvas, ptWidth: base.width, ptHeight: base.height, pageCount, page: n };
  } finally {
    void task.destroy(); // v6: 로딩태스크 destroy로 정리
  }
}
