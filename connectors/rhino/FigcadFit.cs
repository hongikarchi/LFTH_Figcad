// FigcadFit.cs — cap-pair 프리즘 추출 + 단면 분류 (순수 RhinoCommon, 문서 무변형).
// =============================================================================
// FitPrisms     = brep → 유효 압출축 후보 전부(박스=3개) — 반평행 동면적 cap쌍 후보
//                 + 측면⊥검증(판별자 — H 플랜지쌍 오선택을 이게 막음) + 부피 게이트 2%.
// ToSectionPts  = cap 프로파일(월드 3D) → 단면 프레임 2D (Transform.ChangeBasis).
// FitSection    = 2D 프로파일 → rect|circle|hsection|polygon 분류(첫 매치 승, 실패=Shape null=Lane-2).
// CheckFidelity = 재구성 부피(secArea×len) vs 실부피 — "조용히 근사 금지"의 수치 실체.
// PlugIn/Eto/HTTP/Settings 의존 0 → MCP(execute_rhinocommon_csharp_code)/ScriptEditor
// 붙여넣기 검증 가능(FigcadClassify 패턴). 블루프린트 = docs/brep-lifting-2026.md §2.
//
// ---- 프레임 규약 (core deriveStructure.ts sectionRing/deriveBeam과 부호 일치 필수) ----
// 여기 부호 오류 = 이후 침묵 km-스케일 버그. 단위 = mm(Rhino 문서 1:1).
//   보:   평면 진행방향 dir=unit((b−a)의 XY)일 때 단면 X축=(dir.y, −dir.x, 0)
//         — 평면상 축의 오른쪽 = core sectionRing의 n=[dy,−dx]와 동일. Y축=+Z(월드).
//         원점=축 중점. 단면 width는 X방향·depth는 Y방향.
//   기둥: X=월드X · Y=월드Y (core column엔 회전 파라미터 없음 — 월드 정렬 고정).
// =============================================================================
using System;
using System.Collections.Generic;
using Rhino.Geometry;

namespace Figcad
{
    // 프리즘(직선 압출) 피팅 1건. Valid=false면 FailReason에 후퇴 사유 명명(정직 보고).
    public class PrismFit
    {
        public bool Valid;
        public Line Axis;              // cap i 도심 → cap j 도심(축 투영) — 월드 mm
        public double Length;          // 압출 길이 = |(cj−ci)·n|
        public Plane SectionPlane;     // cap i 평면(원점=도심, 법선=outward)
        public List<Point3d> Profile3D;// cap OuterLoop 폴리라인화(월드, 닫는 중복점 제거)
        public Curve ProfileCurve;     // cap OuterLoop 원본 3D 곡선(circle 인식용 raw)
        public double CapArea;
        public double BrepVolume;
        public string FailReason;
    }

    // 단면 분류 1건. Shape=null = 분류 실패(Note에 사유) → 호출자가 Lane-2 처리.
    public class SectionFit
    {
        public string Shape;           // "rect"|"circle"|"hsection"|"polygon"|null
        public double Width, Depth, Diameter, Web, Flange; // mm 정수(반올림)
        public List<double[]> Points;  // polygon 전용 — [x,y] mm 정수, 프레임 좌표
        public double Area;            // 해석 면적(형상별 공식) — CheckFidelity 입력
        public string Note;            // FailReason식 메모(Shape=null 사유 등)
    }

    public static class FigcadFit
    {
        // 임계값 — 계획 고정치. 부피 임계만 패널 조절 대상(CheckFidelity 인자).
        const double AntiparallelDot = -0.9999; // cap쌍: ni·nj < 이 값(≈0.81°)
        const double AreaMatchFrac = 0.02;      // cap쌍 면적 일치(선별용 — 판별자는 측면 검증)
        const double SideDotMax = 0.02;         // 측면 평면: |n·axis| < 이 값(≈축평행 ±1.15°)
        const double CylAxisDotMin = 0.9999;    // 측면 원통: |cylAxis·axis| > 이 값
        const double VolGateFrac = 0.02;        // FitPrisms 내부 부피 게이트
        const double Cos1Deg = 0.99985;         // 명명 단면 축정렬 게이트 ~1°
        const double Sin05Deg = 0.008727;       // rect 직각/평행 0.5°
        const int MaxFaces = 256;               // 면 수 폭탄 가드
        const int MaxPolyPts = 64;              // polygon 점수 상한(core zod .max(128)의 절반)

        // ---------------------------------------------------------------------
        // ① FitPrisms — brep의 모든 유효 압출축 반환(cap 면적 내림차순, 박스=3개).
        //    kind 매퍼(Phase 3)가 방향(수직/수평)으로 최종 선택. tol = max(modelTol, 0.01)mm.
        // ---------------------------------------------------------------------
        public static List<PrismFit> FitPrisms(Brep b, double tol)
        {
            var fits = new List<PrismFit>();
            if (tol < 0.01) tol = 0.01;
            if (b == null) { fits.Add(Fail("brep null")); return fits; }
            if (b.Faces.Count > MaxFaces) { fits.Add(Fail("면 " + b.Faces.Count + "개 > " + MaxFaces + " 가드")); return fits; }
            if (!b.IsSolid) { fits.Add(Fail("열린 brep(비솔리드) — 부피 게이트 불가")); return fits; }

            // 복제본에서 작업(원본 무변형).
            // ① 킹크 단일면 분할 — doc 미경유 brep(Extrusion.ToBrep·CreateExtrusion 결과)은 측면
            //   밴드가 킹크 있는 단일 NURBS 면이라 TryGetPlane 실패 → 전부 기각(MCP 스모크 실증).
            //   doc 저장 객체는 이미 분할돼 있어 no-op.
            // ② 쪼개진 동일평면 cap 병합(실패해도 무해, 후보가 줄 뿐).
            var dup = b.DuplicateBrep();
            dup.Faces.SplitKinkyFaces(Rhino.RhinoMath.DefaultAngleTolerance, true);
            dup.MergeCoplanarFaces(tol);

            var vmp = VolumeMassProperties.Compute(dup);
            if (vmp == null || vmp.Volume <= 0) { fits.Add(Fail("부피 계산 실패")); return fits; }
            double vol = vmp.Volume;

            // 전 면 분류: 0=평면 / 1=원통 / 2=기타. 평면은 AreaMassProperties(면적+도심) 캐시.
            int nf = dup.Faces.Count;
            var kind = new int[nf];
            var nrm = new Vector3d[nf];   // OUTWARD 법선 — OrientationIsReversed면 플립 필수(미플립=cap쌍 오검출)
            var cylAx = new Vector3d[nf];
            var area = new double[nf];
            var cen = new Point3d[nf];
            int nOther = 0;
            for (int i = 0; i < nf; i++)
            {
                var f = dup.Faces[i];
                var s = f.UnderlyingSurface();
                Plane pl; Cylinder cy;
                if (s != null && s.TryGetPlane(out pl, tol))
                {
                    var n = pl.Normal; n.Unitize();
                    if (f.OrientationIsReversed) n.Reverse();
                    // 트림 존중 필수: Surface 오버로드는 언더레이 전체 면적을 계산(고전 함정) → DuplicateFace.
                    var amp = AreaMassProperties.Compute(f.DuplicateFace(false));
                    if (amp == null || amp.Area <= 0) { kind[i] = 2; nOther++; continue; }
                    kind[i] = 0; nrm[i] = n; area[i] = amp.Area; cen[i] = amp.Centroid;
                }
                else if (s != null && s.TryGetCylinder(out cy, tol))
                {
                    var ax = cy.Axis; ax.Unitize();
                    kind[i] = 1; cylAx[i] = ax;
                }
                else { kind[i] = 2; nOther++; }
            }

            int nPairs = 0, rejSide = 0, rejVol = 0, rejProf = 0;
            for (int i = 0; i < nf; i++)
            {
                if (kind[i] != 0) continue;
                for (int j = i + 1; j < nf; j++)
                {
                    if (kind[j] != 0) continue;
                    if (nrm[i] * nrm[j] >= AntiparallelDot) continue;                       // 반평행 cap쌍
                    double amax = Math.Max(area[i], area[j]);
                    if (Math.Abs(area[i] - area[j]) / amax >= AreaMatchFrac) continue;      // 면적 일치(정렬용)
                    var axis = nrm[i];
                    double d = (cen[j] - cen[i]) * axis;                                    // 부호 있는 축거리
                    double len = Math.Abs(d);
                    if (len <= tol) continue;
                    nPairs++;

                    // 판별자 = 측면 검증: 나머지 전 면이 축⊥평면 or 축∥원통이어야 통과.
                    // 제3의 ±축법선 면(H 플랜지 내면 등)·기타면은 여기서 기각.
                    bool ok = true;
                    for (int k = 0; k < nf && ok; k++)
                    {
                        if (k == i || k == j) continue;
                        if (kind[k] == 0) ok = Math.Abs(nrm[k] * axis) < SideDotMax;
                        else if (kind[k] == 1) ok = Math.Abs(cylAx[k] * axis) > CylAxisDotMin;
                        else ok = false;
                    }
                    if (!ok) { rejSide++; continue; }

                    // 부피 게이트: capArea×len ≈ V(전단/경사 프리즘·오염 cap 방어).
                    if (Math.Abs(area[i] * len - vol) / vol > VolGateFrac) { rejVol++; continue; }

                    var loop = dup.Faces[i].OuterLoop;
                    var rawLoop = loop != null ? loop.To3dCurve() : null;
                    var prof = ProfilePolyline(rawLoop, tol);
                    if (prof.Count < 3) { rejProf++; continue; }

                    fits.Add(new PrismFit
                    {
                        Valid = true,
                        Axis = new Line(cen[i], cen[i] + axis * d),
                        Length = len,
                        SectionPlane = new Plane(cen[i], axis),
                        Profile3D = prof,
                        ProfileCurve = rawLoop,
                        CapArea = area[i],
                        BrepVolume = vol,
                    });
                }
            }

            if (fits.Count == 0)
            {
                string why = nPairs == 0
                    ? (nOther > 0 ? "cap쌍 없음(비해석면 " + nOther + "개)" : "반평행 동면적 cap쌍 없음")
                    : "cap쌍 " + nPairs + " 전부 기각(측면 " + rejSide + " · 부피 " + rejVol + " · 프로파일 " + rejProf + ")";
                fits.Add(Fail(why));
                return fits;
            }
            fits.Sort((x, y) => y.CapArea.CompareTo(x.CapArea));
            return fits;
        }

        // ---------------------------------------------------------------------
        // ② ToSectionPts — Profile3D(월드)를 단면 프레임 2D로 (Transform.ChangeBasis).
        //    frame은 BeamSectionFrame/ColumnSectionFrame 사용(부호 규약 헤더 참조).
        // ---------------------------------------------------------------------
        public static List<Point2d> ToSectionPts(PrismFit fit, Plane frame)
        {
            var pts = new List<Point2d>();
            if (fit == null || fit.Profile3D == null || !frame.IsValid) return pts;
            var xf = Transform.ChangeBasis(Plane.WorldXY, frame); // 월드 → frame 좌표
            foreach (var p in fit.Profile3D)
            {
                var q = p; q.Transform(xf);
                pts.Add(new Point2d(q.X, q.Y));
            }
            return pts;
        }

        // 보 단면 프레임 — X=(dir.y,−dir.x,0)(core n과 일치)·Y=+Z·원점=축 중점. 헤더 규약 참조.
        public static Plane BeamSectionFrame(Point3d a, Point3d b)
        {
            var dir = new Vector3d(b.X - a.X, b.Y - a.Y, 0);
            if (!dir.Unitize()) return Plane.Unset; // 수직 전용 축(평면 길이 0) = 보 프레임 불가
            var x = new Vector3d(dir.Y, -dir.X, 0);
            var origin = new Point3d((a.X + b.X) / 2, (a.Y + b.Y) / 2, (a.Z + b.Z) / 2);
            return new Plane(origin, x, Vector3d.ZAxis);
        }

        // 기둥 단면 프레임 — 월드 XY 고정(core column 회전 파라미터 없음).
        public static Plane ColumnSectionFrame(Point3d at)
        {
            return new Plane(at, Vector3d.XAxis, Vector3d.YAxis);
        }

        // ---------------------------------------------------------------------
        // ③ FitSection — 첫 매치 승: circle → rect → hsection → polygon.
        //    pts = ToSectionPts 결과(이미 frame 좌표) · rawLoop3d = fit.ProfileCurve(원 인식용).
        //    frame 인자는 규약 명시/향후 검증용 — 정렬 게이트는 frame 좌표계 축(1,0)/(0,1)로 판정.
        //    명명 단면(rect/hsection)은 축정렬 ~1° 이내만 인정 — 어긋나면(자기축 회전 H보 등)
        //    polygon 폴백(회전을 verbatim 좌표로 흡수). S2에서 channel/tee/angle 분기 삽입 지점.
        // ---------------------------------------------------------------------
        public static SectionFit FitSection(List<Point2d> pts, Curve rawLoop3d, Plane frame, double tol)
        {
            return FitSection(pts, rawLoop3d, frame, tol, true);
        }

        // allowSharpen: 압연형강 필렛 제거 시도 여부. 명명 단면(필렛 제거)이 부피 게이트에서
        // 떨어지면 호출자(매퍼)가 allowSharpen=false로 재호출 → 충실 폴리곤 폴백(2단 중재).
        public static SectionFit FitSection(List<Point2d> pts, Curve rawLoop3d, Plane frame, double tol, bool allowSharpen)
        {
            if (tol < 0.01) tol = 0.01;
            var r = new SectionFit();

            // circle — 다각 근사 전 raw 곡선이 진실원.
            Circle ci;
            if (rawLoop3d != null && rawLoop3d.TryGetCircle(out ci, tol))
            {
                double dia = Math.Round(2 * ci.Radius);
                if (dia >= 1)
                {
                    r.Shape = "circle";
                    r.Diameter = dia;
                    r.Area = Math.PI * dia * dia / 4;
                    return r;
                }
            }

            // 압연형강 필렛 제거 → 명명 단면 승격 시도 (실모델 실증: H-300x500 = 12직선 + r18 90°호 4개
            // → 폴리곤 24점으로 새던 것을 예리한 12코너 복원해 hsection으로. 명목 면적은 필렛만큼
            // 실부피와 어긋나므로(실측 +2.0%) 최종 심판은 매퍼의 CheckFidelity — 실패 시 재호출 폴백).
            if (allowSharpen && rawLoop3d != null && frame.IsValid)
            {
                var sharp3 = SharpCorners3D(rawLoop3d, tol);
                if (sharp3 != null && sharp3.Count >= 4)
                {
                    var xf = Transform.ChangeBasis(Plane.WorldXY, frame);
                    var sp = new List<Point2d>(sharp3.Count);
                    foreach (var p in sharp3) { var q3 = p; q3.Transform(xf); sp.Add(new Point2d(q3.X, q3.Y)); }
                    var sq = Preprocess(sp, tol);
                    double sw, sd;
                    if (sq.Count == 4 && TryAxisAlignedRect(sq, tol, out sw, out sd))
                    {
                        r.Shape = "rect"; r.Width = sw; r.Depth = sd; r.Area = sw * sd; r.Note = "필렛 제거";
                        return r;
                    }
                    if (sq.Count == 12 && TryHSection(sq, tol, r)) { r.Note = "필렛 제거"; return r; }
                }
            }

            // 전처리 — 닫는 중복점 제거 + 공선 붕괴(쪼개진 에지 → rect 4점 판정의 전제).
            var q = Preprocess(pts, tol);
            if (q.Count < 3) { r.Note = "전처리 후 점 3개 미만"; return r; }
            double rawArea = Math.Abs(Shoelace(q));
            if (rawArea <= 0) { r.Note = "면적 0(퇴화 프로파일)"; return r; }

            // rect — 정확 4점 + 대변 평행·등장 + 직각 0.5° + 축정렬 1°.
            double w, dp;
            if (q.Count == 4 && TryAxisAlignedRect(q, tol, out w, out dp))
            {
                r.Shape = "rect"; r.Width = w; r.Depth = dp; r.Area = w * dp;
                return r;
            }

            // hsection — 정확 12점 + 축정렬 + |x|·|y| 클러스터 역산 + canonical 재구성 대조.
            if (q.Count == 12 && TryHSection(q, tol, r)) return r;

            // polygon 폴백 — DP 1mm 데시메이트 → ≤64점 → mm 정수 반올림 → 면적 1% 보존 검증.
            // mm 정수 해상도 한계(설계된 정직 거동): 중심대칭 홀수두께 피처(예: 자기축 회전 H의
            // 웹 7mm → 좌표 ±3.5 → ±4 반올림 → 면적 +5.6%)는 여기 면적 게이트가 기각 → Lane-2.
            // 축정렬 명명 단면은 전폭 단위 반올림(TryHSection)이라 무관 — MCP 스모크 F2 실증.
            var poly = DouglasPeucker(q, 1.0);
            double eps = 2.0;
            while (poly.Count > MaxPolyPts && eps <= 64.0) { poly = DouglasPeucker(poly, eps); eps *= 2; }
            if (poly.Count > MaxPolyPts) { r.Note = "폴리곤 " + poly.Count + "점 > " + MaxPolyPts + "(데시메이트 실패)"; return r; }

            var rounded = new List<Point2d>(poly.Count);
            foreach (var p in poly)
            {
                var rp = new Point2d(Math.Round(p.X), Math.Round(p.Y));
                if (rounded.Count == 0 || rounded[rounded.Count - 1].DistanceTo(rp) > 0.5) rounded.Add(rp);
            }
            if (rounded.Count > 1 && rounded[0].DistanceTo(rounded[rounded.Count - 1]) <= 0.5) rounded.RemoveAt(rounded.Count - 1);
            if (rounded.Count < 3) { r.Note = "반올림 후 3점 미만"; return r; }

            double newArea = Math.Abs(Shoelace(rounded));
            double areaErr = Math.Abs(newArea - rawArea) / rawArea;
            if (areaErr > 0.01)
            {
                r.Note = "폴리곤 면적 보존 실패(" + (areaErr * 100).ToString("0.0") + "% > 1%)"; // Shape=null → Lane-2
                return r;
            }
            r.Shape = "polygon";
            r.Points = new List<double[]>(rounded.Count);
            foreach (var p in rounded) r.Points.Add(new[] { p.X, p.Y });
            r.Area = newArea; // shoelace = 해석 면적(polygon)
            return r;
        }

        // ---------------------------------------------------------------------
        // ④ CheckFidelity — 재구성 부피 게이트(기본 3%는 호출자/패널 몫, 여기선 인자).
        // ---------------------------------------------------------------------
        public static bool CheckFidelity(PrismFit fit, double sectionArea, double volTolFraction)
        {
            if (fit == null || !fit.Valid || fit.BrepVolume <= 0 || sectionArea <= 0 || fit.Length <= 0) return false;
            return Math.Abs(sectionArea * fit.Length - fit.BrepVolume) / fit.BrepVolume <= volTolFraction;
        }

        // ==================== 내부 헬퍼 ====================

        static PrismFit Fail(string why) { return new PrismFit { Valid = false, FailReason = why }; }

        // 압연형강 필렛 제거 — 루프가 직선+접선호(필렛) 교대 구조면 인접 직선의 무한직선 교점으로
        // 예리한 코너 복원(직선 세그 수 = 코너 수). null = 필렛 구조 아님(자유곡선 세그·연속 호·
        // 평행 인접선[반원 팁]·교점이 호에서 원격) → 호출자는 충실 폴리곤 경로 유지.
        static List<Point3d> SharpCorners3D(Curve c, double tol)
        {
            var pcIn = c as PolyCurve;
            if (pcIn == null) return null;
            var pc = (PolyCurve)pcIn.DuplicateCurve(); // RemoveNesting 원본 변형 방지
            pc.RemoveNesting();
            var segs = pc.Explode();
            if (segs == null || segs.Length < 3) return null;
            var order = new List<object>(segs.Length); // Line | Arc
            int nArc = 0;
            foreach (var seg in segs)
            {
                if (seg == null) return null;
                if (seg.IsLinear(tol)) { order.Add(new Line(seg.PointAtStart, seg.PointAtEnd)); continue; }
                Arc arc;
                if (seg.TryGetArc(out arc, tol) && Math.Abs(arc.Angle) <= Math.PI * 0.75) { order.Add(arc); nArc++; continue; }
                return null;
            }
            if (nArc == 0) return null; // 전부 직선 = 기존 경로가 이미 정확
            int n = order.Count;
            var pts = new List<Point3d>();
            for (int i = 0; i < n; i++)
            {
                if (!(order[i] is Line)) continue;
                var li = (Line)order[i];
                var nxt = order[(i + 1) % n];
                if (nxt is Line) { pts.Add(li.To); continue; }
                var arc2 = (Arc)nxt;
                if (!(order[(i + 2) % n] is Line)) return null; // 연속 호 = 비필렛 구조
                var lj = (Line)order[(i + 2) % n];
                double ta, tb;
                if (!Rhino.Geometry.Intersect.Intersection.LineLine(li, lj, out ta, out tb)) return null; // 평행
                var pa = li.PointAt(ta); var pb = lj.PointAt(tb);
                if (pa.DistanceTo(pb) > Math.Max(tol * 2, 0.1)) return null; // 3D 스큐 가드
                if (pa.DistanceTo(arc2.MidPoint) > Math.Max(arc2.Radius * 4, tol * 4)) return null; // 원격 교점 = 비필렛
                pts.Add(pa);
            }
            return pts.Count >= 3 ? pts : null;
        }

        // cap OuterLoop 곡선 → 폴리라인 점열(닫는 중복점 제거). 호는 코드 sag < tol*10로 세분.
        // FigcadConnector.ProfileVerts의 확장판(세그 시작점만 나열 → 호 세분 추가 + 폴백 정리).
        static List<Point3d> ProfilePolyline(Curve c, double tol)
        {
            var verts = new List<Point3d>();
            if (c == null) return verts;
            Polyline pl;
            if (c.TryGetPolyline(out pl))
            {
                foreach (var p in pl) verts.Add(p);
            }
            else if (c is PolyCurve pc)
            {
                pc.RemoveNesting();
                var segs = pc.Explode();
                double sagMax = Math.Max(tol, 0.5); // 호 세분 코드 sag — tol 스케일(×10은 tol=1mm 문서서 과조악)
                if (segs != null)
                {
                    foreach (var seg in segs)
                    {
                        if (seg == null) continue;
                        if (seg.IsLinear(tol)) { verts.Add(seg.PointAtStart); continue; }
                        Arc arc;
                        if (seg.TryGetArc(out arc, tol)) { AppendSubdivided(seg, ArcSegCount(arc, sagMax), verts); continue; }
                        AppendSubdivided(seg, 16, verts); // 자유곡선 세그 폴백
                    }
                }
            }
            else
            {
                // 단일 곡선(원 cap 등) 폴백 — 원은 FitSection이 rawLoop TryGetCircle로 잡으므로 여긴 근사만.
                var tt = c.DivideByCount(32, true);
                if (tt != null) foreach (var t in tt) verts.Add(c.PointAt(t));
            }
            if (verts.Count > 1 && verts[0].DistanceTo(verts[verts.Count - 1]) < Math.Max(tol, 0.01))
                verts.RemoveAt(verts.Count - 1);
            return verts;
        }

        // 호 세그 수: 코드 sag = r(1−cos(θ/2)) ≤ sagMax → θmax = 2·acos(1−sagMax/r).
        static int ArcSegCount(Arc arc, double sagMax)
        {
            double rr = arc.Radius, ang = Math.Abs(arc.Angle);
            if (rr <= 0 || sagMax >= rr) return 1;
            double thetaMax = 2 * Math.Acos(1 - sagMax / rr);
            if (thetaMax < 1e-9) return MaxPolyPts;
            int n = (int)Math.Ceiling(ang / thetaMax);
            return Math.Max(1, Math.Min(n, MaxPolyPts));
        }

        // 세그를 n등분해 시작~끝직전 점 추가(끝점 = 다음 세그 시작 — 중복 방지).
        static void AppendSubdivided(Curve seg, int n, List<Point3d> outPts)
        {
            if (n <= 1) { outPts.Add(seg.PointAtStart); return; }
            var tt = seg.DivideByCount(n, true);
            if (tt == null || tt.Length < 2) { outPts.Add(seg.PointAtStart); return; }
            for (int i = 0; i < tt.Length - 1; i++) outPts.Add(seg.PointAt(tt[i]));
        }

        // 전처리: 연속 중복점 제거 → 닫는 중복점 제거 → 공선 붕괴(랩어라운드, 이웃 선분에서 eps 이내 중간점 삭제).
        static List<Point2d> Preprocess(List<Point2d> pts, double tol)
        {
            var l = new List<Point2d>();
            if (pts == null) return l;
            double dupTol = Math.Max(tol, 0.01);
            foreach (var p in pts)
                if (l.Count == 0 || l[l.Count - 1].DistanceTo(p) > dupTol) l.Add(p);
            if (l.Count > 1 && l[0].DistanceTo(l[l.Count - 1]) <= dupTol) l.RemoveAt(l.Count - 1);
            // 공선 판정 = 모델 공차 스케일(×10 금지 — tol=1mm 문서서 eps 10mm가 H 웹 7mm 노치를
            // 공선으로 붕괴시켜 프로파일 파괴, MCP 스모크 실증).
            double eps = Math.Max(tol, 0.1);
            bool removed = true;
            while (removed && l.Count > 3)
            {
                removed = false;
                for (int i = 0; i < l.Count && l.Count > 3; i++)
                {
                    var a = l[(i + l.Count - 1) % l.Count];
                    var m = l[i];
                    var c = l[(i + 1) % l.Count];
                    if (PerpDist(m, a, c) < eps) { l.RemoveAt(i); removed = true; i--; }
                }
            }
            return l;
        }

        // rect: 대변 평행(반대방향 0.5°)+등장 + 직각 0.5° + 프레임 축정렬 1°. width=X방향·depth=Y방향(mm 반올림).
        static bool TryAxisAlignedRect(List<Point2d> q, double tol, out double width, out double depth)
        {
            width = 0; depth = 0;
            var ux = new double[4]; var uy = new double[4]; var len = new double[4];
            for (int i = 0; i < 4; i++)
            {
                double dx = q[(i + 1) % 4].X - q[i].X, dy = q[(i + 1) % 4].Y - q[i].Y;
                len[i] = Math.Sqrt(dx * dx + dy * dy);
                if (len[i] < tol) return false;
                ux[i] = dx / len[i]; uy[i] = dy / len[i];
            }
            double lenTol = Math.Max(tol * 2, 0.5); // 대변 등장 — 과관용(×10)이면 사다리꼴이 rect로 새므로 ×2
            for (int i = 0; i < 2; i++)
            {
                int j = i + 2;
                if (ux[i] * ux[j] + uy[i] * uy[j] > -(1 - Sin05Deg * Sin05Deg / 2)) return false; // 반평행 0.5°
                if (Math.Abs(len[i] - len[j]) > lenTol) return false;
            }
            if (Math.Abs(ux[0] * ux[1] + uy[0] * uy[1]) > Sin05Deg) return false; // 직각 ±0.5°
            for (int i = 0; i < 4; i++)                                            // 축정렬 게이트 ~1°
                if (Math.Abs(ux[i]) < Cos1Deg && Math.Abs(uy[i]) < Cos1Deg) return false;
            double minX = q[0].X, maxX = q[0].X, minY = q[0].Y, maxY = q[0].Y;
            foreach (var p in q)
            {
                if (p.X < minX) minX = p.X; if (p.X > maxX) maxX = p.X;
                if (p.Y < minY) minY = p.Y; if (p.Y > maxY) maxY = p.Y;
            }
            width = Math.Round(maxX - minX);
            depth = Math.Round(maxY - minY);
            return width >= 1 && depth >= 1;
        }

        // hsection: 도심 원점화 → |x| 고유값 2개(tw/2·b/2)·|y| 고유값 2개(h/2−tf·h/2) 클러스터 →
        // {b,h,tw,tf} 역산(mm 반올림) → canonical 12점 재구성과 양방향 대조.
        // 검증 톨러런스 = max(tol, 1mm): mm 정수 반올림 자체가 최대 ~0.7mm 편차라 1mm 미만은 자기모순.
        static bool TryHSection(List<Point2d> q, double tol, SectionFit r)
        {
            for (int i = 0; i < 12; i++) // 축정렬 게이트(전 에지 축평행 ~1°) — 회전 H = polygon 폴백
            {
                double dx = q[(i + 1) % 12].X - q[i].X, dy = q[(i + 1) % 12].Y - q[i].Y;
                double l = Math.Sqrt(dx * dx + dy * dy);
                if (l < tol) return false;
                if (Math.Abs(dx / l) < Cos1Deg && Math.Abs(dy / l) < Cos1Deg) return false;
            }
            var c = AreaCentroid(q);
            var ctr = new List<Point2d>(12);
            var xs = new List<double>(12); var ys = new List<double>(12);
            foreach (var p in q)
            {
                var pp = new Point2d(p.X - c.X, p.Y - c.Y);
                ctr.Add(pp); xs.Add(pp.X); ys.Add(pp.Y);
            }
            double ctol = Math.Max(tol, 0.5); // mm 클러스터 톨러런스
            var cx = ClusterAbs(xs, ctol);
            var cy = ClusterAbs(ys, ctol);
            if (cx.Count != 2 || cy.Count != 2) return false;
            double b = Math.Round(2 * cx[1]), tw = Math.Round(2 * cx[0]);
            double h = Math.Round(2 * cy[1]), tf = Math.Round(cy[1] - cy[0]);
            if (b < 1 || h < 1 || tw < 1 || tf < 1 || tw >= b || 2 * tf >= h) return false;
            double vtol = Math.Max(tol, 1.0);
            var canon = CanonH(b, h, tw, tf);
            foreach (var p in ctr) if (MinDist(p, canon) > vtol) return false;
            foreach (var p in canon) if (MinDist(p, ctr) > vtol) return false;
            r.Shape = "hsection"; r.Width = b; r.Depth = h; r.Web = tw; r.Flange = tf;
            r.Area = 2 * b * tf + (h - 2 * tf) * tw; // 해석 면적
            return true;
        }

        // canonical H(I형강) 12점 CCW — 원점 도심, 플랜지 상하 대칭. core sectionRing(hsection)과 동형.
        static List<Point2d> CanonH(double b, double h, double tw, double tf)
        {
            double hw = b / 2, hh = h / 2, wt = tw / 2, iy = hh - tf;
            return new List<Point2d>
            {
                new Point2d(-hw, -hh), new Point2d(hw, -hh), new Point2d(hw, -iy), new Point2d(wt, -iy),
                new Point2d(wt, iy),   new Point2d(hw, iy),  new Point2d(hw, hh),  new Point2d(-hw, hh),
                new Point2d(-hw, iy),  new Point2d(-wt, iy), new Point2d(-wt, -iy), new Point2d(-hw, -iy),
            };
        }

        static double MinDist(Point2d p, List<Point2d> set)
        {
            double best = double.MaxValue;
            foreach (var s in set) { double d = p.DistanceTo(s); if (d < best) best = d; }
            return best;
        }

        // |값| 클러스터 평균(오름차순) — 정렬 후 이웃 간극 > tol이면 새 클러스터.
        static List<double> ClusterAbs(List<double> vals, double tol)
        {
            var v = new List<double>(vals.Count);
            foreach (var x in vals) v.Add(Math.Abs(x));
            v.Sort();
            var means = new List<double>();
            int start = 0;
            for (int i = 1; i <= v.Count; i++)
            {
                if (i == v.Count || v[i] - v[i - 1] > tol)
                {
                    double s = 0;
                    for (int k = start; k < i; k++) s += v[k];
                    means.Add(s / (i - start));
                    start = i;
                }
            }
            return means;
        }

        // 닫힌 폴리곤 Douglas-Peucker — p0 앵커 + 닫는점 부가로 open 체인화(끝점 유지 보장).
        static List<Point2d> DouglasPeucker(List<Point2d> pts, double eps)
        {
            if (pts.Count <= 3) return new List<Point2d>(pts);
            var chain = new List<Point2d>(pts) { pts[0] };
            var keep = new bool[chain.Count];
            keep[0] = true; keep[chain.Count - 1] = true;
            DPRec(chain, 0, chain.Count - 1, eps, keep);
            var res = new List<Point2d>();
            for (int i = 0; i < chain.Count - 1; i++) if (keep[i]) res.Add(chain[i]);
            return res;
        }

        static void DPRec(List<Point2d> p, int i, int j, double eps, bool[] keep)
        {
            double dmax = 0; int idx = -1;
            for (int k = i + 1; k < j; k++)
            {
                double d = PerpDist(p[k], p[i], p[j]);
                if (d > dmax) { dmax = d; idx = k; }
            }
            if (idx >= 0 && dmax > eps)
            {
                keep[idx] = true;
                DPRec(p, i, idx, eps, keep);
                DPRec(p, idx, j, eps, keep);
            }
        }

        // 점→선분(a,b) 수직거리(a≈b면 점거리).
        static double PerpDist(Point2d p, Point2d a, Point2d b)
        {
            double vx = b.X - a.X, vy = b.Y - a.Y;
            double l2 = vx * vx + vy * vy;
            if (l2 < 1e-18) return p.DistanceTo(a);
            return Math.Abs(vx * (p.Y - a.Y) - vy * (p.X - a.X)) / Math.Sqrt(l2);
        }

        // 슈레이스 부호 면적(CCW 양수).
        static double Shoelace(List<Point2d> p)
        {
            double s = 0;
            for (int i = 0; i < p.Count; i++)
            {
                var a = p[i]; var b = p[(i + 1) % p.Count];
                s += a.X * b.Y - b.X * a.Y;
            }
            return s / 2;
        }

        // 면적 도심(퇴화 시 정점 평균 폴백).
        static Point2d AreaCentroid(List<Point2d> p)
        {
            double a = 0, cx = 0, cy = 0;
            for (int i = 0; i < p.Count; i++)
            {
                var s = p[i]; var t = p[(i + 1) % p.Count];
                double cr = s.X * t.Y - t.X * s.Y;
                a += cr; cx += (s.X + t.X) * cr; cy += (s.Y + t.Y) * cr;
            }
            a /= 2;
            if (Math.Abs(a) < 1e-9)
            {
                double mx = 0, my = 0;
                foreach (var v in p) { mx += v.X; my += v.Y; }
                return new Point2d(mx / p.Count, my / p.Count);
            }
            return new Point2d(cx / (6 * a), cy / (6 * a));
        }
    }
}
