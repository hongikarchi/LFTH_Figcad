import type { Pt } from '@figcad/core';
import type { SketchAttachment } from './agentClient';

/**
 * AI 스케치 캡처 — 펜 손그림을 문서공간(mm) 폴리라인으로 모은다(불변규칙 1·2:
 * 문서에 저장하지 않음, 임시 상태일 뿐). 확정 시 깔끔한 라인만 PNG로 래스터화하고
 * 정확한 mm bbox를 같이 넘겨 Claude vision이 스케일·방위를 맞추게 한다.
 * (Three 캔버스 픽셀을 읽지 않음 — 그리드/3D 없이 스케치만, bbox 정확.)
 */

let strokes: Pt[][] = [];
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

export function onSketchChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function beginStroke(p: Pt): void {
  strokes.push([p]);
  notify();
}
export function extendStroke(p: Pt): void {
  const s = strokes[strokes.length - 1];
  if (s) s.push(p);
  notify();
}
export function endStroke(): void {
  // 점 1개짜리(탭) 스트로크 제거
  const s = strokes[strokes.length - 1];
  if (s && s.length < 2) strokes.pop();
  notify();
}
export function clearSketch(): void {
  strokes = [];
  notify();
}
export function getStrokes(): readonly Pt[][] {
  return strokes;
}
export function hasSketch(): boolean {
  return strokes.some((s) => s.length >= 2);
}

const MAX_DIM = 1024; // 래스터 긴 변 px
const PAD_FRAC = 0.06; // bbox 여백 비율

/** 스트로크를 깔끔한 검은 라인으로 래스터화 + 문서 mm bbox 프레임 반환 (없으면 null) */
export function rasterizeSketch(): SketchAttachment | null {
  const live = strokes.filter((s) => s.length >= 2);
  if (!live.length) return null;

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const s of live)
    for (const [x, y] of s) {
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  const w0 = maxX - minX || 1000;
  const h0 = maxY - minY || 1000;
  const pad = Math.max(w0, h0) * PAD_FRAC;
  minX -= pad; minY -= pad; maxX += pad; maxY += pad;
  const W = maxX - minX;
  const H = maxY - minY;

  const scale = MAX_DIM / Math.max(W, H);
  const cw = Math.max(1, Math.round(W * scale));
  const ch = Math.max(1, Math.round(H * scale));
  const canvas = document.createElement('canvas');
  canvas.width = cw;
  canvas.height = ch;
  const g = canvas.getContext('2d')!;
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, cw, ch);
  g.strokeStyle = '#111111';
  g.lineWidth = Math.max(2, Math.round(Math.max(cw, ch) / 300));
  g.lineJoin = 'round';
  g.lineCap = 'round';
  // 문서 (x,y) → 캔버스 px: y 뒤집어 북쪽이 위 (이미지 방위 = 도면 방위)
  const px = (x: number) => (x - minX) * scale;
  const py = (y: number) => (maxY - y) * scale;
  for (const s of live) {
    g.beginPath();
    g.moveTo(px(s[0]![0]), py(s[0]![1]));
    for (let i = 1; i < s.length; i++) g.lineTo(px(s[i]![0]), py(s[i]![1]));
    g.stroke();
  }
  const dataB64 = canvas.toDataURL('image/png').split(',')[1] ?? '';
  return {
    dataB64,
    mediaType: 'image/png',
    frame: {
      x0: Math.round(minX),
      y0: Math.round(minY),
      x1: Math.round(maxX),
      y1: Math.round(maxY),
    },
  };
}
