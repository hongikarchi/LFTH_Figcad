import { useRef, useState } from 'react';
import { formatSection, quantize, type DocStore, type ElemType, type Pt, type Section } from '@figcad/core';
import { NumField, TextField } from './fields';

type PolygonSection = Extract<Section, { shape: 'polygon' }>;

/**
 * polygon 단면 편집기 — 소형 SVG 프리뷰 + 점 드래그, pointerup에 updateType(단면 통째 교체 —
 * 부분머지 없음). React 패널 컴포넌트(규칙 3 허용 — 렌더 루프 아님). 문서 y=북쪽 ↔ SVG y=아래 → 표시 y 반전.
 */
function PolygonSectionEditor({
  section,
  onCommit,
}: {
  section: PolygonSection;
  onCommit: (points: Pt[]) => void;
}) {
  const [draft, setDraft] = useState<Pt[] | null>(null); // null = 저장값 표시
  const svgRef = useRef<SVGSVGElement | null>(null);
  const dragIdx = useRef<number>(-1);
  const frozenVb = useRef<{ x: number; y: number; w: number; h: number } | null>(null); // 드래그 중 고정 viewBox
  const pts = draft ?? section.points;

  // viewBox — 점 bbox + 15% 패딩 (y 반전 좌표계).
  // 드래그 중에는 pointerdown 시점 값으로 고정 — 매 렌더 재계산하면 bbox 극점 드래그 시
  // viewBox가 커서 아래에서 리스케일 → toDoc 역변환과 양성 피드백(좌표 폭주).
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const pad = Math.max(maxX - minX, maxY - minY, 100) * 0.15;
  const vbLive = { x: minX - pad, y: -maxY - pad, w: maxX - minX + 2 * pad, h: maxY - minY + 2 * pad };
  const vb = frozenVb.current ?? vbLive;

  /** 클라이언트 px → 문서 mm (viewBox 선형 역변환, y 반전 복원) */
  const toDoc = (e: { clientX: number; clientY: number }): Pt => {
    const rect = svgRef.current!.getBoundingClientRect();
    const x = vb.x + ((e.clientX - rect.left) / rect.width) * vb.w;
    const ySvg = vb.y + ((e.clientY - rect.top) / rect.height) * vb.h;
    return [quantize(x), quantize(-ySvg)];
  };

  /** 드래그 종료 — commit=true(pointerup)만 커밋 시도, cancel/lostcapture는 드래프트 폐기 */
  const endDrag = (commit: boolean) => {
    if (dragIdx.current < 0) return;
    dragIdx.current = -1;
    frozenVb.current = null;
    if (commit && draft) {
      const q = draft.map(([x, y]) => [quantize(x), quantize(y)] as Pt);
      // 퇴화 방어 — 고유점 3개 미만 또는 shoelace 면적 ~0(mm 정수라 |area2|<1 = 정확히 0)이면
      // 서버도 거부 → throw 왕복 없이 저장값으로 복귀
      const distinct = new Set(q.map(([x, y]) => `${x},${y}`)).size;
      let area2 = 0;
      for (let i = 0; i < q.length; i++) {
        const [ax, ay] = q[i]!;
        const [bx, by] = q[(i + 1) % q.length]!;
        area2 += ax * by - bx * ay;
      }
      if (distinct >= 3 && Math.abs(area2) >= 1) {
        try {
          onCommit(q);
        } catch {
          // store 검증 거부(자가교차 등) — 드래프트 폐기, 저장값으로 복귀
        }
      }
    }
    setDraft(null);
  };

  const handleR = Math.max(vb.w, vb.h) * 0.035;
  return (
    <span className="infobox-field" style={{ display: 'block' }}>
      <label>단면 ({pts.length}점 — 점 드래그로 수정)</label>
      <svg
        ref={svgRef}
        viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`}
        style={{ width: '100%', height: 120, touchAction: 'none' }}
        onPointerMove={(e) => {
          if (dragIdx.current < 0) return;
          const p = toDoc(e);
          setDraft((prev) => (prev ?? section.points).map((q, i) => (i === dragIdx.current ? p : q)) as Pt[]);
        }}
        onPointerUp={() => endDrag(true)}
        onPointerCancel={() => endDrag(false)}
        onLostPointerCapture={() => endDrag(false)}
      >
        <polygon
          points={pts.map(([x, y]) => `${x},${-y}`).join(' ')}
          fill="rgba(120,140,160,0.25)"
          stroke="#667"
          strokeWidth={Math.max(vb.w, vb.h) * 0.01}
        />
        {pts.map(([x, y], i) => (
          <circle
            key={i}
            cx={x}
            cy={-y}
            r={handleR}
            fill="#4a7"
            stroke="#fff"
            strokeWidth={handleR * 0.3}
            style={{ cursor: 'grab' }}
            onPointerDown={(e) => {
              dragIdx.current = i;
              frozenVb.current = vb; // 드래그 동안 viewBox·toDoc 역변환 고정
              (e.currentTarget.ownerSVGElement ?? e.currentTarget).setPointerCapture?.(e.pointerId);
              e.preventDefault();
            }}
          />
        ))}
      </svg>
    </span>
  );
}

/** 타입 라벨 메타 (목록 우측 요약) — kind별 핵심 치수. 단면은 코어 formatSection 단일 소스(polygon 포함). */
export function typeMeta(t: ElemType): string {
  if (t.kind === 'stair') return `${t.width}w·${t.riser}r`;
  if (t.kind === 'railing') return `h${t.height}`;
  if (t.kind === 'curtainwall') return formatSection(t.mullionSection);
  if ('thickness' in t) return `${t.thickness}`;
  if ('section' in t) return formatSection(t.section);
  return `${t.opening.width}×${t.opening.height}`;
}

/** 타입 인라인 에디터 — kind별 필드 (이름/두께/색/단면/계단·난간 치수) */
export function TypeEditor({ store, type }: { store: DocStore; type: ElemType }) {
  const inUse = store.listElements().some((e) => 'typeId' in e && e.typeId === type.id);
  /** 단면 커밋 — validateSection throw(hsection 웹≥폭 등) 흡수. catch 시 커밋 안 함 = NumField가 저장값으로 복귀 */
  const commitSection = (section: Record<string, unknown>) => {
    try {
      store.updateType(type.id, { section });
    } catch {
      // store 검증 거부 — 조용히 되돌림
    }
  };
  return (
    <div className="nav-editor">
      <TextField label="이름" value={type.name} maxLength={20} onCommit={(v) => store.updateType(type.id, { name: v })} />
      {'thickness' in type && (
        <NumField label="두께(mm)" value={type.thickness} min={10} onCommit={(v) => store.updateType(type.id, { thickness: v })} />
      )}
      {type.kind === 'opening' && (
        <>
          <NumField label="폭(mm)" value={type.opening.width} min={100} onCommit={(v) => store.updateType(type.id, { opening: { width: v } })} />
          <NumField label="높이(mm)" value={type.opening.height} min={100} onCommit={(v) => store.updateType(type.id, { opening: { height: v } })} />
          <NumField label="창대(mm)" value={type.opening.sillHeight} min={0} onCommit={(v) => store.updateType(type.id, { opening: { sillHeight: v } })} />
        </>
      )}
      {'section' in type && type.section.shape === 'rect' && (
        <>
          <NumField label="폭(mm)" value={type.section.width} min={50} onCommit={(v) => store.updateType(type.id, { section: { shape: 'rect', width: v, depth: (type.section as { depth: number }).depth } })} />
          <NumField label="춤(mm)" value={type.section.depth} min={50} onCommit={(v) => store.updateType(type.id, { section: { shape: 'rect', width: (type.section as { width: number }).width, depth: v } })} />
        </>
      )}
      {'section' in type && type.section.shape === 'circle' && (
        <NumField label="지름(mm)" value={type.section.diameter} min={50} onCommit={(v) => store.updateType(type.id, { section: { shape: 'circle', diameter: v } })} />
      )}
      {'section' in type && type.section.shape === 'hsection' && (
        <>
          <NumField label="폭(mm)" value={type.section.width} min={50} onCommit={(v) => commitSection({ ...(type.section as Record<string, unknown>), width: v })} />
          <NumField label="춤(mm)" value={type.section.depth} min={50} onCommit={(v) => commitSection({ ...(type.section as Record<string, unknown>), depth: v })} />
          <NumField label="웹(mm)" value={type.section.web} min={1} onCommit={(v) => commitSection({ ...(type.section as Record<string, unknown>), web: v })} />
          <NumField label="플랜지(mm)" value={type.section.flange} min={1} onCommit={(v) => commitSection({ ...(type.section as Record<string, unknown>), flange: v })} />
        </>
      )}
      {'section' in type && type.section.shape === 'polygon' && (
        <PolygonSectionEditor
          key={JSON.stringify(type.section.points)} // 외부(협업) 변경 시 리마운트 = 드래프트 리셋
          section={type.section}
          onCommit={(points) => store.updateType(type.id, { section: { shape: 'polygon', points } })}
        />
      )}
      {type.kind === 'stair' && (
        <>
          <NumField label="폭(mm)" value={type.width} min={400} onCommit={(v) => store.updateType(type.id, { width: v })} />
          <NumField label="단높이(mm)" value={type.riser} min={50} onCommit={(v) => store.updateType(type.id, { riser: v })} />
        </>
      )}
      {type.kind === 'railing' && (
        <>
          <NumField label="높이(mm)" value={type.height} min={300} onCommit={(v) => store.updateType(type.id, { height: v })} />
          <NumField label="포스트 간격(mm)" value={type.postSpacing} min={100} onCommit={(v) => store.updateType(type.id, { postSpacing: v })} />
        </>
      )}
      <span className="infobox-field">
        <label>색</label>
        <input
          type="color"
          value={type.color}
          onChange={(e) => store.updateType(type.id, { color: e.target.value })}
        />
      </span>
      <button
        className="nav-delete"
        disabled={inUse}
        title={inUse ? '이 타입을 쓰는 요소가 있어 삭제 불가' : undefined}
        onClick={() => store.deleteType(type.id)}
      >
        {inUse ? '사용 중 — 삭제 불가' : '타입 삭제'}
      </button>
    </div>
  );
}
