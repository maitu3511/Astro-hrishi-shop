import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { ChevronUp, ChevronDown, Star } from "lucide-react";
import { resolveImage, handleImageError } from "@/lib/productImages";
import { collection, getDocs, doc, updateDoc, query, orderBy } from "firebase/firestore";
import { db } from "@/lib/firebase";

type Row = {
  id: string;
  name: string;
  price: number;
  image_url: string | null;
  featured: boolean;
  sort_order: number;
};

/**
 * Homepage highlights are driven entirely by the database (`products.featured`
 * + `products.sort_order`) — nothing is hardcoded in the frontend.
 */
const HighlightsManager = () => {
  const [rows, setRows] = useState<Row[]>([]);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const q = query(collection(db, "products"), orderBy("sort_order", "asc"));
      const snap = await getDocs(q);
      const list = snap.docs.map((d) => ({
        id: d.id,
        name: d.data().name || "",
        price: Number(d.data().price || 0),
        image_url: d.data().image_url || null,
        featured: !!d.data().featured,
        sort_order: Number(d.data().sort_order || 0),
      })) as Row[];
      setRows(list);
    } catch (e) {
      console.error("Failed to load products for highlights:", e);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const toggle = async (r: Row) => {
    setSaving(true);
    try {
      await updateDoc(doc(db, "products", r.id), {
        featured: !r.featured,
        updated_at: new Date().toISOString(),
      });
      toast.success(!r.featured ? "Added to highlights" : "Removed from highlights");
      void load();
    } catch (err: any) {
      toast.error(err.message || "Failed to update highlight");
    } finally {
      setSaving(false);
    }
  };

  const setPriority = async (id: string, value: number) => {
    try {
      await updateDoc(doc(db, "products", id), {
        sort_order: value,
        updated_at: new Date().toISOString(),
      });
      void load();
    } catch (err: any) {
      toast.error(err.message || "Failed to update priority");
    }
  };

  /** Swap sort_order with the neighbouring highlighted product. */
  const move = async (index: number, dir: -1 | 1) => {
    const list = highlighted;
    const target = list[index + dir];
    const current = list[index];
    if (!target || !current) return;
    setSaving(true);
    try {
      await updateDoc(doc(db, "products", current.id), { sort_order: target.sort_order });
      await updateDoc(doc(db, "products", target.id), { sort_order: current.sort_order });
      void load();
    } catch (err: any) {
      toast.error(err.message || "Failed to reorder");
    } finally {
      setSaving(false);
    }
  };

  const highlighted = rows.filter((r) => r.featured);
  const others = rows.filter((r) => !r.featured);

  return (
    <>
      <div className="glass-gold rounded-2xl p-5 mt-6">
        <h3 className="font-display text-gold mb-1">Homepage Highlights</h3>
        <p className="text-sm text-cosmic-silver/70">
          Choose which products appear in the homepage “Featured Products” strip, set their order and priority.
          {highlighted.length} currently highlighted.
        </p>
      </div>

      <div className="mt-6 space-y-3">
        <h4 className="text-xs uppercase tracking-widest text-gold/80">Highlighted (in display order)</h4>
        {highlighted.length === 0 && (
          <div className="text-center text-cosmic-silver/60 py-6">No highlighted products yet.</div>
        )}
        {highlighted.map((r, i) => (
          <div key={r.id} className="glass-gold rounded-2xl p-4 flex items-center gap-3">
            <img
              src={resolveImage(r.image_url)}
              onError={handleImageError}
              alt={r.name}
              loading="lazy"
              className="h-12 w-12 rounded object-cover"
            />
            <div className="flex-1 min-w-0">
              <div className="text-sm font-semibold truncate">{r.name}</div>
              <div className="text-xs text-gold">₹{Number(r.price).toLocaleString("en-IN")}</div>
            </div>
            <label className="text-[10px] text-cosmic-silver/60 flex items-center gap-1">
              Priority
              <input
                type="number"
                defaultValue={r.sort_order}
                onBlur={(e) => {
                  const v = Number(e.target.value);
                  if (!Number.isNaN(v) && v !== r.sort_order) void setPriority(r.id, v);
                }}
                className="w-14 bg-background/40 border border-gold/20 rounded px-2 py-1 text-xs text-foreground"
              />
            </label>
            <div className="flex flex-col">
              <button disabled={saving || i === 0} onClick={() => move(i, -1)} className="text-gold disabled:opacity-30">
                <ChevronUp className="h-4 w-4" />
              </button>
              <button
                disabled={saving || i === highlighted.length - 1}
                onClick={() => move(i, 1)}
                className="text-gold disabled:opacity-30"
              >
                <ChevronDown className="h-4 w-4" />
              </button>
            </div>
            <button
              onClick={() => toggle(r)}
              className="text-xs px-3 py-1.5 rounded-full bg-gradient-gold text-primary-foreground inline-flex items-center gap-1"
            >
              <Star className="h-3 w-3" /> Remove
            </button>
          </div>
        ))}
      </div>

      <div className="mt-8 space-y-3">
        <h4 className="text-xs uppercase tracking-widest text-cosmic-silver/60">All other products</h4>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {others.map((r) => (
            <div key={r.id} className="glass-gold rounded-2xl p-4 flex gap-3 items-center">
              <img
                src={resolveImage(r.image_url)}
                onError={handleImageError}
                alt={r.name}
                loading="lazy"
                className="h-12 w-12 rounded object-cover"
              />
              <div className="flex-1 min-w-0">
                <div className="text-sm font-semibold truncate">{r.name}</div>
                <div className="text-xs text-gold">₹{Number(r.price).toLocaleString("en-IN")}</div>
              </div>
              <button
                onClick={() => toggle(r)}
                className="text-xs px-3 py-1.5 rounded-full border border-gold/30 text-cosmic-silver/70 hover:border-gold"
              >
                Add
              </button>
            </div>
          ))}
        </div>
      </div>
    </>
  );
};

export default HighlightsManager;
