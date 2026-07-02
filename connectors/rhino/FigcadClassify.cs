// FigcadClassify.cs — 레이어/객체 → Figcad kind 분류 (순수, System만 의존).
// =============================================================================
// KindFromLayer = 단일 분류 진실원(레이어 시맨틱: S-Column=기둥·S-Connection=보 등).
// ResolveKind   = 우선순위 [객체 figcad:kind] > [레이어맵 override(패널)] > [KindFromLayer(자동)].
// FigcadLayerMap= 패널이 편집·영속하는 레이어 full-path → kind 맵.
// RhinoCommon/PlugIn.Settings 의존 0 → MCP(execute_rhinocommon_csharp_code)로 pasteable·유닛검증 가능.
// =============================================================================
using System;
using System.Collections.Generic;

namespace Figcad
{
    // 레이어 full-path → kind override 맵. kind ∈ column|wall|slab|beam|stair|railing|ignore.
    // ignore = 명시적 잔여(Lane-2로 보냄). 맵에 없는 레이어 = KindFromLayer 폴백.
    public class FigcadLayerMap
    {
        public readonly Dictionary<string, string> Map = new Dictionary<string, string>();
        public void Set(string layerFullPath, string kind) { if (!string.IsNullOrEmpty(layerFullPath)) Map[layerFullPath] = kind; }
        public bool TryGet(string layerFullPath, out string kind) => Map.TryGetValue(layerFullPath ?? "", out kind);
        public int Count => Map.Count;
    }

    public static class FigcadClassify
    {
        // 유효 kind 집합(패널 콤보 + 검증). "ignore" 포함(잔여 강제).
        public static readonly string[] Kinds = { "column", "wall", "slab", "beam", "stair", "railing", "ignore" };

        // 우선순위: ① 객체 figcad:kind → ② 레이어맵 override → ③ KindFromLayer(자동). ignore/미지 = null(잔여).
        public static string ResolveKind(string kindOverride, string layerFullPath, FigcadLayerMap map)
        {
            var k = Norm(kindOverride);
            if (k != null) return k == "ignore" ? null : k;
            if (map != null && map.TryGet(layerFullPath, out var mk))
            {
                var nk = Norm(mk);
                if (nk != null) return nk == "ignore" ? null : nk;
            }
            return KindFromLayer(layerFullPath);
        }

        // 명시적 지정 여부 — 객체 figcad:kind 또는 레이어맵이 유효 kind로 해석되면 true.
        // (레이어 시맨틱 자동분류 = 추측 → 타당성 상한 적용 / 명시적 지정 = 사용자 의사 → 상한 스킵.)
        public static bool IsExplicitKind(string kindOverride, string layerFullPath, FigcadLayerMap map)
        {
            if (Norm(kindOverride) != null) return true;
            if (map != null && map.TryGet(layerFullPath, out var mk) && Norm(mk) != null) return true;
            return false;
        }

        // 문자열 → 유효 kind(소문자 트림), 아니면 null(폴백 유도).
        static string Norm(string s)
        {
            if (string.IsNullOrWhiteSpace(s)) return null;
            s = s.Trim().ToLowerInvariant();
            foreach (var k in Kinds) if (s == k) return k;
            return null;
        }

        // 레이어 full-path → Figcad kind (부모경로가 시맨틱: S-Column=기둥·S-Connection=보·A-Wall=벽·
        // S-Slab=슬라브). 순수 지오 분류는 H형강서 fragile → 레이어가 kind, 지오가 params.
        // 미지 레이어(glass/logo 등)=null=잔여(Lane-2). 관례 없는 모델은 전부 잔여(정직 — garbage보다 나음).
        public static string KindFromLayer(string p)
        {
            if (string.IsNullOrEmpty(p)) return null;
            // 토큰 분리(::, -, _, 공백 등) 후 *whole-token* 매칭 — 부분문자열은 오탐("wallpaper"→wall,
            // "flooring"→floor, "scolumn"→column). 한글은 token-contains(어절 분리 불확실)로 절충.
            var toks = new HashSet<string>(p.ToLowerInvariant().Split(new[] { ':', '-', '_', ' ', '/', '.', ',' }, StringSplitOptions.RemoveEmptyEntries));
            bool Has(params string[] ks) { foreach (var k in ks) if (toks.Contains(k)) return true; return false; }
            bool HasKo(params string[] ks) { foreach (var k in ks) if (p.Contains(k)) return true; return false; }
            if (Has("column", "col") || HasKo("기둥")) return "column";
            if (Has("connection", "beam", "girder") || HasKo("보")) return "beam";
            if (Has("stair", "stairs") || HasKo("계단")) return "stair";
            if (Has("railing", "handrail", "rail", "guardrail") || HasKo("난간")) return "railing";
            if (Has("wall") || HasKo("벽")) return "wall";
            if (Has("slab", "floor") || HasKo("슬라브", "바닥")) return "slab";
            return null;
        }
    }
}
