// TestHarness.cs — 커넥터 골든 씬 + 분류 census (Rhino-in-process, headless doc).
// =============================================================================
// 골든 씬: KindFromLayer 시맨틱 레이어에 결정적 solid 13개 — 인식 4kind + Lane-2 센티널.
//   사용자 ActiveDoc은 절대 건드리지 않음(RhinoDoc.CreateHeadless).
// Census : ClassifyForPush(setOrigin:false) = 서버·doc 무변경 드라이런 분류표.
//   실 프로젝트 doc(ActiveDoc)에도 읽기전용으로 사용 — 보 과분류 튜닝의 회귀망.
// GoldenPush: headless 골든 doc 2회(각각 새 doc) PushAll — 2회차 = 서버 content-dedup 검증.
// =============================================================================
using System;
using System.Collections.Generic;
using System.Text;
using Rhino;
using Rhino.DocObjects;
using Rhino.Geometry;

namespace Figcad
{
    public static class TestHarness
    {
        // ---------- 공용 헬퍼 ----------
        static int EnsureLayer(RhinoDoc doc, string name)
        {
            int idx = doc.Layers.FindByFullPath(name, -1);
            if (idx >= 0) return idx;
            var layer = new Layer { Name = name };
            return doc.Layers.Add(layer);
        }

        // bbox min을 목표점으로 평행이동 — Extrusion.Create 방향 부호 등 구성 quirk 무력화.
        static Brep PlaceAt(Brep b, double minX, double minY, double minZ)
        {
            var bb = b.GetBoundingBox(true);
            b.Transform(Transform.Translation(minX - bb.Min.X, minY - bb.Min.Y, minZ - bb.Min.Z));
            return b;
        }

        static Curve ClosedPoly(params double[] xy)
        {
            var pts = new List<Point3d>();
            for (int i = 0; i + 1 < xy.Length; i += 2) pts.Add(new Point3d(xy[i], xy[i + 1], 0));
            if (pts[0].DistanceTo(pts[pts.Count - 1]) > 1e-9) pts.Add(pts[0]);
            return new PolylineCurve(pts);
        }

        static Brep ExtrudeZ(Curve profileXY, double height)
        {
            var ex = Extrusion.Create(profileXY, height, true);
            if (ex == null) throw new InvalidOperationException("Extrusion.Create 실패");
            var b = ex.ToBrep();
            if (b == null || !b.IsSolid) throw new InvalidOperationException("Extrusion→Brep 실패/비솔리드");
            return b;
        }

        // H형강 프로파일(XY, 원점 중심) — width=플랜지 폭(X), depth=춤(Y), web/flange=두께.
        static Curve HProfile(double width, double depth, double web, double flange)
        {
            double w2 = width / 2, d2 = depth / 2, t2 = web / 2;
            return ClosedPoly(
                -w2, -d2, w2, -d2, w2, -d2 + flange, t2, -d2 + flange,
                t2, d2 - flange, w2, d2 - flange, w2, d2, -w2, d2,
                -w2, d2 - flange, -t2, d2 - flange, -t2, -d2 + flange, -w2, -d2 + flange);
        }

        static void Add(RhinoDoc doc, Brep b, int layerIdx, string name)
        {
            var attr = new ObjectAttributes { LayerIndex = layerIdx, Name = name };
            doc.Objects.AddBrep(b, attr);
        }

        // ---------- 골든 씬 ----------
        // 전부 양의 사분면, gbb.Min=(0,0)이 되도록(슬라브가 앵커) — recenter가 no-op이라 좌표 단언 단순.
        public static string BuildGolden(RhinoDoc doc)
        {
            int lCol = EnsureLayer(doc, "S-Column");
            int lBeam = EnsureLayer(doc, "S-Connection");
            int lWall = EnsureLayer(doc, "A-Wall");
            int lSlab = EnsureLayer(doc, "S-Slab");
            int lStair = EnsureLayer(doc, "S-Stair");
            int lRail = EnsureLayer(doc, "A-Handrail");
            int lGlass = EnsureLayer(doc, "Z-Glass");

            // 1 슬라브 8000×6000×200, top=z0 (레벨 elevation 0) — gbb 앵커
            Add(doc, Brep.CreateFromBox(new BoundingBox(new Point3d(0, 0, -200), new Point3d(8000, 6000, 0))), lSlab, "slab");

            // 2 각기둥 400×600×3000h, 중심 (1000,1000)
            Add(doc, Brep.CreateFromBox(new BoundingBox(new Point3d(800, 700, 0), new Point3d(1200, 1300, 3000))), lCol, "col-rect");

            // 3 원기둥 Ø500×3000h, 중심 (3000,1000)
            var cyl = new Cylinder(new Circle(new Plane(new Point3d(3000, 1000, 0), Vector3d.ZAxis), 250), 3000);
            Add(doc, cyl.ToBrep(true, true), lCol, "col-circle");

            // 4 H형강 기둥 H-400x400x13x21 수직 3000, 중심 (5000,1000)
            Add(doc, PlaceAt(ExtrudeZ(HProfile(400, 400, 13, 21), 3000), 4800, 800, 0), lCol, "col-h");

            // 5 L형 기둥 300×300 다리, t80, 수직 3000, min (6800,850)
            Add(doc, PlaceAt(ExtrudeZ(ClosedPoly(0, 0, 300, 0, 300, 80, 80, 80, 80, 300, 0, 300), 3000), 6800, 850, 0), lCol, "col-L");

            // 6 H형강 보 H-300(폭)x500(춤) 수평 6000, 축 (7500,0,3000)→(7500,6000,3000) — Y방향.
            //   정준 프로파일(웹=Y)을 X축 +90° 회전(Y→Z): 웹 수직·플랜지 수평 = core hsection 어휘와 일치.
            //   (Y축 회전은 자기축 90° 돌린 H(웹 수평)가 되어 설계상 Lane-2 — 골든 v1서 실증한 함정.)
            var beamH = ExtrudeZ(HProfile(300, 500, 11, 18), 6000);
            beamH.Transform(Transform.Rotation(Math.PI / 2, Vector3d.XAxis, Point3d.Origin));
            Add(doc, PlaceAt(beamH, 7350, 0, 2750), lBeam, "beam-h");

            // 7 각형 보 300(폭)×600(춤) 수평 6000, 축 z=3300, y=4000
            Add(doc, Brep.CreateFromBox(new BoundingBox(new Point3d(1000, 3850, 3000), new Point3d(7000, 4150, 3600))), lBeam, "beam-rect");

            // 8 [센티널] 기울인 평행육면체 — 단면 300×600, 축 (1000,5000,3000)→(7000,5000,4500) 경사.
            //   기대 = Lane-2 "단면과대" (측면 cap쌍이 거대 평행사변 단면으로 수평 통과 → 폭 상한이 기각.
            //   메시지에 "기운 보" 병기 — 진짜 기운 축은 FitPrisms 측면판별자가 이미 기각해 여기까지 못 옴).
            //   beam으로 리프트되면 회귀.
            {
                var c = new Point3d[8];
                // 아래 슬랜트 면 (ccw, 법선 아래쪽)
                c[0] = new Point3d(1000, 4850, 3000); c[1] = new Point3d(7000, 4850, 4500);
                c[2] = new Point3d(7000, 5150, 4500); c[3] = new Point3d(1000, 5150, 3000);
                // 위 면 = 아래 +600z
                c[4] = new Point3d(1000, 4850, 3600); c[5] = new Point3d(7000, 4850, 5100);
                c[6] = new Point3d(7000, 5150, 5100); c[7] = new Point3d(1000, 5150, 3600);
                var tilted = Brep.CreateFromBox(c);
                if (tilted == null) throw new InvalidOperationException("tilted 평행육면체 생성 실패");
                Add(doc, tilted, lBeam, "beam-tilted");
            }

            // 9 [센티널] 평판 2000×3000×150 @ S-Connection — 보로 오분류되면 과분류(폭 2000 보는 없다).
            Add(doc, Brep.CreateFromBox(new BoundingBox(new Point3d(1000, 7000, 3000), new Point3d(3000, 10000, 3150))), lBeam, "plate");

            // 10 [센티널] 큐브 800³ @ S-Connection — 축 없음 → Lane-2.
            Add(doc, Brep.CreateFromBox(new BoundingBox(new Point3d(4000, 7000, 3000), new Point3d(4800, 7800, 3800))), lBeam, "cube");

            // 11 벽 t200, 길이 4000, 중심선 y=11000, 높이 3000
            Add(doc, Brep.CreateFromBox(new BoundingBox(new Point3d(1000, 10900, 0), new Point3d(5000, 11100, 3000))), lWall, "wall");

            // 12 직선 계단 — 단 10개 × (run 280 · rise 170), 폭 1200. XY 톱니 프로파일 → 회전.
            {
                var pts = new List<double> { 0, 0 };
                for (int i = 0; i < 10; i++)
                {
                    pts.Add(i * 280); pts.Add((i + 1) * 170);       // 위로 (rise)
                    pts.Add((i + 1) * 280); pts.Add((i + 1) * 170); // 앞으로 (run)
                }
                pts.Add(2800); pts.Add(0); // 바닥 복귀
                var stair = ExtrudeZ(ClosedPoly(pts.ToArray()), 1200);
                stair.Transform(Transform.Rotation(Math.PI / 2, Vector3d.XAxis, Point3d.Origin)); // Y(rise)→Z
                Add(doc, PlaceAt(stair, 9000, 0, 0), lStair, "stair");
            }

            // 13 난간 — 얇은 박스 3000(x)×50(y)×900(z)h
            Add(doc, Brep.CreateFromBox(new BoundingBox(new Point3d(9000, 4000, 0), new Point3d(12000, 4050, 900))), lRail, "railing");

            // 14 자유곡면 blob(비균등 스케일 구) @ Z-Glass — Lane-2 잔여 → fed-register
            {
                var blob = new Sphere(new Point3d(11000, 8000, 1000), 800).ToBrep();
                blob.Transform(Transform.Scale(new Plane(new Point3d(11000, 8000, 1000), Vector3d.ZAxis), 1.0, 0.7, 0.5));
                Add(doc, blob, lGlass, "blob");
            }

            return "골든 씬 생성: " + doc.Objects.Count + "개 객체";
        }

        // ---------- Census (드라이런 — 서버·doc 무변경) ----------
        public static string Census(RhinoDoc doc, string baseUrl, string room, double volTol)
        {
            var cfg = new FigcadConfig { BaseUrl = baseUrl, Room = room };
            var c = FigcadConnector.ClassifyForPush(doc, cfg, null, false, volTol);
            var sb = new StringBuilder();
            sb.AppendLine("CENSUS lib=" + typeof(TestHarness).Assembly.Location);
            sb.AppendLine("doc=" + (doc.Name ?? "(headless)") + " 수집=" + c.BrepCount + " level=" + (c.HasLevel ? c.LevelId : "NONE") + " origin=" + c.Ox + "," + c.Oy);
            sb.AppendLine("인식: col=" + c.NCol + " beam=" + c.NBeam + " wall=" + c.NWall + " slab=" + c.NSlab +
                " stair=" + c.NStair + " rail=" + c.NRail + " | 잔여=" + c.NResidual + " 근사=" + c.NApprox + " 스킵=" + c.NSkippedOther);
            sb.Append("Lane-2:"); foreach (var kv in c.Lane2Reasons) sb.Append(" " + kv.Key + "=" + kv.Value); sb.AppendLine();
            sb.Append("타입 필요:"); foreach (var k in c.TypeNeeds.Keys) sb.Append(" [" + k + "]"); sb.AppendLine();

            // 층 감지 census (M1 리포트-온리) — emission이 쓰는 prepass 테이블(c.Stories)로 통일
            // (DetectStories(c.Candidates)는 Lane-2 잔여를 빼 emission과 불일치 — 리뷰 major).
            var stories = c.Stories ?? FigcadConnector.DetectStories(c.Candidates);
            sb.AppendLine("층: " + stories.Report());

            // 상세(≤80) 또는 레이어×처분 집계(대형 실문서) — 처분 문자열은 단일 포매터(두 갈래 표기 드리프트 방지).
            if (c.Candidates.Count <= 80)
            {
                int i = 0;
                foreach (var cand in c.Candidates)
                {
                    string layer, name; LookupObj(doc, cand.Id, out layer, out name);
                    var bb = cand.Bbox;
                    string si = cand.Kind == null ? "-"
                        : "S" + stories.ResolveLevel(FigcadStories.AnchorZ(cand.Kind, bb.Min.Z, bb.Max.Z));
                    sb.AppendLine("#" + (i++) + " | " + layer + " | " + name + " | " + Dispo(cand) + " | " + si +
                        " | " + Math.Round(bb.Min.X) + "," + Math.Round(bb.Min.Y) + "," + Math.Round(bb.Min.Z) +
                        " ~ " + Math.Round(bb.Max.X) + "," + Math.Round(bb.Max.Y) + "," + Math.Round(bb.Max.Z));
                }
            }
            else
            {
                var agg = new SortedDictionary<string, int>();
                foreach (var cand in c.Candidates)
                {
                    string layer, name; LookupObj(doc, cand.Id, out layer, out name);
                    // fail 메시지에 실측 mm가 박히므로 집계 키는 숫자 마스킹(# 치환) — 아니면 준-객체별 행 폭발.
                    string key = layer + " → " + System.Text.RegularExpressions.Regex.Replace(Dispo(cand), "[0-9]+(\\.[0-9]+)?", "#");
                    int v; agg.TryGetValue(key, out v); agg[key] = v + 1;
                }
                foreach (var kv in agg) sb.AppendLine(kv.Value.ToString().PadLeft(5) + "  " + kv.Key);
            }
            return sb.ToString();
        }

        static string Dispo(PushCandidate cand)
        {
            if (cand.Kind == null) return "LANE2(" + (cand.FailReason ?? "?") + ")";
            return cand.Approx ? cand.Kind + "(근사:" + (cand.FailReason ?? "?") + ")" : cand.Kind;
        }

        static void LookupObj(RhinoDoc doc, Guid id, out string layer, out string name)
        {
            layer = "(block)"; name = "";
            if (id == Guid.Empty) return;
            var o = doc.Objects.FindId(id);
            if (o == null) return;
            if (o.Attributes.LayerIndex >= 0 && o.Attributes.LayerIndex < doc.Layers.Count)
                layer = doc.Layers[o.Attributes.LayerIndex].FullPath;
            name = o.Attributes.Name ?? "";
        }

        // 골든 headless doc 계약(단위 mm·tol 0.01) 단일 소스 — census/push가 다른 조건서 돌면 상호 검증 무효.
        static string WithGoldenDoc(Func<RhinoDoc, string> body)
        {
            var doc = RhinoDoc.CreateHeadless(null);
            try
            {
                doc.AdjustModelUnitSystem(UnitSystem.Millimeters, false);
                doc.ModelAbsoluteTolerance = 0.01;
                BuildGolden(doc);
                return body(doc);
            }
            finally { doc.Dispose(); }
        }

        // 골든 headless doc 만들어 census만 (push 없음)
        public static string GoldenCensus(string baseUrl, string room, double volTol)
        {
            return WithGoldenDoc(doc => Census(doc, baseUrl, room, volTol));
        }

        // 활성(실) 문서 census — 읽기전용. 실문서 tol 그대로 사용.
        public static string ActiveCensus(string baseUrl, string room, double volTol)
        {
            return Census(RhinoDoc.ActiveDoc, baseUrl, room, volTol);
        }

        // 대형 실문서용 — MCP 응답 타임아웃 우회. RhinoCommon은 스레드세이프 아님(백그라운드 스레드서
        // doc 순회 중 autosave/편집 = 크래시 위험) → RhinoApp.Idle에서 *UI 스레드*로 1회 실행 후 파일 기록.
        // census 동안 Rhino UI가 멈추는 건 감수(개발 계측 도구).
        public static string ActiveCensusToFile(string baseUrl, string room, double volTol, string outPath)
        {
            EventHandler run = null;
            run = (s, e) =>
            {
                RhinoApp.Idle -= run;
                try { System.IO.File.WriteAllText(outPath, Census(RhinoDoc.ActiveDoc, baseUrl, room, volTol)); }
                catch (Exception ex) { try { System.IO.File.WriteAllText(outPath, "ERROR: " + ex); } catch { } }
            };
            RhinoApp.Idle += run;
            return "Idle-큐 census 예약(UI 스레드) → " + outPath;
        }

        // ---------- 실모델 (파일 사본 headless — 사용자 문서 무접촉) ----------
        // Idle-큐(UI 스레드) + 파일 출력 — ActiveCensusToFile과 동일 사유(MCP 타임아웃·스레드 안전).
        public static string RealPushToFile(string filePath, string baseUrl, string room, double volTol, string outPath)
        {
            EventHandler run = null;
            run = (s, e) =>
            {
                RhinoApp.Idle -= run;
                RhinoDoc doc = null;
                try
                {
                    doc = RhinoDoc.OpenHeadless(filePath);
                    if (doc == null) { System.IO.File.WriteAllText(outPath, "ERROR: OpenHeadless 실패 " + filePath); return; }
                    var rep = FigcadConnector.PushAll(doc, new FigcadConfig { BaseUrl = baseUrl, Room = room }, null, volTol);
                    System.IO.File.WriteAllText(outPath, "file=" + filePath + "\n" + rep);
                }
                catch (Exception ex) { try { System.IO.File.WriteAllText(outPath, "ERROR: " + ex); } catch { } }
                finally { if (doc != null) doc.Dispose(); }
            };
            RhinoApp.Idle += run;
            return "Idle-큐 실모델 push 예약 → " + outPath;
        }

        // ---------- 실모델 층 census (파일 사본 headless — 레벨 구조화 M1 실측 게이트) ----------
        // Census(분류+층 감지+층별 배정)를 파일로 — 260629류 실모델을 오너가 검토하는 1차 산출물.
        public static string StoryCensusToFile(string filePath, string baseUrl, string room, double volTol, string outPath)
        {
            EventHandler run = null;
            run = (s, e) =>
            {
                RhinoApp.Idle -= run;
                RhinoDoc doc = null;
                try
                {
                    doc = RhinoDoc.OpenHeadless(filePath);
                    if (doc == null) { System.IO.File.WriteAllText(outPath, "ERROR: OpenHeadless 실패 " + filePath); return; }
                    var sb = new StringBuilder();
                    sb.AppendLine("file=" + filePath);
                    sb.Append(Census(doc, baseUrl, room, volTol));
                    // 층별 × kind 집계 (census 상세는 ≤80만 개별행 — 대형 실모델용 요약)
                    var cfg = new FigcadConfig { BaseUrl = baseUrl, Room = room };
                    var c = FigcadConnector.ClassifyForPush(doc, cfg, null, false, volTol);
                    var stories = c.Stories ?? FigcadConnector.DetectStories(c.Candidates); // prepass 통일(리뷰)
                    var agg = new SortedDictionary<string, int>();
                    foreach (var cand in c.Candidates)
                    {
                        if (cand.Kind == null) continue;
                        var bb = cand.Bbox;
                        int si = stories.ResolveLevel(FigcadStories.AnchorZ(cand.Kind, bb.Min.Z, bb.Max.Z));
                        string key = "S" + si + " " + cand.Kind;
                        int v; agg.TryGetValue(key, out v); agg[key] = v + 1;
                    }
                    sb.AppendLine("층×kind:");
                    foreach (var kv in agg) sb.AppendLine(kv.Value.ToString().PadLeft(5) + "  " + kv.Key);
                    System.IO.File.WriteAllText(outPath, sb.ToString());
                }
                catch (Exception ex) { try { System.IO.File.WriteAllText(outPath, "ERROR: " + ex); } catch { } }
                finally { if (doc != null) doc.Dispose(); }
            };
            RhinoApp.Idle += run;
            return "Idle-큐 층 census 예약 → " + outPath;
        }

        // ---------- 충실도 리포트 — 원본 brep bbox vs 파생 지오메트리 bbox (분석 재구성) ----------
        // "Rhino와 얼마나 다르게 나오나"의 수치화. 요소별: 중심Δ(xy/z)·치수Δ(x/y/z).
        // 파생 bbox는 op 파라미터에서 core derive 규약대로 해석 재구성(연결 회귀 아님 — 표현 한계가 그대로 드러남:
        // 슬라브 z 고정·계단 층고 상승 등). PASS ≤10mm · WARN ≤50mm · BAD >50mm. 표현한계는 별도 집계.
        public static string FidelityToFile(string filePath, string baseUrl, string room, double volTol, string outPath)
        {
            EventHandler run = null;
            run = (s, e) =>
            {
                RhinoApp.Idle -= run;
                RhinoDoc doc = null;
                try
                {
                    doc = RhinoDoc.OpenHeadless(filePath);
                    if (doc == null) { System.IO.File.WriteAllText(outPath, "ERROR: OpenHeadless 실패 " + filePath); return; }
                    System.IO.File.WriteAllText(outPath, Fidelity(doc, baseUrl, room, volTol));
                }
                catch (Exception ex) { try { System.IO.File.WriteAllText(outPath, "ERROR: " + ex); } catch { } }
                finally { if (doc != null) doc.Dispose(); }
            };
            RhinoApp.Idle += run;
            return "Idle-큐 충실도 리포트 예약 → " + outPath;
        }

        public static string GoldenFidelity(string baseUrl, string room, double volTol)
        {
            return WithGoldenDoc(doc => Fidelity(doc, baseUrl, room, volTol));
        }

        static double ToD(object o) => Convert.ToDouble(o, System.Globalization.CultureInfo.InvariantCulture);

        static string Fidelity(RhinoDoc doc, string baseUrl, string room, double volTol)
        {
            var cfg = new FigcadConfig { BaseUrl = baseUrl, Room = room };
            // 레벨 elevation/height (계단 상승·z 기준)
            double levelElev = 0, levelHeight = 0;
            using (var http = new System.Net.Http.HttpClient())
            {
                var body = http.GetStringAsync(cfg.BaseUrl + "/parties/doc/" + cfg.Room + "?op=pull").GetAwaiter().GetResult();
                var snap = (Dictionary<string, object>)ParseJson(body);
                foreach (Dictionary<string, object> l in (List<object>)snap["levels"])
                {
                    if (l.ContainsKey("elevation")) levelElev = ToD(l["elevation"]);
                    if (l.ContainsKey("height")) levelHeight = ToD(l["height"]);
                    break;
                }
            }
            var c = FigcadConnector.ClassifyForPush(doc, cfg, null, false, volTol);

            // 타입키 → 파라미터(섹션 등) — TypeNeeds OpJson에서
            var typeArgs = new Dictionary<string, Dictionary<string, object>>();
            foreach (var kv in c.TypeNeeds)
            {
                var op = (Dictionary<string, object>)ParseJson(kv.Value.OpJson);
                typeArgs[kv.Key] = (Dictionary<string, object>)op["args"];
            }

            var sb = new StringBuilder();
            sb.AppendLine("FIDELITY lib=" + typeof(TestHarness).Assembly.Location);
            sb.AppendLine("doc=" + (doc.Name ?? "(headless)") + " 인식=" + c.Ops.Count + " origin=" + c.Ox + "," + c.Oy +
                " levelElev=" + levelElev + " levelHeight=" + levelHeight);

            int pass = 0, warn = 0, bad = 0, skip = 0, reprLimit = 0;
            var badLines = new List<string>();
            var kindAgg = new SortedDictionary<string, double[]>(); // kind → [n, maxCenter, maxDims]
            int opIdx = 0;
            foreach (var cand in c.Candidates)
            {
                if (cand.Kind == null) continue;
                var op = c.Ops[opIdx++];
                var parsed = (Dictionary<string, object>)ParseJson(op.JsonTemplate.Replace("{TYPEID}", "T"));
                var args = (Dictionary<string, object>)parsed["args"];
                BoundingBox der;
                string limitNote;
                if (!DerivedBox(op, args, typeArgs, c.Ox, c.Oy, levelElev, levelHeight, out der, out limitNote))
                { skip++; continue; }

                var src = cand.Bbox;
                double cdx = Math.Abs((der.Min.X + der.Max.X) / 2 - (src.Min.X + src.Max.X) / 2);
                double cdy = Math.Abs((der.Min.Y + der.Max.Y) / 2 - (src.Min.Y + src.Max.Y) / 2);
                double cdz = Math.Abs((der.Min.Z + der.Max.Z) / 2 - (src.Min.Z + src.Max.Z) / 2);
                double ddx = Math.Abs((der.Max.X - der.Min.X) - (src.Max.X - src.Min.X));
                double ddy = Math.Abs((der.Max.Y - der.Min.Y) - (src.Max.Y - src.Min.Y));
                double ddz = Math.Abs((der.Max.Z - der.Min.Z) - (src.Max.Z - src.Min.Z));
                // 난간: 파생 단면폭(포스트) 재구성이 개략이라 xy 치수는 평가 제외(위치·길이·높이만)
                if (op.Kind == "railing") { ddx = Math.Min(ddx, 0); ddy = Math.Min(ddy, 0); }
                double worstC = Math.Max(cdx, Math.Max(cdy, cdz));
                double worstD = Math.Max(ddx, Math.Max(ddy, ddz));
                double worst = Math.Max(worstC, worstD);

                if (limitNote != null)
                {
                    reprLimit++;
                    // 표현한계(계단 층고·슬라브 z 등)는 BAD 아님 — 별도 카운트 + 대표 수치
                    if (badLines.Count < 40)
                        badLines.Add("[표현한계] " + op.Kind + " " + limitNote + " | 중심Δ(" + F0(cdx) + "," + F0(cdy) + "," + F0(cdz) +
                            ") 치수Δ(" + F0(ddx) + "," + F0(ddy) + "," + F0(ddz) + ") @ " + F0(src.Min.X) + "," + F0(src.Min.Y));
                }
                else if (worst <= 10) pass++;
                else if (worst <= 50) warn++;
                else
                {
                    bad++;
                    if (badLines.Count < 40)
                        badLines.Add("[BAD] " + op.Kind + " 중심Δ(" + F0(cdx) + "," + F0(cdy) + "," + F0(cdz) +
                            ") 치수Δ(" + F0(ddx) + "," + F0(ddy) + "," + F0(ddz) + ") @ " + F0(src.Min.X) + "," + F0(src.Min.Y) + "," + F0(src.Min.Z));
                }

                double[] agg;
                if (!kindAgg.TryGetValue(op.Kind, out agg)) { agg = new double[3]; kindAgg[op.Kind] = agg; }
                agg[0]++; agg[1] = Math.Max(agg[1], worstC); agg[2] = Math.Max(agg[2], worstD);
            }

            sb.AppendLine("판정: PASS(≤10mm)=" + pass + " WARN(≤50)=" + warn + " BAD(>50)=" + bad +
                " 표현한계=" + reprLimit + " 비교생략=" + skip);
            foreach (var kv in kindAgg)
                sb.AppendLine("  " + kv.Key + ": n=" + (int)kv.Value[0] + " max중심Δ=" + F0(kv.Value[1]) + " max치수Δ=" + F0(kv.Value[2]));
            foreach (var l in badLines) sb.AppendLine(l);
            return sb.ToString();
        }

        static string F0(double v) => Math.Round(v).ToString(System.Globalization.CultureInfo.InvariantCulture);

        // op 파라미터 → core derive 규약의 bbox 해석 재구성. limitNote != null = 알려진 표현한계.
        static bool DerivedBox(PushOp op, Dictionary<string, object> args, Dictionary<string, Dictionary<string, object>> typeArgs,
            double ox, double oy, double levelElev, double levelHeight, out BoundingBox box, out string limitNote)
        {
            box = BoundingBox.Empty; limitNote = null;
            Dictionary<string, object> targs = null;
            if (op.TypeKey != null) typeArgs.TryGetValue(op.TypeKey, out targs);

            double baseOff = args.ContainsKey("baseOffset") ? ToD(args["baseOffset"]) : 0;
            Func<string, double[]> pt = k =>
            {
                var l = (List<object>)args[k];
                return new[] { ToD(l[0]) + ox, ToD(l[1]) + oy };
            };

            if (op.Kind == "column")
            {
                if (targs == null || !targs.ContainsKey("section")) return false;
                double sx0, sx1, sy0, sy1;
                if (!SectionExtent((Dictionary<string, object>)targs["section"], out sx0, out sx1, out sy0, out sy1)) return false;
                var at = pt("at");
                double h = ToD(args["height"]);
                double z0 = levelElev + baseOff;
                box = new BoundingBox(new Point3d(at[0] + sx0, at[1] + sy0, z0), new Point3d(at[0] + sx1, at[1] + sy1, z0 + h));
                return true;
            }
            if (op.Kind == "beam")
            {
                if (targs == null || !targs.ContainsKey("section")) return false;
                double sx0, sx1, sy0, sy1;
                if (!SectionExtent((Dictionary<string, object>)targs["section"], out sx0, out sx1, out sy0, out sy1)) return false;
                var a = pt("a"); var b = pt("b");
                double zc = levelElev + (args.ContainsKey("zOffset") ? ToD(args["zOffset"]) : 0);
                double dx = b[0] - a[0], dy = b[1] - a[1], len = Math.Sqrt(dx * dx + dy * dy);
                if (len < 1e-9) return false;
                double px = dy / len, py = -dx / len; // frame X = (dir.y, −dir.x) — core 규약
                box = BoundingBox.Empty;
                foreach (var e in new[] { a, b })
                    foreach (var sxv in new[] { sx0, sx1 })
                        box.Union(new Point3d(e[0] + px * sxv, e[1] + py * sxv, 0));
                box = new BoundingBox(new Point3d(box.Min.X, box.Min.Y, zc + sy0), new Point3d(box.Max.X, box.Max.Y, zc + sy1));
                return true;
            }
            if (op.Kind == "wall")
            {
                double th = targs != null && targs.ContainsKey("thickness") ? ToD(targs["thickness"]) : 0;
                if (th <= 0) return false;
                var a = pt("a"); var b = pt("b");
                double h = ToD(args["height"]);
                double dx = b[0] - a[0], dy = b[1] - a[1], len = Math.Sqrt(dx * dx + dy * dy);
                if (len < 1e-9) return false;
                double px = dy / len * th / 2, py = -dx / len * th / 2;
                box = BoundingBox.Empty;
                foreach (var e in new[] { a, b })
                {
                    box.Union(new Point3d(e[0] + px, e[1] + py, 0));
                    box.Union(new Point3d(e[0] - px, e[1] - py, 0));
                }
                double z0 = levelElev + baseOff;
                box = new BoundingBox(new Point3d(box.Min.X, box.Min.Y, z0), new Point3d(box.Max.X, box.Max.Y, z0 + h));
                return true;
            }
            if (op.Kind == "slab")
            {
                var bnd = (List<object>)args["boundary"];
                if (bnd.Count < 3) return false;
                double mnx = double.MaxValue, mxx = double.MinValue, mny = double.MaxValue, mxy = double.MinValue;
                foreach (List<object> p in bnd)
                {
                    double x = ToD(p[0]) + ox, y = ToD(p[1]) + oy;
                    mnx = Math.Min(mnx, x); mxx = Math.Max(mxx, x); mny = Math.Min(mny, y); mxy = Math.Max(mxy, y);
                }
                double th = args.ContainsKey("thicknessOverride") ? ToD(args["thicknessOverride"]) : 0;
                if (th <= 0) return false;
                // v0.6: 상면 = 레벨 + zOffset(실측 보존) — 인자 없으면 종전 레벨 고정
                double zo = args.ContainsKey("zOffset") ? ToD(args["zOffset"]) : 0;
                double top = levelElev + zo;
                box = new BoundingBox(new Point3d(mnx, mny, top - th), new Point3d(mxx, mxy, top));
                if (!args.ContainsKey("zOffset")) limitNote = "슬라브z(상면=레벨 고정)";
                return true;
            }
            if (op.Kind == "stair")
            {
                if (targs == null || !targs.ContainsKey("width")) return false; // bbox 폴백(시드 타입) = 비교 생략
                double w = ToD(targs["width"]);
                var a = pt("a"); var b = pt("b");
                double dx = b[0] - a[0], dy = b[1] - a[1], len = Math.Sqrt(dx * dx + dy * dy);
                if (len < 1e-9) return false;
                double px = dy / len * w / 2, py = -dx / len * w / 2;
                box = BoundingBox.Empty;
                foreach (var e in new[] { a, b })
                {
                    box.Union(new Point3d(e[0] + px, e[1] + py, 0));
                    box.Union(new Point3d(e[0] - px, e[1] - py, 0));
                }
                double z0 = levelElev + baseOff;
                // v0.6: rise 인자 = 실측 상승 — 없으면 종전 층고 고정(표현한계)
                double rise = args.ContainsKey("rise") ? ToD(args["rise"]) : levelHeight;
                box = new BoundingBox(new Point3d(box.Min.X, box.Min.Y, z0), new Point3d(box.Max.X, box.Max.Y, z0 + rise));
                if (!args.ContainsKey("rise")) limitNote = "계단(상승=층고 " + F0(levelHeight) + " 고정)";
                return true;
            }
            if (op.Kind == "railing")
            {
                double h = targs != null && targs.ContainsKey("height") ? ToD(targs["height"]) : 0;
                if (h <= 0) return false;
                var a = pt("a"); var b = pt("b");
                double z0 = levelElev + baseOff;
                box = new BoundingBox(
                    new Point3d(Math.Min(a[0], b[0]) - 25, Math.Min(a[1], b[1]) - 25, z0),
                    new Point3d(Math.Max(a[0], b[0]) + 25, Math.Max(a[1], b[1]) + 25, z0 + h));
                return true;
            }
            return false;
        }

        // 섹션 JSON → 프레임 좌표 extents (x=폭방향, y=수직/깊이방향 — core sectionRing 규약)
        static bool SectionExtent(Dictionary<string, object> sec, out double x0, out double x1, out double y0, out double y1)
        {
            x0 = x1 = y0 = y1 = 0;
            string shape = sec.ContainsKey("shape") ? sec["shape"] as string : null;
            if (shape == "rect" || shape == "hsection")
            {
                double w = ToD(sec["width"]), d = ToD(sec["depth"]);
                x0 = -w / 2; x1 = w / 2; y0 = -d / 2; y1 = d / 2;
                return true;
            }
            if (shape == "circle")
            {
                double r = ToD(sec["diameter"]) / 2;
                x0 = -r; x1 = r; y0 = -r; y1 = r;
                return true;
            }
            if (shape == "polygon")
            {
                var pts = (List<object>)sec["points"];
                if (pts.Count < 3) return false;
                x0 = double.MaxValue; x1 = double.MinValue; y0 = double.MaxValue; y1 = double.MinValue;
                foreach (List<object> p in pts)
                {
                    double x = ToD(p[0]), y = ToD(p[1]);
                    x0 = Math.Min(x0, x); x1 = Math.Max(x1, x); y0 = Math.Min(y0, y); y1 = Math.Max(y1, y);
                }
                return true;
            }
            return false;
        }

        // FigcadConnector.Json은 private 중첩 아님(internal static) — 하지만 접근자 명시 없이 내부 클래스라
        // 어셈블리 내 접근 가능. 별칭 한 겹(테스트 코드 가독).
        static object ParseJson(string s) => Json.Parse(s);

        // ---------- 면벽(열린브렙) 분포 프로브 — 벽 레이어의 단일면 수직 평면 비율 ----------
        // "벽이 다 non-native"(사용자) 원인 규명: 열린브렙이 면벽(수직 단일 평면면)이면 인식 확장 가치.
        public static string OpenBrepProbeToFile(string filePath, string outPath)
        {
            EventHandler run = null;
            run = (s, e) =>
            {
                RhinoApp.Idle -= run;
                RhinoDoc doc = null;
                try
                {
                    doc = RhinoDoc.OpenHeadless(filePath);
                    if (doc == null) { System.IO.File.WriteAllText(outPath, "ERROR: OpenHeadless 실패"); return; }
                    var agg = new SortedDictionary<string, int[]>(); // layer → [열린브렙, 그중 단일면, 그중 수직평면 단일면]
                    void Walk(IEnumerable<Rhino.DocObjects.RhinoObject> objs, Transform xf, int depth)
                    {
                        if (depth > 8) return;
                        foreach (var o in objs)
                        {
                            if (o is Rhino.DocObjects.InstanceObject io)
                            {
                                try { Walk(io.InstanceDefinition.GetObjects(), xf * io.InstanceXform, depth + 1); } catch { }
                                continue;
                            }
                            Brep bp = o.Geometry as Brep;
                            if (bp == null && o.Geometry is Extrusion ex) bp = ex.ToBrep();
                            if (bp == null || bp.IsSolid) continue;
                            string lp = (o.Attributes.LayerIndex >= 0 && o.Attributes.LayerIndex < doc.Layers.Count)
                                ? doc.Layers[o.Attributes.LayerIndex].FullPath : "?";
                            int[] c;
                            if (!agg.TryGetValue(lp, out c)) { c = new int[3]; agg[lp] = c; }
                            c[0]++;
                            if (bp.Faces.Count == 1)
                            {
                                c[1]++;
                                var srf = bp.Faces[0].UnderlyingSurface();
                                Plane pl;
                                if (srf != null && srf.TryGetPlane(out pl, 1.0))
                                {
                                    var dup = (Brep)bp.Duplicate();
                                    dup.Transform(xf);
                                    Plane pl2;
                                    if (dup.Faces[0].UnderlyingSurface().TryGetPlane(out pl2, 1.0) && Math.Abs(pl2.Normal.Z) < 0.05)
                                        c[2]++;
                                }
                            }
                        }
                    }
                    Walk(doc.Objects, Transform.Identity, 0);
                    var sb = new StringBuilder("OPEN-BREP 분포 (레이어 | 열린 | 단일면 | 수직평면 단일면):\n");
                    foreach (var kv in agg)
                        if (kv.Value[0] >= 5)
                            sb.AppendLine(kv.Value[0].ToString().PadLeft(5) + " " + kv.Value[1].ToString().PadLeft(5) + " " +
                                kv.Value[2].ToString().PadLeft(5) + "  " + kv.Key);
                    System.IO.File.WriteAllText(outPath, sb.ToString());
                }
                catch (Exception ex2) { try { System.IO.File.WriteAllText(outPath, "ERROR: " + ex2); } catch { } }
                finally { if (doc != null) doc.Dispose(); }
            };
            RhinoApp.Idle += run;
            return "Idle-큐 프로브 예약 → " + outPath;
        }

        // ---------- 골든 push (2회 = idempotency) ----------
        public static string GoldenPush(string baseUrl, string room, double volTol)
        {
            var report = new StringBuilder();
            report.AppendLine("lib=" + typeof(TestHarness).Assembly.Location);
            for (int pass = 1; pass <= 2; pass++)
            {
                report.AppendLine("== PUSH " + pass + "/2 (새 headless doc — 2회차는 서버 dedup 검증) ==");
                report.AppendLine(WithGoldenDoc(doc =>
                    FigcadConnector.PushAll(doc, new FigcadConfig { BaseUrl = baseUrl, Room = room }, null, volTol)));
            }
            return report.ToString();
        }

        // ---------- 골든 다층 씬 (레벨 구조화 M3) ----------
        // 2개 층 + 지붕 강등 센티널 + 층 관통 계단. 기대: 층 [0, 3400] · 지붕 슬라브 = 2층 zOffset 3200 ·
        // 보(축 2900) = 1층 · 시드 '1층'@0 재사용 + '2층' 1개 생성. 2회차 = 레벨 신규 0 + 전량 dedup.
        public static string BuildGoldenMultiStory(RhinoDoc doc)
        {
            int lCol = EnsureLayer(doc, "S-Column");
            int lBeam = EnsureLayer(doc, "S-Connection");
            int lWall = EnsureLayer(doc, "A-Wall");
            int lSlab = EnsureLayer(doc, "S-Slab");
            int lStair = EnsureLayer(doc, "S-Stair");

            // L1: 슬라브 top=0 + 기둥 2 + 벽 + 보(축 z 2900 — L2 바닥판 아래)
            Add(doc, Brep.CreateFromBox(new BoundingBox(new Point3d(0, 0, -200), new Point3d(8000, 6000, 0))), lSlab, "slab-l1");
            Add(doc, Brep.CreateFromBox(new BoundingBox(new Point3d(800, 700, 0), new Point3d(1200, 1100, 3300))), lCol, "col-l1a");
            Add(doc, Brep.CreateFromBox(new BoundingBox(new Point3d(6800, 700, 0), new Point3d(7200, 1100, 3300))), lCol, "col-l1b");
            Add(doc, Brep.CreateFromBox(new BoundingBox(new Point3d(1000, 4900, 0), new Point3d(5000, 5100, 3300))), lWall, "wall-l1");
            Add(doc, Brep.CreateFromBox(new BoundingBox(new Point3d(1000, 1850, 2600), new Point3d(7000, 2150, 3200))), lBeam, "beam-l1");

            // L2: 슬라브 3200~3400 + 기둥 2 + 벽
            Add(doc, Brep.CreateFromBox(new BoundingBox(new Point3d(0, 0, 3200), new Point3d(8000, 6000, 3400))), lSlab, "slab-l2");
            Add(doc, Brep.CreateFromBox(new BoundingBox(new Point3d(800, 700, 3400), new Point3d(1200, 1100, 6400))), lCol, "col-l2a");
            Add(doc, Brep.CreateFromBox(new BoundingBox(new Point3d(6800, 700, 3400), new Point3d(7200, 1100, 6400))), lCol, "col-l2b");
            Add(doc, Brep.CreateFromBox(new BoundingBox(new Point3d(1000, 4900, 3400), new Point3d(5000, 5100, 6400))), lWall, "wall-l2");

            // 지붕 슬라브 6400~6600 — 위에 아무것도 없음 = 층 강등 센티널 (2층 zOffset 3200 기대)
            Add(doc, Brep.CreateFromBox(new BoundingBox(new Point3d(0, 0, 6400), new Point3d(8000, 6000, 6600))), lSlab, "slab-roof");

            // 층 관통 직선 계단 — 단 20 × (run 280 · rise 170) = 상승 3400, 폭 1200. base=0 → 1층 배정 기대.
            {
                var pts = new List<double> { 0, 0 };
                for (int i = 0; i < 20; i++)
                {
                    pts.Add(i * 280); pts.Add((i + 1) * 170);
                    pts.Add((i + 1) * 280); pts.Add((i + 1) * 170);
                }
                pts.Add(5600); pts.Add(0);
                var stair = ExtrudeZ(ClosedPoly(pts.ToArray()), 1200);
                stair.Transform(Transform.Rotation(Math.PI / 2, Vector3d.XAxis, Point3d.Origin));
                Add(doc, PlaceAt(stair, 9000, 0, 0), lStair, "stair-span");
            }

            return "골든 다층 씬 생성: " + doc.Objects.Count + "개 객체";
        }

        static string WithGoldenMultiDoc(Func<RhinoDoc, string> body)
        {
            var doc = RhinoDoc.CreateHeadless(null);
            try
            {
                doc.AdjustModelUnitSystem(UnitSystem.Millimeters, false);
                doc.ModelAbsoluteTolerance = 0.01;
                BuildGoldenMultiStory(doc);
                return body(doc);
            }
            finally { doc.Dispose(); }
        }

        // 2회 push(multiLevel=ON) + 서버 스냅샷 자기검증. 신선한 시드 룸(레벨 '1층'@0 1개) 전제.
        public static string GoldenMultiPush(string baseUrl, string room, double volTol)
        {
            var report = new StringBuilder();
            report.AppendLine("lib=" + typeof(TestHarness).Assembly.Location);
            for (int pass = 1; pass <= 2; pass++)
            {
                report.AppendLine("== MULTI PUSH " + pass + "/2 (층 자동 구조화 ON — 2회차 = 레벨 신규 0 + 전량 dedup) ==");
                report.AppendLine(WithGoldenMultiDoc(doc =>
                    FigcadConnector.PushAll(doc, new FigcadConfig { BaseUrl = baseUrl, Room = room }, null, volTol, true)));
            }
            // 자기검증 — 스냅샷 레벨/요소 배정
            try
            {
                using (var http = new System.Net.Http.HttpClient())
                {
                    var body = http.GetStringAsync(baseUrl + "/parties/doc/" + room + "?op=pull").GetAwaiter().GetResult();
                    var snap = (Dictionary<string, object>)ParseJson(body);
                    var levels = (List<object>)snap["levels"];
                    var els = (List<object>)snap["elements"];
                    report.AppendLine(levels.Count == 2 ? "ASSERT PASS 레벨 2개" : "ASSERT FAIL 레벨 " + levels.Count + "개 (기대 2)");
                    string l2id = null;
                    bool has0 = false, has3400 = false;
                    foreach (Dictionary<string, object> l in levels)
                    {
                        double e = ToD(l["elevation"]);
                        if (Math.Abs(e) <= 250) has0 = true;
                        if (Math.Abs(e - 3400) <= 250) { has3400 = true; l2id = (string)l["id"]; }
                    }
                    report.AppendLine(has0 && has3400 ? "ASSERT PASS 레벨 elevation 0·3400" : "ASSERT FAIL 레벨 elevation 세트");
                    int onL2 = 0, roofOk = 0;
                    foreach (Dictionary<string, object> el in els)
                    {
                        if (l2id != null && el.ContainsKey("levelId") && (string)el["levelId"] == l2id)
                        {
                            onL2++;
                            if ((string)el["kind"] == "slab" && el.ContainsKey("zOffset") && Math.Abs(ToD(el["zOffset"]) - 3200) <= 10) roofOk++;
                        }
                    }
                    report.AppendLine(onL2 >= 4 ? "ASSERT PASS 2층 요소 " + onL2 + "개(슬라브+기둥2+벽+지붕)" : "ASSERT FAIL 2층 요소 " + onL2 + "개 (기대 ≥4)");
                    report.AppendLine(roofOk >= 1 ? "ASSERT PASS 지붕 슬라브 = 2층 zOffset≈3200 (층 강등)" : "ASSERT FAIL 지붕 슬라브 zOffset");
                }
            }
            catch (Exception ex) { report.AppendLine("ASSERT ERROR " + ex.Message); }
            return report.ToString();
        }
    }
}
