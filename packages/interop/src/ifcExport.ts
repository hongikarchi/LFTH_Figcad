import * as WebIFC from 'web-ifc';
import type {
  BeamElement,
  BeamType,
  ColumnElement,
  ColumnType,
  DocSnapshot,
  OpeningElement,
  OpeningType,
  SlabElement,
  WallElement,
  WallType,
} from '@figcad/core';
import { resolveOpening } from '@figcad/core';
import { ifcGuidFromId } from './ifcGuid';

/**
 * Figcad 문서 → IFC4 (web-ifc writer).
 *
 * 파라미터 보존 매핑 (리서치 결론 — IFC만이 유일한 무손실 경로):
 *   레벨   → IfcBuildingStorey (Elevation)
 *   벽     → IfcWallStandardCase (Axis 중심선 + Body 압출 + MaterialLayerSetUsage 두께)
 *   슬라브 → IfcSlab (ArbitraryClosedProfile 경계 압출)
 *   문/창  → IfcDoor/IfcWindow + IfcOpeningElement(void) + RelVoids/RelFills
 *
 * 단위: SI METRE + MILLI 접두 → 좌표를 문서 그대로(mm 정수) 기록 (float 드리프트 0).
 * 좌표계: 문서 [x,y]평면 + elevation → IFC Z-up (x,y,elevation).
 * ifcApi는 호출자가 Init() 완료해 주입 (WASM 로딩은 node/browser가 다르므로 분리).
 */
export function exportIfc(ifcApi: WebIFC.IfcAPI, snap: DocSnapshot): Uint8Array {
  const I = WebIFC.IFC4;
  const modelID = ifcApi.CreateModel({ schema: WebIFC.Schemas.IFC4, name: snap.meta.projectName });

  // WriteLine은 expressID를 부여(인플레이스) — 기록 후 Handle로 참조
  const w = <T extends WebIFC.IfcLineObject>(o: T): WebIFC.Handle<T> => {
    ifcApi.WriteLine(modelID, o);
    return new WebIFC.Handle<T>(o.expressID);
  };

  const label = (s: string) => new I.IfcLabel(s);
  const guid = (seed: string) => new I.IfcGloballyUniqueId(ifcGuidFromId(seed));
  // web-ifc는 measure 필드에 원시 number를 그대로 받는다 (라운드트립 검증됨) — 타입만 캐스트
  const pt3 = (x: number, y: number, z: number) =>
    w(new I.IfcCartesianPoint([x, y, z] as never) as unknown as WebIFC.IfcLineObject);
  const pt2 = (x: number, y: number) =>
    w(new I.IfcCartesianPoint([x, y] as never) as unknown as WebIFC.IfcLineObject);
  const dir3 = (x: number, y: number, z: number) =>
    w(new I.IfcDirection([x, y, z] as never) as unknown as WebIFC.IfcLineObject);
  const place3 = (loc: unknown, refDir?: unknown) =>
    w(new I.IfcAxis2Placement3D(loc as never, null, (refDir ?? null) as never));
  const local = (relTo: unknown, rel: unknown) =>
    w(new I.IfcLocalPlacement(relTo as never, rel as never));

  // --- 단위 + 표현 컨텍스트 ---
  const lenUnit = w(new I.IfcSIUnit(I.IfcUnitEnum.LENGTHUNIT, I.IfcSIPrefix.MILLI, I.IfcSIUnitName.METRE));
  const units = w(new I.IfcUnitAssignment([lenUnit as never]));
  const worldCS = place3(pt3(0, 0, 0));
  const ctx = w(
    new I.IfcGeometricRepresentationContext(
      null,
      label('Model'),
      3 as never,
      1e-5 as never,
      worldCS as never,
      null,
    ),
  );

  // --- 공간 위계: Project → Site → Building → Storey(레벨별) ---
  const project = w(
    new I.IfcProject(guid('project'), null, label(snap.meta.projectName), null, null, null, null, [
      ctx as never,
    ], units as never),
  );
  const sitePlace = local(null, place3(pt3(0, 0, 0)));
  const site = w(
    new I.IfcSite(guid('site'), null, label('Site'), null, null, sitePlace as never, null, null, I.IfcElementCompositionEnum.ELEMENT, null, null, null, null, null),
  );
  const bldgPlace = local(null, place3(pt3(0, 0, 0)));
  const building = w(
    new I.IfcBuilding(guid('building'), null, label('Building'), null, null, bldgPlace as never, null, null, I.IfcElementCompositionEnum.ELEMENT, null, null, null),
  );
  w(new I.IfcRelAggregates(guid('agg-project'), null, null, null, project as never, [site as never]));
  w(new I.IfcRelAggregates(guid('agg-site'), null, null, null, site as never, [building as never]));

  // 벽 타입 두께 캐시 (요소가 typeId 참조)
  const wallTypes = new Map(snap.types.filter((t) => t.kind === 'wall').map((t) => [t.id, t as WallType]));
  const openingTypes = new Map(
    snap.types.filter((t) => t.kind === 'opening').map((t) => [t.id, t as OpeningType]),
  );
  const columnTypes = new Map(
    snap.types.filter((t) => t.kind === 'column').map((t) => [t.id, t as ColumnType]),
  );
  const beamTypes = new Map(
    snap.types.filter((t) => t.kind === 'beam').map((t) => [t.id, t as BeamType]),
  );

  // 타입별 MaterialLayerSetUsage (벽 두께 — Revit/ArchiCAD가 레이어드 벽으로 인식) — 두께별 dedup
  const layerUsageByThickness = new Map<number, WebIFC.Handle<WebIFC.IfcLineObject>>();
  const materialUsage = (thickness: number): WebIFC.Handle<WebIFC.IfcLineObject> => {
    const hit = layerUsageByThickness.get(thickness);
    if (hit) return hit;
    const mat = w(new I.IfcMaterial(label(`벽 ${thickness}`), null, null));
    const layer = w(new I.IfcMaterialLayer(mat as never, thickness as never, null, label(`벽 ${thickness}`), null, null, null));
    const set = w(new I.IfcMaterialLayerSet([layer as never], label(`벽 ${thickness}`), null));
    const usage = w(
      new I.IfcMaterialLayerSetUsage(set as never, I.IfcLayerSetDirectionEnum.AXIS2, I.IfcDirectionSenseEnum.POSITIVE, (-thickness / 2) as never, null),
    ) as unknown as WebIFC.Handle<WebIFC.IfcLineObject>;
    layerUsageByThickness.set(thickness, usage);
    return usage;
  };

  const wallsById = new Map(snap.elements.filter((e): e is WallElement => e.kind === 'wall').map((e) => [e.id, e]));

  // --- 레벨별 요소 기록 ---
  const sortedLevels = [...snap.levels].sort((a, b) => a.order - b.order);
  const storeyHandles: WebIFC.Handle<WebIFC.IfcLineObject>[] = [];

  for (const level of sortedLevels) {
    const storeyPlace = local(bldgPlace, place3(pt3(0, 0, level.elevation)));
    const storey = w(
      new I.IfcBuildingStorey(guid(`storey-${level.id}`), null, label(level.name), null, null, storeyPlace as never, null, null, I.IfcElementCompositionEnum.ELEMENT, level.elevation as never),
    );
    storeyHandles.push(storey as unknown as WebIFC.Handle<WebIFC.IfcLineObject>);
    const contained: WebIFC.Handle<WebIFC.IfcLineObject>[] = [];

    // 벽
    const levelWalls = snap.elements.filter(
      (e): e is WallElement => e.kind === 'wall' && e.levelId === level.id,
    );
    for (const wall of levelWalls) {
      const type = wallTypes.get(wall.typeId);
      const thickness = type?.thickness ?? 200;
      const height = wall.height ?? level.height;
      const dx = wall.b[0] - wall.a[0];
      const dy = wall.b[1] - wall.a[1];
      const len = Math.hypot(dx, dy);
      if (len === 0) continue;
      const ux = dx / len;
      const uy = dy / len;

      // baseOffset → 벽 로컬 원점 Z (storey elevation 기준 위로). Body는 z=0부터 압출.
      const baseOffset = wall.baseOffset ?? 0;
      const objPlace = local(storeyPlace, place3(pt3(wall.a[0], wall.a[1], baseOffset), dir3(ux, uy, 0)));

      // Body: 중심선 따라 len, 두께 thickness, 높이 height 박스
      const profile = w(
        new I.IfcRectangleProfileDef(I.IfcProfileTypeEnum.AREA, null, w(new I.IfcAxis2Placement2D(pt2(len / 2, 0) as never, null)) as never, len as never, thickness as never),
      );
      const solid = w(
        new I.IfcExtrudedAreaSolid(profile as never, place3(pt3(0, 0, 0)) as never, dir3(0, 0, 1) as never, height as never),
      );
      const bodyRep = w(new I.IfcShapeRepresentation(ctx as never, label('Body'), label('SweptSolid'), [solid as never]));
      // Axis: 2D 중심선
      const axisLine = w(new I.IfcPolyline([pt2(0, 0) as never, pt2(len, 0) as never]));
      const axisRep = w(new I.IfcShapeRepresentation(ctx as never, label('Axis'), label('Curve2D'), [axisLine as never]));
      const shape = w(new I.IfcProductDefinitionShape(null, null, [axisRep as never, bodyRep as never]));

      const wallEntity = w(
        new I.IfcWallStandardCase(guid(`wall-${wall.id}`), null, label(`벽 ${wall.id}`), null, null, objPlace as never, shape as never, null, null),
      );
      contained.push(wallEntity as unknown as WebIFC.Handle<WebIFC.IfcLineObject>);
      w(new I.IfcRelAssociatesMaterial(guid(`mat-${wall.id}`), null, null, null, [wallEntity as never], materialUsage(thickness) as never));

      // 이 벽의 개구부
      const hosted = snap.elements.filter(
        (e): e is OpeningElement => e.kind === 'opening' && e.hostId === wall.id,
      );
      for (const op of hosted) {
        const ot = openingTypes.get(op.typeId);
        if (!ot) continue;
        const r = resolveOpening(op, ot, wall, height);
        if (!r) continue; // 물리적으로 못 들어가면 생략
        // void 박스 기하는 클램프된 r 사용(벽 안 유효 관통). 단, import가 되읽는
        // 문/창 placement·치수는 원본값으로 기록 — 라운드트립 비파괴 (offset/override 보존).
        const offset0 = op.offset;
        const width0 = op.widthOverride ?? ot.opening.width;
        const height0 = op.heightOverride ?? ot.opening.height;
        const sill0 = op.sillOverride ?? ot.opening.sillHeight;
        const opProfile = w(
          new I.IfcRectangleProfileDef(I.IfcProfileTypeEnum.AREA, null, w(new I.IfcAxis2Placement2D(pt2(r.offset, 0) as never, null)) as never, r.width as never, (thickness + 20) as never),
        );
        const opSolid = w(
          new I.IfcExtrudedAreaSolid(opProfile as never, place3(pt3(0, 0, r.sill)) as never, dir3(0, 0, 1) as never, r.height as never),
        );
        const opShape = w(
          new I.IfcProductDefinitionShape(null, null, [w(new I.IfcShapeRepresentation(ctx as never, label('Body'), label('SweptSolid'), [opSolid as never])) as never]),
        );
        const opPlace = local(objPlace, place3(pt3(0, 0, 0)));
        const opening = w(
          new I.IfcOpeningElement(guid(`op-${op.id}`), null, label(`개구부 ${op.id}`), null, null, opPlace as never, opShape as never, null, null),
        );
        w(new I.IfcRelVoidsElement(guid(`void-${op.id}`), null, null, null, wallEntity as never, opening as never));

        // 문/창 — 원본 offset/치수/sill (import가 이 값으로 정확히 복원)
        const fillPlace = local(objPlace, place3(pt3(offset0, 0, sill0)));
        const fillEntity =
          ot.opening.kind === 'door'
            ? w(new I.IfcDoor(guid(`door-${op.id}`), null, label(`문 ${op.id}`), null, null, fillPlace as never, null, null, height0 as never, width0 as never, null, null, null))
            : w(new I.IfcWindow(guid(`win-${op.id}`), null, label(`창 ${op.id}`), null, null, fillPlace as never, null, null, height0 as never, width0 as never, null, null, null));
        w(new I.IfcRelFillsElement(guid(`fill-${op.id}`), null, null, null, opening as never, fillEntity as never));
        contained.push(fillEntity as unknown as WebIFC.Handle<WebIFC.IfcLineObject>);
      }
    }

    // 슬라브
    const levelSlabs = snap.elements.filter(
      (e): e is SlabElement => e.kind === 'slab' && e.levelId === level.id,
    );
    for (const slab of levelSlabs) {
      const slabType = snap.types.find((t) => t.id === slab.typeId);
      const thickness = slabType && 'thickness' in slabType ? slabType.thickness : (slab.thicknessOverride ?? 150);
      // ArbitraryClosed의 OuterCurve는 닫힌 곡선이어야 함 (IFC4) — 첫점을 끝에 한 번 더
      const ring = [...slab.boundary, slab.boundary[0]!];
      const poly = w(new I.IfcPolyline(ring.map((p) => pt2(p[0], p[1]) as never)));
      const profile = w(new I.IfcArbitraryClosedProfileDef(I.IfcProfileTypeEnum.AREA, null, poly as never));
      // 상면이 레벨 elevation → 아래로 압출
      const solid = w(
        new I.IfcExtrudedAreaSolid(profile as never, place3(pt3(0, 0, 0)) as never, dir3(0, 0, -1) as never, thickness as never),
      );
      const rep = w(new I.IfcShapeRepresentation(ctx as never, label('Body'), label('SweptSolid'), [solid as never]));
      const shape = w(new I.IfcProductDefinitionShape(null, null, [rep as never]));
      const objPlace = local(storeyPlace, place3(pt3(0, 0, 0)));
      const slabEntity = w(
        new I.IfcSlab(guid(`slab-${slab.id}`), null, label(`슬라브 ${slab.id}`), null, null, objPlace as never, shape as never, null, null),
      );
      contained.push(slabEntity as unknown as WebIFC.Handle<WebIFC.IfcLineObject>);
    }

    // 기둥 — at 위치에 단면 압출 (IfcColumn). v1은 export 전용 (import는 v1.5)
    const levelColumns = snap.elements.filter(
      (e): e is ColumnElement => e.kind === 'column' && e.levelId === level.id,
    );
    for (const col of levelColumns) {
      const ctype = columnTypes.get(col.typeId);
      const section = ctype?.section ?? { shape: 'rect', width: 400, depth: 400 };
      const height = col.height ?? level.height;
      const baseOffset = col.baseOffset ?? 0;
      const objPlace = local(storeyPlace, place3(pt3(col.at[0], col.at[1], baseOffset)));
      const profile =
        section.shape === 'circle'
          ? w(
              new I.IfcCircleProfileDef(
                I.IfcProfileTypeEnum.AREA,
                null,
                w(new I.IfcAxis2Placement2D(pt2(0, 0) as never, null)) as never,
                (section.diameter / 2) as never,
              ),
            )
          : w(
              new I.IfcRectangleProfileDef(
                I.IfcProfileTypeEnum.AREA,
                null,
                w(new I.IfcAxis2Placement2D(pt2(0, 0) as never, null)) as never,
                section.width as never,
                section.depth as never,
              ),
            );
      const solid = w(
        new I.IfcExtrudedAreaSolid(profile as never, place3(pt3(0, 0, 0)) as never, dir3(0, 0, 1) as never, height as never),
      );
      const rep = w(new I.IfcShapeRepresentation(ctx as never, label('Body'), label('SweptSolid'), [solid as never]));
      const shape = w(new I.IfcProductDefinitionShape(null, null, [rep as never]));
      const colEntity = w(
        new I.IfcColumn(guid(`col-${col.id}`), null, label(`기둥 ${col.id}`), null, null, objPlace as never, shape as never, null, null),
      );
      contained.push(colEntity as unknown as WebIFC.Handle<WebIFC.IfcLineObject>);
    }

    // 보 — a→b 중심축 따라 단면 압출 (IfcBeam). 솔리드 로컬 Z = 보 축, X = 수직
    const levelBeams = snap.elements.filter(
      (e): e is BeamElement => e.kind === 'beam' && e.levelId === level.id,
    );
    for (const beam of levelBeams) {
      const btype = beamTypes.get(beam.typeId);
      const section = btype?.section ?? { shape: 'rect', width: 300, depth: 600 };
      const dx = beam.b[0] - beam.a[0];
      const dy = beam.b[1] - beam.a[1];
      const len = Math.hypot(dx, dy);
      if (len === 0) continue;
      const ux = dx / len;
      const uy = dy / len;
      const vHalf = section.shape === 'circle' ? section.diameter / 2 : section.depth / 2;
      const z = beam.zOffset ?? level.height - vHalf;
      const objPlace = local(storeyPlace, place3(pt3(beam.a[0], beam.a[1], z)));
      // 솔리드 좌표계: Axis(로컬 Z) = 보 축(평면), RefDirection(로컬 X) = 수직(world Z)
      const solidPos = w(
        new I.IfcAxis2Placement3D(pt3(0, 0, 0) as never, dir3(ux, uy, 0) as never, dir3(0, 0, 1) as never),
      );
      const profile =
        section.shape === 'circle'
          ? w(
              new I.IfcCircleProfileDef(
                I.IfcProfileTypeEnum.AREA,
                null,
                w(new I.IfcAxis2Placement2D(pt2(0, 0) as never, null)) as never,
                (section.diameter / 2) as never,
              ),
            )
          : w(
              // XDim=수직(춤)=depth, YDim=수평=width
              new I.IfcRectangleProfileDef(
                I.IfcProfileTypeEnum.AREA,
                null,
                w(new I.IfcAxis2Placement2D(pt2(0, 0) as never, null)) as never,
                section.depth as never,
                section.width as never,
              ),
            );
      const solid = w(
        new I.IfcExtrudedAreaSolid(profile as never, solidPos as never, dir3(0, 0, 1) as never, len as never),
      );
      const rep = w(new I.IfcShapeRepresentation(ctx as never, label('Body'), label('SweptSolid'), [solid as never]));
      const shape = w(new I.IfcProductDefinitionShape(null, null, [rep as never]));
      const beamEntity = w(
        new I.IfcBeam(guid(`beam-${beam.id}`), null, label(`보 ${beam.id}`), null, null, objPlace as never, shape as never, null, null),
      );
      contained.push(beamEntity as unknown as WebIFC.Handle<WebIFC.IfcLineObject>);
    }

    if (contained.length) {
      w(
        new I.IfcRelContainedInSpatialStructure(guid(`contain-${level.id}`), null, null, null, contained as never, storey as never),
      );
    }
    void wallsById; // (import에서 호스트 매핑용 — export에선 미사용)
  }

  w(new I.IfcRelAggregates(guid('agg-building'), null, null, null, building as never, storeyHandles as never));

  const bytes = ifcApi.SaveModel(modelID);
  ifcApi.CloseModel(modelID);
  return bytes;
}
