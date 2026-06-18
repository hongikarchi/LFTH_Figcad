// @figcad/interop — 외부 포맷 어댑터 (M7).
// IFC(web-ifc)가 1순위 — 유일한 파라메트릭 보존 경로. .3dm/DXF는 후속.
// 무겁고(WASM) 핫패스 밖이므로 앱에서는 반드시 dynamic import로 지연 로드할 것.

export { exportIfc } from './ifcExport';
export { importIfc, type IfcImportResult } from './ifcImport';
export { importIfcMeshes, type ExtractedMesh } from './ifcMeshes';
export { ifcGuidFromId } from './ifcGuid';
export { exportRhino, importRhino, type RhinoImportResult } from './rhino3dm';
export { exportDrawingDxf, exportDxf, importDxf, type DxfImportResult } from './dxf';
