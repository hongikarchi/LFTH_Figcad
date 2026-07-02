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

            // 상세(≤80) 또는 레이어×처분 집계(대형 실문서) — 처분 문자열은 단일 포매터(두 갈래 표기 드리프트 방지).
            if (c.Candidates.Count <= 80)
            {
                int i = 0;
                foreach (var cand in c.Candidates)
                {
                    string layer, name; LookupObj(doc, cand.Id, out layer, out name);
                    var bb = cand.Bbox;
                    sb.AppendLine("#" + (i++) + " | " + layer + " | " + name + " | " + Dispo(cand) +
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
    }
}
