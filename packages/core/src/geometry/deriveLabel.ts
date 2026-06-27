import { buildFaces, type Profile } from './meshBuilder';
import type { DerivedGeometry } from './deriveWall';
import { polygonArea } from './deriveZone';
import type { DocStore } from '../store';
import type { Element, LabelElement, Level, Pt } from '../schema';

const MM = 0.001;
const Y_LIFT = 0.02; // 지면 살짝 위 (평면 주석 — 텍스트와 동일)
const SIZE = 200; // 글자 크기 mm (픽 프록시 박스 추정용)

export interface LabelDeriveInput {
  label: LabelElement;
  level: Level;
  /** DeriveCache가 타깃을 해석해 채운 표시 텍스트 (template별) */
  text: string;
  /** 타깃 중심 (leader 끝점). 고아·custom이면 null */
  targetCenter: Pt | null;
}

const KIND_KO: Record<string, string> = {
  wall: '벽',
  opening: '개구부',
  slab: '슬라브',
  grid: '그리드',
  column: '기둥',
  beam: '보',
  stair: '계단',
  railing: '난간',
  roof: '지붕',
  curtainwall: '커튼월',
  zone: '존',
  text: '텍스트',
  label: '레이블',
  dimension: '치수',
};

/** 'name' 템플릿 표시명 — 이름 있으면 이름, 타입 있으면 타입명, 아니면 종류명 */
function elementName(el: Element, store: DocStore): string {
  if (el.kind === 'zone') return el.number ? `${el.number} ${el.name}` : el.name;
  if (el.kind === 'text') return el.text;
  if (el.kind === 'grid') return el.label;
  if ('typeId' in el) {
    const t = store.getType(el.typeId);
    if (t) return t.name;
  }
  return KIND_KO[el.kind] ?? el.kind;
}

/**
 * 라벨 표시 텍스트 — template + 해석된 타깃. derive(3D)·deriveDrawing(평면) 공유(텍스트 표류 방지).
 * 고아(타깃 삭제)·부적합 타깃 = customText 또는 '—' fallback (연쇄삭제 안 함).
 */
export function labelText(label: LabelElement, target: Element | null, store: DocStore): string {
  if (label.template === 'custom') return label.customText ?? '';
  if (!target) return label.customText ?? '—';
  if (label.template === 'area') {
    if (target.kind === 'zone' || target.kind === 'slab' || target.kind === 'roof') {
      return `${(polygonArea(target.boundary) / 1e6).toFixed(1)}㎡`;
    }
    return label.customText ?? '—';
  }
  return elementName(target, store);
}

/**
 * 라벨 — 평면 점에 텍스트(labels 채널) + 픽킹용 리본(스프라이트는 레이캐스트 안 됨) +
 * leader 지시선(at→타깃 중심, edges). 텍스트·중심은 DeriveCache가 해석해 넘김(순수성).
 */
export function deriveLabel(input: LabelDeriveInput): DerivedGeometry {
  const { label, level, text, targetCenter } = input;
  const [ax, ay] = label.at;
  const y = level.elevation * MM + Y_LIFT;
  const hw = (Math.max(text.length, 1) * SIZE * 0.6) / 2;
  const hh = (SIZE * 1.4) / 2;

  // 픽 프록시 쿼드 (텍스트 박스 대략) — 텍스트와 동일, SceneManager가 투명 처리
  const ribbon: Profile = {
    outer: [
      [ax - hw, -(ay - hh)],
      [ax + hw, -(ay - hh)],
      [ax + hw, -(ay + hh)],
      [ax - hw, -(ay + hh)],
    ],
    holes: [],
  };
  const mesh = buildFaces([{ profile: ribbon, map: (u, v) => [u * MM, y, -v * MM] }]);
  const pos: [number, number, number] = [ax * MM, y, ay * MM];
  const edges: number[] = [];
  // 지시선 끝점 = 타깃 중심(추종) 우선, 없으면 leaderAt(고정 점, 2클릭 free 노트)
  const leaderEnd = targetCenter ?? label.leaderAt ?? null;
  if (label.leader && leaderEnd) {
    edges.push(ax * MM, y, ay * MM, leaderEnd[0] * MM, y, leaderEnd[1] * MM);
  }
  return {
    positions: mesh.positions,
    normals: mesh.normals,
    edges: new Float32Array(edges),
    anchors: { a: pos, b: pos },
    labels: [{ text, pos, style: 'text' }],
  };
}

export function labelDeriveKey(input: LabelDeriveInput): string {
  // 해석된 text·targetCenter가 키에 들어가므로 타깃 이동/이름변경/면적변경 시 자동 재파생
  return JSON.stringify([
    input.label.at,
    input.text,
    input.label.leader ?? false,
    input.targetCenter,
    input.label.leaderAt ?? null,
    input.level.elevation,
  ]);
}
