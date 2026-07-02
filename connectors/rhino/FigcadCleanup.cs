// FigcadCleanup.cs — push 전 결정적(비-AI) 지오 클린업 (중복·근축 직교화·끝점 그리드 용접).
// =============================================================================
// Detect() = 무변형 제안(삭제 후보 id + 라인 교체). Apply() = 단일 undo 레코드로 커밋(한 번 Ctrl+Z 복구).
// 비파괴 기본: 감지는 자유, 변형은 명시적 Apply만. 보수적 tol(오탐=실지오 삭제/왜곡 방지).
// 라인 정리는 2점 라인 곡선(벽 축선 Push 경로)만 — 서버 mm-== 마이터 조인 충족이 핵심 근거.
// PlugIn.Settings 의존 0 → MCP로 합성 doc 유닛검증 가능.
// =============================================================================
using System;
using System.Collections.Generic;
using System.Text;
using Rhino;
using Rhino.DocObjects;
using Rhino.Geometry;

namespace Figcad
{
    public class LineEdit { public Guid Id; public Point3d A; public Point3d B; }

    public class CleanupResult
    {
        public List<Guid> DuplicateDeletes = new List<Guid>(); // 그룹당 1개 남기고 삭제 후보
        public List<LineEdit> LineEdits = new List<LineEdit>(); // 직교화+용접 합성된 최종 라인
        public int DuplicateGroups;
        public int Straightened;
        public int WeldedEndpoints;
        public bool IsEmpty => DuplicateDeletes.Count == 0 && LineEdits.Count == 0;
        public string Summary() =>
            "중복 " + DuplicateDeletes.Count + "개(" + DuplicateGroups + "그룹) · 직교화 " + Straightened + " · 끝점용접 " + WeldedEndpoints + "점";
    }

    public static class FigcadCleanup
    {
        const string IdKey = "figcad:id";

        // 감지(무변형). dedup=중복, straighten=근축 직교화, weld=끝점 그리드 용접. tol은 mm/도.
        public static CleanupResult Detect(RhinoDoc doc, bool dedup, bool straighten, bool weld, double angleTolDeg, double weldTolMm)
        {
            var r = new CleanupResult();
            // 후보 = figcad 소유 아닌 객체(Push 대상과 동일 범위).
            var objs = new List<RhinoObject>();
            foreach (var o in doc.Objects) if (string.IsNullOrEmpty(o.Attributes.GetUserString(IdKey))) objs.Add(o);

            if (dedup) DetectDuplicates(objs, r);

            if (straighten || weld)
            {
                var del = new HashSet<Guid>(r.DuplicateDeletes);
                var lines = new List<LineItem>();
                foreach (var o in objs)
                {
                    if (del.Contains(o.Id)) continue;
                    Point3d a, b;
                    if (!AsLine(o.Geometry as Curve, out a, out b)) continue;
                    lines.Add(new LineItem { Id = o.Id, A = a, B = b, OA = a, OB = b });
                }
                if (straighten)
                {
                    double tolRad = angleTolDeg * Math.PI / 180.0;
                    foreach (var ln in lines) if (Straighten(ln, tolRad)) r.Straightened++;
                }
                if (weld) r.WeldedEndpoints += WeldEndpoints(lines, weldTolMm);
                foreach (var ln in lines)
                    if (ln.A.DistanceTo(ln.OA) > 1e-6 || ln.B.DistanceTo(ln.OB) > 1e-6)
                        r.LineEdits.Add(new LineEdit { Id = ln.Id, A = ln.A, B = ln.B });
            }
            return r;
        }

        // 원본 doc에 커밋(Mode A) — 단일 undo. Mode B(push 데이터만)는 패널이 Apply→Push→_Undo로 오케스트레이션.
        public static string Apply(RhinoDoc doc, CleanupResult r, bool applyDeletes, bool applyLineEdits)
        {
            uint undo = doc.BeginUndoRecord("Figcad Cleanup");
            int del = 0, edt = 0;
            try
            {
                if (applyDeletes) foreach (var id in r.DuplicateDeletes) if (doc.Objects.Delete(id, true)) del++;
                if (applyLineEdits) foreach (var e in r.LineEdits) if (doc.Objects.Replace(e.Id, new LineCurve(e.A, e.B))) edt++;
            }
            finally { doc.EndUndoRecord(undo); }
            doc.Views.Redraw();
            return "클린업 적용: 중복삭제 " + del + " · 라인수정 " + edt + " (Ctrl+Z 한 번으로 복구)";
        }

        // #6 아이솔레이트 — 문제 객체만 남기고 나머지(figcad 소유 아닌 Push 후보) 잠금 + 문제 선택.
        // 잠근 id 반환(복원용). 이미 잠긴 것·figcad 소유는 안 건드림(정확 복원).
        public static List<Guid> IsolateFlagged(RhinoDoc doc, CleanupResult r)
        {
            var flagged = new HashSet<Guid>(r.DuplicateDeletes);
            foreach (var e in r.LineEdits) flagged.Add(e.Id);
            var locked = new List<Guid>();
            foreach (var o in doc.Objects)
            {
                if (flagged.Contains(o.Id)) continue;
                if (o.IsLocked) continue;
                if (!string.IsNullOrEmpty(o.Attributes.GetUserString(IdKey))) continue; // figcad 소유는 유지
                if (doc.Objects.Lock(o.Id, true)) locked.Add(o.Id);
            }
            if (flagged.Count > 0) doc.Objects.Select(flagged, true);
            doc.Views.Redraw();
            return locked;
        }

        // 아이솔레이트 복원 — 기록된 id만 잠금 해제(다른 잠긴 객체는 그대로).
        public static void RestoreIsolate(RhinoDoc doc, List<Guid> lockedIds)
        {
            if (lockedIds == null) return;
            foreach (var id in lockedIds) doc.Objects.Unlock(id, true);
            doc.Views.Redraw();
        }

        // ---- 중복: 반올림 기하 해시 버킷 → 버킷 내 GeometryEquals 확인(해시 충돌 방어) → 그룹당 1개 남김 ----
        static void DetectDuplicates(List<RhinoObject> objs, CleanupResult r)
        {
            var buckets = new Dictionary<string, List<RhinoObject>>();
            foreach (var o in objs)
            {
                var g = o.Geometry; if (g == null) continue;
                string key = GeomHash(g); if (key == null) continue;
                if (!buckets.TryGetValue(key, out var lst)) { lst = new List<RhinoObject>(); buckets[key] = lst; }
                lst.Add(o);
            }
            foreach (var kv in buckets)
            {
                var v = kv.Value;
                if (v.Count < 2) continue;
                var used = new bool[v.Count];
                for (int i = 0; i < v.Count; i++)
                {
                    if (used[i]) continue;
                    var group = new List<int> { i };
                    for (int j = i + 1; j < v.Count; j++)
                    {
                        if (used[j]) continue;
                        if (GeometryBase.GeometryEquals(v[i].Geometry, v[j].Geometry)) { group.Add(j); used[j] = true; }
                    }
                    if (group.Count >= 2)
                    {
                        r.DuplicateGroups++;
                        for (int gi = 1; gi < group.Count; gi++) r.DuplicateDeletes.Add(v[group[gi]].Id);
                    }
                }
            }
        }

        static string GeomHash(GeometryBase g)
        {
            var bb = g.GetBoundingBox(true);
            if (!bb.IsValid) return null;
            long RB(double v) => (long)Math.Round(v);
            var sb = new StringBuilder(g.ObjectType.ToString());
            sb.Append('|').Append(RB(bb.Min.X)).Append(',').Append(RB(bb.Min.Y)).Append(',').Append(RB(bb.Min.Z));
            sb.Append('|').Append(RB(bb.Max.X)).Append(',').Append(RB(bb.Max.Y)).Append(',').Append(RB(bb.Max.Z));
            if (g is Curve crv) sb.Append('|').Append(RB(crv.GetLength()));
            return sb.ToString();
        }

        // ---- 라인 정리 ----
        class LineItem { public Guid Id; public Point3d A, B, OA, OB; }

        static bool AsLine(Curve crv, out Point3d a, out Point3d b)
        {
            a = Point3d.Origin; b = Point3d.Origin;
            if (crv == null) return false;
            if (crv.IsLinear(1e-6)) { a = crv.PointAtStart; b = crv.PointAtEnd; return a.DistanceTo(b) > 1e-6; }
            Polyline pl;
            if (crv.TryGetPolyline(out pl) && pl.Count == 2) { a = pl[0]; b = pl[1]; return a.DistanceTo(b) > 1e-6; }
            return false;
        }

        // 근축(0/90/180/270°) 이내면 off-axis 좌표 평균화로 직교 스냅. XY 평면 기준(축선은 평면), Z 유지.
        static bool Straighten(LineItem ln, double tolRad)
        {
            var d = ln.B - ln.A;
            if (d.Length < 1e-6) return false;
            double ang = Math.Atan2(d.Y, d.X);
            double nearest = Math.Round(ang / (Math.PI / 2)) * (Math.PI / 2);
            if (Math.Abs(NormAngle(ang - nearest)) > tolRad) return false;
            bool xAxis = Math.Abs(Math.Cos(nearest)) > 0.5; // 0/180 = X축, 90/270 = Y축
            if (xAxis) { double m = (ln.A.Y + ln.B.Y) / 2; ln.A.Y = m; ln.B.Y = m; }
            else { double m = (ln.A.X + ln.B.X) / 2; ln.A.X = m; ln.B.X = m; }
            return true;
        }

        static double NormAngle(double x)
        {
            while (x > Math.PI) x -= 2 * Math.PI;
            while (x < -Math.PI) x += 2 * Math.PI;
            return x;
        }

        // 근접 끝점(weldTol 이내)을 클러스터링(그리드 union-find) → 클러스터≥2를 round(centroid) 정수 mm로.
        // 정수 mm 타깃이 핵심: Push가 Math.Round(int mm)이라 0.3mm 차가 .5 경계서 다른 int로 갈릴 수 있음.
        static int WeldEndpoints(List<LineItem> lines, double tol)
        {
            if (tol <= 0 || lines.Count == 0) return 0;
            var pts = new List<Point3d>();
            var owner = new List<(int li, int which)>();
            for (int i = 0; i < lines.Count; i++) { pts.Add(lines[i].A); owner.Add((i, 0)); pts.Add(lines[i].B); owner.Add((i, 1)); }
            int n = pts.Count;
            var parent = new int[n];
            for (int i = 0; i < n; i++) parent[i] = i;
            int Find(int x) { while (parent[x] != x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; }
            void Union(int x, int y) { int rx = Find(x), ry = Find(y); if (rx != ry) parent[rx] = ry; }

            var grid = new Dictionary<(long, long, long), List<int>>();
            (long, long, long) Cell(Point3d p) => ((long)Math.Floor(p.X / tol), (long)Math.Floor(p.Y / tol), (long)Math.Floor(p.Z / tol));
            for (int i = 0; i < n; i++) { var c = Cell(pts[i]); if (!grid.TryGetValue(c, out var l)) { l = new List<int>(); grid[c] = l; } l.Add(i); }
            for (int i = 0; i < n; i++)
            {
                var (cx, cy, cz) = Cell(pts[i]);
                for (long dx = -1; dx <= 1; dx++)
                    for (long dy = -1; dy <= 1; dy++)
                        for (long dz = -1; dz <= 1; dz++)
                            if (grid.TryGetValue((cx + dx, cy + dy, cz + dz), out var l))
                                foreach (var j in l) if (j > i && pts[i].DistanceTo(pts[j]) <= tol) Union(i, j);
            }
            var clusters = new Dictionary<int, List<int>>();
            for (int i = 0; i < n; i++) { int rr = Find(i); if (!clusters.TryGetValue(rr, out var l)) { l = new List<int>(); clusters[rr] = l; } l.Add(i); }
            int moved = 0;
            foreach (var cl in clusters.Values)
            {
                if (cl.Count < 2) continue;
                double sx = 0, sy = 0, sz = 0;
                foreach (var idx in cl) { sx += pts[idx].X; sy += pts[idx].Y; sz += pts[idx].Z; }
                var gp = new Point3d(Math.Round(sx / cl.Count), Math.Round(sy / cl.Count), Math.Round(sz / cl.Count));
                foreach (var idx in cl)
                {
                    if (pts[idx].DistanceTo(gp) > 1e-6) moved++;
                    var (li, which) = owner[idx];
                    if (which == 0) lines[li].A = gp; else lines[li].B = gp;
                }
            }
            return moved;
        }
    }
}
