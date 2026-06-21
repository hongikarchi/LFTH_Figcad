// Figcad 푸시 — 현재 인식 로직(G2 레이어-시맨틱 + recenter + projectOrigin) 단일 스크립트.
// 용도: Rhino _ScriptEditor(RhinoCommon C#) 또는 Rhino MCP execute_rhinocommon_csharp_code에 붙여넣기.
// **옛 .rhp 우회** — 플러그인 재설치/재시작 없이 항상 현재 로직으로 푸시. FigcadConnector.cs와 동일 인식.
//
// 설정: ROOM(룸 id) + BASE(서버) 두 줄만 바꿔서 실행.
//   로컬 테스트:  BASE = "http://localhost:8788"
//   배포(확정분): BASE = "https://figcad.archivibe.workers.dev"
// 전제: 룸이 브라우저서 한 번 열려 시드됨(levelId L-001 · 타입 T-w200/T-s150/T-c400/T-b300/T-st1/T-rl1).
//
// 동작: 블록 재귀 수집 + leaf 레이어 full-path → kind(S-Column=기둥·S-Connection=보·A-Wall=벽·
//   S-Slab=슬라브·A-Stair=계단·A-Handrail=난간). bbox min을 origin으로 ?op=origin POST + recenter.
//   인식 → create_* ops 배치 POST(?op=apply). 미지 레이어=Lane-2(스킵).

string ROOM = "lfth-rev2";
string BASE = "http://localhost:8788";

double tol = System.Math.Max(doc.ModelAbsoluteTolerance, 0.01);
string lv="L-001", wt="T-w200", st="T-s150", ct="T-c400", bt="T-b300", stairT="T-st1", railT="T-rl1";
string U(string op) => BASE + "/parties/doc/" + ROOM + "?op=" + op;
string R(double v) => System.Math.Round(v).ToString(System.Globalization.CultureInfo.InvariantCulture);
var http = new System.Net.Http.HttpClient { Timeout = System.TimeSpan.FromSeconds(90) };

string KFL(string p) {
  if (string.IsNullOrEmpty(p)) return null;
  var tk = new System.Collections.Generic.HashSet<string>(p.ToLowerInvariant().Split(new[]{':','-','_',' ','/','.',','}, System.StringSplitOptions.RemoveEmptyEntries));
  System.Func<string[],bool> H = ks => { foreach (var x in ks) if (tk.Contains(x)) return true; return false; };
  if (H(new[]{"column","col"}) || p.Contains("기둥")) return "column";
  if (H(new[]{"connection","beam","girder"}) || p.Contains("보")) return "beam";
  if (H(new[]{"stair","stairs"}) || p.Contains("계단")) return "stair";
  if (H(new[]{"railing","handrail","rail","guardrail"}) || p.Contains("난간")) return "railing";
  if (H(new[]{"wall"}) || p.Contains("벽")) return "wall";
  if (H(new[]{"slab","floor"}) || p.Contains("슬라브") || p.Contains("바닥")) return "slab";
  return null;
}
System.Func<BrepFace,System.Collections.Generic.List<Point3d>> PV = cap => {
  var v = new System.Collections.Generic.List<Point3d>(); var lo = cap.OuterLoop; if (lo==null) return v;
  var c = lo.To3dCurve(); if (c==null) return v; Polyline pl;
  if (c.TryGetPolyline(out pl)) { foreach (var p in pl) v.Add(p); }
  else { var pc = c as PolyCurve; if (pc!=null) foreach (var sg in pc.Explode()) v.Add(sg.PointAtStart); }
  if (v.Count>1 && v[0].DistanceTo(v[v.Count-1])<1) v.RemoveAt(v.Count-1); return v;
};
System.Func<Brep,BrepFace> HC = b => {
  BrepFace bf=null; double ba=-1;
  foreach (var f in b.Faces) { var s=f.UnderlyingSurface(); Plane p;
    if (s!=null && s.TryGetPlane(out p,tol) && System.Math.Abs(p.Normal.Z)>0.8) { double a=f.GetBoundingBox(true).Diagonal.Length; if (a>ba){ba=a;bf=f;} } }
  return bf;
};
var breps = new System.Collections.Generic.List<System.Tuple<Brep,string>>();
int depth=0;
System.Action<System.Collections.Generic.IEnumerable<RhinoObject>,Transform> W = null;
W = (objs, xf) => {
  if (depth>8) return;
  foreach (var ob in objs) {
    var io = ob as InstanceObject;
    if (io!=null) { depth++; try { W(io.InstanceDefinition.GetObjects(), xf*io.InstanceXform); } catch {} depth--; continue; }
    Brep b=null; var ex=ob.Geometry as Extrusion;
    if (ex!=null) b=ex.ToBrep(); else { var bp=ob.Geometry as Brep; if (bp!=null && bp.IsSolid) b=(Brep)bp.Duplicate(); }
    if (b==null) continue; b.Transform(xf);
    string lp = (ob.Attributes.LayerIndex>=0 && ob.Attributes.LayerIndex<doc.Layers.Count) ? doc.Layers[ob.Attributes.LayerIndex].FullPath : "";
    breps.Add(System.Tuple.Create(b, lp));
  }
};
W(doc.Objects, Transform.Identity);

var gb = BoundingBox.Empty; foreach (var pr in breps) gb.Union(pr.Item1.GetBoundingBox(true));
double ox = System.Math.Round(gb.Min.X), oy = System.Math.Round(gb.Min.Y);
http.PostAsync(U("origin"), new System.Net.Http.StringContent("{\"x\":"+R(ox)+",\"y\":"+R(oy)+"}", System.Text.Encoding.UTF8, "application/json")).GetAwaiter().GetResult();
var sh = Transform.Translation(-ox,-oy,0); foreach (var pr in breps) pr.Item1.Transform(sh);
var mbb = BoundingBox.Empty; foreach (var pr in breps) mbb.Union(pr.Item1.GetBoundingBox(true));

var ops = new System.Collections.Generic.List<string>();
int col=0,wl=0,sl=0,bm=0,sr=0,rl=0,res=0;
foreach (var pr in breps) {
  string k = KFL(pr.Item2); if (k==null) { res++; continue; }
  var bb = pr.Item1.GetBoundingBox(true); if (!bb.IsValid) continue;
  double cx=(bb.Min.X+bb.Max.X)/2, cy=(bb.Min.Y+bb.Max.Y)/2;
  if (cx<mbb.Min.X-1000||cx>mbb.Max.X+1000||cy<mbb.Min.Y-1000||cy>mbb.Max.Y+1000) continue; // outlier
  double dx=bb.Max.X-bb.Min.X, dy=bb.Max.Y-bb.Min.Y, dz=bb.Max.Z-bb.Min.Z; bool xl=dx>=dy;
  double a1=xl?bb.Min.X:cx, a2=xl?cy:bb.Min.Y, b1=xl?bb.Max.X:cx, b2=xl?cy:bb.Max.Y;
  if (k=="column") { ops.Add("{\"op\":\"create_column\",\"args\":{\"levelId\":\""+lv+"\",\"typeId\":\""+ct+"\",\"at\":["+R(cx)+","+R(cy)+"],\"baseOffset\":"+R(bb.Min.Z)+",\"height\":"+R(dz)+"}}"); col++; }
  else if (k=="beam") { ops.Add("{\"op\":\"create_beam\",\"args\":{\"levelId\":\""+lv+"\",\"typeId\":\""+bt+"\",\"a\":["+R(a1)+","+R(a2)+"],\"b\":["+R(b1)+","+R(b2)+"],\"zOffset\":"+R((bb.Min.Z+bb.Max.Z)/2)+"}}"); bm++; }
  else if (k=="wall") { ops.Add("{\"op\":\"create_wall\",\"args\":{\"levelId\":\""+lv+"\",\"typeId\":\""+wt+"\",\"a\":["+R(a1)+","+R(a2)+"],\"b\":["+R(b1)+","+R(b2)+"]}}"); wl++; }
  else if (k=="stair") { ops.Add("{\"op\":\"create_stair\",\"args\":{\"levelId\":\""+lv+"\",\"typeId\":\""+stairT+"\",\"a\":["+R(a1)+","+R(a2)+"],\"b\":["+R(b1)+","+R(b2)+"],\"baseOffset\":"+R(bb.Min.Z)+"}}"); sr++; }
  else if (k=="railing") { ops.Add("{\"op\":\"create_railing\",\"args\":{\"levelId\":\""+lv+"\",\"typeId\":\""+railT+"\",\"a\":["+R(a1)+","+R(a2)+"],\"b\":["+R(b1)+","+R(b2)+"],\"baseOffset\":"+R(bb.Min.Z)+"}}"); rl++; }
  else if (k=="slab") {
    var cap=HC(pr.Item1); var pf = cap!=null?PV(cap):null;
    if (pf==null||pf.Count<3) pf = new System.Collections.Generic.List<Point3d>{ new Point3d(bb.Min.X,bb.Min.Y,0), new Point3d(bb.Max.X,bb.Min.Y,0), new Point3d(bb.Max.X,bb.Max.Y,0), new Point3d(bb.Min.X,bb.Max.Y,0) };
    var s2 = new System.Text.StringBuilder("["); for (int i=0;i<pf.Count;i++){ if(i>0)s2.Append(","); s2.Append("["+R(pf[i].X)+","+R(pf[i].Y)+"]"); } s2.Append("]");
    ops.Add("{\"op\":\"create_slab\",\"args\":{\"levelId\":\""+lv+"\",\"typeId\":\""+st+"\",\"boundary\":"+s2+"}}"); sl++;
  }
}
int ap=0; const int BT=1500;
for (int o=0;o<ops.Count;o+=BT) {
  var sc=ops.GetRange(o, System.Math.Min(BT,ops.Count-o));
  var rp=http.PostAsync(U("apply"), new System.Net.Http.StringContent("{\"ops\":["+string.Join(",",sc)+"]}", System.Text.Encoding.UTF8, "application/json")).GetAwaiter().GetResult();
  var tx=rp.Content.ReadAsStringAsync().GetAwaiter().GetResult();
  var m=System.Text.RegularExpressions.Regex.Match(tx,"\"applied\":(\\d+)"); if (m.Success) ap+=int.Parse(m.Groups[1].Value);
}
RhinoApp.WriteLine($"Figcad push → {ROOM} @ {BASE}: 기둥{col}·벽{wl}·슬라브{sl}·보{bm}·계단{sr}·난간{rl}·잔여{res} applied {ap} origin[{R(ox)},{R(oy)}]");
