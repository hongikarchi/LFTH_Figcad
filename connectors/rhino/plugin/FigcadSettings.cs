// FigcadSettings.cs — 커넥터 설정 영속 (PlugIn.Settings = PersistentSettings).
// 룸/baseUrl/key + 최근 룸 목록 + 룸별 레이어→kind 맵. 룸 복붙 제거(#1 불만) + 패널 상태 단일 소스.
using System;
using System.Collections.Generic;
using Rhino;
using Rhino.PlugIns;

namespace Figcad
{
    public static class FigcadSettings
    {
        const string DefaultBaseUrl = "https://lfthfigcad-production.up.railway.app";

        static PersistentSettings S => FigcadPlugin.Instance != null ? FigcadPlugin.Instance.Settings : null;

        public static string Room
        {
            get { var s = S; return s != null ? s.GetString("room", "") : ""; }
            set { var s = S; if (s != null) s.SetString("room", value ?? ""); }
        }
        public static string BaseUrl
        {
            get { var s = S; return s != null ? s.GetString("baseUrl", DefaultBaseUrl) : DefaultBaseUrl; }
            set { var s = S; if (s != null) s.SetString("baseUrl", string.IsNullOrWhiteSpace(value) ? DefaultBaseUrl : value.Trim()); }
        }
        public static string Key
        {
            get { var s = S; return s != null ? s.GetString("key", "") : ""; }
            set { var s = S; if (s != null) s.SetString("key", value ?? ""); }
        }

        // v0.4 브렙 리프트 부피 오차 임계(%) — 1~10, 기본 3. PushAll/Preview의 CheckFidelity 게이트.
        public static double VolTolPercent
        {
            get { var s = S; double v = s != null ? s.GetDouble("volTolPercent", 3.0) : 3.0; return Math.Min(10.0, Math.Max(1.0, v)); }
            set { var s = S; if (s != null) s.SetDouble("volTolPercent", Math.Min(10.0, Math.Max(1.0, value))); }
        }
        public static double VolTolFraction => VolTolPercent / 100.0;

        // M3 층 자동 구조화 (베타) — 기본 OFF (OFF = v0.6 단일 레벨 경로 동일). 서버가 M2 dedup
        // 절대z 정규화 배포본이어야 재푸시 무중복 — 구서버에선 add_level unknown op = 신규층 요소 드롭(정직).
        public static bool MultiLevel
        {
            get { var s = S; return s != null && s.GetBool("multiLevel", false); }
            set { var s = S; if (s != null) s.SetBool("multiLevel", value); }
        }

        // 최근 룸 = 개행 join 문자열(룸 id는 A-Za-z0-9_-라 개행 충돌 없음 — GetStringList 의존 회피).
        public static string[] RecentRooms()
        {
            var s = S; if (s == null) return new string[0];
            var raw = s.GetString("recentRooms", "");
            return string.IsNullOrEmpty(raw) ? new string[0] : raw.Split('\n');
        }
        public static void PushRecent(string room)
        {
            if (string.IsNullOrWhiteSpace(room)) return;
            room = room.Trim();
            var list = new List<string>(RecentRooms());
            list.RemoveAll(x => x == room);
            list.Insert(0, room);
            if (list.Count > 10) list = list.GetRange(0, 10);
            var s = S; if (s != null) s.SetString("recentRooms", string.Join("\n", list));
        }

        public static FigcadConfig ToConfig() =>
            new FigcadConfig { BaseUrl = BaseUrl, Room = Room, Key = string.IsNullOrWhiteSpace(Key) ? null : Key };

        // ---- 룸별 레이어→kind 맵 (child collection: layermap/<room>/<layerFullPath> = kind) ----
        // full-path는 ::/공백 포함이라 구분자 문자열 불가 → PersistentSettings child collection 사용.
        public static FigcadLayerMap LoadMap(string room)
        {
            var map = new FigcadLayerMap();
            var s = S; if (s == null || string.IsNullOrWhiteSpace(room)) return map;
            try
            {
                if (s.TryGetChild("layermap", out var lm) && lm.TryGetChild(room, out var rm))
                    foreach (var k in rm.Keys) { var v = rm.GetString(k, null); if (!string.IsNullOrEmpty(v)) map.Set(k, v); }
            }
            catch { }
            return map;
        }
        public static void SaveMap(string room, FigcadLayerMap map)
        {
            var s = S; if (s == null || string.IsNullOrWhiteSpace(room) || map == null) return;
            try
            {
                var rm = s.AddChild("layermap").AddChild(room);
                foreach (var k in new List<string>(rm.Keys)) { try { rm.DeleteItem(k); } catch { } } // 삭제된 매핑 반영
                foreach (var kv in map.Map) rm.SetString(kv.Key, kv.Value);
            }
            catch { }
        }
    }
}
