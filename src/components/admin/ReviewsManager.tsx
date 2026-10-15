import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { Trash2, Pencil, Eye, EyeOff, Plus, X } from "lucide-react";
import { collection, getDocs, doc, addDoc, updateDoc, deleteDoc, query, orderBy } from "firebase/firestore";
import { db } from "@/lib/firebase";

type Review = {
  id: string;
  product_id: string;
  author_name: string;
  rating: number;
  comment: string;
  published: boolean;
  created_at: string;
};

type Product = { id: string; name: string };

const inputCls = "bg-background/40 border-gold/20";
const selectCls =
  "w-full bg-background/40 border border-gold/20 rounded-lg px-3 py-2 text-sm text-foreground";

const empty = { product_id: "", author_name: "", rating: 5, comment: "" };

/** Product-wise review management: add, edit, publish/unpublish, delete, filter. */
const ReviewsManager = () => {
  const [products, setProducts] = useState<Product[]>([]);
  const [reviews, setReviews] = useState<Review[]>([]);
  const [filter, setFilter] = useState("");
  const [search, setSearch] = useState("");
  const [form, setForm] = useState({ ...empty });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const pSnap = await getDocs(collection(db, "products"));
      const pList = pSnap.docs.map((d) => ({
        id: d.id,
        name: d.data().name || "Unnamed Product",
      }));
      setProducts(pList);

      const rSnap = await getDocs(query(collection(db, "product_reviews"), orderBy("created_at", "desc")));
      const rList = rSnap.docs.map((d) => ({
        id: d.id,
        ...d.data(),
      })) as Review[];
      setReviews(rList);
    } catch (e) {
      console.error("Failed to load reviews:", e);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const productName = useCallback(
    (id: string) => products.find((p) => p.id === id)?.name ?? "Unknown product",
    [products],
  );

  const filtered = useMemo(
    () =>
      reviews.filter(
        (r) =>
          (!filter || r.product_id === filter) &&
          (!search ||
            r.author_name?.toLowerCase().includes(search.toLowerCase()) ||
            r.comment?.toLowerCase().includes(search.toLowerCase())),
      ),
    [reviews, filter, search],
  );

  const reset = () => {
    setForm({ ...empty });
    setEditingId(null);
  };

  const save = async () => {
    if (!form.product_id) return toast.error("Select a product");
    if (!form.author_name.trim()) return toast.error("Enter the customer name");
    if (!form.comment.trim()) return toast.error("Enter the review text");
    if (form.rating < 1 || form.rating > 5) return toast.error("Rating must be between 1 and 5");
    setBusy(true);
    const payload = {
      product_id: form.product_id,
      author_name: form.author_name.trim(),
      rating: Number(form.rating),
      comment: form.comment.trim(),
      updated_at: new Date().toISOString(),
    };
    try {
      if (editingId) {
        await updateDoc(doc(db, "product_reviews", editingId), payload);
      } else {
        await addDoc(collection(db, "product_reviews"), {
          ...payload,
          published: true,
          created_at: new Date().toISOString(),
        });
      }
      setBusy(false);
      toast.success(editingId ? "Review updated" : "Review added");
      reset();
      void load();
    } catch (err: any) {
      setBusy(false);
      toast.error(err.message || "Failed to save review");
    }
  };

  const togglePublished = async (r: Review) => {
    try {
      await updateDoc(doc(db, "product_reviews", r.id), {
        published: !r.published,
        updated_at: new Date().toISOString(),
      });
      void load();
    } catch (err: any) {
      toast.error(err.message || "Failed to toggle review visibility");
    }
  };

  const remove = async (id: string) => {
    if (!window.confirm("Delete this review?")) return;
    try {
      await deleteDoc(doc(db, "product_reviews", id));
      toast.success("Review deleted");
      void load();
    } catch (err: any) {
      toast.error(err.message || "Failed to delete review");
    }
  };

  return (
    <>
      <div className="glass-gold rounded-2xl p-5 mt-6">
        <h3 className="font-display text-gold mb-3">{editingId ? "Edit Review" : "Add Product Review"}</h3>
        <div className="grid sm:grid-cols-3 gap-3">
          <select
            value={form.product_id}
            onChange={(e) => setForm({ ...form, product_id: e.target.value })}
            className={selectCls}
          >
            <option value="">Select product…</option>
            {products.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <Input
            placeholder="Customer name"
            value={form.author_name}
            onChange={(e) => setForm({ ...form, author_name: e.target.value })}
            className={inputCls}
          />
          <select
            value={form.rating}
            onChange={(e) => setForm({ ...form, rating: Number(e.target.value) })}
            className={selectCls}
          >
            {[5, 4, 3, 2, 1].map((n) => (
              <option key={n} value={n}>
                {"★".repeat(n)} ({n})
              </option>
            ))}
          </select>
        </div>
        <Textarea
          placeholder="Review text"
          value={form.comment}
          onChange={(e) => setForm({ ...form, comment: e.target.value })}
          className={`mt-3 ${inputCls}`}
        />
        <div className="flex gap-2 mt-3">
          <Button disabled={busy} onClick={save} className="bg-gradient-gold text-primary-foreground">
            <Plus className="h-4 w-4 mr-1" /> {editingId ? "Save changes" : "Add review"}
          </Button>
          {editingId && (
            <Button variant="outline" onClick={reset} className="border-gold/30">
              <X className="h-4 w-4 mr-1" /> Cancel
            </Button>
          )}
        </div>
      </div>

      <div className="glass-gold rounded-2xl p-5 mt-4 grid sm:grid-cols-2 gap-3">
        <select value={filter} onChange={(e) => setFilter(e.target.value)} className={selectCls}>
          <option value="">All products</option>
          {products.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <Input
          placeholder="Search by customer or text…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className={inputCls}
        />
      </div>

      <div className="space-y-3 mt-6">
        {filtered.length === 0 && <div className="text-center text-cosmic-silver/60 py-8">No reviews found</div>}
        {filtered.map((r) => (
          <div key={r.id} className="glass-gold rounded-2xl p-4 flex gap-3">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm font-semibold">{r.author_name || "Anonymous"}</span>
                <span className="text-xs text-gold">{"★".repeat(r.rating)}</span>
                <span
                  className={`text-[10px] px-2 py-0.5 rounded-full border ${
                    r.published ? "border-emerald-400/40 text-emerald-300" : "border-gold/30 text-cosmic-silver/60"
                  }`}
                >
                  {r.published ? "Visible" : "Hidden"}
                </span>
              </div>
              <div className="text-xs text-cosmic-silver/60">{productName(r.product_id)}</div>
              <p className="text-xs text-cosmic-silver/80 mt-1">{r.comment}</p>
              <div className="text-[10px] text-cosmic-silver/50 mt-1">{new Date(r.created_at).toLocaleString()}</div>
            </div>
            <div className="flex flex-col gap-2">
              <button onClick={() => togglePublished(r)} className="text-gold" title="Show / hide">
                {r.published ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
              </button>
              <button
                onClick={() => {
                  setEditingId(r.id);
                  setForm({
                    product_id: r.product_id,
                    author_name: r.author_name,
                    rating: r.rating,
                    comment: r.comment,
                  });
                  window.scrollTo({ top: 0, behavior: "smooth" });
                }}
                className="text-gold"
                title="Edit"
              >
                <Pencil className="h-4 w-4" />
              </button>
              <button onClick={() => remove(r.id)} className="text-destructive" title="Delete">
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          </div>
        ))}
      </div>
    </>
  );
};

export default ReviewsManager;
