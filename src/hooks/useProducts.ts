import { useCallback, useEffect, useState } from "react";
import { collection, query, where, getDocs } from "firebase/firestore";
import { db } from "@/lib/firebase";
import type { DBProduct } from "@/lib/shop";
import { CATALOG, catalogById } from "@/lib/catalog";

const FEATURED_ID = "trishield-bracelet";

export const useProducts = () => {
  const [products, setProducts] = useState<DBProduct[]>(CATALOG);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    try {
      const q = query(
        collection(db, "products"),
        where("active", "==", true)
      );
      const fetchPromise = getDocs(q).catch((e) => {
        console.warn("Firestore products query failed, using local catalog:", e?.message || e);
        return null;
      });
      const timeoutPromise = new Promise<null>((resolve) =>
        setTimeout(() => resolve(null), 2500)
      );
      const snap = await Promise.race([fetchPromise, timeoutPromise]);
      if (!snap) {
        setProducts(CATALOG);
        setLoading(false);
        return;
      }
      let rows: DBProduct[] = snap.docs.map((docSnap) => {
        const data = docSnap.data();
        return {
          id: docSnap.id,
          ...data,
        } as DBProduct;
      });

      const productMap = new Map<string, DBProduct>();
      for (const p of CATALOG) {
        productMap.set(p.id, p);
      }
      for (const r of rows) {
        const existing = productMap.get(r.id);
        productMap.set(r.id, existing ? { ...existing, ...r } : r);
      }
      let merged = Array.from(productMap.values());
      merged = merged.filter((p) => p.category !== "test");
      merged.sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));

      setProducts(merged);
    } catch (err) {
      console.warn("Products load warning, fallback to catalog:", err);
      setProducts(CATALOG);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return { products, loading, reload: load };
};
