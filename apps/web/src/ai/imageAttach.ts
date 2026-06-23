/**
 * 사진 첨부(vision 입력) — 카메라/파일 이미지를 다운스케일해 JPEG base64로.
 * 대용량 사진(수 MB) 그대로 전송 방지 + vision은 ~1280px면 충분. sketch(트레이스)와 달리 참고 이미지.
 */
export interface ImageAttachment {
  dataB64: string;
  mediaType: 'image/jpeg';
}

export async function fileToAttachment(file: File, maxPx = 1280): Promise<ImageAttachment> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error('이미지 로드 실패'));
      i.src = url;
    });
    const scale = Math.min(1, maxPx / Math.max(img.width, img.height));
    const w = Math.max(1, Math.round(img.width * scale));
    const h = Math.max(1, Math.round(img.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('canvas 2d 컨텍스트 불가');
    ctx.drawImage(img, 0, 0, w, h);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.82);
    return { dataB64: dataUrl.split(',')[1] ?? '', mediaType: 'image/jpeg' };
  } finally {
    URL.revokeObjectURL(url);
  }
}
