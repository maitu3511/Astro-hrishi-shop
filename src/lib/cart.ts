import { create } from "zustand";

export type CartItem = {
  /** Unique cart line key — product id, plus variant when one is selected. */
  id: string;
  product_id: string;
  name: string;
  price: number;
  image_url: string | null;
  variant?: string | null;
  quantity: number;
};

type CartState = {
  items: CartItem[];
  add: (item: Omit<CartItem, "quantity">, qty?: number) => void;
  remove: (id: string) => void;
  setQty: (id: string, qty: number) => void;
  clear: () => void;
  total: () => number;
  count: () => number;
  syncAccountCart: (accountKey?: string | null) => void;
};

export const lineKey = (productId: string, variant?: string | null) =>
  variant ? `${productId}::${variant}` : productId;

/**
 * Returns a unique, isolated storage key scoped to the logged-in user account.
 * When guest/logged out, returns 'awh_cart_guest'.
 */
export const getCartStorageKey = (accountKey?: string | null): string => {
  if (accountKey && typeof accountKey === "string" && accountKey.trim()) {
    const clean = accountKey.trim().toLowerCase().replace(/[^a-z0-9_@.-]/gi, "_");
    return `awh_cart_${clean}`;
  }
  if (typeof window !== "undefined") {
    try {
      const custStr = localStorage.getItem("awh_customer_session") || sessionStorage.getItem("awh_customer_session");
      if (custStr) {
        const parsed = JSON.parse(custStr);
        const id = (parsed?.email ? String(parsed.email).toLowerCase().trim() : null) || parsed?.id || parsed?.uid;
        if (id) {
          const clean = String(id).replace(/[^a-z0-9_@.-]/gi, "_");
          return `awh_cart_${clean}`;
        }
      }
      const adminStr = localStorage.getItem("awh_admin_session") || sessionStorage.getItem("awh_admin_session");
      if (adminStr) {
        const parsed = JSON.parse(adminStr);
        const id = (parsed?.email ? String(parsed.email).toLowerCase().trim() : null) || parsed?.id || parsed?.uid;
        if (id) {
          const clean = String(id).replace(/[^a-z0-9_@.-]/gi, "_");
          return `awh_cart_${clean}`;
        }
      }
    } catch {}
  }
  return "awh_cart_guest";
};

const loadItemsForAccount = (key?: string): CartItem[] => {
  if (typeof window === "undefined") return [];
  try {
    const storageKey = key || getCartStorageKey();
    const raw = localStorage.getItem(storageKey);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed;
    }
    // Backward compatibility: If guest cart is empty, check legacy "awh-cart"
    if (storageKey === "awh_cart_guest") {
      const legacy = localStorage.getItem("awh-cart");
      if (legacy) {
        const parsedLegacy = JSON.parse(legacy);
        if (parsedLegacy?.state?.items && Array.isArray(parsedLegacy.state.items)) {
          return parsedLegacy.state.items;
        }
      }
    }
  } catch {}
  return [];
};

const saveItemsForAccount = (items: CartItem[], key?: string) => {
  if (typeof window === "undefined") return;
  try {
    const storageKey = key || getCartStorageKey();
    localStorage.setItem(storageKey, JSON.stringify(items));
  } catch {}
};

export const useCart = create<CartState>()((set, get) => ({
  items: loadItemsForAccount(),
  add: (item, qty = 1) => {
    set((s) => {
      const existing = s.items.find((i) => i.id === item.id);
      const newItems = existing
        ? s.items.map((i) => (i.id === item.id ? { ...i, quantity: i.quantity + qty } : i))
        : [...s.items, { ...item, quantity: qty }];
      saveItemsForAccount(newItems);
      return { items: newItems };
    });
  },
  remove: (id) => {
    set((s) => {
      const newItems = s.items.filter((i) => i.id !== id);
      saveItemsForAccount(newItems);
      return { items: newItems };
    });
  },
  setQty: (id, qty) => {
    set((s) => {
      const newItems = s.items.map((i) => (i.id === id ? { ...i, quantity: Math.max(1, qty) } : i));
      saveItemsForAccount(newItems);
      return { items: newItems };
    });
  },
  clear: () => {
    const storageKey = getCartStorageKey();
    saveItemsForAccount([], storageKey);
    set({ items: [] });
  },
  total: () => get().items.reduce((sum, i) => sum + i.price * i.quantity, 0),
  count: () => get().items.reduce((sum, i) => sum + i.quantity, 0),
  syncAccountCart: (accountKey?: string | null) => {
    const storageKey = getCartStorageKey(accountKey);
    const loaded = loadItemsForAccount(storageKey);
    set({ items: loaded });
  },
}));

/**
 * Switch cart instantly to the specified user account or guest
 */
export const switchUserCart = (accountKey?: string | null) => {
  useCart.getState().syncAccountCart(accountKey);
};
