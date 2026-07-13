// FigcadPanel.cs — Rhino 도킹 패널 (Eto.Forms — 네이티브 테마). 폭 고정(가로스크롤 없음)·필드 도움말·
// 레이어 매핑(선택+드롭다운)·preview·클린업(아이솔레이트). 코어(FigcadConnector/Classify/Cleanup) 재사용.
using System;
using System.Collections.Generic;
using Eto.Drawing;
using Eto.Forms;
using Rhino;

namespace Figcad
{
    [System.Runtime.InteropServices.Guid("b2c3d4e5-6f70-8192-a3b4-c5d6e7f80912")]
    public class FigcadPanel : Panel
    {
        const string Auto = "(자동)";
        static readonly string[] KindItems = { Auto, "column", "wall", "slab", "beam", "stair", "railing", "ignore" };

        ComboBox _room;
        TextBox _base;
        PasswordBox _key;
        TextArea _log;
        GridView _grid;
        DropDown _kindPick;
        List<LayerRow> _rows = new List<LayerRow>();
        Button _btnPreview;
        CheckBox _cbMultiLevel;
        CheckBox _cbDup, _cbStraight, _cbWeld;
        NumericStepper _numAngle, _numWeld, _numVolTol;
        RadioButton _rbModeA, _rbModeB;
        FigcadPreviewConduit _conduit;
        CleanupResult _lastCleanup;
        List<Guid> _isolateLocked;

        public class LayerRow { public string Layer { get; set; } public string Kind { get; set; } }

        public FigcadPanel(uint documentSerialNumber)
        {
            BuildUi();
            LoadConn();
        }

        void BuildUi()
        {
            var body = new DynamicLayout { Padding = new Padding(8), DefaultSpacing = new Size(6, 4) };

            // 연결 — 라벨 위 / 컨트롤 폭전체 / 힌트 아래 (좁은 패널서도 딱 맞음)
            body.AddRow(Header("연결"));
            body.AddRow(new Label { Text = "룸 id (?p=)" });
            body.AddRow(_room = new ComboBox());
            body.AddRow(Hint("브라우저에서 Figcad 열면 주소 끝 ?p= 뒤에 붙는 값. \"어떤 프로젝트에 연결할지\"를 정함."));
            body.AddRow(new Label { Text = "서버 URL" });
            body.AddRow(_base = new TextBox());
            body.AddRow(Hint("Figcad 서버 주소. 기본 = Railway 프로덕션. 내 PC 로컬 서버면 http://localhost:8787."));
            body.AddRow(new Label { Text = "Room key (선택)" });
            body.AddRow(_key = new PasswordBox());
            body.AddRow(Hint("룸 암호. 서버에 ROOM_KEY를 안 걸었으면 비워두세요(대부분 비움)."));
            body.AddRow(Btn("연결 저장", () => { SaveConn(); Log("연결 저장됨"); }));

            // 왕복 — v0.4: Push 1버튼 통합(커브 레인 + 브렙 리프트 + Lane-2 잔여, 충실도 보고 1장)
            body.AddRow(Header("모델 왕복"));
            body.AddRow(Btn("Pull (3D)", () => RunConn(cfg => FigcadConnector.Pull(RhinoDoc.ActiveDoc, cfg), true)),
                        Btn("Push", () => RunConn(cfg => FigcadConnector.PushAll(RhinoDoc.ActiveDoc, cfg, CurrentMap(), FigcadSettings.VolTolFraction, FigcadSettings.MultiLevel), false)));
            _numVolTol = new NumericStepper { MinValue = 1, MaxValue = 10, Increment = 1, DecimalPlaces = 0, Value = 3 };
            body.AddRow(new Label { Text = "부피 오차 %" }, _numVolTol);
            body.AddRow(Hint("브렙 리프트 충실도 게이트 — 재구성 부피(단면×길이)가 실부피와 이 % 넘게 다르면 Lane-2 잔여로 보냄."));
            _cbMultiLevel = new CheckBox { Text = "층 자동 구조화 (베타)", Checked = false };
            body.AddRow(_cbMultiLevel);
            body.AddRow(Hint("z-분포로 층 감지 → 레벨 생성·배정. 끄면 종전 단일층. 서버가 구버전이면 신규층 요소는 드롭됨(보고 명시)."));

            // 매핑 — 셀 내 콤보 대신 [행 선택 → 드롭다운 → 적용] (한번에 여러 행, 클릭 자연스러움)
            body.AddRow(Header("레이어 → kind 매핑"));
            body.AddRow(Hint("행 선택(여러 개 가능) → 아래 kind 고르고 [적용]. (자동)=레이어명 자동판별. ignore=잔여로 보냄."));
            _grid = new GridView { DataStore = _rows, ShowHeader = true, AllowMultipleSelection = true, Height = 150 };
            _grid.Columns.Add(new GridColumn { HeaderText = "레이어", DataCell = new TextBoxCell("Layer"), Width = 150, Resizable = true });
            _grid.Columns.Add(new GridColumn { HeaderText = "kind", DataCell = new TextBoxCell("Kind"), Width = 70, Resizable = true });
            body.AddRow(_grid);
            _kindPick = new DropDown();
            foreach (var k in KindItems) _kindPick.Items.Add(k);
            _kindPick.SelectedIndex = 0;
            body.AddRow(new Label { Text = "선택 행 → kind:" }, _kindPick, Btn("적용", ApplyKindToSelected));
            body.AddRow(Btn("레이어 스캔", ScanLayers), Btn("매핑 저장", SaveMapping));

            // preview
            body.AddRow(Header("Preview (리프트=색 · 근사=주황 · 잔여=회색)"));
            body.AddRow(_btnPreview = Btn("Preview 켜기", TogglePreview));

            // 클린업
            body.AddRow(Header("Pre-push 클린업 (비파괴 · 검사→적용)"));
            _cbDup = new CheckBox { Text = "중복 객체 삭제", Checked = true };
            _cbStraight = new CheckBox { Text = "선 직각 맞추기 (틀어진 선→90°)", Checked = true };
            _cbWeld = new CheckBox { Text = "끝점 용접 (근접 끝점→정수 mm)", Checked = true };
            body.AddRow(_cbDup);
            body.AddRow(_cbStraight);
            body.AddRow(_cbWeld);
            _numAngle = new NumericStepper { MinValue = 0.1, MaxValue = 15, Increment = 0.5, DecimalPlaces = 1, Value = 2.0 };
            _numWeld = new NumericStepper { MinValue = 1, MaxValue = 500, Increment = 1, DecimalPlaces = 0, Value = 5 };
            body.AddRow(new Label { Text = "직각 tol °" }, _numAngle, new Label { Text = "용접 tol mm" }, _numWeld);
            _rbModeA = new RadioButton { Text = "라이노 원본 수정", Checked = true };
            _rbModeB = new RadioButton(_rbModeA) { Text = "push 데이터만 (원본 유지)" };
            body.AddRow(_rbModeA);
            body.AddRow(_rbModeB);
            body.AddRow(Btn("검사", CleanupDetect), Btn("적용", CleanupApply));
            body.AddRow(Btn("문제만 보기", CleanupIsolate), Btn("복원", CleanupRestore));

            _log = new TextArea { ReadOnly = true, Wrap = false, Height = 110 };

            // 폭 고정 = 가로 스크롤 없음, 힌트 줄바꿈, 패널 리사이즈에 핏.
            Content = new TableLayout
            {
                Rows =
                {
                    new TableRow(new Scrollable { Content = body, Border = BorderType.None, ExpandContentWidth = true }) { ScaleHeight = true },
                    new TableRow(_log),
                },
            };
        }

        // ---- UI 헬퍼 ----
        static Label Header(string t) => new Label { Text = t, Font = SystemFonts.Bold() };
        static Label Hint(string t) => new Label { Text = t, TextColor = Colors.Gray, Wrap = WrapMode.Word };
        Button Btn(string text, Action onClick)
        {
            var b = new Button { Text = text };
            b.Click += (s, e) => { try { onClick(); } catch (Exception ex) { Log("오류: " + ex.Message); } };
            return b;
        }

        // ---- 연결 ----
        void LoadConn()
        {
            _room.Items.Clear();
            foreach (var r in FigcadSettings.RecentRooms()) _room.Items.Add(r);
            _room.Text = FigcadSettings.Room;
            _base.Text = FigcadSettings.BaseUrl;
            _key.Text = FigcadSettings.Key;
            _numVolTol.Value = FigcadSettings.VolTolPercent;
            _cbMultiLevel.Checked = FigcadSettings.MultiLevel;
        }
        void SaveConn()
        {
            FigcadSettings.Room = (_room.Text ?? "").Trim();
            FigcadSettings.BaseUrl = _base.Text;
            FigcadSettings.Key = _key.Text;
            FigcadSettings.VolTolPercent = _numVolTol.Value;
            FigcadSettings.MultiLevel = _cbMultiLevel.Checked == true;
            if (!string.IsNullOrWhiteSpace(_room.Text)) FigcadSettings.PushRecent(_room.Text.Trim());
        }
        void RunConn(Func<FigcadConfig, string> fn, bool redraw)
        {
            var doc = RhinoDoc.ActiveDoc;
            if (doc == null) { Log("활성 문서 없음"); return; }
            SaveConn();
            var cfg = FigcadSettings.ToConfig();
            if (string.IsNullOrWhiteSpace(cfg.Room)) { Log("룸 id를 입력하세요"); return; }
            try { Log(fn(cfg)); if (redraw) doc.Views.Redraw(); }
            catch (Exception ex) { Log("오류: " + ex.Message); }
        }

        // ---- 매핑 ----
        void ScanLayers()
        {
            var doc = RhinoDoc.ActiveDoc;
            if (doc == null) { Log("활성 문서 없음"); return; }
            var saved = FigcadSettings.LoadMap(FigcadSettings.Room);
            var rows = new List<LayerRow>();
            foreach (var layer in doc.Layers)
            {
                if (layer.IsDeleted) continue;
                string fp = layer.FullPath;
                string kind = Auto;
                if (saved.TryGet(fp, out var mk) && Array.IndexOf(KindItems, mk) >= 0) kind = mk;
                rows.Add(new LayerRow { Layer = fp, Kind = kind });
            }
            _rows = rows;
            _grid.DataStore = _rows;
            Log("레이어 " + _rows.Count + "개 스캔 — 행 선택→kind 고르고 [적용]→[매핑 저장]");
        }
        void ApplyKindToSelected()
        {
            string k = _kindPick.SelectedIndex >= 0 ? KindItems[_kindPick.SelectedIndex] : Auto;
            int cnt = 0;
            foreach (var it in _grid.SelectedItems) if (it is LayerRow lr) { lr.Kind = k; cnt++; }
            _grid.DataStore = new List<LayerRow>(_rows); // 새 참조 = 그리드 갱신(kind 변경 반영)
            Log(cnt > 0 ? cnt + "개 행 → " + k : "행을 먼저 선택하세요");
        }
        void SaveMapping()
        {
            if (string.IsNullOrWhiteSpace(FigcadSettings.Room)) { Log("먼저 룸을 저장하세요"); return; }
            FigcadSettings.SaveMap(FigcadSettings.Room, MapFromGrid());
            Log("레이어 매핑 저장됨");
        }
        FigcadLayerMap MapFromGrid()
        {
            var m = new FigcadLayerMap();
            foreach (var row in _rows)
                if (!string.IsNullOrEmpty(row.Layer) && !string.IsNullOrEmpty(row.Kind) && row.Kind != Auto) m.Set(row.Layer, row.Kind);
            return m;
        }
        FigcadLayerMap CurrentMap() => _rows.Count > 0 ? MapFromGrid() : FigcadSettings.LoadMap(FigcadSettings.Room);

        // ---- Preview ----
        void TogglePreview()
        {
            var doc = RhinoDoc.ActiveDoc;
            if (doc == null) { Log("활성 문서 없음"); return; }
            if (_conduit == null) _conduit = new FigcadPreviewConduit();
            if (_conduit.Enabled)
            {
                _conduit.Enabled = false; _conduit.Clear(); doc.Views.Redraw();
                _btnPreview.Text = "Preview 켜기";
                return;
            }
            SaveConn();
            var cfg = FigcadSettings.ToConfig();
            if (string.IsNullOrWhiteSpace(cfg.Room)) { Log("룸 id 필요"); return; }
            try
            {
                var c = FigcadConnector.ClassifyForPush(doc, cfg, CurrentMap(), false, FigcadSettings.VolTolFraction);
                _conduit.SetItems(c.Candidates);
                _conduit.Enabled = true;
                _btnPreview.Text = "Preview 끄기";
                Log("Preview: 기둥 " + c.NCol + " · 벽 " + c.NWall + " · 슬라브 " + c.NSlab + " · 보 " + c.NBeam +
                    " · 계단 " + c.NStair + " · 난간 " + c.NRail + " · 근사 " + c.NApprox +
                    " · 잔여 " + c.NResidual + " (수집 " + c.BrepCount +
                    (c.NOpenBrep > 0 ? " · 열린브렙 " + c.NOpenBrep : "") + (c.NMesh > 0 ? " · 메시 " + c.NMesh : "") + ")");
                try { Log(FigcadConnector.DetectStories(c.Candidates).Report()); } catch { } // 층 감지 census (M1)
                doc.Views.Redraw();
            }
            catch (Exception ex) { Log("Preview 오류: " + ex.Message); }
        }

        // ---- 클린업 ----
        void CleanupDetect()
        {
            var doc = RhinoDoc.ActiveDoc;
            if (doc == null) { Log("활성 문서 없음"); return; }
            _lastCleanup = FigcadCleanup.Detect(doc, _cbDup.Checked == true, _cbStraight.Checked == true, _cbWeld.Checked == true, _numAngle.Value, _numWeld.Value);
            Log("클린업 검사: " + _lastCleanup.Summary());
        }
        void CleanupApply()
        {
            var doc = RhinoDoc.ActiveDoc;
            if (doc == null) { Log("활성 문서 없음"); return; }
            if (_lastCleanup == null) { Log("먼저 [검사]를 실행하세요"); return; }
            if (_lastCleanup.IsEmpty) { Log("정리할 것 없음"); _lastCleanup = null; return; }
            bool doLines = _cbStraight.Checked == true || _cbWeld.Checked == true;
            if (_rbModeA.Checked)
            {
                Log(FigcadCleanup.Apply(doc, _lastCleanup, _cbDup.Checked == true, doLines));
            }
            else
            {
                SaveConn();
                var cfg = FigcadSettings.ToConfig();
                if (string.IsNullOrWhiteSpace(cfg.Room)) { Log("룸 필요"); return; }
                var applied = FigcadCleanup.Apply(doc, _lastCleanup, _cbDup.Checked == true, doLines);
                string rep;
                // 모드B는 브렙 레인만(PushBreps) 유지 — 커브 레인의 figcad:id writeback이 _Undo로 풀리면
                // 재푸시 중복(커브 레인은 dedup 없음)이라 PushAll 부적합.
                try { rep = FigcadConnector.PushBreps(doc, cfg, CurrentMap(), FigcadSettings.VolTolFraction); }
                catch (Exception ex) { rep = "Push 오류: " + ex.Message; }
                RhinoApp.RunScript("_Undo", false);
                doc.Views.Redraw();
                Log("[모드B 원본유지] " + applied + " → " + rep + " → 원본 복구(_Undo)");
            }
            _lastCleanup = null;
        }
        void CleanupIsolate()
        {
            var doc = RhinoDoc.ActiveDoc;
            if (doc == null) { Log("활성 문서 없음"); return; }
            if (_lastCleanup == null || _lastCleanup.IsEmpty) { Log("먼저 [검사]를 실행하세요(또는 문제 없음)"); return; }
            if (_isolateLocked != null) CleanupRestore();
            _isolateLocked = FigcadCleanup.IsolateFlagged(doc, _lastCleanup);
            Log("문제만 보기: 나머지 " + _isolateLocked.Count + "개 잠금 · 문제 " + (_lastCleanup.DuplicateDeletes.Count + _lastCleanup.LineEdits.Count) + "개 선택 ([복원]으로 해제)");
        }
        void CleanupRestore()
        {
            var doc = RhinoDoc.ActiveDoc;
            if (doc == null || _isolateLocked == null) { Log("복원할 잠금 없음"); return; }
            FigcadCleanup.RestoreIsolate(doc, _isolateLocked);
            Log("복원: " + _isolateLocked.Count + "개 잠금 해제");
            _isolateLocked = null;
        }

        void Log(string msg)
        {
            if (_log != null) _log.Append(msg + Environment.NewLine, true);
            RhinoApp.WriteLine("[Figcad] " + msg);
        }
    }
}
