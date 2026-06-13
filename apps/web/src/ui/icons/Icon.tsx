import type { JSX } from 'react';
import {
  Copy,
  Download,
  FileSearch,
  FlipHorizontal,
  Layers,
  Minus,
  MousePointer2,
  Move,
  MoveHorizontal,
  Pencil,
  Plus,
  RotateCw,
  Scissors,
  Sparkles,
  SquareDashed,
  Trash2,
  TriangleAlert,
  Type,
  Upload,
  X,
  History,
  type LucideIcon,
} from 'lucide-react';

/**
 * 단일 아이콘 컴포넌트 (M8-C) — lucide(MIT, 라인 아이콘) + 건축 전용 커스텀 글리프.
 * 블랙앤화이트 ArchiCAD/Apple 컨셉: 모두 24×24 viewBox, currentColor, stroke 2.
 * capability.icon은 문자열 키만 보유 → 여기서 해석 (레지스트리는 JSX 없는 순수 데이터).
 * active 버튼에선 부모 color가 흰색이라 currentColor 상속으로 자동 반전.
 */

// 일반 동작 = lucide (트리셰이킹: 사용 아이콘만 named import)
const LUCIDE: Record<string, LucideIcon> = {
  select: MousePointer2,
  'file-search': FileSearch,
  layers: Layers,
  pencil: Pencil,
  trash: Trash2,
  move: Move,
  copy: Copy,
  'grid-2x2': Copy, // 배열 = 복사 변형
  'flip-horizontal': FlipHorizontal,
  'rotate-cw': RotateCw,
  scissors: Scissors,
  'move-horizontal': MoveHorizontal,
  plus: Plus,
  minus: Minus,
  ai: Sparkles,
  version: History,
  lint: TriangleAlert,
  download: Download,
  upload: Upload,
  close: X,
  text: Type,
  box: SquareDashed,
};

// 건축 요소 = 커스텀 라인 글리프 (24×24, fill none, stroke=currentColor)
const GLYPHS: Record<string, JSX.Element> = {
  wall: (
    <>
      <line x1="4" y1="8" x2="20" y2="8" />
      <line x1="4" y1="16" x2="20" y2="16" />
    </>
  ),
  door: (
    <>
      <path d="M6 20 V8 a8 8 0 0 1 8 8 v4" />
      <line x1="6" y1="20" x2="20" y2="20" />
    </>
  ),
  window: (
    <>
      <rect x="4" y="6" width="16" height="12" rx="1" />
      <line x1="12" y1="6" x2="12" y2="18" />
    </>
  ),
  slab: (
    <>
      <rect x="4" y="4" width="16" height="16" rx="1" />
      <line x1="9" y1="20" x2="20" y2="9" />
      <line x1="14" y1="20" x2="20" y2="14" />
    </>
  ),
  grid: (
    <>
      <line x1="9" y1="3" x2="9" y2="21" />
      <line x1="15" y1="3" x2="15" y2="21" />
      <line x1="3" y1="9" x2="21" y2="9" />
      <line x1="3" y1="15" x2="21" y2="15" />
    </>
  ),
  column: (
    <>
      <rect x="8" y="3" width="8" height="18" rx="1" />
    </>
  ),
  beam: (
    <>
      <rect x="3" y="9" width="18" height="6" rx="1" />
    </>
  ),
  stair: (
    <path d="M4 20 V16 H8 V12 H12 V8 H16 V4 H20" />
  ),
  railing: (
    <>
      <line x1="3" y1="6" x2="21" y2="6" />
      <line x1="6" y1="6" x2="6" y2="20" />
      <line x1="12" y1="6" x2="12" y2="20" />
      <line x1="18" y1="6" x2="18" y2="20" />
    </>
  ),
  roof: (
    <path d="M3 18 L12 5 L21 18" />
  ),
  dimension: (
    <>
      <line x1="3" y1="12" x2="21" y2="12" />
      <line x1="3" y1="8" x2="3" y2="16" />
      <line x1="21" y1="8" x2="21" y2="16" />
    </>
  ),
  hatch: (
    <>
      <rect x="4" y="4" width="16" height="16" rx="1" />
      <line x1="4" y1="12" x2="12" y2="4" />
      <line x1="8" y1="20" x2="20" y2="8" />
      <line x1="16" y1="20" x2="20" y2="16" />
    </>
  ),
};

export function Icon({
  name,
  size = 18,
  stroke = 2,
}: {
  name: string;
  size?: number;
  stroke?: number;
}): JSX.Element {
  const Lu = LUCIDE[name];
  if (Lu) return <Lu size={size} strokeWidth={stroke} absoluteStrokeWidth />;
  const glyph = GLYPHS[name];
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={stroke}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {glyph ?? <rect x="4" y="4" width="16" height="16" rx="2" />}
    </svg>
  );
}
