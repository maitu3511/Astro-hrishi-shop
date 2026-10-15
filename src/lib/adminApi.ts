import { collection, getDocs, doc, addDoc, updateDoc, deleteDoc, query, orderBy, setDoc } from "firebase/firestore";
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";
import { db, auth, storage } from "@/lib/firebase";

export interface AdminStats {
  bookings: number;
  todayBookings: number;
  orders: number;
  revenue: number;
}

export const getAdminHeaders = async (): Promise<HeadersInit> => {
  try {
    const adminToken = typeof window !== "undefined"
      ? (sessionStorage.getItem("awh_admin_token") || localStorage.getItem("awh_admin_token"))
      : null;
    if (adminToken) {
      return {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${adminToken}`,
      };
    }
    const user = auth.currentUser;
    if (user) {
      const token = await user.getIdToken();
      return {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`,
      };
    }
  } catch (e) {
    console.warn("Could not retrieve admin token:", e);
  }
  return {
    "Content-Type": "application/json",
  };
};

export const fetchAdminStats = async (): Promise<AdminStats> => {
  try {
    const res = await fetch("/api/admin/stats", {
      headers: await getAdminHeaders(),
    });
    if (res.ok) {
      const data = await res.json();
      return {
        bookings: Number(data.bookings || 0),
        todayBookings: Number(data.todayBookings || 0),
        orders: Number(data.orders || 0),
        revenue: Number(data.revenue || 0),
      };
    }
  } catch (err) {
    console.warn("Server admin stats fetch note:", err);
  }

  // Fallback to client Firestore query if available
  try {
    const apptsSnap = await getDocs(collection(db, "appointments"));
    const ordersSnap = await getDocs(collection(db, "orders"));
    const appts = apptsSnap.docs.map((d) => d.data());
    const orders = ordersSnap.docs.map((d) => d.data());
    const today = new Date().toDateString();

    return {
      bookings: appts.length,
      todayBookings: appts.filter((a: any) => {
        const ca = a.created_at || a.appointment_date;
        return ca && new Date(ca).toDateString() === today;
      }).length,
      orders: orders.length,
      revenue: orders.reduce((s: number, o: any) => s + Number(o.total || 0), 0),
    };
  } catch (e) {
    console.warn("Client Firestore stats query note:", e);
    return {
      bookings: 0,
      todayBookings: 0,
      orders: 0,
      revenue: 0,
    };
  }
};

export const fetchAdminCollection = async (collectionName: string): Promise<any[]> => {
  try {
    const res = await fetch(`/api/admin/collection/${collectionName}`, {
      headers: await getAdminHeaders(),
    });
    if (res.ok) {
      const json = await res.json();
      if (Array.isArray(json?.data)) {
        return json.data;
      }
    }
  } catch (err) {
    console.warn(`Server collection ${collectionName} fetch note:`, err);
  }

  try {
    let q;
    try {
      q = query(collection(db, collectionName), orderBy("created_at", "desc"));
    } catch {
      q = collection(db, collectionName);
    }
    const snap = await getDocs(q);
    return snap.docs.map((d) => ({ id: d.id, ...(d.data() as Record<string, unknown>) }));
  } catch (e) {
    console.warn(`Client Firestore collection ${collectionName} note:`, e);
    return [];
  }
};

export const createAdminDoc = async (collectionName: string, data: any): Promise<string> => {
  try {
    const res = await fetch(`/api/admin/collection/${collectionName}`, {
      method: "POST",
      headers: await getAdminHeaders(),
      body: JSON.stringify(data),
    });
    if (res.ok) {
      const json = await res.json();
      if (json?.id) return json.id;
    }
  } catch (e) {
    console.warn(`Server doc add in ${collectionName} note:`, e);
  }

  const docRef = await addDoc(collection(db, collectionName), {
    ...data,
    created_at: data.created_at || new Date().toISOString(),
  });
  return docRef.id;
};

export const updateAdminDoc = async (collectionName: string, id: string, data: any): Promise<void> => {
  try {
    const res = await fetch(`/api/admin/collection/${collectionName}/${id}`, {
      method: "PUT",
      headers: await getAdminHeaders(),
      body: JSON.stringify(data),
    });
    if (res.ok) return;
  } catch (e) {
    console.warn(`Server doc update in ${collectionName}/${id} note:`, e);
  }

  await setDoc(
    doc(db, collectionName, id),
    {
      ...data,
      updated_at: new Date().toISOString(),
    },
    { merge: true }
  );
};

export const deleteAdminDoc = async (collectionName: string, id: string): Promise<void> => {
  try {
    const res = await fetch(`/api/admin/collection/${collectionName}/${id}`, {
      method: "DELETE",
      headers: await getAdminHeaders(),
    });
    if (res.ok) return;
  } catch (e) {
    console.warn(`Server doc delete in ${collectionName}/${id} note:`, e);
  }

  await deleteDoc(doc(db, collectionName, id));
};

export interface PaymentGatewayAdminSettings {
  razorpay_enabled: boolean;
  razorpay_key_id: string;
  razorpay_key_secret_masked?: string;
  has_key_secret?: boolean;
  razorpay_webhook_secret_masked?: string;
  has_webhook_secret?: boolean;
  upi_enabled: boolean;
  upi_id: string;
  payee_name: string;
  cod_enabled: boolean;
  test_mode?: boolean;
  is_live?: boolean;
  is_test?: boolean;
}

export const fetchPaymentSettings = async (): Promise<PaymentGatewayAdminSettings | null> => {
  try {
    const res = await fetch("/api/admin/payment-settings", {
      headers: await getAdminHeaders(),
    });
    if (res.ok) {
      const data = await res.json();
      return data.settings || null;
    }
  } catch (err) {
    console.warn("Error fetching payment settings:", err);
  }
  return null;
};

export const savePaymentSettings = async (settings: Partial<PaymentGatewayAdminSettings> & { razorpay_key_secret?: string; razorpay_webhook_secret?: string }): Promise<{ success: boolean; message?: string; error?: string }> => {
  try {
    const res = await fetch("/api/admin/payment-settings", {
      method: "POST",
      headers: await getAdminHeaders(),
      body: JSON.stringify(settings),
    });
    const data = await res.json();
    if (res.ok && data.success) {
      return { success: true, message: data.message };
    }
    return { success: false, error: data.error || "Failed to save settings" };
  } catch (err: any) {
    return { success: false, error: err.message || "Failed to connect to server" };
  }
};

export const testRazorpayConnection = async (keys?: { key_id?: string; key_secret?: string }): Promise<{ valid: boolean; message?: string; error?: string; mode?: string }> => {
  try {
    const res = await fetch("/api/admin/test-razorpay", {
      method: "POST",
      headers: await getAdminHeaders(),
      body: JSON.stringify(keys || {}),
    });
    const data = await res.json();
    if (res.ok && data.valid) {
      return { valid: true, message: data.message, mode: data.mode };
    }
    return { valid: false, error: data.error || "Verification failed" };
  } catch (err: any) {
    return { valid: false, error: err.message || "Failed to connect to verification API" };
  }
};

export const verifyUpiOrderAdmin = async (
  orderId: string,
  notes?: string,
  confirmedAmount?: number
): Promise<{ success: boolean; message?: string; error?: string }> => {
  try {
    const res = await fetch("/api/admin/verify-upi-order", {
      method: "POST",
      headers: await getAdminHeaders(),
      body: JSON.stringify({ order_id: orderId, notes, confirmed_amount: confirmedAmount }),
    });
    const data = await res.json();
    if (res.ok && data.success) {
      return { success: true, message: data.message };
    }
    return { success: false, error: data.error || "Failed to verify UPI order" };
  } catch (err: any) {
    return { success: false, error: err.message || "Failed to connect to verification API" };
  }
};

export interface TrackingAdminSettings {
  google_analytics_id: string;
  meta_pixel_id: string;
  google_ads_id: string;
  google_ads_conversion_label: string;
  google_site_verification: string;
  gtm_id?: string;
  enabled: boolean;
}

export const fetchTrackingSettings = async (): Promise<TrackingAdminSettings | null> => {
  try {
    const res = await fetch("/api/admin/tracking-settings", {
      headers: await getAdminHeaders(),
    });
    if (res.ok) {
      const data = await res.json();
      return data.settings || null;
    }
  } catch (err) {
    console.warn("Error fetching tracking settings:", err);
  }
  return null;
};

export const saveTrackingSettings = async (
  settings: Partial<TrackingAdminSettings>
): Promise<{ success: boolean; message?: string; error?: string }> => {
  try {
    const res = await fetch("/api/admin/tracking-settings", {
      method: "POST",
      headers: await getAdminHeaders(),
      body: JSON.stringify(settings),
    });
    const data = await res.json();
    if (res.ok && data.success) {
      return { success: true, message: data.message };
    }
    return { success: false, error: data.error || "Failed to save tracking settings" };
  } catch (err: any) {
    return { success: false, error: err.message || "Failed to connect to tracking API" };
  }
};

/**
 * Universal media uploader for Admin (images & videos from device/gallery).
 * First attempts Firebase Storage; smoothly falls back to server-side static media endpoint.
 */
export const uploadAdminMedia = async (file: File, folder = "media"): Promise<string> => {
  // 1. Try Firebase Storage if configured
  try {
    const ext = file.name.split(".").pop()?.toLowerCase() || "mp4";
    const path = `${folder}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
    const storageRef = ref(storage, path);
    const snapshot = await uploadBytes(storageRef, file, { contentType: file.type });
    const url = await getDownloadURL(snapshot.ref);
    if (url) return url;
  } catch (storageErr) {
    console.warn("Firebase Storage note, falling back to server media endpoint:", storageErr);
  }

  // 2. Fallback to server /api/admin/upload-media endpoint
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const base64Data = reader.result as string;
        const res = await fetch("/api/admin/upload-media", {
          method: "POST",
          headers: await getAdminHeaders(),
          body: JSON.stringify({
            data: base64Data,
            filename: file.name,
            contentType: file.type,
          }),
        });
        const json = await res.json();
        if (res.ok && json.success && json.url) {
          resolve(json.url);
        } else {
          // If server returns error, return data URL
          resolve(base64Data);
        }
      } catch (err) {
        console.warn("Server upload note, using object URL:", err);
        resolve(URL.createObjectURL(file));
      }
    };
    reader.onerror = () => reject(new Error("Failed to read file from gallery/device"));
    reader.readAsDataURL(file);
  });
};


