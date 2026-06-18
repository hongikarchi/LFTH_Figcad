// IFC 서브엔트리 — web-ifc만 끌어오도록 분리 (코드 스플릿 경계, @figcad/interop/ifc)
export { exportIfc } from './ifcExport';
export { importIfc, type IfcImportResult } from './ifcImport';
export { importIfcMeshes, type ExtractedMesh } from './ifcMeshes';
export { ifcGuidFromId } from './ifcGuid';
