// FigcadStories.cs — 지오메트리 z-분포에서 층(story) 감지 (순수, System만 의존).
// =============================================================================
// 레벨 구조화 M1/M3 (docs/level-structuring-plan.md): 후보 앵커(슬라브 상면 z 면적가중 1차 +
// 벽/기둥 base z 2차)를 1-D 갭 분할 클러스터링 → 가중 중앙값 → 최소지지 필터 → 지붕 강등.
// RhinoCommon 의존 0 → dotnet test(connectors/rhino/tests) 헤드리스 검증 + MCP pasteable.
// 좌표는 문서 mm — 감지·배정 전부 절대 z(리센터는 XY 전용이라 무영향).
// 오너 디폴트(플랜 명시): 절대표고 유지(리센터 없음) · 지붕=최상단 슬라브-단독 클러스터 강등 ·
// 층 이름 '1층·2층·…' 오름차순(지하 추론 없음, v1).
// =============================================================================
using System;
using System.Collections.Generic;

namespace Figcad
{
    // 감지 입력 앵커 — kind + bbox z 범위 + 평면적(슬라브 가중치; bbox dx*dy mm²).
    public sealed class StoryAnchor
    {
        public string Kind;
        public double MinZ, MaxZ;
        public double PlanAreaMm2;
    }

    // 감지된 층 1개 — elevation/height mm 정수, 지지 census 포함.
    public sealed class Story
    {
        public int ElevationMm;
        public int HeightMm;
        public int SlabCount, BaseCount; // base = wall+column
        public double SlabAreaMm2;
    }

    // 감지 결과 — 오름차순 층 목록 + 진단 카운터 + 배정/리포트.
    public sealed class StoryTable
    {
        public readonly List<Story> Stories = new List<Story>();
        public int DemotedRoofSlabs, MergedClusters, DroppedClusters;

        // 배정: 밴드 포함 + 아래 방향 250mm 스냅. 최저층 미만 = 0 클램프. 빈 테이블 = 0.
        public int ResolveLevel(double anchorZ)
        {
            if (Stories.Count == 0) return 0;
            int z = (int)Math.Round(anchorZ) + FigcadStories.AssignSnapMm;
            int k = 0;
            for (int i = 0; i < Stories.Count; i++)
                if (Stories[i].ElevationMm <= z) k = i;
            return k;
        }

        // census 한 블록 — push 리포트·패널 미리보기·하네스 공유 포맷 (골든 문자열 테스트로 동결).
        public string Report()
        {
            if (Stories.Count == 0) return "층후보 0";
            var parts = new List<string>();
            foreach (var s in Stories)
                parts.Add("EL" + s.ElevationMm + "(슬" + s.SlabCount + "·벽기" + s.BaseCount + ")");
            return "층후보 " + Stories.Count + " [" + string.Join(" ", parts) + "]"
                + " 지붕강등" + DemotedRoofSlabs + " 병합" + MergedClusters
                + (DroppedClusters > 0 ? " 탈락" + DroppedClusters : "");
        }
    }

    public static class FigcadStories
    {
        // ---- 임계값 (mm) — 전부 명명 상수, 튜닝은 여기 한 곳 ----
        public const int GapSplitMm = 1000;            // 1-D 클러스터 분할 갭
        public const int MinStorySeparationMm = 2000;  // 이보다 가까운 클러스터 = 병합 (메자닌 규칙)
        public const int MinBaseSupport = 3;           // 슬라브 없는 클러스터의 최소 벽/기둥 지지
        public const double MinSlabAreaMm2 = 1_000_000; // 1㎡ — 클러스터 유효 슬라브 면적
        public const int AssignSnapMm = 250;           // ResolveLevel 아래 방향 노이즈 스냅
        public const int DefaultTopHeightMm = 3000;    // 최상층 층고 폴백 (ifcImport 관례)

        // 배정 앵커 — 감지와 별개로 모든 kind에 정의:
        // slab=상면(MaxZ) · beam=축 중앙((Min+Max)/2, core 파생 기본값 '레벨 상단 근처' 재현) ·
        // 그 외(wall/column/stair/railing/…)=base(MinZ). stair는 base 층 배정 + 실측 rise 유지.
        public static double AnchorZ(string kind, double minZ, double maxZ)
        {
            if (kind == "slab") return maxZ;
            if (kind == "beam") return (minZ + maxZ) / 2.0;
            return minZ;
        }

        // 감지 — 슬라브 상면(면적가중 1차) + 벽/기둥 base(2차). beam/stair/railing 제외(노이즈).
        public static StoryTable Detect(IEnumerable<StoryAnchor> anchors)
        {
            var table = new StoryTable();
            // 1) 감지 앵커 수집: (z, isSlab, weight)
            var pts = new List<(int Z, bool Slab, double Area)>();
            foreach (var a in anchors)
            {
                if (a == null || a.Kind == null) continue;
                if (a.Kind == "slab") pts.Add(((int)Math.Round(a.MaxZ), true, Math.Max(a.PlanAreaMm2, 0)));
                else if (a.Kind == "wall" || a.Kind == "column") pts.Add(((int)Math.Round(a.MinZ), false, 0));
            }
            if (pts.Count == 0) return table;
            pts.Sort((x, y) => x.Z.CompareTo(y.Z));

            // 2) 갭 분할 클러스터
            var clusters = new List<List<(int Z, bool Slab, double Area)>> { new List<(int, bool, double)> { pts[0] } };
            for (int i = 1; i < pts.Count; i++)
            {
                if (pts[i].Z - pts[i - 1].Z > GapSplitMm) clusters.Add(new List<(int, bool, double)>());
                clusters[clusters.Count - 1].Add(pts[i]);
            }

            // 3) 클러스터 → 임시 층 (elevation = 유효 슬라브 있으면 면적가중 중앙값, 아니면 전체 중앙값)
            var provisional = new List<Story>();
            foreach (var c in clusters)
            {
                var s = Summarize(c);
                provisional.Add(s);
            }

            // 4) 병합 (메자닌): 직전 유지 층과 elevation 차 < MinStorySeparationMm → 흡수
            var merged = new List<(Story S, List<(int Z, bool Slab, double Area)> Pts)>();
            for (int i = 0; i < provisional.Count; i++)
            {
                if (merged.Count > 0 && provisional[i].ElevationMm - merged[merged.Count - 1].S.ElevationMm < MinStorySeparationMm)
                {
                    merged[merged.Count - 1].Pts.AddRange(clusters[i]);
                    var re = Summarize(merged[merged.Count - 1].Pts);
                    merged[merged.Count - 1] = (re, merged[merged.Count - 1].Pts);
                    table.MergedClusters++;
                }
                else merged.Add((provisional[i], new List<(int, bool, double)>(clusters[i])));
            }

            // 5) 최소지지 필터 — 슬라브 1㎡ 이상 or 벽/기둥 3개 이상. 전멸 방지: 최다 지지 1개는 유지.
            var kept = new List<Story>();
            foreach (var (s, _) in merged)
            {
                if (s.SlabAreaMm2 >= MinSlabAreaMm2 || s.BaseCount >= MinBaseSupport) kept.Add(s);
                else table.DroppedClusters++;
            }
            if (kept.Count == 0)
            {
                Story best = merged[0].S;
                foreach (var (s, _) in merged)
                    if (s.SlabAreaMm2 + s.BaseCount * MinSlabAreaMm2 > best.SlabAreaMm2 + best.BaseCount * MinSlabAreaMm2) best = s;
                kept.Add(best);
                table.DroppedClusters--; // best는 탈락 아님
            }

            // 6) 지붕 강등 — 생존 ≥2 이고 최상단이 슬라브-단독(base 0)이면 층 아님 (아래층 지붕 슬라브)
            if (kept.Count >= 2 && kept[kept.Count - 1].BaseCount == 0 && kept[kept.Count - 1].SlabCount > 0)
            {
                table.DemotedRoofSlabs += kept[kept.Count - 1].SlabCount;
                kept.RemoveAt(kept.Count - 1);
            }

            // 7) 층고: 다음 층까지 거리, 최상층 = 폴백
            for (int i = 0; i < kept.Count; i++)
                kept[i].HeightMm = i + 1 < kept.Count ? kept[i + 1].ElevationMm - kept[i].ElevationMm : DefaultTopHeightMm;

            table.Stories.AddRange(kept);
            return table;
        }

        // 클러스터 요약 — elevation·지지 census.
        static Story Summarize(List<(int Z, bool Slab, double Area)> c)
        {
            c.Sort((x, y) => x.Z.CompareTo(y.Z));
            var s = new Story();
            double slabArea = 0;
            foreach (var p in c)
            {
                if (p.Slab) { s.SlabCount++; slabArea += p.Area; }
                else s.BaseCount++;
            }
            s.SlabAreaMm2 = slabArea;
            if (slabArea >= MinSlabAreaMm2)
            {
                // 면적가중 중앙값 (슬라브 상면만) — 큰 바닥판이 기준, 소형 단차판에 안 끌려감
                double half = slabArea / 2, acc = 0;
                foreach (var p in c)
                {
                    if (!p.Slab) continue;
                    acc += p.Area;
                    if (acc >= half) { s.ElevationMm = p.Z; break; }
                }
            }
            else s.ElevationMm = c[c.Count / 2].Z; // 전체 중앙값
            return s;
        }
    }
}
