import * as WebIFC from 'web-ifc';
import { DocStore, type DocSnapshot, type Id, type Section } from '@figcad/core';

/**
 * IFC4 → Figcad 문서 (web-ifc reader).
 *
 * 파라미터 복원 (export의 역):
 *   IfcBuildingStorey       → 레벨
 *   IfcWallStandardCase     → 벽 (placement 원점/방향 + Body 프로필 XDim/YDim/Depth)
 *   IfcSlab                 → 슬라브 (ArbitraryClosedProfile 경계 + Depth)
 *   IfcColumn               → 기둥 (placement at + 압출 프로필→단면 + Depth→높이)
 *   IfcBeam                 → 보 (placement a + 솔리드 축 방향·길이로 b 복원 + 프로필→단면)
 *   IfcDoor/IfcWindow + Void/Fills → 개구부 (호스트 벽 + offset/sill)
 *
 * Figcad 모델(swept solid 파라메트릭)로 만든 IFC는 정확 복원되고, 외부 IFC도
 * 표준 IfcWallStandardCase/IfcSlab/IfcColumn/IfcBeam면 best-effort 복원된다(자유형 B-rep 스킵).
 * 타입은 두께/단면/개구부 치수별로 생성·dedup. ifcApi는 호출자가 Init() 주입.
 *
 * 의도적 미지원(스킵+카운트 — 기하 베이크라 깨끗한 파라 역변환 불가, brep 시맨틱 리프팅=v1.5):
 *   계단(IfcStair)·난간(IfcRailing)·지붕(IfcSlab ROOF, 슬로프 손실). 존/커튼월은 export 자체가 후속.
 */

// 플래튼된 GetLine 값 헬퍼
const num = (v: unknown): number => {
  if (typeof v === 'number') return v;
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    if (typeof o['_representationValue'] === 'number') return o['_representationValue'];
    if (typeof o['value'] === 'number') return o['value'];
  }
  return 0;
};
const sval = (v: unknown): string => {
  if (v && typeof v === 'object' && 'value' in v) return String((v as { value: unknown }).value ?? '');
  return v == null ? '' : String(v);
};
const coordsOf = (cp: unknown): number[] =>
  (((cp as { Coordinates?: unknown[] })?.Coordinates ?? []) as unknown[]).map(num);

interface AnyLine {
  expressID: number;
  [k: string]: unknown;
}

export interface IfcImportResult {
  snapshot: DocSnapshot;
  /** 무시한 요소 종류별 카운트 (자유형 등 미지원) */
  skipped: Record<string, number>;
}

export function importIfc(ifcApi: WebIFC.IfcAPI, bytes: Uint8Array): IfcImportResult {
  const m = ifcApi.OpenModel(bytes);
  const skipped: Record<string, number> = {};
  const bump = (k: string) => (skipped[k] = (skipped[k] ?? 0) + 1);

  const ids = (type: number): number[] => {
    const v = ifcApi.GetLineIDsWithType(m, type);
    const out: number[] = [];
    for (let i = 0; i < v.size(); i++) out.push(v.get(i));
    return out;
  };
  const line = (id: number): AnyLine => ifcApi.GetLine(m, id, true) as AnyLine;

  const store = new DocStore();
  const projIds = ids(WebIFC.IFCPROJECT);
  const proj = projIds.length ? (line(projIds[0]!) as AnyLine) : undefined;
  const projectName = (proj ? sval(proj['Name']) : '') || '가져온 프로젝트';

  // --- 레벨 (storey) ---
  const storeyExpressToLevel = new Map<number, Id>();
  const storeys = ids(WebIFC.IFCBUILDINGSTOREY)
    .map((id) => line(id))
    .map((s) => ({ id: s.expressID, name: sval(s['Name']) || '층', elevation: Math.round(num(s['Elevation'])) }))
    .sort((a, b) => a.elevation - b.elevation);
  storeys.forEach((s, i) => {
    const next = storeys[i + 1];
    const height = next ? next.elevation - s.elevation : 3000; // 다음 층까지 = 층고, 최상층 기본 3000
    const levelId = store.addLevel({ name: s.name, elevation: s.elevation, height: height > 0 ? height : 3000, order: i });
    storeyExpressToLevel.set(s.id, levelId);
  });
  // storey가 하나도 없으면 기본 레벨
  let fallbackLevel: Id | null = null;
  const levelFor = (storeyExpress: number | undefined): Id => {
    if (storeyExpress !== undefined && storeyExpressToLevel.has(storeyExpress))
      return storeyExpressToLevel.get(storeyExpress)!;
    if (!fallbackLevel) fallbackLevel = store.addLevel({ name: '1층', elevation: 0, height: 3000, order: storeyExpressToLevel.size });
    return fallbackLevel;
  };

  // --- 요소 → 포함 storey 매핑 ---
  const elementStorey = new Map<number, number>();
  for (const relId of ids(WebIFC.IFCRELCONTAINEDINSPATIALSTRUCTURE)) {
    const rel = line(relId);
    const storeyId = (rel['RelatingStructure'] as AnyLine)?.expressID;
    for (const el of (rel['RelatedElements'] as AnyLine[]) ?? []) {
      if (el?.expressID && storeyId) elementStorey.set(el.expressID, storeyId);
    }
  }

  // --- 타입 dedup ---
  const wallTypeByThickness = new Map<number, Id>();
  const wallType = (thickness: number): Id => {
    const hit = wallTypeByThickness.get(thickness);
    if (hit) return hit;
    const id = store.addType({ kind: 'wall', name: `벽 ${thickness}`, thickness, color: '#eceae5' });
    wallTypeByThickness.set(thickness, id);
    return id;
  };
  const slabTypeByThickness = new Map<number, Id>();
  const slabType = (thickness: number): Id => {
    const hit = slabTypeByThickness.get(thickness);
    if (hit) return hit;
    const id = store.addType({ kind: 'slab', name: `슬라브 ${thickness}`, thickness, color: '#dcdad5' });
    slabTypeByThickness.set(thickness, id);
    return id;
  };
  const openingTypeByKey = new Map<string, Id>();
  const openingType = (kind: 'door' | 'window', width: number, height: number, sill: number): Id => {
    const key = `${kind}|${width}|${height}|${sill}`;
    const hit = openingTypeByKey.get(key);
    if (hit) return hit;
    const id = store.addType({
      kind: 'opening',
      name: kind === 'door' ? `문 ${width}×${height}` : `창 ${width}×${height}`,
      color: kind === 'door' ? '#b08d57' : '#9cc3d5',
      opening: { kind, width, height, sillHeight: sill },
    });
    openingTypeByKey.set(key, id);
    return id;
  };

  /** Body(SweptSolid) 표현에서 ExtrudedAreaSolid 추출 */
  const bodySolid = (el: AnyLine): AnyLine | null => {
    const reps = ((el['Representation'] as AnyLine)?.['Representations'] as AnyLine[]) ?? [];
    const body =
      reps.find((r) => sval(r['RepresentationIdentifier']) === 'Body') ?? reps.find((r) => (r['Items'] as unknown[])?.length);
    const item = (body?.['Items'] as AnyLine[])?.[0];
    return item ?? null;
  };

  // --- 단면 복원 (기둥/보 압출 프로필 → Section) ---
  // 기둥 프로필: XDim=width, YDim=depth. 보 프로필: XDim=depth, YDim=width (export와 대칭).
  const sectionFromProfile = (profile: AnyLine | undefined, beamSwap: boolean): Section | null => {
    if (!profile) return null;
    const radius = num(profile['Radius']);
    if (radius > 0) return { shape: 'circle', diameter: Math.round(radius * 2) };
    const xd = Math.round(num(profile['XDim']));
    const yd = Math.round(num(profile['YDim']));
    if (xd <= 0 || yd <= 0) return null;
    return beamSwap ? { shape: 'rect', width: yd, depth: xd } : { shape: 'rect', width: xd, depth: yd };
  };
  const sectionKey = (s: Section): string =>
    s.shape === 'circle' ? `c${s.diameter}` : `r${s.width}x${s.depth}`;
  const sectionLabel = (s: Section): string =>
    s.shape === 'circle' ? `D${s.diameter}` : `${s.width}×${s.depth}`;

  // --- 벽 (IfcWallStandardCase + 외부 도구의 평범한 IfcWall 둘 다) ---
  const wallExpressToId = new Map<number, Id>();
  const wallIds = new Set<number>([...ids(WebIFC.IFCWALLSTANDARDCASE), ...ids(WebIFC.IFCWALL)]);
  for (const wid of wallIds) {
    const wl = line(wid);
    const place = (wl['ObjectPlacement'] as AnyLine)?.['RelativePlacement'] as AnyLine | undefined;
    const loc = coordsOf(place?.['Location']);
    const ax = Math.round(loc[0] ?? 0);
    const ay = Math.round(loc[1] ?? 0);
    const baseOffset = Math.round(loc[2] ?? 0);
    const ratios = ((place?.['RefDirection'] as AnyLine)?.['DirectionRatios'] as number[] | undefined)?.map(num) ?? [1, 0];
    let dx = ratios[0] ?? 1;
    let dy = ratios[1] ?? 0;
    const dlen = Math.hypot(dx, dy) || 1;
    dx /= dlen;
    dy /= dlen;
    const solid = bodySolid(wl);
    const profile = solid?.['SweptArea'] as AnyLine | undefined;
    const len = Math.round(num(profile?.['XDim']));
    const thickness = Math.round(num(profile?.['YDim'])) || 200;
    const height = Math.round(num(solid?.['Depth'])) || 3000;
    if (len <= 0) {
      // 사각 프로필 압출이 아닌 벽(자유형/외부 표현) — 복원 불가, 손실 보고
      bump('wall(미지원 표현)');
      continue;
    }
    const levelId = levelFor(elementStorey.get(wid));
    const level = store.getLevel(levelId)!;
    const a: [number, number] = [ax, ay];
    const b: [number, number] = [Math.round(ax + dx * len), Math.round(ay + dy * len)];
    const wallId = store.createWall({
      levelId,
      typeId: wallType(thickness),
      a,
      b,
      ...(height !== level.height ? { height } : {}),
      ...(baseOffset !== 0 ? { baseOffset } : {}),
    });
    wallExpressToId.set(wid, wallId);
  }

  // --- 슬라브 ---
  for (const sid of ids(WebIFC.IFCSLAB)) {
    const sl = line(sid);
    // 지붕(PredefinedType=ROOF)은 IfcSlab로 export되지만 v1 import 미지원 — 스킵+카운트.
    // (안 그러면 roof→slab으로 kind가 바뀌고 표고도 추락. .3dm/DXF importer의 Roof skip과 대칭)
    if (sval(sl['PredefinedType']) === 'ROOF') {
      bump('지붕(v1 가져오기 미지원 — IFC 경유)');
      continue;
    }
    const solid = bodySolid(sl);
    const profile = solid?.['SweptArea'] as AnyLine | undefined;
    const curve = profile?.['OuterCurve'] as AnyLine | undefined;
    const pts = ((curve?.['Points'] as AnyLine[]) ?? []).map((p) => {
      const c = coordsOf(p);
      return [Math.round(c[0] ?? 0), Math.round(c[1] ?? 0)] as [number, number];
    });
    // 닫힘점 중복 제거
    if (pts.length > 1) {
      const f = pts[0]!;
      const l = pts[pts.length - 1]!;
      if (f[0] === l[0] && f[1] === l[1]) pts.pop();
    }
    if (pts.length < 3) {
      bump('slab(bad-profile)');
      continue;
    }
    const thickness = Math.round(num(solid?.['Depth'])) || 150;
    const levelId = levelFor(elementStorey.get(sid));
    try {
      store.createSlab({ levelId, typeId: slabType(thickness), boundary: pts });
    } catch {
      bump('slab(invalid-polygon)');
    }
  }

  // --- 기둥 (IfcColumn) — placement at + 압출 단면/높이 복원 ---
  const columnTypeBySection = new Map<string, Id>();
  const columnTypeFor = (section: Section): Id => {
    const key = sectionKey(section);
    const hit = columnTypeBySection.get(key);
    if (hit) return hit;
    const id = store.addType({ kind: 'column', name: `기둥 ${sectionLabel(section)}`, section, color: '#9a9aa6' });
    columnTypeBySection.set(key, id);
    return id;
  };
  for (const cid of ids(WebIFC.IFCCOLUMN)) {
    const cl = line(cid);
    const place = (cl['ObjectPlacement'] as AnyLine)?.['RelativePlacement'] as AnyLine | undefined;
    const loc = coordsOf(place?.['Location']);
    const at: [number, number] = [Math.round(loc[0] ?? 0), Math.round(loc[1] ?? 0)];
    const baseOffset = Math.round(loc[2] ?? 0);
    const solid = bodySolid(cl);
    const section = sectionFromProfile(solid?.['SweptArea'] as AnyLine | undefined, false);
    const height = Math.round(num(solid?.['Depth']));
    if (!section || height <= 0) {
      bump('column(미지원 표현)');
      continue;
    }
    const levelId = levelFor(elementStorey.get(cid));
    const level = store.getLevel(levelId)!;
    store.createColumn({
      levelId,
      typeId: columnTypeFor(section),
      at,
      ...(height !== level.height ? { height } : {}),
      ...(baseOffset !== 0 ? { baseOffset } : {}),
    });
  }

  // --- 보 (IfcBeam) — placement a + 솔리드 축 방향(Position.Axis)·길이(Depth)로 b 복원 ---
  const beamTypeBySection = new Map<string, Id>();
  const beamTypeFor = (section: Section): Id => {
    const key = sectionKey(section);
    const hit = beamTypeBySection.get(key);
    if (hit) return hit;
    const id = store.addType({ kind: 'beam', name: `보 ${sectionLabel(section)}`, section, color: '#9a9070' });
    beamTypeBySection.set(key, id);
    return id;
  };
  for (const bid of ids(WebIFC.IFCBEAM)) {
    const bl = line(bid);
    const place = (bl['ObjectPlacement'] as AnyLine)?.['RelativePlacement'] as AnyLine | undefined;
    const loc = coordsOf(place?.['Location']);
    const a: [number, number] = [Math.round(loc[0] ?? 0), Math.round(loc[1] ?? 0)];
    // 보는 export가 zOffset 미지정 시 기본 z(level.height-춤/2)를 항상 기록 →
    // import는 그 값을 명시 zOffset으로 복원(지오 동일, 파라만 explicit화). 의도된 정규화.
    const zOffset = Math.round(loc[2] ?? 0);
    const solid = bodySolid(bl);
    const section = sectionFromProfile(solid?.['SweptArea'] as AnyLine | undefined, true);
    const len = num(solid?.['Depth']);
    const axis = ((solid?.['Position'] as AnyLine)?.['Axis'] as AnyLine)?.['DirectionRatios'] as
      | number[]
      | undefined;
    const ux = num(axis?.[0] ?? 1);
    const uy = num(axis?.[1] ?? 0);
    const dlen = Math.hypot(ux, uy) || 1;
    if (!section || len <= 0) {
      bump('beam(미지원 표현)');
      continue;
    }
    const b: [number, number] = [
      Math.round(a[0] + (ux / dlen) * len),
      Math.round(a[1] + (uy / dlen) * len),
    ];
    const levelId = levelFor(elementStorey.get(bid));
    try {
      store.createBeam({ levelId, typeId: beamTypeFor(section), a, b, zOffset });
    } catch {
      bump('beam(zero-length)');
    }
  }

  // --- 개구부 (Voids + Fills 조인) ---
  const openingToWall = new Map<number, number>(); // openingElement express → wall express
  for (const rid of ids(WebIFC.IFCRELVOIDSELEMENT)) {
    const rel = line(rid);
    const wallE = (rel['RelatingBuildingElement'] as AnyLine)?.expressID;
    const opE = (rel['RelatedOpeningElement'] as AnyLine)?.expressID;
    if (wallE && opE) openingToWall.set(opE, wallE);
  }
  for (const rid of ids(WebIFC.IFCRELFILLSELEMENT)) {
    const rel = line(rid);
    const opE = (rel['RelatingOpeningElement'] as AnyLine)?.expressID;
    const fillE = (rel['RelatedBuildingElement'] as AnyLine)?.expressID;
    if (!opE || !fillE) continue;
    const wallE = openingToWall.get(opE);
    const hostId = wallE !== undefined ? wallExpressToId.get(wallE) : undefined;
    if (!hostId) {
      bump('opening(no-host)');
      continue;
    }
    const fill = line(fillE);
    const isDoor = fill.type === WebIFC.IFCDOOR;
    const width = Math.round(num(fill['OverallWidth'])) || 900;
    const oheight = Math.round(num(fill['OverallHeight'])) || 2100;
    const place = (fill['ObjectPlacement'] as AnyLine)?.['RelativePlacement'] as AnyLine | undefined;
    const loc = coordsOf(place?.['Location']);
    const offset = Math.round(loc[0] ?? 0);
    const sill = Math.round(loc[2] ?? 0);
    try {
      store.createOpening({
        hostId,
        typeId: openingType(isDoor ? 'door' : 'window', width, oheight, sill),
        offset,
      });
    } catch {
      bump('opening(invalid)');
    }
  }

  ifcApi.CloseModel(m);
  const snapshot = store.snapshot();
  snapshot.meta = { ...snapshot.meta, projectName };
  return { snapshot, skipped };
}
