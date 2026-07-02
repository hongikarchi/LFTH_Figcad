// FigcadPreviewConduit.cs — pre-push preview 오버레이. 리프트(kind별 색) vs 근사(주황) vs 잔여(회색) bbox.
// 비파괴(순수 시각, doc 무변형) + 캐시(ClassifyForPush 1회 → 프레임마다 재분류 안 함).
using System.Collections.Generic;
using System.Drawing;
using Rhino.Display;
using Rhino.Geometry;

namespace Figcad
{
    public class FigcadPreviewConduit : DisplayConduit
    {
        struct Item { public BoundingBox Bb; public Color Col; }
        readonly List<Item> _items = new List<Item>();

        static readonly Color ApproxOrange = Color.FromArgb(240, 150, 40); // 근사 리프트(계단/난간 bbox·슬라브 개구 등)

        public void SetItems(IEnumerable<PushCandidate> candidates)
        {
            _items.Clear();
            foreach (var c in candidates)
                if (c.Bbox.IsValid)
                    _items.Add(new Item { Bb = c.Bbox, Col = c.Kind != null && c.Approx ? ApproxOrange : ColorForKind(c.Kind) });
        }
        public void Clear() => _items.Clear();

        static Color ColorForKind(string kind)
        {
            switch (kind)
            {
                case "column": return Color.FromArgb(70, 130, 220);
                case "beam": return Color.FromArgb(90, 180, 90);
                case "wall": return Color.FromArgb(120, 200, 120);
                case "slab": return Color.FromArgb(200, 180, 80);
                case "stair": return Color.FromArgb(180, 120, 200);
                case "railing": return Color.FromArgb(220, 150, 90);
                default: return Color.FromArgb(150, 150, 150); // 잔여(Lane-2)
            }
        }

        protected override void CalculateBoundingBox(CalculateBoundingBoxEventArgs e)
        {
            foreach (var it in _items) e.IncludeBoundingBox(it.Bb);
        }
        protected override void PostDrawObjects(DrawEventArgs e)
        {
            foreach (var it in _items) e.Display.DrawBox(it.Bb, it.Col, 2);
        }
    }
}
