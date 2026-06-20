// FigcadConnector.cs — Rhino ↔ Figcad 라이브 커넥터 (M10-D2)
// =============================================================================
// Figcad 서버 라이브쓰기 API(M10-D1: ?op=pull / ?op=apply)를 호출하는 결정적 커넥터.
// MCP(execute_rhinocommon_csharp_code)로 배포된 D-1에 대고 양방향 왕복 검증 완료:
//   Pull: 벽 axis=[0,0]→[6000,0] 등 좌표 정확 재현 · 재-Pull 멱등(소유권 규칙)
//   Push: Rhino 작도 벽/슬라브 → ?op=apply → Figcad 반영 + createdIds writeback(무중복)
//
// 정체성/소유권 규칙 (왕복 무중복의 핵심):
//   "figcad:id" UserString = Figcad가 소유한 객체.
//   - Pull: figcad-owned 전부 삭제 후 스냅샷대로 재그림(+id 스탬프) → 재-Pull 멱등.
//   - Push: figcad:id 없는(=Rhino 작도) 객체만 전송. apply 응답 createdIds를 그 객체에
//           되써(stamp) Figcad 소유로 전환 → 다음 Pull이 중복 안 그림.
//
// 단위: Figcad mm 정수 ↔ Rhino mm 1:1 (스케일 없음). 좌표는 round.
// 컨버터 범위(v1, .3dm export 매핑 packages/interop/src/rhino3dm.ts 재사용):
//   Pull(넓게): wall(axis+footprint)·slab·column·grid·beam·roof·zone·curtainwall(baseline).
//   Push(좁게): "Wall Axis" 선 → create_wall, "Slab" 닫힌곡선 → create_slab. 그 외 레이어·
//               임의 brep/메시 = 스킵+카운트(무손실 역변환 불가 — AI 시맨틱 리프팅=v1.5).
//   level/type은 Pull 스냅샷의 기존 id 재사용(create_type 없음 — 룸은 Figcad 앱이 시드).
//
// 두 가지 실행 형태:
//   (1) Rhino 8 스크립트 에디터(_ScriptEditorCommand, C#): 본 파일 붙여넣고
//       FigcadConnector.Pull(RhinoDoc.ActiveDoc, cfg) 호출.
//   (2) .rhp 플러그인: 하단 Command 스텁을 Rhino.Commands.Command로 빌드(Visual Studio +
//       RhinoCommon NuGet, Yak 패키징). 코어 로직은 그대로 재사용.
// =============================================================================
using System;
using System.Collections.Generic;
using System.Globalization;
using System.Net.Http;
using System.Text;
using Rhino;
using Rhino.DocObjects;
using Rhino.Geometry;

namespace Figcad
{
    public class FigcadConfig
    {
        public string BaseUrl = "http://localhost:8787"; // 프로덕션 = https://figcad.archivibe.workers.dev
        public string Room = "default";                   // Figcad 프로젝트 id (?p=)
        public string Key = null;                          // ROOM_KEY (설정 시)
    }

    public static class FigcadConnector
    {
        const string IdKey = "figcad:id";
        static readonly HttpClient Http = new HttpClient { Timeout = TimeSpan.FromSeconds(60) };

        static string Url(FigcadConfig c, string op) =>
            c.BaseUrl + "/parties/doc/" + c.Room + "?op=" + op +
            (string.IsNullOrEmpty(c.Key) ? "" : "&key=" + Uri.EscapeDataString(c.Key));

        static double D(object o) => Convert.ToDouble(o, CultureInfo.InvariantCulture);

        // ===== Pull: Figcad → Rhino =====
        public static string Pull(RhinoDoc doc, FigcadConfig cfg)
        {
            string body = Http.GetStringAsync(Url(cfg, "pull")).GetAwaiter().GetResult();
            var root = (Dictionary<string, object>)Json.Parse(body);
            var levels = (List<object>)root["levels"];
            var types = (List<object>)root["types"];
            var elements = (List<object>)root["elements"];

            var elev = new Dictionary<string, double>();
            var levelH = new Dictionary<string, double>();
            foreach (Dictionary<string, object> l in levels)
            {
                elev[(string)l["id"]] = D(l["elevation"]);
                levelH[(string)l["id"]] = D(l["height"]);
            }
            var typeById = new Dictionary<string, Dictionary<string, object>>();
            foreach (Dictionary<string, object> t in types) typeById[(string)t["id"]] = t;

            int axisL = Layer(doc, "Wall Axis", 60, 60, 60);
            int wallL = Layer(doc, "Walls", 120, 120, 120);
            int slabL = Layer(doc, "Slab", 150, 150, 150);
            int gridL = Layer(doc, "Grid", 200, 60, 60);
            int colL = Layer(doc, "Column", 90, 90, 120);
            int beamL = Layer(doc, "Beam", 110, 110, 90);
            int roofL = Layer(doc, "Roof", 130, 120, 90);
            int zoneL = Layer(doc, "Zone", 90, 160, 90);
            int cwL = Layer(doc, "CurtainWall", 90, 150, 170);

            // 소유권 규칙: figcad-owned 전부 삭제 후 재그림 (재-Pull 멱등)
            var owned = new List<Guid>();
            foreach (var o in doc.Objects)
                if (!string.IsNullOrEmpty(o.Attributes.GetUserString(IdKey))) owned.Add(o.Id);
            foreach (var g in owned) doc.Objects.Delete(g, true);

            int n = 0;
            foreach (Dictionary<string, object> el in elements)
            {
                string kind = (string)el["kind"], id = (string)el["id"];
                string lid = el.ContainsKey("levelId") ? (string)el["levelId"] : null;
                double z = lid != null && elev.ContainsKey(lid) ? elev[lid] : 0;

                if (kind == "wall")
                {
                    var a = (List<object>)el["a"]; var b = (List<object>)el["b"];
                    double ax = D(a[0]), ay = D(a[1]), bx = D(b[0]), by = D(b[1]);
                    z += Opt(el, "baseOffset", 0);
                    AddCurve(doc, new Point3d[] { new Point3d(ax, ay, z), new Point3d(bx, by, z) }, axisL, id, null);
                    double th = (typeById.ContainsKey((string)el["typeId"]) ? Opt(typeById[(string)el["typeId"]], "thickness", 200) : 200) / 2;
                    double dx = bx - ax, dy = by - ay, len = Math.Sqrt(dx * dx + dy * dy); if (len < 1e-9) len = 1;
                    double nx = -dy / len * th, ny = dx / len * th;
                    AddCurve(doc, new Point3d[] {
                        new Point3d(ax+nx, ay+ny, z), new Point3d(bx+nx, by+ny, z),
                        new Point3d(bx-nx, by-ny, z), new Point3d(ax-nx, ay-ny, z), new Point3d(ax+nx, ay+ny, z)
                    }, wallL, id, "footprint");
                    n++;
                }
                else if (kind == "slab" || kind == "roof" || kind == "zone")
                {
                    double zz = z;
                    if (kind == "roof") zz = z + (lid != null ? levelH[lid] : 3000) + Opt(el, "baseOffset", 0);
                    AddCurve(doc, Ring2D((List<object>)el["boundary"], zz, true), kind == "slab" ? slabL : kind == "roof" ? roofL : zoneL, id, null);
                    n++;
                }
                else if (kind == "grid")
                {
                    var a = (List<object>)el["a"]; var b = (List<object>)el["b"];
                    AddCurve(doc, new Point3d[] { new Point3d(D(a[0]), D(a[1]), 0), new Point3d(D(b[0]), D(b[1]), 0) }, gridL, id, null);
                    n++;
                }
                else if (kind == "column")
                {
                    z += Opt(el, "baseOffset", 0);
                    var at = (List<object>)el["at"];
                    var sec = SectionOf(typeById, (string)el["typeId"]);
                    var pts = new List<Point3d>();
                    foreach (var off in SectionRing(sec)) pts.Add(new Point3d(D(at[0]) + off[0], D(at[1]) + off[1], z));
                    pts.Add(pts[0]);
                    AddCurve(doc, pts.ToArray(), colL, id, null);
                    n++;
                }
                else if (kind == "beam")
                {
                    var a = (List<object>)el["a"]; var b = (List<object>)el["b"];
                    double zb = z + Opt(el, "zOffset", (lid != null ? levelH[lid] : 3000) - 300);
                    AddCurve(doc, new Point3d[] { new Point3d(D(a[0]), D(a[1]), zb), new Point3d(D(b[0]), D(b[1]), zb) }, beamL, id, null);
                    n++;
                }
                else if (kind == "curtainwall")
                {
                    var a = (List<object>)el["a"]; var b = (List<object>)el["b"];
                    AddCurve(doc, new Point3d[] { new Point3d(D(a[0]), D(a[1]), z), new Point3d(D(b[0]), D(b[1]), z) }, cwL, id, null);
                    n++;
                }
                // opening/dimension/text/label/stair/railing = v1 Pull 스킵(주석·구조 일부) — IFC/후속
            }
            doc.Views.Redraw();
            return "Pull: 요소 " + n + "개 (삭제 owned " + owned.Count + ")";
        }

        // ===== Push: Rhino → Figcad =====
        public static string Push(RhinoDoc doc, FigcadConfig cfg)
        {
            // 기존 level/type id (Push 대상 — create_type 없음, 룸은 앱이 시드)
            string snapBody = Http.GetStringAsync(Url(cfg, "pull")).GetAwaiter().GetResult();
            var snap = (Dictionary<string, object>)Json.Parse(snapBody);
            string levelId = null, wallTypeId = null, slabTypeId = null;
            foreach (Dictionary<string, object> l in (List<object>)snap["levels"]) { levelId = (string)l["id"]; break; }
            foreach (Dictionary<string, object> t in (List<object>)snap["types"])
            {
                if ((string)t["kind"] == "wall" && wallTypeId == null) wallTypeId = (string)t["id"];
                if ((string)t["kind"] == "slab" && slabTypeId == null) slabTypeId = (string)t["id"];
            }
            int axisL = doc.Layers.FindByFullPath("Wall Axis", -1);
            int slabL = doc.Layers.FindByFullPath("Slab", -1);

            var pushed = new List<Guid>();
            var ops = new List<string>();
            int skipped = 0;
            foreach (var o in doc.Objects)
            {
                if (!string.IsNullOrEmpty(o.Attributes.GetUserString(IdKey))) continue; // Figcad 소유 = 스킵
                var crv = o.Geometry as Curve;
                if (crv == null) { skipped++; continue; } // brep/mesh 등 = 스킵+카운트
                int li = o.Attributes.LayerIndex;
                if (li == axisL && levelId != null && wallTypeId != null)
                {
                    var p0 = crv.PointAtStart; var p1 = crv.PointAtEnd;
                    if (p0.DistanceTo(p1) < 1) { skipped++; continue; }
                    ops.Add("{\"op\":\"create_wall\",\"args\":{\"levelId\":\"" + levelId + "\",\"typeId\":\"" + wallTypeId +
                            "\",\"a\":[" + R(p0.X) + "," + R(p0.Y) + "],\"b\":[" + R(p1.X) + "," + R(p1.Y) + "]}}");
                    pushed.Add(o.Id);
                }
                else if (li == slabL && levelId != null && slabTypeId != null)
                {
                    Polyline poly;
                    if (!crv.TryGetPolyline(out poly)) { skipped++; continue; }
                    var pts = new List<Point3d>(poly);
                    if (pts.Count > 1 && pts[0].DistanceTo(pts[pts.Count - 1]) < 1) pts.RemoveAt(pts.Count - 1);
                    if (pts.Count < 3) { skipped++; continue; }
                    var sb = new StringBuilder("[");
                    for (int i = 0; i < pts.Count; i++) { if (i > 0) sb.Append(","); sb.Append("[" + R(pts[i].X) + "," + R(pts[i].Y) + "]"); }
                    sb.Append("]");
                    ops.Add("{\"op\":\"create_slab\",\"args\":{\"levelId\":\"" + levelId + "\",\"typeId\":\"" + slabTypeId + "\",\"boundary\":" + sb + "}}");
                    pushed.Add(o.Id);
                }
                else skipped++;
            }
            if (ops.Count == 0) return "Push: 보낼 Rhino 작도 객체 없음 (스킵 " + skipped + ")";

            // 배치 전송 — D-1 바운드(ops≤2000) 회피. 큰 모델(예: 416MB grid 111개, 향후 수천)도 분할 POST.
            const int BATCH = 1500;
            int applied = 0, failedTotal = 0;
            var allCreated = new List<string>();
            for (int off = 0; off < ops.Count; off += BATCH)
            {
                var slice = ops.GetRange(off, Math.Min(BATCH, ops.Count - off));
                var content = new StringContent("{\"ops\":[" + string.Join(",", slice) + "]}", Encoding.UTF8, "application/json");
                var resp = Http.PostAsync(Url(cfg, "apply"), content).GetAwaiter().GetResult();
                var res = (Dictionary<string, object>)Json.Parse(resp.Content.ReadAsStringAsync().GetAwaiter().GetResult());
                applied += Convert.ToInt32(D(res["applied"]));
                failedTotal += ((List<object>)res["failed"]).Count;
                foreach (var cid in (List<object>)res["createdIds"]) allCreated.Add((string)cid);
            }
            // createdIds writeback: pushed[i] ← allCreated[i] (다음 Pull 무중복의 핵심).
            // 정렬은 create_* op이 op당 정확히 id 1개를 내고 실패 0일 때만 보장 — 실패 시 스킵(재-Pull로 화해).
            if (failedTotal == 0)
                for (int i = 0; i < pushed.Count && i < allCreated.Count; i++)
                {
                    var ob = doc.Objects.FindId(pushed[i]);
                    if (ob == null) continue;
                    ob.Attributes.SetUserString(IdKey, allCreated[i]);
                    ob.CommitChanges();
                }
            return "Push: 적용 " + applied + " · 실패 " + failedTotal + " · 스킵 " + skipped +
                   " · 배치 " + ((ops.Count + BATCH - 1) / BATCH) + (failedTotal > 0 ? " (실패로 writeback 보류)" : "");
        }

        // ===== M13-G: Brep 인식 Push (기계적 리프트) =====================================
        // 압출/실린더 Brep → 기둥·벽·슬라브·보 ops. 적중률 측정 77~94%(구조요소 ~100%,
        // docs/brep-lifting-2026.md). 인식 = cap-pair(반대법선 평면쌍, 면적최대)→축·길이,
        // cap OuterLoop→프로필 폴리곤(PolyCurve.Explode). 블록 인스턴스는 InstanceXform 재귀 적용.
        // 불변①: ops/파라만 방출(메시 bake 금지). ingest=PR: 인식분 + 잔여 카운트 = 충실도 보고.
        //
        // ⚠️ 스캐폴드 — 이 코드는 Figcad 빌드 env(JS)서 컴파일 안 됨. Rhino 8 스크립트에디터/
        //    .rhp에서 빌드·튜닝할 것. RhinoCommon API 호출은 MCP로 사전 검증(TryGetPlane/
        //    TryGetCylinder/AreaMassProperties/OuterLoop.To3dCurve/PolyCurve.Explode/InstanceXform).
        // 한계(문서화): ① section/thickness는 기존 column/wall TYPE서 옴(create_type 없음) —
        //    인식은 위치·footprint·높이·축만, 단면은 타입 근사(ingest 후 clean-up서 정밀화=v1.5).
        //    ② in-block 지오는 figcad:id writeback 불가 → 재-Push 중복 가능. ingest=PR *1회 import*
        //    용도(연속 sync 아님). ③ 분류 임계(기둥 foot≤1200·벽 foot≤600·슬라브 span>3000)는
        //    이 모델 기준 — 실사용서 튜닝.
        public static string PushBreps(RhinoDoc doc, FigcadConfig cfg)
        {
            string snapBody = Http.GetStringAsync(Url(cfg, "pull")).GetAwaiter().GetResult();
            var snap = (Dictionary<string, object>)Json.Parse(snapBody);
            string levelId = null, wallTypeId = null, slabTypeId = null, columnTypeId = null, beamTypeId = null;
            foreach (Dictionary<string, object> l in (List<object>)snap["levels"]) { levelId = (string)l["id"]; break; }
            foreach (Dictionary<string, object> t in (List<object>)snap["types"])
            {
                string k = (string)t["kind"];
                if (k == "wall" && wallTypeId == null) wallTypeId = (string)t["id"];
                else if (k == "slab" && slabTypeId == null) slabTypeId = (string)t["id"];
                else if (k == "column" && columnTypeId == null) columnTypeId = (string)t["id"];
                else if (k == "beam" && beamTypeId == null) beamTypeId = (string)t["id"];
            }
            double tol = Math.Max(doc.ModelAbsoluteTolerance, 0.01);

            // 1) 재귀 수집: 블록 인스턴스 변환 누적 적용 (figcad 소유 스킵). top-level만 writeback 가능.
            var breps = new List<Brep>();
            void Collect(IEnumerable<RhinoObject> objs, Transform xf, int depth)
            {
                if (depth > 8) return;
                foreach (var o in objs)
                {
                    if (!string.IsNullOrEmpty(o.Attributes.GetUserString(IdKey))) continue;
                    var io = o as InstanceObject;
                    if (io != null) { try { Collect(io.InstanceDefinition.GetObjects(), xf * io.InstanceXform, depth + 1); } catch { } continue; }
                    Brep b = null;
                    var ex = o.Geometry as Extrusion;
                    if (ex != null) b = ex.ToBrep();
                    else { var bp = o.Geometry as Brep; if (bp != null && bp.IsSolid) b = (Brep)bp.Duplicate(); }
                    if (b == null) continue;
                    b.Transform(xf);
                    breps.Add(b);
                }
            }
            Collect(doc.Objects, Transform.Identity, 0);

            // 1b) recenter + origin 기억 (M13 projectOrigin, Revit Base Point 패턴): 부지/측량 좌표
            //     모델은 원점서 km라 Figcad서 멀다 → 전체 bbox min(XY)을 빼 원점 근처로 저장하고,
            //     그 offset을 룸에 기억(?op=origin POST). export(Pull·interop)는 다시 더해 원좌표 복원.
            //     이미 origin 있는 룸(2차 import)이면 그 origin 재사용(멀티모델 정합). 무누락 = 서버 rebaseSnapshot.
            double ox = 0, oy = 0;
            try
            {
                var ob = Http.GetStringAsync(Url(cfg, "origin")).GetAwaiter().GetResult();
                var od = (Dictionary<string, object>)Json.Parse(ob);
                if (od.ContainsKey("origin") && od["origin"] is List<object> ol && ol.Count == 2) { ox = D(ol[0]); oy = D(ol[1]); }
            }
            catch { }
            if (ox == 0 && oy == 0 && breps.Count > 0)
            {
                var gbb = BoundingBox.Empty;
                foreach (var b in breps) gbb.Union(b.GetBoundingBox(true));
                if (gbb.IsValid)
                {
                    ox = Math.Round(gbb.Min.X); oy = Math.Round(gbb.Min.Y);
                    var setc = new StringContent("{\"x\":" + R(ox) + ",\"y\":" + R(oy) + "}", Encoding.UTF8, "application/json");
                    try { Http.PostAsync(Url(cfg, "origin"), setc).GetAwaiter().GetResult(); } catch { }
                }
            }
            if (ox != 0 || oy != 0)
            {
                var shift = Transform.Translation(-ox, -oy, 0);
                foreach (var b in breps) b.Transform(shift);
            }

            // 2) 인식 → ops
            var ops = new List<string>();
            int nCol = 0, nWall = 0, nSlab = 0, nBeam = 0, nResidual = 0;
            foreach (var b in breps)
            {
                string kind;
                var op = RecognizeBrep(b, tol, levelId, wallTypeId, slabTypeId, columnTypeId, beamTypeId, out kind);
                if (op == null) { nResidual++; continue; }
                ops.Add(op);
                if (kind == "column") nCol++; else if (kind == "wall") nWall++; else if (kind == "slab") nSlab++; else if (kind == "beam") nBeam++;
            }
            if (ops.Count == 0) return "PushBreps: 인식된 압출/실린더 없음 (Brep " + breps.Count + " · 잔여 " + nResidual + ")";

            // 3) 배치 POST (Push와 동일 패턴, writeback은 생략 — in-block id 매핑 불가, ingest=PR 1회)
            const int BATCH = 1500;
            int applied = 0, failedTotal = 0;
            for (int off = 0; off < ops.Count; off += BATCH)
            {
                var slice = ops.GetRange(off, Math.Min(BATCH, ops.Count - off));
                var content = new StringContent("{\"ops\":[" + string.Join(",", slice) + "]}", Encoding.UTF8, "application/json");
                var resp = Http.PostAsync(Url(cfg, "apply"), content).GetAwaiter().GetResult();
                var res = (Dictionary<string, object>)Json.Parse(resp.Content.ReadAsStringAsync().GetAwaiter().GetResult());
                applied += Convert.ToInt32(D(res["applied"]));
                failedTotal += ((List<object>)res["failed"]).Count;
            }
            // 충실도 보고 (ingest=PR)
            return "PushBreps 충실도 보고: 적용 " + applied + " · 실패 " + failedTotal +
                   " | 기둥 " + nCol + " · 벽 " + nWall + " · 슬라브 " + nSlab + " · 보 " + nBeam +
                   " · 자유곡면/미인식 잔여 " + nResidual + " (Lane-2 passthrough 대상)";
        }

        // Brep 1개 인식 → create_* op (또는 null=잔여). out kind = column/wall/slab/beam.
        static string RecognizeBrep(Brep b, double tol, string lv, string wt, string st, string ct, string bt, out string kind)
        {
            kind = null;
            if (lv == null) return null;
            // 실린더면 보유 = 원형기둥 후보
            bool isCyl = false; double dia = 0;
            foreach (var f in b.Faces)
            {
                var s = f.UnderlyingSurface();
                Cylinder cy;
                if (s != null && !s.IsPlanar(tol) && s.TryGetCylinder(out cy, tol)) { isCyl = true; dia = cy.Radius * 2; break; }
            }
            // cap-pair: 반대법선(dot<-0.9) 평면쌍 중 면적최대 = 압출 캡. 축=법선, 길이=평면거리.
            var pf = new List<KeyValuePair<BrepFace, Plane>>();
            var areas = new List<double>();
            foreach (var f in b.Faces)
            {
                var s = f.UnderlyingSurface();
                Plane pl;
                if (s != null && s.TryGetPlane(out pl, tol))
                {
                    pf.Add(new KeyValuePair<BrepFace, Plane>(f, pl));
                    // cap 크기 프록시 = 면 bbox 대각 (AreaMassProperties는 564 Brep서 너무 느림 — MCP 실증:
                    // bbox로 바꾸니 타임아웃 0·인식 85%(479/564). 정확 면적 불필요 — 최대쌍 선택+유사도용).
                    areas.Add(f.GetBoundingBox(true).Diagonal.Length);
                }
            }
            BrepFace cap = null; double len = 0, best = -1; Vector3d axis = Vector3d.ZAxis;
            for (int i = 0; i < pf.Count; i++)
                for (int j = i + 1; j < pf.Count; j++)
                {
                    if (pf[i].Value.Normal * pf[j].Value.Normal < -0.9)
                    {
                        double d = Math.Abs(pf[i].Value.DistanceTo(pf[j].Value.Origin));
                        double minA = Math.Min(areas[i], areas[j]);
                        if (d > tol && minA > best) { best = minA; cap = areas[i] >= areas[j] ? pf[i].Key : pf[j].Key; len = d; axis = pf[i].Value.Normal; }
                    }
                }
            if (cap == null) return null; // 압출 미인식 = 잔여(Lane-2)
            axis.Unitize();
            var verts = ProfileVerts(cap);
            if (verts.Count < 3) return null;
            var bb = new BoundingBox(verts);
            double dx = bb.Max.X - bb.Min.X, dy = bb.Max.Y - bb.Min.Y;
            double cx = (bb.Min.X + bb.Max.X) / 2, cyc = (bb.Min.Y + bb.Max.Y) / 2, cz = (bb.Min.Z + bb.Max.Z) / 2;
            double foot = Math.Min(dx, dy), span = Math.Max(dx, dy);
            bool vert = Math.Abs(axis.Z) > 0.8;

            if (isCyl && vert && ct != null) { kind = "column"; return "{\"op\":\"create_column\",\"args\":{\"levelId\":\"" + lv + "\",\"typeId\":\"" + ct + "\",\"at\":[" + R(cx) + "," + R(cyc) + "],\"baseOffset\":" + R(bb.Min.Z) + ",\"height\":" + R(len) + "}}"; }
            if (vert)
            {
                if (span > 3000 && len < foot && st != null)
                {
                    var sb = new StringBuilder("[");
                    for (int i = 0; i < verts.Count; i++) { if (i > 0) sb.Append(","); sb.Append("[" + R(verts[i].X) + "," + R(verts[i].Y) + "]"); }
                    sb.Append("]");
                    kind = "slab"; return "{\"op\":\"create_slab\",\"args\":{\"levelId\":\"" + lv + "\",\"typeId\":\"" + st + "\",\"boundary\":" + sb + "}}";
                }
                if (foot <= 600 && span > foot * 2.5 && wt != null)
                {
                    // 벽: 프로필 장축이 중심선
                    double ax, ay, bx, by;
                    if (dx >= dy) { ax = bb.Min.X; ay = cyc; bx = bb.Max.X; by = cyc; } else { ax = cx; ay = bb.Min.Y; bx = cx; by = bb.Max.Y; }
                    kind = "wall"; return "{\"op\":\"create_wall\",\"args\":{\"levelId\":\"" + lv + "\",\"typeId\":\"" + wt + "\",\"a\":[" + R(ax) + "," + R(ay) + "],\"b\":[" + R(bx) + "," + R(by) + "]}}";
                }
                if (foot <= 1200 && ct != null) { kind = "column"; return "{\"op\":\"create_column\",\"args\":{\"levelId\":\"" + lv + "\",\"typeId\":\"" + ct + "\",\"at\":[" + R(cx) + "," + R(cyc) + "],\"baseOffset\":" + R(bb.Min.Z) + ",\"height\":" + R(len) + "}}"; }
                return null; // 수직이나 임계 미스 = 잔여
            }
            // 수평 압출 = 보 (축 따라 a→b, 프로필 중심)
            if (bt != null)
            {
                double hx = axis.X, hy = axis.Y, hl = Math.Sqrt(hx * hx + hy * hy);
                if (hl < 1e-6) return null;
                hx /= hl; hy /= hl;
                double ax = cx - hx * len / 2, ay = cyc - hy * len / 2, bx = cx + hx * len / 2, by = cyc + hy * len / 2;
                kind = "beam"; return "{\"op\":\"create_beam\",\"args\":{\"levelId\":\"" + lv + "\",\"typeId\":\"" + bt + "\",\"a\":[" + R(ax) + "," + R(ay) + "],\"b\":[" + R(bx) + "," + R(by) + "],\"zOffset\":" + R(cz) + "}}";
            }
            return null;
        }

        // cap 면 OuterLoop → 월드 프로필 정점 (PolyCurve 대응 — TryGetPolyline 실패 시 Explode)
        static List<Point3d> ProfileVerts(BrepFace cap)
        {
            var outLoop = cap.OuterLoop;
            var verts = new List<Point3d>();
            if (outLoop == null) return verts;
            var c = outLoop.To3dCurve();
            if (c == null) return verts;
            Polyline pl;
            if (c.TryGetPolyline(out pl)) { foreach (var p in pl) verts.Add(p); }
            else
            {
                var pc = c as PolyCurve;
                if (pc != null) { foreach (var seg in pc.Explode()) verts.Add(seg.PointAtStart); }
                else { var d = c.DivideByCount(16, true); if (d != null) foreach (var t in d) verts.Add(c.PointAt(t)); }
            }
            // 닫힘 중복 끝점 제거
            if (verts.Count > 1 && verts[0].DistanceTo(verts[verts.Count - 1]) < 1) verts.RemoveAt(verts.Count - 1);
            return verts;
        }

        // --- helpers ---
        static string R(double v) => Math.Round(v).ToString(CultureInfo.InvariantCulture);
        static double Opt(Dictionary<string, object> d, string k, double def) => d.ContainsKey(k) && d[k] != null ? D(d[k]) : def;

        static int Layer(RhinoDoc doc, string name, int r, int g, int b)
        {
            int idx = doc.Layers.FindByFullPath(name, -1);
            if (idx >= 0) return idx;
            return doc.Layers.Add(new Layer { Name = name, Color = System.Drawing.Color.FromArgb(r, g, b) });
        }

        static void AddCurve(RhinoDoc doc, Point3d[] pts, int layer, string id, string role)
        {
            var a = new ObjectAttributes { LayerIndex = layer };
            a.SetUserString(IdKey, id);
            if (role != null) a.SetUserString("figcad:role", role);
            doc.Objects.AddCurve(new PolylineCurve(pts), a);
        }

        static Point3d[] Ring2D(List<object> boundary, double z, bool close)
        {
            var pts = new List<Point3d>();
            foreach (List<object> p in boundary) pts.Add(new Point3d(D(p[0]), D(p[1]), z));
            if (close && pts.Count > 0) pts.Add(pts[0]);
            return pts.ToArray();
        }

        static Dictionary<string, object> SectionOf(Dictionary<string, Dictionary<string, object>> types, string typeId) =>
            types.ContainsKey(typeId) && types[typeId].ContainsKey("section") ? (Dictionary<string, object>)types[typeId]["section"] : null;

        // sectionRing 재현 (rect 4각 / circle 24각)
        static List<double[]> SectionRing(Dictionary<string, object> sec)
        {
            var r = new List<double[]>();
            if (sec != null && (string)sec["shape"] == "circle")
            {
                double rad = D(sec["diameter"]) / 2;
                for (int k = 0; k < 24; k++) { double an = k / 24.0 * Math.PI * 2; r.Add(new[] { Math.Cos(an) * rad, Math.Sin(an) * rad }); }
            }
            else
            {
                double w = (sec != null ? D(sec["width"]) : 400) / 2, dp = (sec != null ? D(sec["depth"]) : 400) / 2;
                r.Add(new[] { -w, -dp }); r.Add(new[] { w, -dp }); r.Add(new[] { w, dp }); r.Add(new[] { -w, dp });
            }
            return r;
        }
    }

    // ===== 외부 의존 없는 미니 JSON 리더 (Roslyn 스크립트 샌드박스엔 System.Text.Json/Newtonsoft
    //        참조가 없음 — .rhp 빌드에선 그대로 두거나 표준 라이브러리로 교체 가능) =====
    static class Json
    {
        public static object Parse(string s) { int p = 0; return Val(s, ref p); }
        static void Ws(string s, ref int p) { while (p < s.Length && char.IsWhiteSpace(s[p])) p++; }
        static object Val(string s, ref int p)
        {
            Ws(s, ref p); char ch = s[p];
            if (ch == '{')
            {
                var d = new Dictionary<string, object>(); p++; Ws(s, ref p);
                if (s[p] == '}') { p++; return d; }
                while (true) { Ws(s, ref p); string k = Str(s, ref p); Ws(s, ref p); p++; d[k] = Val(s, ref p); Ws(s, ref p); if (s[p] == ',') { p++; continue; } p++; break; }
                return d;
            }
            if (ch == '[')
            {
                var a = new List<object>(); p++; Ws(s, ref p);
                if (s[p] == ']') { p++; return a; }
                while (true) { a.Add(Val(s, ref p)); Ws(s, ref p); if (s[p] == ',') { p++; continue; } p++; break; }
                return a;
            }
            if (ch == '"') return Str(s, ref p);
            if (ch == 't') { p += 4; return true; }
            if (ch == 'f') { p += 5; return false; }
            if (ch == 'n') { p += 4; return null; }
            int st = p; while (p < s.Length && "-+.eE0123456789".IndexOf(s[p]) >= 0) p++;
            return double.Parse(s.Substring(st, p - st), CultureInfo.InvariantCulture);
        }
        static string Str(string s, ref int p)
        {
            var sb = new StringBuilder(); p++;
            while (s[p] != '"')
            {
                char ch = s[p++];
                if (ch == '\\')
                {
                    char e = s[p++];
                    if (e == 'u') { sb.Append((char)Convert.ToInt32(s.Substring(p, 4), 16)); p += 4; }
                    else if (e == 'n') sb.Append('\n'); else if (e == 't') sb.Append('\t'); else if (e == 'r') sb.Append('\r');
                    else sb.Append(e);
                }
                else sb.Append(ch);
            }
            p++; return sb.ToString();
        }
    }

    // ===== .rhp Command 스텁 (Visual Studio + RhinoCommon으로 빌드 시) =====
    // public class FigcadPullCommand : Rhino.Commands.Command {
    //     public override string EnglishName => "FigcadPull";
    //     protected override Rhino.Commands.Result RunCommand(RhinoDoc doc, Rhino.Commands.RunMode mode) {
    //         var cfg = new FigcadConfig { BaseUrl = "...", Room = "..." }; // EditBox/설정에서
    //         RhinoApp.WriteLine(FigcadConnector.Pull(doc, cfg));
    //         return Rhino.Commands.Result.Success;
    //     }
    // }
    // FigcadPushCommand 동일 패턴 (Push 호출). HTTP 콜백이 UI 스레드 밖이면
    // RhinoApp.InvokeOnUiThread로 doc 수정 마샬.
    //
    // M13-G: FigcadPushBrepsCommand — FigcadConnector.PushBreps(doc, cfg) 호출 (Brep 기계적 리프트).
    //   스크립트에디터 1회 실행: FigcadConnector.PushBreps(RhinoDoc.ActiveDoc, new FigcadConfig{Room="..."});
    //   반환 = 충실도 보고("기둥 N·벽 M·슬라브·보 · 잔여 K"). ingest=PR 1회 import 용도(연속 sync 아님).
    //   ⚠️ Push와 달리 figcad:id writeback 없음(in-block 지오) → 재실행 시 중복. 새 룸에 1회 권장.
}
