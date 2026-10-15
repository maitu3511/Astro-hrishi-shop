import { db } from "./firebase";
import { collection, query, where, getDocs, limit } from "firebase/firestore";

export type OrderItemRow = {
  id?: string;
  product_id?: string | null;
  product_name: string;
  product_image?: string | null;
  quantity: number;
  price: number;
  subtotal?: number;
  variant?: string | null;
};

export type StatusHistoryRow = {
  id?: string;
  old_status?: string | null;
  new_status?: string | null;
  status?: string | null;
  note?: string | null;
  changed_by?: string | null;
  changed_at: string;
};

export type AdminOrderRow = {
  id: string;
  order_number: string | null;
  created_at: string;
  updated_at?: string | null;
  user_id: string | null;
  customer_name: string;
  customer_email: string | null;
  customer_phone: string;
  address: string | null;
  city: string | null;
  state: string | null;
  pincode: string | null;
  subtotal: number;
  shipping: number;
  discount: number;
  total: number;
  status: string | null;
  payment_status: string | null;
  payment_method: string | null;
  payment_id?: string | null;
  payment_reference?: string | null;
  razorpay_order_id?: string | null;
  courier_name: string | null;
  tracking_number: string | null;
  tracking_url: string | null;
  estimated_delivery_date: string | null;
  shipping_note: string | null;
  cancellation_reason: string | null;
  notes?: string | null;
  items: unknown;
};

export type TrackedOrder = {
  order: {
    id: string;
    order_number: string;
    created_at: string;
    status: string;
    payment_status: string | null;
    payment_method: string | null;
    customer_name: string;
    customer_phone?: string;
    address: string | null;
    city: string | null;
    state: string | null;
    pincode: string | null;
    subtotal: number;
    shipping: number;
    discount: number;
    total: number;
    courier_name: string | null;
    tracking_number: string | null;
    tracking_url: string | null;
    estimated_delivery_date: string | null;
    shipping_note: string | null;
    cancellation_reason: string | null;
  };
  items: OrderItemRow[];
  history: StatusHistoryRow[];
};

export const trackOrderLookup = async (orderNumber: string, contact: string) => {
  try {
    const res = await fetch(`/api/tracking/lookup?q=${encodeURIComponent(orderNumber)}&phone=${encodeURIComponent(contact)}`);
    if (res.ok) {
      const json = await res.json();
      if (json.order) {
        const items = itemsFromOrder(json.order);
        return {
          error: null,
          data: {
            order: json.order,
            items,
            history: json.order.history || [],
          } as TrackedOrder,
        };
      }
    }
  } catch (e) {
    console.warn("Server tracking lookup note:", e);
  }

  // Client-side Firestore lookup fallback
  try {
    const cleanNum = orderNumber.trim().toUpperCase();
    const cleanContact = contact.trim().toLowerCase().replace(/\s+/g, "");

    const q = query(
      collection(db, "orders"),
      where("order_number", "==", cleanNum),
      limit(1)
    );
    const snap = await getDocs(q);

    if (!snap.empty) {
      const orderData = snap.docs[0].data() as any;
      const orderPhone = (orderData.customer_phone || "").replace(/\D/g, "");
      const orderEmail = (orderData.customer_email || "").toLowerCase().trim();
      const inputDigits = cleanContact.replace(/\D/g, "");

      const phoneMatch = inputDigits && orderPhone && (orderPhone.endsWith(inputDigits) || inputDigits.endsWith(orderPhone));
      const emailMatch = cleanContact.includes("@") && orderEmail === cleanContact;

      if (!phoneMatch && !emailMatch) {
        return { error: "contact_mismatch", data: null };
      }

      const items = itemsFromOrder(orderData);
      return {
        error: null,
        data: {
          order: {
            ...orderData,
            id: snap.docs[0].id,
          },
          items,
          history: orderData.history || [],
        } as TrackedOrder,
      };
    }
    return { error: "order_not_found", data: null };
  } catch (clientErr) {
    console.error("Tracking lookup error:", clientErr);
    return { error: "order_not_found", data: null };
  }
};

export const itemsFromOrder = (order: { items?: unknown }): OrderItemRow[] =>
  Array.isArray(order.items)
    ? (order.items as any[]).map((i) => ({
        product_id: i.id ?? i.product_id ?? null,
        product_name: i.name ?? i.product_name ?? "Item",
        product_image: i.image_url ?? i.product_image ?? i.image ?? null,
        quantity: Number(i.quantity ?? 1),
        price: Number(i.price ?? 0),
        subtotal: Number(i.price ?? 0) * Number(i.quantity ?? 1),
        variant: i.variant ?? null,
      }))
    : [];
