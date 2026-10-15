import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from "react";
import {
  onAuthStateChanged,
  signOut as fbSignOut,
  type User,
} from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import { auth, db } from "@/lib/firebase";
import { switchUserCart } from "@/lib/cart";

export interface UnifiedUser {
  id: string;
  uid?: string;
  email: string | null;
  phoneNumber?: string | null;
  phone?: string | null;
  displayName?: string | null;
  full_name?: string | null;
  role?: string;
  isAdmin?: boolean;
}

type AuthContextValue = {
  session: { user: UnifiedUser } | null;
  user: UnifiedUser | null;
  firebaseUser: User | null;
  isAdmin: boolean;
  loading: boolean;
  signOut: () => Promise<void>;
  setAdminSession: (adminData: { email: string; token?: string; displayName?: string; uid?: string }) => void;
  setCustomerSession: (customer: UnifiedUser) => void;
};

const AuthContext = createContext<AuthContextValue>({
  session: null,
  user: null,
  firebaseUser: null,
  isAdmin: false,
  loading: true,
  signOut: async () => {},
  setAdminSession: () => {},
  setCustomerSession: () => {},
});

const ADMIN_EMAILS = ["maitrimehta3511@gmail.com", "astrowithhrishi@gmail.com"];

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [firebaseUser, setFirebaseUser] = useState<User | null>(null);
  const [user, setUser] = useState<UnifiedUser | null>(() => {
    // Synchronously initialize from storage so user never experiences sudden logout flicker
    if (typeof window !== "undefined") {
      try {
        const savedCust = localStorage.getItem("awh_customer_session") || sessionStorage.getItem("awh_customer_session");
        if (savedCust) {
          const parsed = JSON.parse(savedCust);
          if (parsed && (parsed.email || parsed.phone || parsed.phoneNumber || parsed.id || parsed.uid)) {
            return parsed;
          }
        }
        const savedAdmin = localStorage.getItem("awh_admin_session") || sessionStorage.getItem("awh_admin_session");
        if (savedAdmin) {
          const parsed = JSON.parse(savedAdmin);
          if (parsed && (parsed.isAdmin || parsed.email || parsed.id)) {
            return parsed;
          }
        }
      } catch {}
    }
    return null;
  });
  const [isAdmin, setIsAdmin] = useState<boolean>(() => {
    if (typeof window !== "undefined") {
      try {
        const savedAdmin = localStorage.getItem("awh_admin_session") || sessionStorage.getItem("awh_admin_session");
        if (savedAdmin) {
          const parsed = JSON.parse(savedAdmin);
          if (parsed?.isAdmin) return true;
        }
        const savedCust = localStorage.getItem("awh_customer_session") || sessionStorage.getItem("awh_customer_session");
        if (savedCust) {
          const parsed = JSON.parse(savedCust);
          if (parsed?.isAdmin || (parsed?.email && ADMIN_EMAILS.includes(parsed.email.toLowerCase()))) {
            return true;
          }
        }
      } catch {}
    }
    return false;
  });
  const [loading, setLoading] = useState(true);

  // Check admin authorization strictly through Firebase Auth & Firestore
  const checkAdmin = useCallback(async (currUser: User): Promise<boolean> => {
    const email = (currUser.email || "").toLowerCase();

    // 1. Check custom claim 'admin' on Firebase ID token
    try {
      const idTokenResult = await currUser.getIdTokenResult();
      if (idTokenResult.claims.admin === true) {
        setIsAdmin(true);
        return true;
      }
    } catch {}

    // 2. Check server-side Firebase ID token verification
    try {
      const idToken = await currUser.getIdToken();
      const res = await fetch("/api/admin/verify-admin", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${idToken}`,
        },
      });
      if (res.ok) {
        const data = await res.json();
        if (data.authorized) {
          setIsAdmin(true);
          return true;
        }
      }
    } catch (err) {
      console.warn("Server admin verify check note:", err);
    }

    // 3. Check Firestore user_roles collection (guarded with timeout)
    try {
      const roleRef = doc(db, "user_roles", currUser.uid);
      const snap = await Promise.race([
        getDoc(roleRef).catch(() => null),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 2000)),
      ]);
      if (snap && snap.exists() && snap.data()?.role === "admin") {
        setIsAdmin(true);
        return true;
      }
    } catch (err) {
      console.warn("Firestore user_roles check note:", err);
    }

    // 4. Designated admin emails
    if (ADMIN_EMAILS.includes(email)) {
      setIsAdmin(true);
      return true;
    }

    setIsAdmin(false);
    return false;
  }, []);

  // Customer session setter (persists across tab closes, page reloads, and app reopens)
  const setCustomerSession = useCallback((customer: UnifiedUser) => {
    const cleanEmail = (customer.email || "").trim().toLowerCase();
    const isUserAdmin = Boolean(
      customer.isAdmin ||
      customer.role === "admin" ||
      (cleanEmail && ADMIN_EMAILS.includes(cleanEmail))
    );

    const unified: UnifiedUser = {
      ...customer,
      id: customer.id || customer.uid || `cust_${Date.now()}`,
      uid: customer.uid || customer.id || `cust_${Date.now()}`,
      email: cleanEmail || customer.email || null,
      displayName: customer.displayName || customer.full_name || cleanEmail.split("@")[0] || "Customer",
      role: isUserAdmin ? "admin" : "customer",
      isAdmin: isUserAdmin,
    };

    try {
      localStorage.setItem("awh_customer_session", JSON.stringify(unified));
      sessionStorage.setItem("awh_customer_session", JSON.stringify(unified));
      if (unified.id) {
        localStorage.setItem("awh_customer_id", unified.id);
      }
      if (isUserAdmin) {
        localStorage.setItem("awh_admin_session", JSON.stringify(unified));
        sessionStorage.setItem("awh_admin_session", JSON.stringify(unified));
      }
    } catch {}

    setUser(unified);
    setIsAdmin(isUserAdmin);
    setLoading(false);
    switchUserCart(unified.email || unified.id);
  }, []);

  // Admin session setter (persists token and user session in localStorage & sessionStorage)
  const setAdminSession = useCallback((adminData: { email: string; token?: string; displayName?: string; uid?: string }) => {
    const cleanEmail = (adminData.email || "astrowithhrishi@gmail.com").trim().toLowerCase();
    const adminObj: UnifiedUser = {
      id: adminData.uid || `admin_${cleanEmail.replace(/[^a-z0-9]/gi, "_")}`,
      uid: adminData.uid || `admin_${cleanEmail.replace(/[^a-z0-9]/gi, "_")}`,
      email: cleanEmail,
      displayName: adminData.displayName || (cleanEmail === "maitrimehta3511@gmail.com" ? "Maitri Mehta (Admin)" : "Astrologer Hrishi (Admin)"),
      role: "admin",
      isAdmin: true,
    };
    if (adminData.token) {
      try {
        localStorage.setItem("awh_admin_token", adminData.token);
        sessionStorage.setItem("awh_admin_token", adminData.token);
      } catch {}
    }
    try {
      localStorage.setItem("awh_admin_session", JSON.stringify(adminObj));
      sessionStorage.setItem("awh_admin_session", JSON.stringify(adminObj));
    } catch {}
    setUser(adminObj);
    setIsAdmin(true);
    switchUserCart(adminObj.email || adminObj.id);
  }, []);

  useEffect(() => {
    let active = true;

    // 1. Check for active admin session in localStorage or sessionStorage
    try {
      const savedAdminToken = localStorage.getItem("awh_admin_token") || sessionStorage.getItem("awh_admin_token");
      const savedAdminSession = localStorage.getItem("awh_admin_session") || sessionStorage.getItem("awh_admin_session");
      if (savedAdminSession && savedAdminToken) {
        const parsed = JSON.parse(savedAdminSession);
        if (parsed && parsed.isAdmin) {
          setUser(parsed);
          setIsAdmin(true);
          setLoading(false);
          // Verify with server in background if not a static local session
          if (!savedAdminToken.startsWith("awh_adm_local_")) {
            fetch("/api/admin/verify-token", {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${savedAdminToken}`,
              },
            })
              .then(async (r) => {
                const text = await r.text().catch(() => "");
                return text && text.trim().startsWith("{") ? JSON.parse(text) : null;
              })
              .then((res) => {
                if (res && res.authorized === false) {
                  localStorage.removeItem("awh_admin_token");
                  localStorage.removeItem("awh_admin_session");
                  sessionStorage.removeItem("awh_admin_token");
                  sessionStorage.removeItem("awh_admin_session");
                  setUser(null);
                  setIsAdmin(false);
                }
              })
              .catch(() => {});
          }
          return;
        }
      }
    } catch {}

    // 2. Check for active customer session in localStorage or sessionStorage
    try {
      const saved = localStorage.getItem("awh_customer_session") || sessionStorage.getItem("awh_customer_session");
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed && (parsed.email || parsed.id || parsed.uid || parsed.phone || parsed.phoneNumber)) {
          setUser(parsed);
          setIsAdmin(Boolean(parsed.isAdmin || (parsed.email && ADMIN_EMAILS.includes(parsed.email.toLowerCase()))));
          setLoading(false);
        }
      }
    } catch {}

    const unsubscribe = onAuthStateChanged(auth, async (currUser) => {
      if (!active) return;
      setFirebaseUser(currUser);

      if (currUser) {
        const email = (currUser.email || "").toLowerCase();
        const isUserAdmin = ADMIN_EMAILS.includes(email);
        const unified: UnifiedUser = {
          id: currUser.uid,
          uid: currUser.uid,
          email: currUser.email,
          phoneNumber: currUser.phoneNumber,
          displayName: currUser.displayName || currUser.email?.split("@")[0] || "Customer",
          role: isUserAdmin ? "admin" : "customer",
          isAdmin: isUserAdmin,
        };
        setUser(unified);
        setIsAdmin(isUserAdmin);
        try {
          localStorage.setItem("awh_customer_session", JSON.stringify(unified));
          sessionStorage.setItem("awh_customer_session", JSON.stringify(unified));
        } catch {}
        switchUserCart(unified.email || unified.id);
        await checkAdmin(currUser);
      } else {
        // If Firebase Auth has no active user, check if we have a persistent customer or admin session
        try {
          const savedCust = localStorage.getItem("awh_customer_session") || sessionStorage.getItem("awh_customer_session");
          if (savedCust) {
            const parsed = JSON.parse(savedCust);
            if (parsed && (parsed.email || parsed.id || parsed.uid || parsed.phone || parsed.phoneNumber)) {
              setUser(parsed);
              setIsAdmin(Boolean(parsed.isAdmin || (parsed.email && ADMIN_EMAILS.includes(parsed.email.toLowerCase()))));
              setLoading(false);
              switchUserCart(parsed.email || parsed.id || parsed.uid);
              return;
            }
          }
          const savedAdmin = localStorage.getItem("awh_admin_session") || sessionStorage.getItem("awh_admin_session");
          if (savedAdmin) {
            const parsed = JSON.parse(savedAdmin);
            if (parsed && (parsed.isAdmin || parsed.email || parsed.id)) {
              setUser(parsed);
              setIsAdmin(true);
              setLoading(false);
              switchUserCart(parsed.email || parsed.id);
              return;
            }
          }
        } catch {}

        // Only clear if neither storage has ANY session
        const hasSaved =
          localStorage.getItem("awh_customer_session") ||
          sessionStorage.getItem("awh_customer_session") ||
          localStorage.getItem("awh_admin_session") ||
          sessionStorage.getItem("awh_admin_session");

        if (!hasSaved) {
          setUser(null);
          setIsAdmin(false);
          switchUserCart("guest");
        }
      }
      setLoading(false);
    });

    const timer = window.setTimeout(() => {
      if (active) setLoading(false);
    }, 1200);

    return () => {
      active = false;
      window.clearTimeout(timer);
      unsubscribe();
    };
  }, [checkAdmin]);

  const signOut = useCallback(async () => {
    try {
      await fbSignOut(auth);
    } catch (e) {
      console.warn("Firebase signout error:", e);
    }
    // Clean up all customer and admin sessions
    try {
      sessionStorage.removeItem("awh_admin_token");
      sessionStorage.removeItem("awh_admin_session");
      sessionStorage.removeItem("awh_customer_session");
      localStorage.removeItem("awh_admin_token");
      localStorage.removeItem("awh_admin_session");
      localStorage.removeItem("awh_customer_session");
      localStorage.removeItem("awh_customer_id");
    } catch {}
    setUser(null);
    setFirebaseUser(null);
    setIsAdmin(false);
    switchUserCart("guest");
  }, []);

  const session = user ? { user } : null;

  return (
    <AuthContext.Provider value={{ session, user, firebaseUser, isAdmin, loading, signOut, setAdminSession, setCustomerSession }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
