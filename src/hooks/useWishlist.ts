import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { collection, query, where, getDocs, doc, setDoc, deleteDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";

/** Database-backed wishlist, scoped to the signed-in customer. */
export const useDbWishlist = () => {
  const { user } = useAuth();
  const [ids, setIds] = useState<string[]>([]);

  const load = useCallback(async () => {
    if (!user) return setIds([]);
    try {
      const q = query(collection(db, "wishlist_items"), where("user_id", "==", user.id));
      const snap = await getDocs(q);
      const list = snap.docs.map((d) => d.data().product_id as string).filter(Boolean);
      setIds(list);
    } catch (e) {
      console.warn("Failed to load wishlist:", e);
    }
  }, [user]);

  useEffect(() => {
    void load();
  }, [load]);

  const has = (productId: string) => ids.includes(productId);

  const toggle = async (productId: string) => {
    if (!user) return;
    const docId = `${user.id}_${productId}`;
    if (has(productId)) {
      setIds((s) => s.filter((i) => i !== productId));
      try {
        await deleteDoc(doc(db, "wishlist_items", docId));
      } catch (e) {
        console.warn("Failed to remove from wishlist:", e);
      }
    } else {
      setIds((s) => [...s, productId]);
      try {
        await setDoc(doc(db, "wishlist_items", docId), {
          user_id: user.id,
          product_id: productId,
          created_at: new Date().toISOString(),
        });
      } catch (e) {
        console.warn("Failed to add to wishlist:", e);
      }
    }
  };

  return { ids, has, toggle, reload: load };
};
