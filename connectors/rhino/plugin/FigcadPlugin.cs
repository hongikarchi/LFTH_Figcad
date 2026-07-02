// FigcadPlugin.cs — .rhp 플러그인 진입점 + Rhino 명령 (M13-G 설치형 → v0.4 Push 통합).
// FigcadConnector.cs(코어 로직)를 감싸 설치형 플러그인으로. 빌드 = FigcadPlugin.csproj 참조.
// 설치 후 Rhino 명령줄: FigcadPull / FigcadPush(=PushAll 통합) / FigcadPushBreps(레거시 별칭).
using System;
using System.Runtime.InteropServices;
using Rhino;
using Rhino.Commands;
using Rhino.Input;
using Rhino.PlugIns;
using Rhino.UI;

// 플러그인 고유 id (변경 금지 — 한 번 정하면 유지). + 메타.
[assembly: Guid("e1f2a3b4-5c6d-7e8f-9a0b-1c2d3e4f5a6b")]
[assembly: PlugInDescription(DescriptionType.Organization, "LFTH")]
[assembly: PlugInDescription(DescriptionType.WebSite, "https://lfthfigcad-production.up.railway.app")]

namespace Figcad
{
    public class FigcadPlugin : PlugIn
    {
        public FigcadPlugin() { Instance = this; }
        public static FigcadPlugin Instance { get; private set; }

        protected override LoadReturnCode OnLoad(ref string errorMessage)
        {
            Panels.RegisterPanel(this, typeof(FigcadPanel), "Figcad", LoadIcon());
            return LoadReturnCode.Success;
        }

        // 임베드 브랜드 png → 패널 탭 아이콘. 리소스명은 네임스페이스 무관하게 접미사로 탐색.
        static System.Drawing.Icon LoadIcon()
        {
            try
            {
                var asm = typeof(FigcadPlugin).Assembly;
                var name = Array.Find(asm.GetManifestResourceNames(), x => x.EndsWith("figcad.png", StringComparison.OrdinalIgnoreCase));
                if (name == null) return null;
                using (var st = asm.GetManifestResourceStream(name))
                using (var bmp = new System.Drawing.Bitmap(st))
                    return System.Drawing.Icon.FromHandle(bmp.GetHicon());
            }
            catch { return null; }
        }
    }

    // 패널 열기 명령.
    public class FigcadPanelCommand : Command
    {
        public override string EnglishName => "FigcadPanel";
        protected override Result RunCommand(RhinoDoc doc, RunMode mode)
        {
            Panels.OpenPanel(typeof(FigcadPanel).GUID);
            return Result.Success;
        }
    }

    // 공통 — 룸 id 프롬프트 + BaseUrl. 저장된 룸을 기본값으로(엔터=재사용, #1 불만 해소). 패널은 별도 UI.
    public abstract class FigcadCommandBase : Command
    {
        protected FigcadConfig Prompt()
        {
            string room = FigcadSettings.Room;
            string hint = string.IsNullOrEmpty(room) ? "브라우저 ?p= 값" : "엔터=" + room;
            var r = RhinoGet.GetString("Figcad 룸 id (" + hint + ")", true, ref room); // acceptNothing=true → 엔터로 저장값 재사용
            if (r != Result.Success && r != Result.Nothing) return null;
            room = (room ?? "").Trim();
            if (string.IsNullOrEmpty(room)) return null;
            FigcadSettings.Room = room;
            FigcadSettings.PushRecent(room);
            return FigcadSettings.ToConfig();
        }
        protected Result Run(RhinoDoc doc, Func<FigcadConfig, string> fn, bool redraw)
        {
            var cfg = Prompt();
            if (cfg == null) return Result.Cancel;
            try { RhinoApp.WriteLine(fn(cfg)); if (redraw) doc.Views.Redraw(); }
            catch (Exception e) { RhinoApp.WriteLine("Figcad 오류: " + e.Message); return Result.Failure; }
            return Result.Success;
        }
    }

    public class FigcadPullCommand : FigcadCommandBase
    {
        public override string EnglishName => "FigcadPull";
        protected override Result RunCommand(RhinoDoc doc, RunMode mode) => Run(doc, cfg => FigcadConnector.Pull(doc, cfg), true);
    }

    // v0.4: Push = 통합 레인(커브 + 브렙 리프트 + Lane-2 잔여) — 충실도 보고 1장.
    public class FigcadPushCommand : FigcadCommandBase
    {
        public override string EnglishName => "FigcadPush";
        protected override Result RunCommand(RhinoDoc doc, RunMode mode) =>
            Run(doc, cfg => FigcadConnector.PushAll(doc, cfg, FigcadSettings.LoadMap(cfg.Room), FigcadSettings.VolTolFraction), false);
    }

    // 레거시 별칭 (M13-G) — FigcadPush로 통합됨. 브렙 레인만 실행(하위호환·모드B 클린업 경로).
    public class FigcadPushBrepsCommand : FigcadCommandBase
    {
        public override string EnglishName => "FigcadPushBreps";
        protected override Result RunCommand(RhinoDoc doc, RunMode mode)
        {
            RhinoApp.WriteLine("FigcadPushBreps는 FigcadPush로 통합됨 — 레거시 별칭(브렙 레인만 실행).");
            return Run(doc, cfg => FigcadConnector.PushBreps(doc, cfg, FigcadSettings.LoadMap(cfg.Room)), false);
        }
    }
}
