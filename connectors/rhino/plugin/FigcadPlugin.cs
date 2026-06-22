// FigcadPlugin.cs — .rhp 플러그인 진입점 + Rhino 명령 (M13-G 설치형).
// FigcadConnector.cs(코어 로직)를 감싸 설치형 플러그인으로. 빌드 = FigcadPlugin.csproj 참조.
// 설치 후 Rhino 명령줄: FigcadPull / FigcadPush / FigcadPushBreps.
using System;
using System.Runtime.InteropServices;
using Rhino;
using Rhino.Commands;
using Rhino.Input;
using Rhino.PlugIns;

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
    }

    // 공통 — 룸 id 프롬프트 + BaseUrl. 로컬 테스트면 DefaultBaseUrl을 http://localhost:8787 로.
    public abstract class FigcadCommandBase : Command
    {
        protected const string DefaultBaseUrl = "https://lfthfigcad-production.up.railway.app";
        protected FigcadConfig Prompt()
        {
            string room = "";
            var r = RhinoGet.GetString("Figcad 룸 id (브라우저 ?p= 값)", false, ref room);
            if (r != Result.Success || string.IsNullOrWhiteSpace(room)) return null;
            return new FigcadConfig { BaseUrl = DefaultBaseUrl, Room = room.Trim() };
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

    public class FigcadPushCommand : FigcadCommandBase
    {
        public override string EnglishName => "FigcadPush";
        protected override Result RunCommand(RhinoDoc doc, RunMode mode) => Run(doc, cfg => FigcadConnector.Push(doc, cfg), false);
    }

    // M13-G: Brep 기계적 리프트 (기둥·벽·슬라브·보 인식 → Figcad ops + 충실도 보고). 새 룸에 1회 권장.
    public class FigcadPushBrepsCommand : FigcadCommandBase
    {
        public override string EnglishName => "FigcadPushBreps";
        protected override Result RunCommand(RhinoDoc doc, RunMode mode) => Run(doc, cfg => FigcadConnector.PushBreps(doc, cfg), false);
    }
}
