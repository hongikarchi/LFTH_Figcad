// FigcadConnector.cs — Rhino ↔ Figcad 라이브 커넥터 (M10-D2 → v0.4 파라메트릭 형상충실 리프트)
// =============================================================================
// Figcad 서버 라이브쓰기 API(M10-D1: ?op=pull / ?op=apply)를 호출하는 결정적 커넥터.
//
// 정체성/소유권 규칙 (왕복 무중복의 핵심):
//   "figcad:id" UserString = Figcad가 소유한 객체.
//   - Pull: figcad-owned 전부 삭제 후 스냅샷대로 재그림(+id 스탬프) → 재-Pull 멱등.
//   - Push: figcad:id 없는(=Rhino 작도) 객체만 전송. apply 응답 createdIds를 그 객체에
//           되써(stamp) Figcad 소유로 전환 → 다음 Pull이 중복 안 그림.
//
// 단위: Figcad mm 정수 ↔ Rhino mm 1:1 (스케일 없음). 좌표는 round.
//
// v0.4 (커넥터 형상충실 리프트 — 계획: connector-upgrade-1-tidy-stream):
//   - PushAll = 커브 레인 + 브렙 리프트 + Lane-2 잔여 통합, 충실도 보고 1장.
//   - RecognizeElement: 파라미터를 bbox가 아닌 FigcadFit(cap-pair 프리즘 + 단면 분류)에서.
//     기둥/보/벽 단면 실측(rect|circle|hsection|polygon) · 보 대각 축 보존 · 벽 임의회전 rect.
//   - 타입 관리 2단계 POST: 스냅샷 타입 canonical key 매치 → 미매치만 create_type(POST-B,
//     dedup 없음 — create_type은 서버가 절대 dedup 안 함) → createdIds로 typeId 해석 →
//     요소 ops POST-C(&dedup=1). 구서버(create_type=unknown op 전패)는 first-type 근사 폴백+보고.
//   - baseOffset/zOffset = *레벨 상대*(스냅샷 level.elevation 차감) — 종전 raw Z 버그 수정.
//     (core deriveColumn: baseY=elevation+baseOffset · deriveBeam: axisZ=elevation+zOffset)
//   - Collect: 열린 brep·메시도 조용히 버리지 않고 Lane-2 잔여 동승(+카운터, preview 회색).
//   - Pull 패리티: SectionRing hsection 12점/polygon verbatim + AddBeamPrism(임의 단면 보).
//   - "조용히 근사 금지": 단면/각도/부피 게이트 실패 = Lane-2 + FailReason 카운트,
//     bbox 폴백 없음. 계단/난간 bbox 근사·슬라브 개구 무시·슬라브 z 유실(상면≠레벨 elevation,
//     core 스키마 v1에 z 없음)은 NApprox로 정직 카운트.
//
// 두 가지 실행 형태:
//   (1) Rhino 8 스크립트 에디터: 본 파일 + FigcadClassify.cs + FigcadFit.cs 붙여넣고
//       FigcadConnector.PushAll(RhinoDoc.ActiveDoc, cfg, null) 호출.
//   (2) .rhp 플러그인: plugin/FigcadPlugin.csproj가 이 파일을 링크해 빌드.
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
        public string BaseUrl = "http://localhost:8787"; // 프로덕션 = https://lfthfigcad-production.up.railway.app
        public string Room = "default";                   // Figcad 프로젝트 id (?p=)
        public string Key = null;                          // ROOM_KEY (설정 시)
    }

    // Push/Preview 분류 결과 — Preview 오버레이·Push ops·Lane-2 잔여를 한 소스로(preview가 리프트 못 속임).
    public class PushCandidate
    {
        public Guid Id;          // 자유 top-level 객체 id; in-block/딥 = Guid.Empty
        public BoundingBox Bbox; // *원본*(doc/화면) 좌표 — preview DrawBox용
        public string Kind;      // null = 잔여(Lane-2)
        public bool Approx;      // 근사 리프트(계단/난간 bbox·슬라브 개구 무시 등) — preview 주황
        public string FailReason;// 잔여 사유(Kind=null) 또는 근사 사유
    }

    // 리프트 op 1건 — 타입은 2단계 POST 후 canonical key로 해석(JsonTemplate의 {TYPEID} 치환).
    public class PushOp
    {
        public string Kind;
        public string TypeKey;      // "kind|섹션키" — null = typeId 리터럴 완성(slab/stair/railing)
        public string JsonTemplate; // TypeKey != null이면 "{TYPEID}" 토큰 포함
    }

    // create_type 필요 1건 (kind+단면 canonical key 당 1개 — 커넥터측 dedup의 실체).
    public class TypeNeed
    {
        public string Kind;
        public string OpJson; // {"op":"create_type","args":{...}} 완성 JSON
    }

    public class PushClassification
    {
        public bool HasLevel;
        public int BrepCount;    // 수집된 지오 수(솔리드+열린brep+메시)
        public double Ox, Oy;
        public string LevelId;
        public double LevelElev; // 첫 레벨 elevation(mm) — baseOffset/zOffset 레벨 상대화의 기준
        public List<PushOp> Ops = new List<PushOp>();
        public List<PushCandidate> Candidates = new List<PushCandidate>();
        public List<GeometryBase> Residuals = new List<GeometryBase>(); // *원본* 좌표 — 닫힌/열린 brep + 메시
        public Dictionary<string, TypeNeed> TypeNeeds = new Dictionary<string, TypeNeed>();   // key = kind|섹션키
        public Dictionary<string, string> ExistingTypeIds = new Dictionary<string, string>(); // key → typeId (스냅샷)
        public Dictionary<string, string> FirstTypeOfKind = new Dictionary<string, string>(); // 구서버 폴백
        public int NCol, NWall, NSlab, NBeam, NStair, NRail, NResidual;
        public int NOpenBrep, NMesh, NSkippedOther, NApprox;
        public Dictionary<string, int> ApproxReasons = new Dictionary<string, int>();
        public Dictionary<string, int> Lane2Reasons = new Dictionary<string, int>();
    }

    // 수집 항목(내부) — 블록 재귀 후 지오 + 레이어 + 객체 figcad:kind + top-level id.
    // B=brep(Open=비솔리드), M=메시. 커브는 커브 레인 소관이라 여기 안 옴.
    struct Collected { public Brep B; public Mesh M; public bool Open; public string Layer; public string KindOverride; public Guid Id; }

    public static class FigcadConnector
    {
        const string IdKey = "figcad:id";
        const int BATCH = 1500; // D-1 바운드(ops≤2000) 회피 배치 크기
        const double Cos2Deg = 0.99939; // 수직 프리즘축 게이트 cos(2°)
        const double Sin2Deg = 0.03490; // 수평 프리즘축 게이트 sin(2°)
        // 부재 타당성 상한 — *레이어 자동분류(추측)에만* 적용, 명시적 figcad:kind/레이어맵 지정은 스킵.
        // 목적 = 눕힌 판·덩어리의 부재 오분류 차단(골든 씬 plate 2000×150 실증). 값은 실무 상한 여유:
        // 보 춤 2500(전이거더)·기둥 2000(메가기둥)·벽 1500(지하 옹벽). 초과 = Lane-2 정직 잔여.
        const double BeamWidthMax = 1200;  // 보 단면 폭(수평) 상한(mm) — "폭 2m 보는 없다"
        const double BeamDepthMax = 2500;  // 보 단면 춤(수직) 상한(mm) — 전이거더 1500~2500 실존
        const double ColumnDimMax = 2000;  // 기둥 단면 최대변 상한(mm)
        const double WallThickMax = 1500;  // 벽 두께 상한(mm) — 실모델 F-Wall 600~700 파사드 벽 실존(census) + 옹벽 여유
        // aspect 가드 = 엡실론 비교. 종전 정확비교(len <= maxdim)는 입방체서 float 동점 코인플립
        // (800.0000001 > 799.9999998 → 800³ 큐브가 beam 통과, 골든 씬 실증). 비율 마진(×1.2)은
        // 실존 인방/커플링보(길이 900 × 춤 800)까지 기각해 과잉 — +1mm 엡실론이 정확한 수정.
        const double AspectEps = 1.0;
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

            // projectOrigin 복원(+origin) — recenter import된 좌표를 원 부지좌표로 되돌려 그림(라운드트립
            // 무손실, rebaseSnapshot(+1)의 C# 등가). 모든 export 경계가 origin 복원을 거친다(무누락). XY만.
            double ox = 0, oy = 0;
            try
            {
                var ob = Http.GetStringAsync(Url(cfg, "origin")).GetAwaiter().GetResult();
                var od = (Dictionary<string, object>)Json.Parse(ob);
                if (od.ContainsKey("origin") && od["origin"] is List<object> ol && ol.Count == 2) { ox = D(ol[0]); oy = D(ol[1]); }
            }
            catch { }
            if (ox != 0 || oy != 0)
            {
                void Shift(List<object> p) { if (p != null && p.Count >= 2) { p[0] = D(p[0]) + ox; p[1] = D(p[1]) + oy; } }
                foreach (Dictionary<string, object> el in elements)
                {
                    foreach (var k in new[] { "a", "b", "at" }) if (el.ContainsKey(k) && el[k] is List<object> pt) Shift(pt);
                    if (el.ContainsKey("boundary") && el["boundary"] is List<object> bd) foreach (var pp in bd) if (pp is List<object> pt2) Shift(pt2);
                }
            }

            var elev = new Dictionary<string, double>();
            var levelH = new Dictionary<string, double>();
            foreach (Dictionary<string, object> l in levels)
            {
                elev[(string)l["id"]] = D(l["elevation"]);
                levelH[(string)l["id"]] = D(l["height"]);
            }
            var typeById = new Dictionary<string, Dictionary<string, object>>();
            foreach (Dictionary<string, object> t in types) typeById[(string)t["id"]] = t;

            int wallL = Layer(doc, "Walls", 120, 120, 120);
            int slabL = Layer(doc, "Slab", 150, 150, 150);
            int gridL = Layer(doc, "Grid", 200, 60, 60);
            int colL = Layer(doc, "Column", 90, 90, 120);
            int beamL = Layer(doc, "Beam", 110, 110, 90);
            int roofL = Layer(doc, "Roof", 130, 120, 90);
            int zoneL = Layer(doc, "Zone", 90, 160, 90);
            int cwL = Layer(doc, "CurtainWall", 90, 150, 170);
            int stairL = Layer(doc, "Stair", 150, 110, 170);
            int railL = Layer(doc, "Railing", 170, 130, 90);

            // 소유권 규칙: figcad-owned 전부 삭제 후 재그림 (재-Pull 멱등)
            var owned = new List<Guid>();
            foreach (var o in doc.Objects)
                if (!string.IsNullOrEmpty(o.Attributes.GetUserString(IdKey))) owned.Add(o.Id);
            foreach (var g in owned) doc.Objects.Delete(g, true);

            // 3D 솔리드 재생성(#8) — Figcad 파라미터(중심선·두께·높이·단면)에서 압출. 커브 아님(사용자=3D만).
            //   wall=footprint×height↑ · column=단면×height↑ · slab/roof=경계×thickness · beam=단면 축 압출.
            //   stair/railing/curtainwall=박스 근사(정직 — "근사"로 보고). grid/zone=참조 커브 유지(비물리).
            double tol = Math.Max(doc.ModelAbsoluteTolerance, 0.01);
            var added = new List<Guid>();
            void Track(Guid g) { if (g != Guid.Empty) added.Add(g); }
            int n = 0, approx = 0;
            foreach (Dictionary<string, object> el in elements)
            {
                string kind = (string)el["kind"], id = (string)el["id"];
                string lid = el.ContainsKey("levelId") ? (string)el["levelId"] : null;
                double baseZ = lid != null && elev.ContainsKey(lid) ? elev[lid] : 0;
                double lvH = lid != null && levelH.ContainsKey(lid) ? levelH[lid] : 3000;
                string typeId = el.ContainsKey("typeId") ? (string)el["typeId"] : null;
                var type = typeId != null && typeById.ContainsKey(typeId) ? typeById[typeId] : null;

                if (kind == "wall")
                {
                    var a = (List<object>)el["a"]; var b = (List<object>)el["b"];
                    double ax = D(a[0]), ay = D(a[1]), bx = D(b[0]), by = D(b[1]);
                    double z = baseZ + Opt(el, "baseOffset", 0);
                    double th = (type != null ? Opt(type, "thickness", 200) : 200) / 2;
                    double dx = bx - ax, dy = by - ay, len = Math.Sqrt(dx * dx + dy * dy); if (len < 1e-9) len = 1;
                    double nx = -dy / len * th, ny = dx / len * th;
                    var foot = new Point3d[] {
                        new Point3d(ax+nx, ay+ny, z), new Point3d(bx+nx, by+ny, z),
                        new Point3d(bx-nx, by-ny, z), new Point3d(ax-nx, ay-ny, z), new Point3d(ax+nx, ay+ny, z) };
                    Track(AddSolidOrCurve(doc, foot, new Vector3d(0, 0, Opt(el, "height", lvH)), wallL, id, tol));
                    n++;
                }
                else if (kind == "column")
                {
                    double z = baseZ + Opt(el, "baseOffset", 0);
                    var at = (List<object>)el["at"];
                    var pts = new List<Point3d>();
                    foreach (var off in SectionRing(SectionOf(typeById, typeId))) pts.Add(new Point3d(D(at[0]) + off[0], D(at[1]) + off[1], z));
                    pts.Add(pts[0]);
                    Track(AddSolidOrCurve(doc, pts.ToArray(), new Vector3d(0, 0, Opt(el, "height", lvH)), colL, id, tol));
                    n++;
                }
                else if (kind == "slab" || kind == "roof")
                {
                    double zTop = kind == "roof" ? baseZ + lvH + Opt(el, "baseOffset", 0) : baseZ;
                    double typeTh = type != null ? Opt(type, "thickness", 200) : 200;
                    double th = Opt(el, "thicknessOverride", typeTh);
                    var ring = Ring2D((List<object>)el["boundary"], zTop, true);
                    Track(AddSolidOrCurve(doc, ring, new Vector3d(0, 0, -th), kind == "slab" ? slabL : roofL, id, tol));
                    n++;
                }
                else if (kind == "zone")
                {
                    // 존 = 비물리 공간 경계 → 참조 커브 유지(솔리드 아님)
                    Track(AddCurve(doc, Ring2D((List<object>)el["boundary"], baseZ, true), zoneL, id, null));
                    n++;
                }
                else if (kind == "grid")
                {
                    var a = (List<object>)el["a"]; var b = (List<object>)el["b"];
                    Track(AddCurve(doc, new Point3d[] { new Point3d(D(a[0]), D(a[1]), 0), new Point3d(D(b[0]), D(b[1]), 0) }, gridL, id, null));
                    n++;
                }
                else if (kind == "beam")
                {
                    var a = (List<object>)el["a"]; var b = (List<object>)el["b"];
                    var ring = SectionRing(SectionOf(typeById, typeId));
                    // sectionVHalf 등가(max q) — core deriveBeam 기본 zOffset = level.height − vHalf(천장 정렬)
                    double vHalf = 0; bool first = true;
                    foreach (var pq in ring) { if (first || pq[1] > vHalf) { vHalf = pq[1]; first = false; } }
                    double zc = baseZ + Opt(el, "zOffset", lvH - vHalf); // zOffset = 레벨 상대 중심축 높이
                    Track(AddBeamPrism(doc, D(a[0]), D(a[1]), D(b[0]), D(b[1]), zc, ring, beamL, id, tol));
                    n++;
                }
                else if (kind == "stair")
                {
                    var a = (List<object>)el["a"]; var b = (List<object>)el["b"];
                    double z = baseZ + Opt(el, "baseOffset", 0);
                    double w = type != null ? Opt(type, "width", 1000) : 1000;
                    Track(AddRunBox(doc, D(a[0]), D(a[1]), D(b[0]), D(b[1]), z, 0, lvH, w, stairL, id));
                    n++; approx++;
                }
                else if (kind == "railing")
                {
                    var a = (List<object>)el["a"]; var b = (List<object>)el["b"];
                    double z = baseZ + Opt(el, "baseOffset", 0);
                    double rh = type != null ? Opt(type, "height", 1000) : 1000;
                    Track(AddRunBox(doc, D(a[0]), D(a[1]), D(b[0]), D(b[1]), z, 0, rh, 50, railL, id));
                    n++; approx++;
                }
                else if (kind == "curtainwall")
                {
                    var a = (List<object>)el["a"]; var b = (List<object>)el["b"];
                    double z = baseZ + Opt(el, "baseOffset", 0);
                    Track(AddRunBox(doc, D(a[0]), D(a[1]), D(b[0]), D(b[1]), z, 0, Opt(el, "height", lvH), 60, cwL, id));
                    n++; approx++;
                }
                // opening/dimension/text/label = v1 Pull 스킵(주석)
            }
            if (added.Count > 0) doc.Objects.Select(added, true); // #7 가져온 객체 선택 (2-인자만 존재)
            doc.Views.Redraw();
            return "Pull: 요소 " + n + "개 (3D 솔리드" + (approx > 0 ? " · 근사 " + approx : "") + " · 선택 " + added.Count + " · 삭제 owned " + owned.Count + ")";
        }

        // ===== 배치 apply POST (커브/타입/요소 공용) =====
        class ApplyOutcome
        {
            public int Applied, Failed, Deduped;
            public List<string> CreatedIds = new List<string>();
            public string FirstError; // 첫 실패 op의 에러 문자열 — 구서버(unknown op) 판별용
        }

        static ApplyOutcome PostOps(FigcadConfig cfg, List<string> ops, bool dedup)
        {
            var o = new ApplyOutcome();
            string applyUrl = Url(cfg, "apply") + (dedup ? "&dedup=1" : "");
            for (int off = 0; off < ops.Count; off += BATCH)
            {
                var slice = ops.GetRange(off, Math.Min(BATCH, ops.Count - off));
                var content = new StringContent("{\"ops\":[" + string.Join(",", slice) + "]}", Encoding.UTF8, "application/json");
                var resp = Http.PostAsync(applyUrl, content).GetAwaiter().GetResult();
                var bodyStr = resp.Content.ReadAsStringAsync().GetAwaiter().GetResult();
                var res = (Dictionary<string, object>)Json.Parse(bodyStr);
                if (!res.ContainsKey("applied"))
                    throw new Exception("apply 실패(" + (int)resp.StatusCode + "): " + (res.ContainsKey("error") ? (string)res["error"] : bodyStr));
                o.Applied += Convert.ToInt32(D(res["applied"]));
                var fl = (List<object>)res["failed"];
                o.Failed += fl.Count;
                if (o.FirstError == null && fl.Count > 0 && fl[0] is Dictionary<string, object> fe && fe.ContainsKey("error"))
                    o.FirstError = fe["error"] as string;
                if (res.ContainsKey("deduped")) o.Deduped += Convert.ToInt32(D(res["deduped"]));
                foreach (var cid in (List<object>)res["createdIds"]) o.CreatedIds.Add((string)cid);
            }
            return o;
        }

        // ===== 커브 레인: "Wall Axis" 선 → create_wall, "Slab" 닫힌곡선 → create_slab =====
        class CurveLaneResult { public int NWall, NSlab, Applied, Failed, Skipped; public bool WritebackHeld; }

        // ox/oy = projectOrigin(recenter) — PushAll이 전체 모델 extent에서 1회 해석·POST 후 전달.
        // 커브 좌표도 브렙 레인과 같은 origin을 차감해야 두 레인 요소가 정렬(종전 raw 전송 = 비대칭 버그).
        // 레거시 Push()는 0,0 전달 = 종전 raw 거동 유지(하위호환).
        static CurveLaneResult PushCurvesCore(RhinoDoc doc, FigcadConfig cfg, double ox, double oy)
        {
            var r = new CurveLaneResult();
            // 기존 level/type id 재사용 (커브 레인은 create_type 불필요 — 벽 축선/슬라브 스케치용)
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
            foreach (var o in doc.Objects)
            {
                if (!string.IsNullOrEmpty(o.Attributes.GetUserString(IdKey))) continue; // Figcad 소유 = 스킵
                var crv = o.Geometry as Curve;
                if (crv == null) { r.Skipped++; continue; } // brep/mesh = 브렙 레인 소관
                int li = o.Attributes.LayerIndex;
                if (li == axisL && levelId != null && wallTypeId != null)
                {
                    var p0 = crv.PointAtStart; var p1 = crv.PointAtEnd;
                    if (p0.DistanceTo(p1) < 1) { r.Skipped++; continue; }
                    ops.Add("{\"op\":\"create_wall\",\"args\":{\"levelId\":\"" + levelId + "\",\"typeId\":\"" + wallTypeId +
                            "\",\"a\":[" + R(p0.X - ox) + "," + R(p0.Y - oy) + "],\"b\":[" + R(p1.X - ox) + "," + R(p1.Y - oy) + "]}}");
                    pushed.Add(o.Id);
                    r.NWall++;
                }
                else if (li == slabL && levelId != null && slabTypeId != null)
                {
                    Polyline poly;
                    if (!crv.TryGetPolyline(out poly)) { r.Skipped++; continue; }
                    var pts = new List<Point3d>(poly);
                    if (pts.Count > 1 && pts[0].DistanceTo(pts[pts.Count - 1]) < 1) pts.RemoveAt(pts.Count - 1);
                    if (pts.Count < 3) { r.Skipped++; continue; }
                    var sb = new StringBuilder("[");
                    for (int i = 0; i < pts.Count; i++) { if (i > 0) sb.Append(","); sb.Append("[" + R(pts[i].X - ox) + "," + R(pts[i].Y - oy) + "]"); }
                    sb.Append("]");
                    ops.Add("{\"op\":\"create_slab\",\"args\":{\"levelId\":\"" + levelId + "\",\"typeId\":\"" + slabTypeId + "\",\"boundary\":" + sb + "}}");
                    pushed.Add(o.Id);
                    r.NSlab++;
                }
                else r.Skipped++;
            }
            if (ops.Count == 0) return r;

            var outc = PostOps(cfg, ops, false);
            r.Applied = outc.Applied; r.Failed = outc.Failed;
            // createdIds writeback: pushed[i] ← created[i] (다음 Pull 무중복의 핵심).
            // 정렬은 create_* op이 op당 정확히 id 1개를 내고 실패 0일 때만 보장 — 실패 시 스킵(재-Pull로 화해).
            if (outc.Failed == 0)
            {
                for (int i = 0; i < pushed.Count && i < outc.CreatedIds.Count; i++)
                {
                    var ob = doc.Objects.FindId(pushed[i]);
                    if (ob == null) continue;
                    ob.Attributes.SetUserString(IdKey, outc.CreatedIds[i]);
                    ob.CommitChanges();
                }
            }
            else r.WritebackHeld = true;
            return r;
        }

        // 레거시 커브 전용 Push (FigcadPush 명령은 v0.4부터 PushAll — 이건 스크립트 하위호환).
        // origin 0,0 = 종전 raw 좌표 거동 그대로(하위호환) — origin 정렬 푸시가 필요하면 PushAll 사용.
        public static string Push(RhinoDoc doc, FigcadConfig cfg)
        {
            var r = PushCurvesCore(doc, cfg, 0, 0);
            if (r.NWall + r.NSlab == 0) return "Push: 보낼 Rhino 작도 커브 없음 (스킵 " + r.Skipped + ")";
            return "Push(커브): 벽 " + r.NWall + " · 슬라브 " + r.NSlab + " · 적용 " + r.Applied + " · 실패 " + r.Failed +
                   " · 스킵 " + r.Skipped + (r.WritebackHeld ? " (실패로 writeback 보류)" : "");
        }

        // ===== v0.4 Push 통합 — 커브 레인 + 브렙 리프트 + Lane-2 + 통합 충실도 보고 1장 =====
        public static string PushAll(RhinoDoc doc, FigcadConfig cfg, FigcadLayerMap map) => PushAll(doc, cfg, map, 0.03);

        public static string PushAll(RhinoDoc doc, FigcadConfig cfg, FigcadLayerMap map, double volTolFraction)
        {
            // origin 1회 해석(전체 모델 extent) + 1회 POST → 두 레인이 *같은* origin을 차감.
            // 종전엔 커브 레인=raw · 브렙 레인=recenter라 측량좌표 모델에서 커브 요소만 +origin 오프셋(비대칭 버그).
            double ox, oy;
            ResolvePushOrigin(doc, cfg, out ox, out oy);
            var cv = PushCurvesCore(doc, cfg, ox, oy);
            var br = PushBrepsCore(doc, cfg, map, volTolFraction, ox, oy);
            if (br.Error != null)
                return "Push: " + br.Error + (cv.NWall + cv.NSlab > 0 ? " ([커브] 벽" + cv.NWall + "·슬라브" + cv.NSlab + "는 전송됨)" : "");
            string curvePart = "[커브] 벽" + cv.NWall + "·슬라브" + cv.NSlab + (cv.Failed > 0 ? "(실패" + cv.Failed + ")" : "");
            return "Push 충실도 보고: " + curvePart + " | [브렙] " + BrepReport(br);
        }

        // PushAll 공용 projectOrigin 해석 — 룸 기존 origin 재사용(GET ?op=origin), 없으면 *전체 모델*
        // (figcad 미소유 커브+브렙+메시+블록) extent min corner에서 산출해 1회 POST. 브렙 레인
        // ClassifyForPush의 origin 로직과 같은 규약(min corner·mm round) — 커브만 있는 모델도 커버.
        static void ResolvePushOrigin(RhinoDoc doc, FigcadConfig cfg, out double ox, out double oy)
        {
            ox = 0; oy = 0;
            try
            {
                var ob = Http.GetStringAsync(Url(cfg, "origin")).GetAwaiter().GetResult();
                var od = (Dictionary<string, object>)Json.Parse(ob);
                if (od.ContainsKey("origin") && od["origin"] is List<object> ol && ol.Count == 2) { ox = D(ol[0]); oy = D(ol[1]); }
            }
            catch { }
            if (ox != 0 || oy != 0) return; // 기존 origin 재사용(재POST 없음)
            var bb = BoundingBox.Empty;
            foreach (var o in doc.Objects)
            {
                if (!string.IsNullOrEmpty(o.Attributes.GetUserString(IdKey))) continue;
                var g = o.Geometry;
                if (g == null) continue;
                if (!(g is Curve || g is Brep || g is Extrusion || g is Mesh || o is InstanceObject)) continue;
                BoundingBox b;
                try { b = g.GetBoundingBox(true); } catch { continue; }
                if (b.IsValid) bb.Union(b);
            }
            if (!bb.IsValid) return;
            ox = Math.Round(bb.Min.X); oy = Math.Round(bb.Min.Y);
            if (ox != 0 || oy != 0)
            {
                var setc = new StringContent("{\"x\":" + R(ox) + ",\"y\":" + R(oy) + "}", Encoding.UTF8, "application/json");
                try { Http.PostAsync(Url(cfg, "origin"), setc).GetAwaiter().GetResult(); } catch { }
            }
        }

        // ===== 브렙 레인 (M13-G → v0.4 형상충실 리프트) =====
        // 분류(ClassifyForPush) → 타입 2단계 POST-B → 요소 POST-C(&dedup=1) → Lane-2 잔여 오버레이.
        class BrepLaneResult
        {
            public PushClassification C;
            public int Applied, Failed, Deduped, TypesNew, TypesReused, DroppedNoType;
            public bool OldServer;
            public string Lane2Note = "";
            public string Error; // 선행 실패(레벨 없음 등)
        }

        // 레거시(PushBreps 별칭) 경로 — origin은 종전대로 ClassifyForPush가 자체 해석·POST.
        static BrepLaneResult PushBrepsCore(RhinoDoc doc, FigcadConfig cfg, FigcadLayerMap map, double volTolFraction) =>
            PushBrepsCore(doc, cfg, map, volTolFraction, double.NaN, double.NaN);

        // presetOx/presetOy = PushAll이 이미 해석·POST한 origin(NaN = 미지정) — 두 번째 origin POST 금지.
        static BrepLaneResult PushBrepsCore(RhinoDoc doc, FigcadConfig cfg, FigcadLayerMap map, double volTolFraction, double presetOx, double presetOy)
        {
            var r = new BrepLaneResult();
            var c = ClassifyForPush(doc, cfg, map, true, volTolFraction, presetOx, presetOy); // setOrigin=true — recenter offset 기억(Pull 복원용)
            r.C = c;
            if (!c.HasLevel) { r.Error = "룸에 레벨 없음 (Figcad 앱이 먼저 시드해야 함)"; return r; }

            // --- POST-B: 타입 해석 — 스냅샷 canonical key 매치 우선, 미매치만 create_type ---
            // 단일 POST placeholder 리맵을 안 쓰는 이유: dedup 콘텐츠키가 리맵 *전* 계산 + 배치 분할 시 placeholder 좌초.
            var typeIds = new Dictionary<string, string>();
            var toCreate = new List<string>(); // full key ("kind|섹션키") 순서 보존 — createdIds op-order 매핑
            foreach (var kv in c.TypeNeeds)
            {
                string tid;
                if (c.ExistingTypeIds.TryGetValue(kv.Key, out tid)) { typeIds[kv.Key] = tid; r.TypesReused++; }
                else toCreate.Add(kv.Key);
            }
            if (toCreate.Count > 0)
            {
                var typeOps = new List<string>();
                foreach (var k in toCreate) typeOps.Add(c.TypeNeeds[k].OpJson);
                var outB = PostOps(cfg, typeOps, false); // create_type은 서버가 절대 dedup 안 함 — 커넥터가 위에서 키 매치로 dedup
                if (outB.Applied == 0 && outB.Failed >= toCreate.Count &&
                    outB.FirstError != null && outB.FirstError.Contains("unknown op"))
                {
                    // 구서버 폴백: create_type 미지원 → 기존 first-type-of-kind 근사 + 보고 명시
                    r.OldServer = true;
                    foreach (var k in toCreate)
                    {
                        string tid;
                        if (c.FirstTypeOfKind.TryGetValue(c.TypeNeeds[k].Kind, out tid)) typeIds[k] = tid;
                    }
                }
                else if (outB.Failed == 0)
                {
                    // createdIds = op 순서(전수 성공일 때만 정렬 보장) → key→typeId
                    for (int i = 0; i < toCreate.Count && i < outB.CreatedIds.Count; i++) typeIds[toCreate[i]] = outB.CreatedIds[i];
                    r.TypesNew = outB.CreatedIds.Count;
                }
                else
                {
                    // 부분 실패 — 순서 매핑 불가 → 스냅샷 재조회로 key 매치(성공분은 이제 스냅샷에 있음)
                    try
                    {
                        string body2 = Http.GetStringAsync(Url(cfg, "pull")).GetAwaiter().GetResult();
                        var snap2 = (Dictionary<string, object>)Json.Parse(body2);
                        foreach (Dictionary<string, object> t in (List<object>)snap2["types"])
                        {
                            string key2 = TypeKeyOf(t);
                            if (key2 == null) continue;
                            string full = (string)t["kind"] + "|" + key2;
                            if (!typeIds.ContainsKey(full)) typeIds[full] = (string)t["id"];
                        }
                    }
                    catch { }
                    r.TypesNew = outB.Applied;
                }
            }

            // --- POST-C: 요소 ops — {TYPEID} 치환 + &dedup=1(재푸시 정확중첩 차단) ---
            var elOps = new List<string>();
            foreach (var op in c.Ops)
            {
                if (op.TypeKey == null) { elOps.Add(op.JsonTemplate); continue; }
                string tid;
                if (typeIds.TryGetValue(op.TypeKey, out tid)) elOps.Add(op.JsonTemplate.Replace("{TYPEID}", tid));
                else r.DroppedNoType++; // 타입 생성 실패분 — 조용히 근사하지 않고 드롭 카운트
            }
            if (elOps.Count > 0)
            {
                var outC = PostOps(cfg, elOps, true);
                r.Applied = outC.Applied; r.Failed = outC.Failed; r.Deduped = outC.Deduped;
            }

            // --- Lane-2 잔여 통과(자유곡면·기울·열린brep·메시) — 버리지 않고 오버레이(§9.3) ---
            if (c.Residuals.Count > 0)
            {
                try { r.Lane2Note = " → " + RegisterResiduals(doc, cfg, c.Residuals); }
                catch (Exception e) { r.Lane2Note = " → 오버레이 등록 실패(" + e.Message + ")"; }
            }
            else
            {
                // 잔여 0 = fed-register(replace='lane2') 미실행 → 이전 푸시의 Lane-2 오버레이가 있으면 그대로
                // 남음(stale). 빈 파일 업로드로 교체하는 건 서버 거동 미검증이라 안 함 — 정직하게 보고만.
                r.Lane2Note = " → 잔여 0 — 이전 Lane-2 오버레이가 있으면 수동 삭제 필요";
            }
            return r;
        }

        static string FmtReasons(Dictionary<string, int> d)
        {
            if (d == null || d.Count == 0) return "";
            var parts = new List<string>();
            foreach (var kv in d) parts.Add(kv.Key + kv.Value);
            return "(" + string.Join("·", parts) + ")";
        }

        // 통합 충실도 보고의 [브렙] 파트 — 계획 포맷:
        // 기둥a·벽b·슬라브c·보d (타입 신규t·재사용u) · 근사x(...) · Lane-2 잔여k(...) · 중복스킵dd
        static string BrepReport(BrepLaneResult r)
        {
            var c = r.C;
            var sb = new StringBuilder();
            sb.Append("기둥" + c.NCol + "·벽" + c.NWall + "·슬라브" + c.NSlab + "·보" + c.NBeam);
            if (c.NStair > 0 || c.NRail > 0) sb.Append("·계단" + c.NStair + "·난간" + c.NRail);
            sb.Append(" (타입 신규" + r.TypesNew + "·재사용" + r.TypesReused + ")");
            sb.Append(" · 근사" + c.NApprox + FmtReasons(c.ApproxReasons));
            sb.Append(" · Lane-2 잔여" + c.NResidual + FmtReasons(c.Lane2Reasons));
            sb.Append(" · 중복스킵" + r.Deduped);
            sb.Append(" · 적용" + r.Applied + "·실패" + r.Failed);
            if (r.DroppedNoType > 0) sb.Append(" · 타입미해석 드롭" + r.DroppedNoType);
            if (c.NSkippedOther > 0) sb.Append(" · 기타스킵" + c.NSkippedOther);
            if (r.OldServer) sb.Append(" · 서버 구버전 — 단면 타입 생성 불가(기존 타입 근사)");
            sb.Append(r.Lane2Note);
            return sb.ToString();
        }

        // 레거시 별칭 — FigcadPush(PushAll)로 통합됨. 브렙 레인만 실행(모드B 클린업 등 하위호환).
        public static string PushBreps(RhinoDoc doc, FigcadConfig cfg) => PushBreps(doc, cfg, null);

        public static string PushBreps(RhinoDoc doc, FigcadConfig cfg, FigcadLayerMap map) => PushBreps(doc, cfg, map, 0.03);

        public static string PushBreps(RhinoDoc doc, FigcadConfig cfg, FigcadLayerMap map, double volTolFraction)
        {
            var r = PushBrepsCore(doc, cfg, map, volTolFraction);
            if (r.Error != null) return "PushBreps: " + r.Error;
            if (r.C.Ops.Count == 0 && r.C.Residuals.Count == 0)
                return "PushBreps: 인식·잔여 모두 0 (수집 " + r.C.BrepCount + " — solid/메시 없음 또는 전부 figcad 소유)";
            return "PushBreps(레거시 별칭 — FigcadPush로 통합): " + BrepReport(r);
        }

        // ===== 분류기 (Preview·Push 공유 단일 소스 — preview가 리프트 결과를 못 속임) =====
        //   지오 수집(블록 재귀, 솔리드+열린brep+메시) → recenter → 레이어/객체 kind 해결 →
        //   RecognizeElement(FigcadFit)로 ops + 타입 필요목록. 미인식 = 잔여(Lane-2, *원본* 좌표 보관).
        //   setOrigin=true(Push)면 recenter offset을 룸에 POST(Pull 복원용); false(Preview)면 서버 무변경.
        public static PushClassification ClassifyForPush(RhinoDoc doc, FigcadConfig cfg, FigcadLayerMap map, bool setOrigin) =>
            ClassifyForPush(doc, cfg, map, setOrigin, 0.03);

        public static PushClassification ClassifyForPush(RhinoDoc doc, FigcadConfig cfg, FigcadLayerMap map, bool setOrigin, double volTolFraction) =>
            ClassifyForPush(doc, cfg, map, setOrigin, volTolFraction, double.NaN, double.NaN);

        // presetOx/presetOy = 호출측(PushAll)이 이미 해석·POST한 origin(NaN = 자체 해석) — 레인 간 origin 단일화.
        static PushClassification ClassifyForPush(RhinoDoc doc, FigcadConfig cfg, FigcadLayerMap map, bool setOrigin, double volTolFraction, double presetOx, double presetOy)
        {
            var result = new PushClassification();
            string snapBody = Http.GetStringAsync(Url(cfg, "pull")).GetAwaiter().GetResult();
            var snap = (Dictionary<string, object>)Json.Parse(snapBody);
            string levelId = null;
            double levelElev = 0;
            foreach (Dictionary<string, object> l in (List<object>)snap["levels"])
            {
                levelId = (string)l["id"];
                levelElev = Opt(l, "elevation", 0);
                break; // 멀티레벨 배정 = v1.5(현행 first-level)
            }
            foreach (Dictionary<string, object> t in (List<object>)snap["types"])
            {
                string k = t.ContainsKey("kind") ? (string)t["kind"] : null;
                string tid = t.ContainsKey("id") ? (string)t["id"] : null;
                if (k == null || tid == null) continue;
                if (!result.FirstTypeOfKind.ContainsKey(k)) result.FirstTypeOfKind[k] = tid;
                string key = TypeKeyOf(t);
                if (key != null && !result.ExistingTypeIds.ContainsKey(k + "|" + key)) result.ExistingTypeIds[k + "|" + key] = tid;
            }
            result.HasLevel = levelId != null;
            result.LevelId = levelId;
            result.LevelElev = levelElev;
            double tol = Math.Max(doc.ModelAbsoluteTolerance, 0.01);

            // 1) 재귀 수집: 블록 인스턴스 변환 누적 + leaf 레이어 full-path + 객체 figcad:kind + top-level id
            //    (in-block은 안정 id 없어 Empty). figcad 소유(id 스탬프됨) 스킵.
            //    v0.4: 열린 brep·메시도 수집(Lane-2 동승) — 조용한 드롭 제거. 그 외 지오는 카운트된 드롭.
            var items = new List<Collected>();
            void Collect(IEnumerable<RhinoObject> objs, Transform xf, int depth)
            {
                if (depth > 8) return;
                foreach (var o in objs)
                {
                    if (!string.IsNullOrEmpty(o.Attributes.GetUserString(IdKey))) continue;
                    var io = o as InstanceObject;
                    if (io != null) { try { Collect(io.InstanceDefinition.GetObjects(), xf * io.InstanceXform, depth + 1); } catch { } continue; }
                    string lp = (o.Attributes.LayerIndex >= 0 && o.Attributes.LayerIndex < doc.Layers.Count) ? doc.Layers[o.Attributes.LayerIndex].FullPath : "";
                    string ko = o.Attributes.GetUserString("figcad:kind");
                    Guid topId = depth == 0 ? o.Id : Guid.Empty;
                    var ex = o.Geometry as Extrusion;
                    if (ex != null)
                    {
                        var b = ex.ToBrep(); // 킹크 측면 분할은 FigcadFit.FitPrisms 내부(SplitKinkyFaces)가 처리
                        if (b == null) { result.NSkippedOther++; continue; }
                        b.Transform(xf);
                        items.Add(new Collected { B = b, Open = !b.IsSolid, Layer = lp, KindOverride = ko, Id = topId });
                        continue;
                    }
                    var bp = o.Geometry as Brep;
                    if (bp != null)
                    {
                        var b = (Brep)bp.Duplicate();
                        b.Transform(xf);
                        items.Add(new Collected { B = b, Open = !b.IsSolid, Layer = lp, KindOverride = ko, Id = topId });
                        continue;
                    }
                    var me = o.Geometry as Mesh;
                    if (me != null)
                    {
                        var m = (Mesh)me.Duplicate();
                        m.Transform(xf);
                        items.Add(new Collected { M = m, Layer = lp, KindOverride = ko, Id = topId });
                        continue;
                    }
                    if (o.Geometry is Curve) continue; // 커브 레인(PushCurvesCore) 소관 — 여기선 무카운트
                    result.NSkippedOther++; // 서피스·점·주석 등 = 카운트된 드롭
                }
            }
            Collect(doc.Objects, Transform.Identity, 0);
            result.BrepCount = items.Count;

            // 2) recenter + origin 기억 (M13 projectOrigin, Revit Base Point 패턴). 기존 origin 있으면 재사용.
            //    preset(PushAll 경로) = 전체 모델 extent로 이미 해석·POST됨 → 재해석/재POST 금지(origin 충돌 방지).
            double ox = 0, oy = 0;
            if (!double.IsNaN(presetOx)) { ox = presetOx; oy = presetOy; }
            else
            {
                try
                {
                    var ob = Http.GetStringAsync(Url(cfg, "origin")).GetAwaiter().GetResult();
                    var od = (Dictionary<string, object>)Json.Parse(ob);
                    if (od.ContainsKey("origin") && od["origin"] is List<object> ol && ol.Count == 2) { ox = D(ol[0]); oy = D(ol[1]); }
                }
                catch { }
                if (ox == 0 && oy == 0 && items.Count > 0)
                {
                    var gbb = BoundingBox.Empty;
                    foreach (var it in items) gbb.Union(GeoOf(it).GetBoundingBox(true));
                    if (gbb.IsValid)
                    {
                        ox = Math.Round(gbb.Min.X); oy = Math.Round(gbb.Min.Y);
                        if (setOrigin && (ox != 0 || oy != 0))
                        {
                            var setc = new StringContent("{\"x\":" + R(ox) + ",\"y\":" + R(oy) + "}", Encoding.UTF8, "application/json");
                            try { Http.PostAsync(Url(cfg, "origin"), setc).GetAwaiter().GetResult(); } catch { }
                        }
                    }
                }
            }
            result.Ox = ox; result.Oy = oy;
            if (ox != 0 || oy != 0)
            {
                var shiftNeg = Transform.Translation(-ox, -oy, 0);
                foreach (var it in items) GeoOf(it).Transform(shiftNeg);
            }

            // 3) 인식 → ops. modelBB(recentered) = outlier 가드. 분류는 shift 불변(좌표·modelBB 동시 이동).
            var modelBB = BoundingBox.Empty;
            foreach (var it in items) modelBB.Union(GeoOf(it).GetBoundingBox(true));
            var shiftPos = new Vector3d(ox, oy, 0);
            var ctx = new RecoCtx
            {
                LevelId = levelId,
                LevelElev = levelElev,
                Tol = tol,
                VolTol = volTolFraction,
                SlabTypeId = result.FirstTypeOfKind.ContainsKey("slab") ? result.FirstTypeOfKind["slab"] : null,
                ModelBB = modelBB,
            };
            foreach (var it in items)
            {
                var geo = GeoOf(it);
                var rbb = geo.GetBoundingBox(true);
                var obb = (ox != 0 || oy != 0) ? new BoundingBox(rbb.Min + shiftPos, rbb.Max + shiftPos) : rbb; // *원본* 좌표 — preview용

                // 열린 brep / 메시 = 리프트 불가 → Lane-2 동승(회색 preview). 명시적 ignore만 카운트된 드롭.
                if (it.M != null || it.Open)
                {
                    if (IsExplicitIgnore(it.KindOverride, it.Layer, map)) { result.NSkippedOther++; continue; }
                    string why = it.M != null ? "메시" : "열린브렙";
                    if (it.M != null) result.NMesh++; else result.NOpenBrep++;
                    Bump(result.Lane2Reasons, why);
                    result.NResidual++;
                    if (ox != 0 || oy != 0) geo.Transform(Transform.Translation(ox, oy, 0)); // 원본 좌표 복원
                    result.Residuals.Add(geo);
                    result.Candidates.Add(new PushCandidate { Id = it.Id, Bbox = obb, Kind = null, FailReason = why });
                    continue;
                }

                string resolved = FigcadClassify.ResolveKind(it.KindOverride, it.Layer, map);
                string fail = null, bucket = null;
                RecognizedOp rec = null;
                if (levelId == null) { fail = "레벨 없음"; bucket = "기타"; }
                else if (resolved == null) { fail = "미분류(레이어)"; bucket = "미분류"; }
                else rec = RecognizeElement(it.B, resolved, FigcadClassify.IsExplicitKind(it.KindOverride, it.Layer, map), ctx, result, out fail, out bucket);

                if (rec == null)
                {
                    Bump(result.Lane2Reasons, bucket ?? "기타");
                    result.NResidual++;
                    // 잔여 = *원본* 좌표로 복원(reconciler가 -origin 재적용 → 리프트 요소와 정렬). in-place(재사용 안 함).
                    if (ox != 0 || oy != 0) it.B.Transform(Transform.Translation(ox, oy, 0));
                    result.Residuals.Add(it.B);
                    result.Candidates.Add(new PushCandidate { Id = it.Id, Bbox = obb, Kind = null, FailReason = fail });
                }
                else
                {
                    result.Ops.Add(new PushOp { Kind = rec.Kind, TypeKey = rec.TypeKey, JsonTemplate = rec.JsonTemplate });
                    if (rec.Approx) { result.NApprox++; Bump(result.ApproxReasons, rec.ApproxReason ?? rec.Kind); }
                    if (rec.Kind == "column") result.NCol++;
                    else if (rec.Kind == "wall") result.NWall++;
                    else if (rec.Kind == "slab") result.NSlab++;
                    else if (rec.Kind == "beam") result.NBeam++;
                    else if (rec.Kind == "stair") result.NStair++;
                    else if (rec.Kind == "railing") result.NRail++;
                    result.Candidates.Add(new PushCandidate
                    {
                        Id = it.Id, Bbox = obb, Kind = rec.Kind, Approx = rec.Approx,
                        FailReason = rec.Approx ? rec.ApproxReason : null,
                    });
                }
            }
            return result;
        }

        static GeometryBase GeoOf(Collected it) => it.B != null ? (GeometryBase)it.B : it.M;

        static void Bump(Dictionary<string, int> d, string k) { int v; d.TryGetValue(k, out v); d[k] = v + 1; }

        // 명시적 ignore(객체 figcad:kind 또는 레이어맵) — 열린brep/메시의 Lane-2 동승에서 제외(카운트된 드롭).
        // 솔리드 brep의 ignore는 종전대로 잔여(Lane-2) 처리(ResolveKind null 경유 — 패널 힌트와 일치).
        static bool IsExplicitIgnore(string kindOverride, string layer, FigcadLayerMap map)
        {
            if (kindOverride != null && kindOverride.Trim().ToLowerInvariant() == "ignore") return true;
            string mk;
            if (map != null && map.TryGet(layer, out mk) && mk != null && mk.Trim().ToLowerInvariant() == "ignore") return true;
            return false;
        }

        // ===== v0.4 RecognizeElement — kind=레이어(불변), 파라미터=FigcadFit 실측 =====
        sealed class RecoCtx
        {
            public string LevelId;
            public double LevelElev; // 첫 레벨 elevation — baseOffset/zOffset 레벨 상대화
            public double Tol;
            public double VolTol;    // CheckFidelity 임계(패널 1~10%)
            public string SlabTypeId; // stair/railing 시드 타입은 v0.5 파라메트릭 전환으로 소멸
            public BoundingBox ModelBB;
        }

        sealed class RecognizedOp
        {
            public string Kind;
            public string TypeKey;      // "kind|섹션키" (column/beam/wall) — null = typeId 완성됨
            public string JsonTemplate; // {TYPEID} 토큰 포함 가능
            public bool Approx;
            public string ApproxReason;
        }

        // Brep 1개 인식. null 반환 = Lane-2(fail=상세 사유, bucket=보고 집계 키).
        // "조용히 근사 금지": 단면 분류/각도 게이트/부피 게이트 실패는 bbox 폴백 없이 Lane-2.
        // explicitKind = 사용자가 figcad:kind/레이어맵으로 명시 지정 → 타당성 *상한*만 스킵
        // (기하 유효성 게이트 — 프리즘·aspect·부피 — 는 명시 지정도 통과 못 하면 Lane-2).
        static RecognizedOp RecognizeElement(Brep b, string kind, bool explicitKind, RecoCtx ctx, PushClassification result, out string fail, out string bucket)
        {
            fail = null; bucket = null;
            var bb = b.GetBoundingBox(true);
            if (!bb.IsValid) { fail = "bbox 무효"; bucket = "기타"; return null; }
            double cx = (bb.Min.X + bb.Max.X) / 2, cy = (bb.Min.Y + bb.Max.Y) / 2;
            // outlier 가드 — 인식 좌표가 모델 bbox 밖(±1m)이면 잔여
            if (ctx.ModelBB.IsValid && (cx < ctx.ModelBB.Min.X - 1000 || cx > ctx.ModelBB.Max.X + 1000 ||
                                        cy < ctx.ModelBB.Min.Y - 1000 || cy > ctx.ModelBB.Max.Y + 1000))
            { fail = "outlier(모델 bbox 밖)"; bucket = "outlier"; return null; }

            // 계단/난간 — v0.5 파라메트릭 리프트. 난간 = 실측 높이로 create_type(시드 불필요).
            // 계단 = tread 검출(상향 수평면 z-클러스터·등간격·직선 진행) → width+riser 타입 + 실주행축 a/b.
            // 검출 실패(곡선·나선·비정형) = 종전 bbox 근사 폴백(시드 타입 필요). baseOffset = 레벨 상대.
            if (kind == "stair" || kind == "railing")
            {
                double dxx = bb.Max.X - bb.Min.X, dyy = bb.Max.Y - bb.Min.Y;
                bool xl = dxx >= dyy; // 수평 장축(폴백·난간 축)
                double rax = xl ? bb.Min.X : cx, ray = xl ? cy : bb.Min.Y;
                double rbx = xl ? bb.Max.X : cx, rby = xl ? cy : bb.Max.Y;
                string baseOffJson = ",\"baseOffset\":" + R(bb.Min.Z - ctx.LevelElev);

                if (kind == "railing")
                {
                    int h = (int)Math.Round(bb.Max.Z - bb.Min.Z);
                    if (h < 1) { fail = "난간 높이 0(퇴화)"; bucket = "기타"; return null; }
                    string rkey = "h:" + h;
                    RegisterTypeNeed(result, "railing", rkey, "R-" + h, "\"height\":" + h + ",\"postSpacing\":1200");
                    string rjson = "{\"op\":\"create_railing\",\"args\":{\"levelId\":\"" + ctx.LevelId + "\",\"typeId\":\"{TYPEID}\",\"a\":[" +
                        R(rax) + "," + R(ray) + "],\"b\":[" + R(rbx) + "," + R(rby) + "]" + baseOffJson + "}}";
                    return new RecognizedOp { Kind = "railing", TypeKey = "railing|" + rkey, JsonTemplate = rjson, Approx = true, ApproxReason = "난간(축bbox·포스트근사)" };
                }

                var sf = TryStairFit(b, ctx.Tol);
                if (sf != null)
                {
                    string skey = "w:" + sf.Width + "r:" + sf.Riser;
                    RegisterTypeNeed(result, "stair", skey, "ST-" + sf.Width, "\"width\":" + sf.Width + ",\"riser\":" + sf.Riser);
                    // rise = 실측 총상승 — v0.6 core가 노출(종전 "층고 고정" 근사 해소). 구서버 = 조용히 무시.
                    string sjson = "{\"op\":\"create_stair\",\"args\":{\"levelId\":\"" + ctx.LevelId + "\",\"typeId\":\"{TYPEID}\",\"a\":[" +
                        R(sf.Ax) + "," + R(sf.Ay) + "],\"b\":[" + R(sf.Bx) + "," + R(sf.By) + "]" + baseOffJson +
                        (sf.Rise >= 1 ? ",\"rise\":" + R(sf.Rise) : "") + "}}";
                    return new RecognizedOp { Kind = "stair", TypeKey = "stair|" + skey, JsonTemplate = sjson, Approx = true, ApproxReason = "계단(파라)" };
                }

                // 이형(곡선·꺾임·쐐기·객석) = bbox 근사 리프트 대신 Lane-2 오버레이(원본 메시 = 시각 100%).
                // 가짜 직선 계단이 "실형상과 너무 다름"(사용자 피드백) — 정직 잔여가 낫다.
                fail = "계단 이형(직선 검출 실패) → 오버레이"; bucket = "계단이형"; return null;
            }

            // 이하 = FitPrisms 기반 (column/beam/wall/slab)
            var fits = FigcadFit.FitPrisms(b, ctx.Tol);
            var valid = new List<PrismFit>();
            foreach (var f in fits) if (f.Valid) valid.Add(f);
            if (valid.Count == 0)
            {
                fail = "프리즘 아님: " + (fits.Count > 0 ? fits[0].FailReason : "?");
                bucket = "자유곡면";
                return null;
            }

            if (kind == "column")
            {
                var fit = MostVertical(valid);
                if (fit == null) { fail = "기울음(수직 프리즘축 없음)"; bucket = "기울"; return null; }
                double atx = (fit.Axis.From.X + fit.Axis.To.X) / 2, aty = (fit.Axis.From.Y + fit.Axis.To.Y) / 2;
                var frame = FigcadFit.ColumnSectionFrame(new Point3d(atx, aty, 0)); // 기둥 = 월드 XY 고정
                // 상한 게이트 = 핏 *이전* raw pts bbox(보 분기와 동일 지점·동일 측정) — 저렴한 검사 먼저 +
                // 두 분기의 게이트 측정 단일화(사후 명명치수 게이트는 필렛 sharpen 편차로 kind별 불일치 유발).
                var cpts = FigcadFit.ToSectionPts(fit, frame);
                double cw, cd;
                PtsExtent(cpts, out cw, out cd);
                if (!explicitKind && Math.Max(cw, cd) > ColumnDimMax)
                { fail = "단면 과대(기둥 " + F(Math.Max(cw, cd)) + "mm > " + F(ColumnDimMax) + ")"; bucket = "단면과대"; return null; }
                var sec = FitSectionWithFidelity(fit, frame, cpts, ctx, out fail);
                if (sec == null) { bucket = fail != null && fail.StartsWith("부피") ? "부피" : "단면"; return null; }
                string key, name;
                if (!SectionTypeKey(sec, kind, out key, out name)) { fail = "단면 키 생성 실패"; bucket = "단면"; return null; }
                RegisterTypeNeed(result, kind, key, name, "\"section\":" + SectionJson(sec));
                double baseOff = Math.Min(fit.Axis.From.Z, fit.Axis.To.Z) - ctx.LevelElev; // 레벨 상대(raw Z 버그 수정)
                // create_column capability가 baseOffset 수용(v0.4 core에서 노출). 구서버는 인자를
                // 조용히 무시(z=elevation 배치) — create_type 구버전 폴백과 같은 세대 이슈라 별도 플래그 없음.
                string json = "{\"op\":\"create_column\",\"args\":{\"levelId\":\"" + ctx.LevelId + "\",\"typeId\":\"{TYPEID}\",\"at\":[" +
                    R(atx) + "," + R(aty) + "]" + (R(baseOff) != "0" ? ",\"baseOffset\":" + R(baseOff) : "") +
                    ",\"height\":" + R(fit.Length) + "}}";
                return new RecognizedOp { Kind = "column", TypeKey = kind + "|" + key, JsonTemplate = json };
            }

            if (kind == "beam")
            {
                // 수평 후보(|û·Z| < sin2°)를 길이 내림차순으로. 경사 보(평행육면체)는 좌우면 cap쌍이
                // *수평* 축(거대 평행사변 단면)으로 통과해 부피 게이트까지 속임(MCP 스모크 실증) →
                // aspect 가드: 축 길이 > 단면 bbox 최대변 필수. 통과 후보 없음 = Lane-2 "기운 보".
                var horiz = new List<PrismFit>();
                foreach (var f in valid)
                {
                    var u = f.Axis.Direction; u.Unitize();
                    if (Math.Abs(u.Z) < Sin2Deg) horiz.Add(f);
                }
                horiz.Sort((x, y) => y.Length.CompareTo(x.Length));
                string ovFail = null, stubFail = null; // 기각 사유 — 스킵 지점서 기록(사후 재구성 금지)
                foreach (var fit in horiz)
                {
                    var frame = FigcadFit.BeamSectionFrame(fit.Axis.From, fit.Axis.To);
                    if (!frame.IsValid) continue;
                    var pts = FigcadFit.ToSectionPts(fit, frame);
                    if (pts.Count == 0) continue;
                    double secW, secD;
                    PtsExtent(pts, out secW, out secD);
                    double secMax = Math.Max(secW, secD);
                    if (!explicitKind && (secW > BeamWidthMax || secD > BeamDepthMax))
                    {
                        // 기운 보(평행육면체)의 측면 cap쌍도 여기 걸림(거대 평행사변 단면) — 판/덩어리와 구분 불가라 병기.
                        if (ovFail == null) ovFail = "단면 과대(보 " + F(secW) + "×" + F(secD) + "mm > " +
                            F(BeamWidthMax) + "×" + F(BeamDepthMax) + " — 판·기운 보·덩어리)";
                        continue;
                    }
                    if (fit.Length <= secMax + AspectEps)
                    {
                        if (stubFail == null) stubFail = "스텁/입방(축길이 " + F(fit.Length) + " ≤ 단면최대변 " + F(secMax) + ")";
                        continue; // aspect 가드
                    }
                    var sec = FitSectionWithFidelity(fit, frame, pts, ctx, out fail);
                    if (sec == null) { bucket = fail != null && fail.StartsWith("부피") ? "부피" : "단면"; return null; }
                    string key, name;
                    if (!SectionTypeKey(sec, kind, out key, out name)) { fail = "단면 키 생성 실패"; bucket = "단면"; return null; }
                    RegisterTypeNeed(result, kind, key, name, "\"section\":" + SectionJson(sec));
                    double zOff = (fit.Axis.From.Z + fit.Axis.To.Z) / 2 - ctx.LevelElev; // 레벨 상대 중심축(core deriveBeam)
                    // a/b = 실축 평면 투영 — 대각 보존(축정렬 스냅 금지)
                    string json = "{\"op\":\"create_beam\",\"args\":{\"levelId\":\"" + ctx.LevelId + "\",\"typeId\":\"{TYPEID}\",\"a\":[" +
                        R(fit.Axis.From.X) + "," + R(fit.Axis.From.Y) + "],\"b\":[" + R(fit.Axis.To.X) + "," + R(fit.Axis.To.Y) +
                        "],\"zOffset\":" + R(zOff) + "}}";
                    return new RecognizedOp { Kind = "beam", TypeKey = kind + "|" + key, JsonTemplate = json };
                }
                if (ovFail != null) { fail = ovFail; bucket = "단면과대"; }
                else if (stubFail != null) { fail = stubFail; bucket = "스텁"; }
                else { fail = "기운 보(수평 축후보 없음)"; bucket = "기울보"; }
                return null;
            }

            if (kind == "wall")
            {
                var fit = MostVertical(valid);
                if (fit == null) { fail = "기울음(수직 프리즘축 없음)"; bucket = "기울"; return null; }
                double wax, way, wbx, wby, th, planArea;
                if (!TryWallPlanRect(fit.Profile3D, ctx.Tol, out wax, out way, out wbx, out wby, out th, out planArea))
                { fail = "벽 평면 비직사각(wall-nonrect)"; bucket = "벽비정형"; return null; }
                if (!explicitKind && th > WallThickMax) { fail = "두께 과대(벽 " + F(th) + "mm > " + F(WallThickMax) + ")"; bucket = "두께과대"; return null; }
                if (!FigcadFit.CheckFidelity(fit, planArea, ctx.VolTol))
                { fail = "부피 불일치(벽 rect 재구성)"; bucket = "부피"; return null; }
                int thMm = (int)Math.Max(1, Math.Round(th));
                string key = "t:" + thMm;
                RegisterTypeNeed(result, "wall", key, "W-" + thMm, "\"thickness\":" + thMm);
                double baseOff = Math.Min(fit.Axis.From.Z, fit.Axis.To.Z) - ctx.LevelElev; // 레벨 상대
                string json = "{\"op\":\"create_wall\",\"args\":{\"levelId\":\"" + ctx.LevelId + "\",\"typeId\":\"{TYPEID}\",\"a\":[" +
                    R(wax) + "," + R(way) + "],\"b\":[" + R(wbx) + "," + R(wby) + "],\"height\":" + R(fit.Length) +
                    (R(baseOff) != "0" ? ",\"baseOffset\":" + R(baseOff) : "") + "}}"; // create_wall이 baseOffset 수용(v0.4 core)
                return new RecognizedOp { Kind = "wall", TypeKey = "wall|" + key, JsonTemplate = json };
            }

            if (kind == "slab")
            {
                if (ctx.SlabTypeId == null) { fail = "슬라브 타입 없음(룸 시드 필요)"; bucket = "타입없음"; return null; }
                var fit = MostVertical(valid);
                if (fit == null) { fail = "기울음(수직 프리즘축 없음)"; bucket = "기울"; return null; }
                // boundary = cap 외곽 평면 정점(기존 거동) — 반올림 후 연속 중복 제거
                var ring = new List<double[]>();
                foreach (var p in fit.Profile3D)
                {
                    double px = Math.Round(p.X), py = Math.Round(p.Y);
                    if (ring.Count > 0 && ring[ring.Count - 1][0] == px && ring[ring.Count - 1][1] == py) continue;
                    ring.Add(new[] { px, py });
                }
                if (ring.Count > 1 && ring[0][0] == ring[ring.Count - 1][0] && ring[0][1] == ring[ring.Count - 1][1])
                    ring.RemoveAt(ring.Count - 1);
                if (ring.Count < 3) { fail = "슬라브 외곽 3점 미만"; bucket = "단면"; return null; }
                // 개구(inner loop) 감지 — 외곽 폴리곤 면적 > 트림 cap 면적이면 "개구 무시" 근사(외곽 유지+카운트,
                // 통째 Lane-2 안 함 — 계획의 예외 정책). 부피 충실은 FitPrisms 내부 게이트(트림 면적 기준)가 이미 봄.
                double outerArea = Math.Abs(Shoelace2(ring));
                bool holes = fit.CapArea > 0 && outerArea > fit.CapArea * 1.01;
                var sb = new StringBuilder("[");
                for (int i = 0; i < ring.Count; i++) { if (i > 0) sb.Append(","); sb.Append("[" + R(ring[i][0]) + "," + R(ring[i][1]) + "]"); }
                sb.Append("]");
                // zOffset = 상면 실측 z(레벨 상대) — v0.6 core가 노출(종전 "슬라브z 유실" 근사 해소).
                // 구서버는 인자 조용히 무시(상면=레벨) — create_type 폴백과 같은 세대 이슈.
                double topZ = Math.Max(fit.Axis.From.Z, fit.Axis.To.Z);
                double zOff = topZ - ctx.LevelElev;
                // thicknessOverride = 프리즘 길이(실측) — 종전 "타입 두께 무시" 버그 수정 (create_slab이 노출)
                string json = "{\"op\":\"create_slab\",\"args\":{\"levelId\":\"" + ctx.LevelId + "\",\"typeId\":\"" + ctx.SlabTypeId +
                    "\",\"boundary\":" + sb + ",\"thicknessOverride\":" + R(fit.Length) +
                    ",\"zOffset\":" + R(zOff) + "}}"; // 0 포함 무조건 방출 — "z 실측됨" 신호(충실도 리포트 오발 방지)
                return new RecognizedOp { Kind = "slab", JsonTemplate = json, Approx = holes, ApproxReason = holes ? "슬라브개구" : null };
            }

            fail = "미지원 kind: " + kind; bucket = "기타"; return null;
        }

        // 직선 계단 피팅 결과 — 주행축 끝점(a=하단→b=상단)·폭·단높이·실측 총상승.
        sealed class StairFit
        {
            public double Ax, Ay, Bx, By;
            public int Width, Riser;
            public double Rise;
        }

        // 직선 계단 파라미터 추출. 상향 수평 tread 면 → z-클러스터(면적가중 도심) → 등간격 단높이 +
        // 선형 진행(역행/과이탈 기각) 검증 → 주행축 a/b(bbox 투영)·폭. null = 비계단형 → bbox 폴백.
        static StairFit TryStairFit(Brep b, double tol)
        {
            var dup = b.DuplicateBrep(); // 프로파일 압출은 측면이 킹크 단일면(FitPrisms와 동일) → 분할 필수
            dup.Faces.SplitKinkyFaces(Rhino.RhinoMath.DefaultAngleTolerance, true);
            var tz = new List<double>(); var tc = new List<Point3d>(); var ta = new List<double>();
            for (int i = 0; i < dup.Faces.Count; i++)
            {
                var f = dup.Faces[i];
                var s = f.UnderlyingSurface();
                Plane pl;
                if (s == null || !s.TryGetPlane(out pl, tol)) continue;
                var n = pl.Normal; n.Unitize();
                if (f.OrientationIsReversed) n.Reverse();
                if (n.Z < 0.999) continue; // 상향 수평(tread)만
                var amp = AreaMassProperties.Compute(f.DuplicateFace(false)); // 트림 존중(FitPrisms 함정과 동일)
                if (amp == null || amp.Area <= 0) continue;
                tz.Add(amp.Centroid.Z); tc.Add(amp.Centroid); ta.Add(amp.Area);
            }
            if (tz.Count < 3) return null;

            var idx = new List<int>();
            for (int i = 0; i < tz.Count; i++) idx.Add(i);
            idx.Sort((x, y) => tz[x].CompareTo(tz[y]));

            // z-클러스터 (같은 단의 쪼개진 면 병합) — 면적 가중 도심
            double clusterTol = Math.Max(tol * 5, 5.0);
            var cz = new List<double>(); var cc = new List<Point3d>(); var ca = new List<double>();
            double aSum = 0, zSum = 0, xSum = 0, ySum = 0, prevZ = double.NaN;
            void Flush()
            {
                if (aSum > 0) { cz.Add(zSum / aSum); cc.Add(new Point3d(xSum / aSum, ySum / aSum, zSum / aSum)); ca.Add(aSum); }
                aSum = 0; zSum = 0; xSum = 0; ySum = 0;
            }
            foreach (var i in idx)
            {
                if (!double.IsNaN(prevZ) && tz[i] - prevZ > clusterTol) Flush();
                aSum += ta[i]; zSum += tz[i] * ta[i]; xSum += tc[i].X * ta[i]; ySum += tc[i].Y * ta[i];
                prevZ = tz[i];
            }
            Flush();
            int nc = cz.Count;
            if (nc < 3) return null;

            // 등간격 단높이 (실무 범위 50~400mm, 편차 max(5mm, 20%) 이내)
            double riser = (cz[nc - 1] - cz[0]) / (nc - 1);
            if (riser < 50 || riser > 400) return null;
            for (int i = 1; i < nc; i++)
                if (Math.Abs((cz[i] - cz[i - 1]) - riser) > Math.Max(5.0, riser * 0.2)) return null;

            // 직선 진행 — 최저→최고 tread 방향, 각 tread 투영 단조증가 + 측방 이탈 폭 이내
            double dx = cc[nc - 1].X - cc[0].X, dy = cc[nc - 1].Y - cc[0].Y;
            double runLen = Math.Sqrt(dx * dx + dy * dy);
            if (runLen < riser) return null; // 수직 퇴화(주행 없음)
            double ux = dx / runLen, uy = dy / runLen;
            double prevS = double.NegativeInfinity, maxLat = 0;
            foreach (var c in cc)
            {
                double sx = c.X - cc[0].X, sy = c.Y - cc[0].Y;
                double sp = sx * ux + sy * uy;
                double lat = Math.Abs(-sx * uy + sy * ux);
                if (sp < prevS - 1) return null; // 역행 = 꺾임/나선
                if (lat > maxLat) maxLat = lat;
                prevS = sp;
            }

            if (maxLat > Math.Max(runLen / 10, 100)) return null; // 도심 측방 이탈 = 꺾임/L형
            double going = runLen / (nc - 1);
            if (going < 50 || going > 600) return null; // 비현실 디딤판 = 비계단

            // 주행 프레임 oriented-extent — brep *정점 전체*를 주행축(s)/측방(l)에 투영.
            // 월드 AABB 투영(비축정렬서 부풀어 오기각)·트레드-앵커 끝점(첫/끝 단 깊이 차로 ±13cm 오차)
            // 둘 다 실측서 기각된 접근 — 정점 투영은 회전 불변 + 축정렬서 bbox와 동치(실모델 18계단 Δ0 유지).
            double sMin = double.MaxValue, sMax = double.MinValue, lMin = double.MaxValue, lMax = double.MinValue;
            foreach (var bv in b.Vertices)
            {
                var p = bv.Location;
                double sp = p.X * ux + p.Y * uy;
                double lp = -p.X * uy + p.Y * ux;
                if (sp < sMin) sMin = sp; if (sp > sMax) sMax = sp;
                if (lp < lMin) lMin = lp; if (lp > lMax) lMax = lp;
            }
            double runExt = sMax - sMin, width = lMax - lMin;
            if (runExt < 1 || width < 1) return null;
            // 면적비 자기검증 — 직선 장방 계단은 트레드 행이 풋프린트를 타일링(Σ면적 ≈ 주행×폭,
            // 실측 실계단 ≥ ~0.9). 쐐기(0.5)·사다리꼴 객석(~0.7, 51cm 오차 리프트 실측)은 기각 → bbox 폴백.
            double areaRatio = 0;
            foreach (var av in ca) areaRatio += av;
            areaRatio /= runExt * width;
            if (areaRatio < 0.8 || areaRatio > 1.25) return null;

            double lc = (lMin + lMax) / 2;
            var bb2 = b.GetBoundingBox(true);
            return new StairFit
            {
                Ax = sMin * ux - lc * uy, Ay = sMin * uy + lc * ux,
                Bx = sMax * ux - lc * uy, By = sMax * uy + lc * ux,
                Width = (int)Math.Max(1, Math.Round(width)),
                Riser = (int)Math.Max(1, Math.Round(riser)),
                Rise = cz[nc - 1] - bb2.Min.Z,
            };
        }

        // 프레임 단면점 bbox 치수 — 타당성 상한 게이트의 단일 측정(기둥·보 공용, 핏 이전 raw).
        static void PtsExtent(List<Point2d> pts, out double w, out double d)
        {
            w = 0; d = 0;
            if (pts == null || pts.Count == 0) return;
            double minX = double.MaxValue, maxX = double.MinValue, minY = double.MaxValue, maxY = double.MinValue;
            foreach (var p in pts)
            {
                if (p.X < minX) minX = p.X; if (p.X > maxX) maxX = p.X;
                if (p.Y < minY) minY = p.Y; if (p.Y > maxY) maxY = p.Y;
            }
            w = maxX - minX; d = maxY - minY;
        }

        // 게이트 메시지용 수치 — R()은 정수 반올림이라 경계값서 "1200mm > 1200" 자기모순 출력 → 0.# 유지.
        static string F(double v) => v.ToString("0.#", CultureInfo.InvariantCulture);

        // 수직 후보(|û·Z| > cos2°) 중 최수직 — column/wall/slab 공용.
        static PrismFit MostVertical(List<PrismFit> valid)
        {
            PrismFit best = null;
            double bestDot = Cos2Deg;
            foreach (var f in valid)
            {
                var u = f.Axis.Direction; u.Unitize();
                double dz = Math.Abs(u.Z);
                if (dz > bestDot) { bestDot = dz; best = f; }
            }
            return best;
        }

        // FitSection 2단 중재 — 필렛 제거 명명 단면(sharpen)이 부피 게이트에 떨어지면 충실 폴리곤으로
        // 재시도(FigcadFit allowSharpen=false 계약). 둘 다 실패 = null(fail에 사유).
        // pts = 호출측이 이미 게이트용으로 계산한 단면점 재사용(대형 폴리라인 프로파일 이중 투영 제거).
        static SectionFit FitSectionWithFidelity(PrismFit fit, Plane frame, List<Point2d> pts, RecoCtx ctx, out string fail)
        {
            fail = null;
            var sec = FigcadFit.FitSection(pts, fit.ProfileCurve, frame, ctx.Tol);
            if (sec.Shape != null && FigcadFit.CheckFidelity(fit, sec.Area, ctx.VolTol)) return sec;
            var sec2 = FigcadFit.FitSection(pts, fit.ProfileCurve, frame, ctx.Tol, false);
            if (sec2.Shape != null && FigcadFit.CheckFidelity(fit, sec2.Area, ctx.VolTol)) return sec2;
            if (sec.Shape == null && sec2.Shape == null)
                fail = "단면 분류 실패(" + (sec2.Note ?? sec.Note ?? "?") + ")";
            else
                fail = "부피 불일치(단면×길이 ≉ 실부피, tol " + (ctx.VolTol * 100).ToString("0", CultureInfo.InvariantCulture) + "%)";
            return null;
        }

        // 벽 평면 rect 피팅(임의 평면 회전 허용 — 대각 벽 지원). cap 프로파일 평면투영 → 공선 붕괴 →
        // 정확 4코너 + 대변 반평행·등장 + 직각 → 중심선 = 장변 미드라인(단변 중점 잇기), 두께 = 단변.
        // FigcadFit.FitSection rect는 프레임 축정렬 요구라 대각 벽에 못 씀 → 로컬 구현.
        static bool TryWallPlanRect(List<Point3d> profile3d, double tol,
            out double ax, out double ay, out double bx, out double by, out double thickness, out double area)
        {
            ax = ay = bx = by = thickness = area = 0;
            if (profile3d == null || profile3d.Count < 4) return false;
            double dupTol = Math.Max(tol, 0.01);
            var pts = new List<Point2d>();
            foreach (var p in profile3d)
            {
                var q = new Point2d(p.X, p.Y);
                if (pts.Count == 0 || pts[pts.Count - 1].DistanceTo(q) > dupTol) pts.Add(q);
            }
            if (pts.Count > 1 && pts[0].DistanceTo(pts[pts.Count - 1]) <= dupTol) pts.RemoveAt(pts.Count - 1);
            double eps = Math.Max(tol, 0.1); // 공선 판정 — FigcadFit.Preprocess와 동일 스케일
            bool removed = true;
            while (removed && pts.Count > 3)
            {
                removed = false;
                for (int i = 0; i < pts.Count && pts.Count > 3; i++)
                {
                    var pa = pts[(i + pts.Count - 1) % pts.Count];
                    var pm = pts[i];
                    var pc = pts[(i + 1) % pts.Count];
                    if (PerpDist2(pm, pa, pc) < eps) { pts.RemoveAt(i); removed = true; i--; }
                }
            }
            if (pts.Count != 4) return false;
            var ux = new double[4]; var uy = new double[4]; var len = new double[4];
            for (int i = 0; i < 4; i++)
            {
                double dx = pts[(i + 1) % 4].X - pts[i].X, dy = pts[(i + 1) % 4].Y - pts[i].Y;
                len[i] = Math.Sqrt(dx * dx + dy * dy);
                if (len[i] < Math.Max(tol, 1.0)) return false;
                ux[i] = dx / len[i]; uy[i] = dy / len[i];
            }
            double lenTol = Math.Max(tol * 2, 1.0);
            for (int i = 0; i < 2; i++)
            {
                int j = i + 2;
                if (ux[i] * ux[j] + uy[i] * uy[j] > -0.99996) return false; // 대변 반평행 ~0.5°
                if (Math.Abs(len[i] - len[j]) > lenTol) return false;        // 대변 등장
            }
            if (Math.Abs(ux[0] * ux[1] + uy[0] * uy[1]) > 0.0087) return false; // 직각 ±0.5°
            double l0 = (len[0] + len[2]) / 2, l1 = (len[1] + len[3]) / 2;
            area = l0 * l1;
            if (l0 >= l1)
            {
                // e0(p0→p1)/e2 = 장변, 단변 = e1(p1→p2)·e3(p3→p0) → 중심선 = 단변 중점 잇기
                thickness = l1;
                ax = (pts[3].X + pts[0].X) / 2; ay = (pts[3].Y + pts[0].Y) / 2;
                bx = (pts[1].X + pts[2].X) / 2; by = (pts[1].Y + pts[2].Y) / 2;
            }
            else
            {
                thickness = l0;
                ax = (pts[0].X + pts[1].X) / 2; ay = (pts[0].Y + pts[1].Y) / 2;
                bx = (pts[2].X + pts[3].X) / 2; by = (pts[2].Y + pts[3].Y) / 2;
            }
            return thickness >= 1;
        }

        static double PerpDist2(Point2d p, Point2d a, Point2d b)
        {
            double vx = b.X - a.X, vy = b.Y - a.Y;
            double l2 = vx * vx + vy * vy;
            if (l2 < 1e-18) return p.DistanceTo(a);
            return Math.Abs(vx * (p.Y - a.Y) - vy * (p.X - a.X)) / Math.Sqrt(l2);
        }

        static double Shoelace2(List<double[]> p)
        {
            double s = 0;
            for (int i = 0; i < p.Count; i++)
            {
                var a = p[i]; var b = p[(i + 1) % p.Count];
                s += a[0] * b[1] - b[0] * a[1];
            }
            return s / 2;
        }

        // ===== 단면 → canonical key / 이름 / JSON (타입 관리 단일 소스) =====
        // 키 규약(계획): rect r:{w}x{d} · circle c:{d} · hsection h:{w}x{d}x{tw}x{tf} ·
        // polygon p:{n}:{fnv1a} · wall t:{mm}. 전부 mm 정수 반올림 *후* 키 — 서버 quantize와 일치(재푸시 멱등).
        static bool SectionTypeKey(SectionFit s, string kind, out string key, out string name)
        {
            key = null; name = null;
            switch (s.Shape)
            {
                case "rect":
                    key = "r:" + R(s.Width) + "x" + R(s.Depth);
                    name = (kind == "beam" ? "RB-" : "C-") + R(s.Width) + "×" + R(s.Depth);
                    return true;
                case "circle":
                    key = "c:" + R(s.Diameter);
                    name = "Ø" + R(s.Diameter);
                    return true;
                case "hsection":
                    key = "h:" + R(s.Width) + "x" + R(s.Depth) + "x" + R(s.Web) + "x" + R(s.Flange);
                    name = "H-" + R(s.Depth) + "×" + R(s.Width); // 형강 관례: H-춤×폭
                    return true;
                case "polygon":
                    if (s.Points == null || s.Points.Count < 3) return false;
                    key = "p:" + s.Points.Count + ":" + Fnv1aPoints(s.Points);
                    name = "PL-" + s.Points.Count + "pt";
                    return true;
            }
            return false;
        }

        static string SectionJson(SectionFit s)
        {
            switch (s.Shape)
            {
                case "rect":
                    return "{\"shape\":\"rect\",\"width\":" + R(s.Width) + ",\"depth\":" + R(s.Depth) + "}";
                case "circle":
                    return "{\"shape\":\"circle\",\"diameter\":" + R(s.Diameter) + "}";
                case "hsection":
                    return "{\"shape\":\"hsection\",\"width\":" + R(s.Width) + ",\"depth\":" + R(s.Depth) +
                           ",\"web\":" + R(s.Web) + ",\"flange\":" + R(s.Flange) + "}";
                case "polygon":
                {
                    var sb = new StringBuilder("{\"shape\":\"polygon\",\"points\":[");
                    for (int i = 0; i < s.Points.Count; i++)
                    {
                        if (i > 0) sb.Append(",");
                        sb.Append("[" + R(s.Points[i][0]) + "," + R(s.Points[i][1]) + "]");
                    }
                    sb.Append("]}");
                    return sb.ToString();
                }
            }
            return null;
        }

        static void RegisterTypeNeed(PushClassification r, string kind, string key, string name, string argsFragment)
        {
            string full = kind + "|" + key;
            if (r.TypeNeeds.ContainsKey(full)) return;
            r.TypeNeeds[full] = new TypeNeed
            {
                Kind = kind,
                OpJson = "{\"op\":\"create_type\",\"args\":{\"kind\":\"" + kind + "\",\"name\":\"" + JStr(name) + "\"," + argsFragment + "}}",
            };
        }

        // FNV-1a 32bit — mm 정수 반올림 좌표 문자열("x,y;")에 대해. 커넥터/스냅샷 양쪽이 같은 함수 →
        // polygon 타입 키 안정성(재푸시 시 타입 매치 = create_type 0개 = 멱등).
        static string Fnv1aPoints(List<double[]> pts)
        {
            uint h = 2166136261u;
            foreach (var p in pts)
            {
                string s = R(p[0]) + "," + R(p[1]) + ";";
                foreach (char ch in s) { h ^= ch; h = unchecked(h * 16777619u); }
            }
            return h.ToString("x8");
        }

        // 스냅샷 타입 → canonical key (커넥터 단면 키와 동일 규약 — mm 정수 반올림 후).
        // wall=t:{mm} · stair=w:{}r:{} · railing=h:{} (RegisterTypeNeed 키와 반드시 일치 — 불일치 =
        // 재푸시마다 타입 재생성 → 요소 dedup 연쇄 미스, v0.5 계단 파라 도입 시 실증). slab/roof = first-type.
        static string TypeKeyOf(Dictionary<string, object> t)
        {
            string kind = t.ContainsKey("kind") ? t["kind"] as string : null;
            if (kind == "wall")
                return t.ContainsKey("thickness") && t["thickness"] != null ? "t:" + R(D(t["thickness"])) : null;
            if (kind == "stair")
                return t.ContainsKey("width") && t["width"] != null && t.ContainsKey("riser") && t["riser"] != null
                    ? "w:" + R(D(t["width"])) + "r:" + R(D(t["riser"])) : null;
            if (kind == "railing")
                return t.ContainsKey("height") && t["height"] != null ? "h:" + R(D(t["height"])) : null;
            if (kind != "column" && kind != "beam") return null;
            if (!t.ContainsKey("section") || !(t["section"] is Dictionary<string, object> sec)) return null;
            string shape = sec.ContainsKey("shape") ? sec["shape"] as string : null;
            if (shape == "rect" && sec.ContainsKey("width") && sec.ContainsKey("depth"))
                return "r:" + R(D(sec["width"])) + "x" + R(D(sec["depth"]));
            if (shape == "circle" && sec.ContainsKey("diameter"))
                return "c:" + R(D(sec["diameter"]));
            if (shape == "hsection" && sec.ContainsKey("width") && sec.ContainsKey("depth") && sec.ContainsKey("web") && sec.ContainsKey("flange"))
                return "h:" + R(D(sec["width"])) + "x" + R(D(sec["depth"])) + "x" + R(D(sec["web"])) + "x" + R(D(sec["flange"]));
            if (shape == "polygon" && sec.ContainsKey("points") && sec["points"] is List<object> pl)
            {
                var pts = new List<double[]>();
                foreach (var p in pl) if (p is List<object> pp && pp.Count >= 2) pts.Add(new[] { D(pp[0]), D(pp[1]) });
                if (pts.Count < 3) return null;
                return "p:" + pts.Count + ":" + Fnv1aPoints(pts);
            }
            return null;
        }

        // Lane-2 잔여(닫힌/열린 brep + 메시) → coarse 메시 → mm .3dm blob → fed-upload → fed-register.
        // 지오는 *원본* 좌표(ClassifyForPush가 +origin 복원). replace=lane2 → 재푸시 시 이전 오버레이 교체.
        static string RegisterResiduals(RhinoDoc doc, FigcadConfig cfg, List<GeometryBase> residuals)
        {
            var file = new Rhino.FileIO.File3dm();
            file.Settings.ModelUnitSystem = UnitSystem.Millimeters; // 커넥터 mm 1:1 — 리프트 요소(raw mm)와 오버레이 정렬
            int meshed = 0;
            var mp = MeshingParameters.FastRenderMesh; // coarse — 레퍼런스 오버레이(정밀 불필요)
            foreach (var g in residuals)
            {
                var m0 = g as Mesh;
                if (m0 != null)
                {
                    if (m0.Faces.Count == 0) continue;
                    file.Objects.AddMesh(m0); // 메시는 그대로 동승(v0.4 — 조용한 드롭 제거)
                    meshed++;
                    continue;
                }
                var b = g as Brep;
                if (b == null) continue;
                Mesh[] ms = null;
                try { ms = Mesh.CreateFromBrep(b, mp); } catch { }
                if (ms == null) continue;
                var merged = new Mesh();
                foreach (var m in ms) if (m != null) merged.Append(m);
                if (merged.Faces.Count == 0) continue;
                file.Objects.AddMesh(merged);
                meshed++;
            }
            if (meshed == 0) return "잔여 " + residuals.Count + " 메시화 실패(오버레이 미등록)";
            byte[] bytes = file.ToByteArray(new Rhino.FileIO.File3dmWriteOptions { Version = 7 });

            // 업로드(fed-upload, ext=3dm) → { url }
            var upContent = new ByteArrayContent(bytes);
            upContent.Headers.ContentType = new System.Net.Http.Headers.MediaTypeHeaderValue("application/octet-stream");
            var upResp = Http.PostAsync(Url(cfg, "fed-upload") + "&ext=3dm", upContent).GetAwaiter().GetResult();
            var upStr = upResp.Content.ReadAsStringAsync().GetAwaiter().GetResult();
            if (!upResp.IsSuccessStatusCode) return "잔여 " + meshed + " 업로드 실패(" + (int)upResp.StatusCode + ")";
            var up = (Dictionary<string, object>)Json.Parse(upStr);
            if (!up.ContainsKey("url")) return "잔여 업로드 응답에 url 없음";
            string refUrl = cfg.BaseUrl + "/parties/doc/" + cfg.Room + (string)up["url"]; // 웹 업로드와 동일 형태

            // 등록(fed-register) → { id }
            string regBody = "{\"name\":\"Lane-2 잔여 · Push\",\"sourceType\":\"3dm\",\"ref\":\"" + JStr(refUrl) + "\",\"replace\":\"lane2\"}";
            var regResp = Http.PostAsync(Url(cfg, "fed-register"), new StringContent(regBody, Encoding.UTF8, "application/json")).GetAwaiter().GetResult();
            var regStr = regResp.Content.ReadAsStringAsync().GetAwaiter().GetResult();
            if (!regResp.IsSuccessStatusCode) return "잔여 " + meshed + " 오버레이 등록 실패(" + (int)regResp.StatusCode + ": " + regStr + ")";
            var reg = (Dictionary<string, object>)Json.Parse(regStr);
            string id = reg.ContainsKey("id") ? (string)reg["id"] : "?";
            return "잔여 " + meshed + "개 연동 오버레이 등록(" + id + ")";
        }

        // JSON 문자열 이스케이프(ref URL·이름 — 손수 만든 JSON에 " \ 제어문자 안전).
        static string JStr(string s)
        {
            var sb = new StringBuilder();
            foreach (char ch in s)
            {
                if (ch == '"' || ch == '\\') { sb.Append('\\'); sb.Append(ch); }
                else if (ch == '\n') sb.Append("\\n");
                else if (ch == '\r') sb.Append("\\r");
                else if (ch == '\t') sb.Append("\\t");
                else sb.Append(ch);
            }
            return sb.ToString();
        }

        // 레이어 full-path → Figcad kind 분류는 FigcadClassify.KindFromLayer로 이동(단일 소스, MCP 유닛테스트
        // 가능한 순수 모듈). 레이어→kind 매핑 override + 객체별 figcad:kind는 FigcadClassify.ResolveKind.

        // --- helpers ---
        // +0.0 더해 음의 0 정규화 — .NET Core는 (-0.0).ToString()="-0"(JSON 오염 + "≠0" 오판 방지).
        static string R(double v) => (Math.Round(v) + 0.0).ToString(CultureInfo.InvariantCulture);
        static double Opt(Dictionary<string, object> d, string k, double def) => d.ContainsKey(k) && d[k] != null ? D(d[k]) : def;

        static int Layer(RhinoDoc doc, string name, int r, int g, int b)
        {
            int idx = doc.Layers.FindByFullPath(name, -1);
            if (idx >= 0) return idx;
            return doc.Layers.Add(new Layer { Name = name, Color = System.Drawing.Color.FromArgb(r, g, b) });
        }

        static Guid AddCurve(RhinoDoc doc, Point3d[] pts, int layer, string id, string role)
        {
            var a = new ObjectAttributes { LayerIndex = layer };
            a.SetUserString(IdKey, id);
            if (role != null) a.SetUserString("figcad:role", role);
            return doc.Objects.AddCurve(new PolylineCurve(pts), a);
        }

        // ===== 3D 솔리드 빌더 (Pull #8) =====
        static Guid AddBrep(RhinoDoc doc, Brep brep, int layer, string id)
        {
            var a = new ObjectAttributes { LayerIndex = layer };
            a.SetUserString(IdKey, id);
            return doc.Objects.AddBrep(brep, a);
        }

        // 닫힌 평면 프로파일을 dir 벡터로 압출+캡 → 솔리드. 실패 시 프로파일 커브 폴백(무손실).
        static Guid AddSolidOrCurve(RhinoDoc doc, Point3d[] closedPts, Vector3d dir, int layer, string id, double tol)
        {
            var brep = ExtrudeClosed(closedPts, dir, tol);
            if (brep != null && brep.IsValid) return AddBrep(doc, brep, layer, id);
            return AddCurve(doc, closedPts, layer, id, null);
        }

        static Brep ExtrudeClosed(Point3d[] closedPts, Vector3d dir, double tol)
        {
            if (closedPts == null || closedPts.Length < 4 || dir.Length < 1e-6) return null;
            var crv = new PolylineCurve(closedPts);
            if (!crv.IsClosed) return null;
            var srf = Surface.CreateExtrusion(crv, dir); // 방향 명시적(winding 무관)
            if (srf == null) return null;
            var b = srf.ToBrep();
            if (b == null) return null;
            var capped = b.CapPlanarHoles(tol);
            if (capped == null) return b;
            if (capped.SolidOrientation == BrepSolidOrientation.Inward) capped.Flip(); // 법선 바깥으로(winding 무관 정규화)
            return capped;
        }

        // 일반 보 프리즘 (v0.4 — AddBeamBox 대체, rect 포함 단일 경로) — 축 a→b(평면)·축중심 zCenter에
        // 단면 링(p,q)을 압출. 링 매핑 규약 = core deriveBeam과 부호 일치(여기 부호 오류 = 침묵 플립):
        //   core: world = [mx + dir.x·w + n.x·p, axisZ + q, my + dir.y·w + n.y·p], n=(dir.y, −dir.x).
        //   여기: P(p,q) = A + n3·p + Z·q (n3=(dir.Y, −dir.X, 0)) → p = 축 우측 수평(n) · q = +Z.
        //   압출 = dir·len (A→B 전장) — core는 mid±L/2로 같은 스팬. 부피 = 링 면적 × len (동일).
        static Guid AddBeamPrism(RhinoDoc doc, double ax, double ay, double bx, double by, double zCenter,
            List<double[]> ring, int layer, string id, double tol)
        {
            var d3 = new Vector3d(bx - ax, by - ay, 0);
            double len = d3.Length;
            if (len < 1e-6 || ring == null || ring.Count < 3) return Guid.Empty;
            d3.Unitize();
            var n3 = new Vector3d(d3.Y, -d3.X, 0); // core n=(dir.y,−dir.x)
            var pts = new Point3d[ring.Count + 1];
            for (int i = 0; i < ring.Count; i++)
                pts[i] = new Point3d(ax + n3.X * ring[i][0], ay + n3.Y * ring[i][0], zCenter + ring[i][1]);
            pts[ring.Count] = pts[0];
            return AddSolidOrCurve(doc, pts, d3 * len, layer, id, tol);
        }

        // 런 박스(계단/난간/커튼월 근사) — a→b 길이 × [yMin,yMax] 수직 × thickness 가로.
        static Guid AddRunBox(RhinoDoc doc, double ax, double ay, double bx, double by, double zBase, double yMin, double yMax, double thickness, int layer, string id)
        {
            var xaxis = new Vector3d(bx - ax, by - ay, 0); double len = xaxis.Length; if (len < 1e-6) return Guid.Empty; xaxis.Unitize();
            var plane = new Plane(new Point3d(ax, ay, zBase), xaxis, Vector3d.ZAxis);
            var box = new Box(plane, new Interval(0, len), new Interval(yMin, yMax), new Interval(-thickness / 2, thickness / 2));
            var brep = box.ToBrep();
            return brep != null ? AddBrep(doc, brep, layer, id) : Guid.Empty;
        }

        // 단면 → (width 수평, depth 수직). circle=지름 정사각 근사 · hsection=외곽 폭/춤 · polygon=bbox.
        static void SectionWD(Dictionary<string, object> sec, out double w, out double d)
        {
            string shape = sec != null && sec.ContainsKey("shape") ? sec["shape"] as string : null;
            if (shape == "circle") { double dia = D(sec["diameter"]); w = dia; d = dia; return; }
            if (shape == "polygon" && sec.ContainsKey("points") && sec["points"] is List<object> pl && pl.Count > 0)
            {
                double minX = double.MaxValue, maxX = double.MinValue, minY = double.MaxValue, maxY = double.MinValue;
                foreach (var p in pl)
                {
                    if (!(p is List<object> pp) || pp.Count < 2) continue;
                    double x = D(pp[0]), y = D(pp[1]);
                    if (x < minX) minX = x; if (x > maxX) maxX = x;
                    if (y < minY) minY = y; if (y > maxY) maxY = y;
                }
                if (maxX > minX && maxY > minY) { w = maxX - minX; d = maxY - minY; return; }
            }
            // rect/hsection = width/depth 직독
            w = sec != null && sec.ContainsKey("width") ? D(sec["width"]) : 400;
            d = sec != null && sec.ContainsKey("depth") ? D(sec["depth"]) : 400;
        }

        static Point3d[] Ring2D(List<object> boundary, double z, bool close)
        {
            var pts = new List<Point3d>();
            foreach (List<object> p in boundary) pts.Add(new Point3d(D(p[0]), D(p[1]), z));
            if (close && pts.Count > 0) pts.Add(pts[0]);
            return pts.ToArray();
        }

        static Dictionary<string, object> SectionOf(Dictionary<string, Dictionary<string, object>> types, string typeId) =>
            typeId != null && types.ContainsKey(typeId) && types[typeId].ContainsKey("section") ? (Dictionary<string, object>)types[typeId]["section"] : null;

        // sectionRing 재현 — core deriveStructure.ts sectionRing과 순서·좌표 동일해야 함(왕복 패리티):
        //   rect 4각 / circle 24각(각도 0부터) / hsection 12점 CCW(좌하단부터) / polygon verbatim.
        //   (p,q) mm — 보: p=축직각 수평(n)·q=수직(+Z) · 기둥: p=x·q=y.
        static List<double[]> SectionRing(Dictionary<string, object> sec)
        {
            var r = new List<double[]>();
            string shape = sec != null && sec.ContainsKey("shape") ? sec["shape"] as string : null;
            if (shape == "circle")
            {
                double rad = D(sec["diameter"]) / 2;
                for (int k = 0; k < 24; k++) { double an = k / 24.0 * Math.PI * 2; r.Add(new[] { Math.Cos(an) * rad, Math.Sin(an) * rad }); }
            }
            else if (shape == "hsection" && sec.ContainsKey("width") && sec.ContainsKey("depth") && sec.ContainsKey("web") && sec.ContainsKey("flange"))
            {
                // core hsection 12점 CCW — deriveStructure.ts sectionRing hsection 분기와 문자 그대로 일치
                double hw = D(sec["width"]) / 2, hd = D(sec["depth"]) / 2;
                double tw2 = D(sec["web"]) / 2, ny = hd - D(sec["flange"]);
                r.Add(new[] { -hw, -hd }); r.Add(new[] { hw, -hd }); r.Add(new[] { hw, -ny }); r.Add(new[] { tw2, -ny });
                r.Add(new[] { tw2, ny }); r.Add(new[] { hw, ny }); r.Add(new[] { hw, hd }); r.Add(new[] { -hw, hd });
                r.Add(new[] { -hw, ny }); r.Add(new[] { -tw2, ny }); r.Add(new[] { -tw2, -ny }); r.Add(new[] { -hw, -ny });
            }
            else if (shape == "polygon" && sec.ContainsKey("points") && sec["points"] is List<object> pl)
            {
                foreach (var p in pl) if (p is List<object> pp && pp.Count >= 2) r.Add(new[] { D(pp[0]), D(pp[1]) });
                if (r.Count < 3) { r.Clear(); }
            }
            if (r.Count == 0 && shape != "circle")
            {
                double w = (sec != null && sec.ContainsKey("width") ? D(sec["width"]) : 400) / 2;
                double dp = (sec != null && sec.ContainsKey("depth") ? D(sec["depth"]) : 400) / 2;
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

    // ===== .rhp Command 배선은 plugin/FigcadPlugin.cs =====
    // v0.4: FigcadPush = PushAll(커브+브렙 통합) · FigcadPushBreps = 레거시 별칭(브렙 레인만).
    // 스크립트에디터 1회 실행 예:
    //   Rhino.RhinoApp.WriteLine(Figcad.FigcadConnector.PushAll(Rhino.RhinoDoc.ActiveDoc,
    //       new Figcad.FigcadConfig { Room = "..." }, null));
    // 재푸시 멱등: 요소 = 서버 ?dedup=1(content key), 타입 = 스냅샷 canonical key 매치(create_type 0개).
}
