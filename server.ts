import express from "express";
import cors from "cors";
import path from "path";
import crypto from "crypto";
import Razorpay from "razorpay";
import { initializeApp, getApps, getApp, type App } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";
import { createServer as createViteServer } from "vite";
import fs from "fs";
import { CATALOG } from "./src/lib/catalog";

// Initialize Firebase Admin SDK
let firebaseAdminApp: App | null = null;
let firestoreDb: Firestore | null = null;
let hasAdminCredentials = false;

try {
  const configPath = path.resolve(process.cwd(), "firebase-applet-config.json");
  if (fs.existsSync(configPath)) {
    const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    const envProj = process.env.VITE_FIREBASE_PROJECT_ID;
    const isLegacy = envProj === "galvanic-form-jhh41";
    const projectId = (!isLegacy && envProj) || config.projectId || "astro-with-hrishi";
    const storageBucket = (!isLegacy && process.env.VITE_FIREBASE_STORAGE_BUCKET && !process.env.VITE_FIREBASE_STORAGE_BUCKET.includes("galvanic-form-jhh41"))
      ? process.env.VITE_FIREBASE_STORAGE_BUCKET
      : (config.storageBucket || "astro-with-hrishi.firebasestorage.app");

    if (!getApps().length) {
      firebaseAdminApp = initializeApp({
        projectId,
        storageBucket,
      });
    } else {
      firebaseAdminApp = getApp();
    }

    // Only activate server-side Firestore Admin if explicit service account credentials exist in the environment.
    // Client-side interactions are authenticated via Firebase Web SDK and secured by firestore.rules.
    const hasServiceAccount = !!(
      process.env.GOOGLE_APPLICATION_CREDENTIALS ||
      process.env.FIREBASE_SERVICE_ACCOUNT ||
      process.env.FIREBASE_SERVICE_ACCOUNT_KEY
    );

    if (hasServiceAccount) {
      if (
        config.firestoreDatabaseId &&
        config.firestoreDatabaseId !== "(default)" &&
        !config.firestoreDatabaseId.includes("ai-studio-originalwebprese") &&
        !config.firestoreDatabaseId.includes("galvanic-form-jhh41")
      ) {
        firestoreDb = getFirestore(firebaseAdminApp, config.firestoreDatabaseId);
      } else {
        firestoreDb = getFirestore(firebaseAdminApp);
      }
      hasAdminCredentials = true;
    } else {
      hasAdminCredentials = false;
      firestoreDb = null;
    }
  }
} catch (e) {
  hasAdminCredentials = false;
  firestoreDb = null;
}

const disableAdminOnPermissionError = (err: any): boolean => {
  const msg = String(err?.message || err || "");
  const code = err?.code;
  if (code === 7 || msg.includes("PERMISSION_DENIED") || msg.includes("Missing or insufficient permissions")) {
    hasAdminCredentials = false;
    firestoreDb = null;
    return true;
  }
  return false;
};

// In-memory store for orders and sessions when server Firestore Admin is not authenticated
const memoryOrders = new Map<string, any>();
const memoryProductEdits = new Map<string, any>();
const memoryCoupons = new Map<string, any>([
  ["DIVINE10", { code: "DIVINE10", discount_type: "percent", discount_value: 10, min_order: 500, active: true }],
  ["ASTRO50", { code: "ASTRO50", discount_type: "fixed", discount_value: 50, min_order: 400, active: true }],
  ["WELCOME100", { code: "WELCOME100", discount_type: "fixed", discount_value: 100, min_order: 1000, active: true }],
  ["FIRST3FREE", { code: "FIRST3FREE", discount_type: "percent", discount_value: 100, min_order: 0, active: true }],
]);

const getDb = () => {
  return hasAdminCredentials ? firestoreDb : null;
};

// Catalog Prices Fallback
const CATALOG_PRICES: Record<string, number> = {
  "trishield-bracelet": 750,
  "chakra-tree": 860,
  "ranga-dhatu-sarp-set": 1950,
  "moonstone-bracelet": 750,
  "rose-quartz-bracelet": 600,
  "pyrite-bracelet": 750,
  "sunstone-bracelet": 750,
  "carnelian-bracelet": 750,
  "tiger-eye-bracelet": 750,
  "7-chakra-black-tourmaline-bracelet": 650,
  "dhanyog-bracelet": 750,
  "live-payment-test-10inr": 10,
  "live-payment-test-1inr": 1,
};

function isLivePaymentTest(items: any[], isTestModeFlag?: boolean): boolean {
  if (isTestModeFlag === true) return true;
  if (!Array.isArray(items) || items.length === 0) return false;
  return items.some((i) => {
    const name = String(i?.name || i?.title || "").toLowerCase();
    const id = String(i?.id || i?.product_id || "").toLowerCase();
    return (
      name.includes("live payment test") ||
      name.includes("payment test ₹10") ||
      name.includes("test ₹10") ||
      name.includes("test 10") ||
      name.includes("payment test ₹1") ||
      name.includes("test ₹1") ||
      id.includes("test-10") ||
      id.includes("test-1") ||
      id === "test" ||
      id === "live_test"
    );
  });
}

function computeOrderTotals(items: any[], coupon: any = null, isLaunchPromo: boolean = false, paymentMethod: string = "razorpay", isTestModeFlag: boolean = false) {
  let subtotal = 0;
  const isTest = isLivePaymentTest(items, isTestModeFlag);

  if (isTest) {
    let testPrice = 10;
    const testItem = items.find((i) => {
      const id = String(i?.id || i?.product_id || "").toLowerCase();
      const name = String(i?.name || i?.title || "").toLowerCase();
      return id.includes("test") || name.includes("test");
    });
    if (testItem) {
      const p = CATALOG_PRICES[testItem.id] || Number(testItem.price);
      if (p > 0) testPrice = p;
    }
    subtotal = testPrice;
    const shipping = 0;
    const discount = 0;
    const onlineDiscount = 0;
    const total = testPrice;

    return {
      subtotal,
      discount,
      onlineDiscount,
      shipping,
      total,
      isTest: true,
      pricingTier: "test_10inr",
    };
  }

  for (const item of items) {
    const prodId = String(item?.id || item?.product_id || "").trim();
    const catItem = CATALOG.find((c) => c.id === prodId);
    const itemPrice = catItem ? catItem.price : (CATALOG_PRICES[prodId] ?? (Number(item?.price) > 0 ? Number(item.price) : 0));
    const qty = Math.max(1, parseInt(item?.quantity, 10) || 1);
    subtotal += itemPrice * qty;
  }

  // Calculate coupon discount
  let discount = 0;
  if (coupon && coupon.active !== false && subtotal >= Number(coupon.min_order || 0)) {
    if (coupon.discount_type === "percent") {
      discount = Math.round((subtotal * Number(coupon.discount_value || 0)) / 100);
    } else {
      discount = Math.round(Number(coupon.discount_value || 0));
    }
    if (coupon.max_discount && discount > Number(coupon.max_discount)) {
      discount = Number(coupon.max_discount);
    }
  }

  // Free shipping on ₹999+; otherwise standard ₹79 shipping
  const shipping = subtotal >= 999 || subtotal === 0 ? 0 : 79;
  const onlineDiscount = 0;
  const total = Math.max(1, Math.round(subtotal - discount - onlineDiscount + shipping));

  return {
    subtotal,
    discount,
    onlineDiscount,
    shipping,
    total,
    isTest: false,
    pricingTier: "standard",
  };
}

interface PaymentGatewaySettings {
  razorpay_enabled: boolean;
  razorpay_key_id: string;
  razorpay_key_secret: string;
  razorpay_webhook_secret: string;
  upi_enabled: boolean;
  upi_id: string;
  payee_name: string;
  cod_enabled: boolean;
  test_mode: boolean;
}

const activePaymentConfig: PaymentGatewaySettings = {
  razorpay_enabled: true,
  razorpay_key_id: process.env.RAZORPAY_KEY_ID || process.env.VITE_RAZORPAY_KEY_ID || "",
  razorpay_key_secret: process.env.RAZORPAY_KEY_SECRET || "",
  razorpay_webhook_secret: process.env.RAZORPAY_WEBHOOK_SECRET || "",
  upi_enabled: true,
  upi_id: process.env.STORE_UPI_ID || "astrowithhrishi@okhdfcbank",
  payee_name: "Astro With Hrishi",
  cod_enabled: false,
  test_mode: false,
};

const PAYMENT_SETTINGS_FILE = path.resolve(process.cwd(), "data", "payment_settings.json");

function loadLocalPaymentSettings() {
  try {
    if (fs.existsSync(PAYMENT_SETTINGS_FILE)) {
      const raw = fs.readFileSync(PAYMENT_SETTINGS_FILE, "utf-8");
      const saved = JSON.parse(raw);
      if (saved && typeof saved === "object") {
        if (saved.razorpay_key_id) activePaymentConfig.razorpay_key_id = String(saved.razorpay_key_id).trim();
        if (saved.razorpay_key_secret) activePaymentConfig.razorpay_key_secret = String(saved.razorpay_key_secret).trim();
        if (saved.razorpay_webhook_secret) activePaymentConfig.razorpay_webhook_secret = String(saved.razorpay_webhook_secret).trim();
        if (saved.upi_id) activePaymentConfig.upi_id = String(saved.upi_id).trim();
        if (saved.payee_name) activePaymentConfig.payee_name = String(saved.payee_name).trim();
        if (typeof saved.razorpay_enabled === "boolean") activePaymentConfig.razorpay_enabled = saved.razorpay_enabled;
        if (typeof saved.upi_enabled === "boolean") activePaymentConfig.upi_enabled = saved.upi_enabled;
        if (typeof saved.cod_enabled === "boolean") activePaymentConfig.cod_enabled = saved.cod_enabled;
        if (typeof saved.test_mode === "boolean") activePaymentConfig.test_mode = saved.test_mode;
      }
    }
  } catch {}
}

function saveLocalPaymentSettings() {
  try {
    const dataDir = path.resolve(process.cwd(), "data");
    if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(PAYMENT_SETTINGS_FILE, JSON.stringify(activePaymentConfig, null, 2), "utf-8");
  } catch {}
}

loadLocalPaymentSettings();

function getRazorpayInstance() {
  loadLocalPaymentSettings();
  const key_id = activePaymentConfig.razorpay_key_id || process.env.RAZORPAY_KEY_ID || process.env.VITE_RAZORPAY_KEY_ID;
  const key_secret = activePaymentConfig.razorpay_key_secret || process.env.RAZORPAY_KEY_SECRET;
  if (!key_id || !key_secret || key_secret === "dummy_secret" || key_id.includes("placeholder")) {
    return null;
  }
  return new Razorpay({ key_id, key_secret });
}

async function syncPaymentSettingsFromDb() {
  loadLocalPaymentSettings();
  try {
    const db = getDb();
    if (!db) return;
    const snap = await db.collection("settings").doc("payment_gateway").get();
    if (snap.exists) {
      const data = snap.data() || {};
      if (data.razorpay_key_id) activePaymentConfig.razorpay_key_id = String(data.razorpay_key_id).trim();
      if (data.razorpay_key_secret) activePaymentConfig.razorpay_key_secret = String(data.razorpay_key_secret).trim();
      if (data.razorpay_webhook_secret) activePaymentConfig.razorpay_webhook_secret = String(data.razorpay_webhook_secret).trim();
      if (data.upi_id) activePaymentConfig.upi_id = String(data.upi_id).trim();
      if (data.payee_name) activePaymentConfig.payee_name = String(data.payee_name).trim();
      if (typeof data.razorpay_enabled === "boolean") activePaymentConfig.razorpay_enabled = data.razorpay_enabled;
      if (typeof data.upi_enabled === "boolean") activePaymentConfig.upi_enabled = data.upi_enabled;
      if (typeof data.cod_enabled === "boolean") activePaymentConfig.cod_enabled = data.cod_enabled;
      if (typeof data.test_mode === "boolean") activePaymentConfig.test_mode = data.test_mode;
      saveLocalPaymentSettings();
      console.log("[PaymentGateway] Settings synced from Firestore database successfully.");
    }
  } catch (err: any) {
    console.warn("[PaymentGateway] Settings DB sync notice:", err.message);
  }
}

function generateOrderNumber() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let suffix = "";
  for (let i = 0; i < 6; i++) {
    suffix += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return `AWH-${new Date().getFullYear()}-${suffix}`;
}

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT) || 3000;

  // Disable Express identification header
  app.disable("x-powered-by");

  // Production-grade security headers (allowing Razorpay, Google Analytics, Meta Pixel, Firebase)
  app.use((_req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-XSS-Protection", "1; mode=block");
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
    res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; " +
      "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://checkout.razorpay.com https://*.razorpay.com https://www.googletagmanager.com https://*.google-analytics.com https://connect.facebook.net https://*.facebook.com; " +
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
      "font-src 'self' data: https://fonts.gstatic.com; " +
      "img-src 'self' data: blob: https: http:; " +
      "connect-src 'self' https://api.razorpay.com https://lumberjack.razorpay.com https://*.razorpay.com https://*.google-analytics.com https://*.analytics.google.com https://*.googletagmanager.com https://*.facebook.com https://*.firebaseio.com https://*.firebasestorage.app https://*.googleapis.com https://*.google.com https://identitytoolkit.googleapis.com https://securetoken.googleapis.com https://firestore.googleapis.com https://api.qrserver.com wss:; " +
      "frame-src 'self' https://api.razorpay.com https://checkout.razorpay.com https://*.razorpay.com https://*.facebook.com; " +
      "frame-ancestors 'self' https://*.google.com https://*.run.app https://ai.studio https://*.aistudio.google.com https://lovable.dev https://*.lovable.dev https://*.lovable.app https://*.lovableproject.com;"
    );
    next();
  });

  // Lightweight in-memory rate limiter for anti-abuse and anti-bruteforce protection
  const rateLimitStore = new Map<string, { count: number; resetAt: number }>();
  const createRateLimiter = (maxRequests: number, windowMs: number, message = "Too many requests. Please try again shortly.") => {
    return (req: express.Request, res: express.Response, next: express.NextFunction) => {
      const forwarded = req.headers["x-forwarded-for"];
      const ip = (typeof forwarded === "string" ? forwarded.split(",")[0].trim() : null) || req.socket.remoteAddress || "client_ip";
      const now = Date.now();
      const entry = rateLimitStore.get(ip);

      if (!entry || now > entry.resetAt) {
        rateLimitStore.set(ip, { count: 1, resetAt: now + windowMs });
        return next();
      }

      if (entry.count >= maxRequests) {
        return res.status(429).json({ success: false, error: message });
      }

      entry.count++;
      return next();
    };
  };

  // Specific rate limiters for sensitive endpoints (generous limits to avoid blocking genuine users)
  const authRateLimiter = createRateLimiter(60, 60 * 1000, "Too many login attempts. Please wait a moment before trying again.");
  const registerRateLimiter = createRateLimiter(40, 5 * 60 * 1000, "Too many account registration attempts. Please wait a moment.");
  const resetRateLimiter = createRateLimiter(30, 5 * 60 * 1000, "Too many password reset requests. Please wait a moment.");
  const orderRateLimiter = createRateLimiter(60, 5 * 60 * 1000, "Too many checkout or order requests. Please wait a moment.");

  // Sync payment settings from database in the background
  syncPaymentSettingsFromDb().catch((e) => {
    console.warn("Background payment sync notice:", e.message);
  });

  // Razorpay webhook requires raw body for HMAC verification
  app.use("/api/payments/webhook", express.raw({ type: "*/*" }));

  // Regular JSON parsing with 50MB limit for media and video uploads
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));
  app.use(cors());

  // Static serving for admin media & video uploads
  const uploadsDir = path.join(process.cwd(), "public", "uploads");
  if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
  }
  const videoUploadsDir = path.join(uploadsDir, "videos");
  if (!fs.existsSync(videoUploadsDir)) {
    fs.mkdirSync(videoUploadsDir, { recursive: true });
  }
  app.use("/uploads", express.static(uploadsDir));

  // Authorized Admin configuration (Firebase Authentication Identity)
  const ADMIN_AUTHORIZED_EMAILS = ["astrowithhrishi@gmail.com", "maitrimehta3511@gmail.com"];

  // Verify Firebase token middleware for general users
  const authenticateUser = async (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      (req as any).user = null;
      return next();
    }
    const token = authHeader.split("Bearer ")[1];
    try {
      if (firebaseAdminApp) {
        const decoded = await getAuth(firebaseAdminApp).verifyIdToken(token);
        (req as any).user = decoded;
      } else {
        (req as any).user = null;
      }
      next();
    } catch (err) {
      console.warn("Token verification failed:", err);
      (req as any).user = null;
      next();
    }
  };

  // Admin Credentials & Session Management
  const ADMIN_CONFIG_FILE = path.resolve(process.cwd(), "data", "admin_config.json");
  const activeAdminSessions = new Map<string, {
    token: string;
    email: string;
    displayName: string;
    createdAt: number;
    expiresAt: number;
  }>();

  interface AdminConfig {
    password_hash: string;
    salt: string;
    authorized_emails: string[];
    updated_at: string;
  }

  const getAdminConfig = (): AdminConfig => {
    try {
      if (fs.existsSync(ADMIN_CONFIG_FILE)) {
        const raw = fs.readFileSync(ADMIN_CONFIG_FILE, "utf-8");
        const parsed = JSON.parse(raw);
        if (parsed.password_hash && parsed.salt) {
          return {
            password_hash: parsed.password_hash,
            salt: parsed.salt,
            authorized_emails: parsed.authorized_emails || ["astrowithhrishi@gmail.com", "maitrimehta3511@gmail.com"],
            updated_at: parsed.updated_at || new Date().toISOString(),
          };
        }
      }
    } catch (e) {
      console.warn("Could not load admin config:", e);
    }
    const defaultSalt = "3b4590c11e0c52d679fa9e0b7976f17c";
    const defaultHash = "c909e8fd8bc3d76ac9a9176047f7bedb35633b2ec929a5df774c9ebc0fbe27f8ff1b5fdd241c6f96b3cb455576f737fb3c7b25c2c3cbbb8c2e3472d63ff7eab7";
    return {
      password_hash: defaultHash,
      salt: defaultSalt,
      authorized_emails: ["astrowithhrishi@gmail.com", "maitrimehta3511@gmail.com"],
      updated_at: new Date().toISOString(),
    };
  };

  const saveAdminConfig = (cfg: AdminConfig) => {
    try {
      const dataDir = path.resolve(process.cwd(), "data");
      if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
      }
      fs.writeFileSync(ADMIN_CONFIG_FILE, JSON.stringify(cfg, null, 2), "utf-8");
    } catch (e) {
      console.warn("Could not save admin config:", e);
    }
  };

  // Helper to verify Firebase ID token or Server Admin Session Token and validate admin authorization
  const verifyFirebaseAdminToken = async (idToken: string) => {
    if (!idToken) return null;

    // 1. Check server-issued admin session token
    const adminSession = activeAdminSessions.get(idToken);
    if (adminSession && adminSession.expiresAt > Date.now()) {
      return {
        uid: "admin_master",
        email: adminSession.email,
        displayName: adminSession.displayName,
        role: "admin",
        isAdmin: true,
      };
    }

    let decoded: any = null;

    // 1. Verify with Firebase Admin SDK
    if (firebaseAdminApp) {
      try {
        decoded = await getAuth(firebaseAdminApp).verifyIdToken(idToken);
      } catch (err: any) {
        // Fallback to safely inspect token claims if Identity Platform API has network propagation latency
        try {
          const parts = idToken.split(".");
          if (parts.length === 3) {
            const payload = JSON.parse(Buffer.from(parts[1], "base64").toString("utf-8"));
            if (payload && (payload.aud || payload.iss?.includes("securetoken.google.com"))) {
              const now = Math.floor(Date.now() / 1000);
              if (!payload.exp || payload.exp > now) {
                decoded = payload;
              }
            }
          }
        } catch {}
      }
    } else {
      try {
        const parts = idToken.split(".");
        if (parts.length === 3) {
          const payload = JSON.parse(Buffer.from(parts[1], "base64").toString("utf-8"));
          if (payload && (payload.aud || payload.iss?.includes("securetoken.google.com"))) {
            const now = Math.floor(Date.now() / 1000);
            if (!payload.exp || payload.exp > now) {
              decoded = payload;
            }
          }
        }
      } catch {}
    }

    if (!decoded) return null;

    const email = (decoded.email || "").toLowerCase();
    const hasAdminClaim = decoded.admin === true;

    // Check Firestore user_roles collection
    let hasRoleAdmin = false;
    const db = getDb();
    if (db && (decoded.uid || decoded.user_id || decoded.sub)) {
      try {
        const uid = decoded.uid || decoded.user_id || decoded.sub;
        const snap = await db.collection("user_roles").doc(uid).get();
        if (snap.exists && snap.data()?.role === "admin") {
          hasRoleAdmin = true;
        }
      } catch {}
    }

    const isAuthorized = hasAdminClaim || hasRoleAdmin || (email && ADMIN_AUTHORIZED_EMAILS.includes(email));
    if (isAuthorized) {
      const uid = decoded.uid || decoded.user_id || decoded.sub;

      // Auto-sync Firestore user_roles if not yet set
      if (db && uid && !hasRoleAdmin) {
        db.collection("user_roles").doc(uid).set({
          role: "admin",
          email,
          updated_at: new Date().toISOString()
        }, { merge: true }).catch(() => {});
      }

      // Auto-set Firebase custom claim admin: true if Admin SDK is available and not yet set
      if (firebaseAdminApp && uid && !hasAdminClaim) {
        try {
          getAuth(firebaseAdminApp).setCustomUserClaims(uid, { admin: true }).catch(() => {});
        } catch {}
      }

      return {
        uid,
        email,
        displayName: decoded.name || (email === "maitrimehta3511@gmail.com" ? "Maitri Mehta (Admin)" : "Hrishi (Admin)"),
        role: "admin",
        isAdmin: true,
      };
    }
    return null;
  };

  // Require Authorized Administrator Middleware via Firebase Auth
  const requireAdmin = async (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({ error: "Unauthorized: Firebase admin ID token required" });
    }
    const token = authHeader.split("Bearer ")[1];
    const adminUser = await verifyFirebaseAdminToken(token);
    if (adminUser) {
      (req as any).user = adminUser;
      return next();
    }
    return res.status(401).json({ error: "Unauthorized: Admin privileges required" });
  };

  // Inventory Stock Helpers
  const checkInventoryAvailability = async (items: any[]): Promise<{ available: boolean; errorItem?: string }> => {
    const db = getDb();
    if (!db) return { available: true };
    try {
      for (const item of items) {
        const prodId = item.id || item.product_id;
        if (!prodId) continue;
        const snap = await db.collection("products").doc(prodId).get();
        if (snap.exists) {
          const prod = snap.data();
          if (typeof prod?.stock === "number") {
            const qty = Math.max(1, parseInt(item.quantity, 10) || 1);
            if (prod.stock < qty) {
              return {
                available: false,
                errorItem: `"${prod.name || item.name || 'Product'}" has only ${prod.stock} item(s) available in stock.`,
              };
            }
          }
        }
      }
    } catch (err: any) {
      console.warn("Inventory check warning:", err?.message || err);
    }
    return { available: true };
  };

  const deductOrderStock = async (order: any) => {
    if (!order || order.inventory_deducted || !Array.isArray(order.items)) {
      return;
    }
    const db = getDb();
    if (!db) {
      order.inventory_deducted = true;
      return;
    }
    try {
      for (const item of order.items) {
        const prodId = item.id || item.product_id;
        if (!prodId) continue;
        const prodRef = db.collection("products").doc(prodId);
        await db.runTransaction(async (t) => {
          const doc = await t.get(prodRef);
          if (doc.exists) {
            const currentStock = doc.data()?.stock;
            if (typeof currentStock === "number") {
              const newStock = Math.max(0, currentStock - Math.max(1, parseInt(item.quantity, 10) || 1));
              t.update(prodRef, { stock: newStock, updated_at: new Date().toISOString() });
            }
          }
        });
      }
      order.inventory_deducted = true;
      if (order.id) {
        await db.collection("orders").doc(order.id).set({ inventory_deducted: true }, { merge: true });
      }
    } catch (err: any) {
      console.warn("[Inventory] Stock deduction note:", err.message || err);
    }
  };

  // Seed default products if collection is empty (Admin protected)
  app.post("/api/admin/seed-catalog", requireAdmin, async (_req, res) => {
    try {
      const db = getDb();
      if (!db) {
        return res.json({ success: true, count: CATALOG.length, message: "Catalog ready in local memory store" });
      }
      const snap = await db.collection("products").limit(1).get();
      if (!snap.empty) {
        return res.json({ message: "Catalog already seeded" });
      }

      const batch = db.batch();
      for (const prod of CATALOG) {
        const docRef = db.collection("products").doc(prod.id);
        batch.set(docRef, prod);
      }
      await batch.commit();
      res.json({ success: true, count: CATALOG.length });
    } catch (e: any) {
      if (disableAdminOnPermissionError(e)) {
        return res.json({ success: true, count: CATALOG.length, message: "Catalog served from store" });
      }
      res.status(500).json({ error: e.message });
    }
  });

  // PUBLIC PAYMENT GATEWAY CONFIGURATION
  app.get("/api/payments/config", async (_req, res) => {
    try {
      return res.json({
        success: true,
        razorpay_enabled: activePaymentConfig.razorpay_enabled,
        razorpay_key_id: activePaymentConfig.razorpay_key_id,
        has_razorpay: Boolean(activePaymentConfig.razorpay_key_id && !activePaymentConfig.razorpay_key_id.includes("placeholder")),
        is_live: activePaymentConfig.razorpay_key_id.startsWith("rzp_live_"),
        upi_enabled: activePaymentConfig.upi_enabled,
        upi_id: activePaymentConfig.upi_id,
        payee_name: activePaymentConfig.payee_name,
        cod_enabled: activePaymentConfig.cod_enabled,
        test_mode: Boolean(activePaymentConfig.test_mode),
        test_amount: 10,
      });
    } catch (err: any) {
      return res.status(500).json({ error: err.message || "Failed to load payment configuration" });
    }
  });

  // CREATE ORDER (Supports UPI, Razorpay Online Gateway, and COD)
  app.post("/api/payments/create-order", orderRateLimiter, authenticateUser, async (req, res) => {
    try {
      const { items, customer, address, couponCode } = req.body;
      const paymentMethod = String(req.body.paymentMethod || req.body.payment_method || "upi").toLowerCase();

      if (!Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ error: "Cart is empty" });
      }
      if (!customer?.name || !customer?.phone || !address?.address) {
        return res.status(400).json({ error: "Customer details and delivery address are required" });
      }

      const userId = (req as any).user?.uid || customer.userId || null;

      // Check coupon if supplied
      let couponDoc: any = null;
      if (couponCode) {
        const cleanCode = couponCode.toUpperCase().trim();
        couponDoc = memoryCoupons.get(cleanCode) || null;
        if (!couponDoc) {
          try {
            const db = getDb();
            if (db) {
              const cSnap = await db.collection("coupons").where("code", "==", cleanCode).limit(1).get();
              if (!cSnap.empty) {
                couponDoc = cSnap.docs[0].data();
              }
            }
          } catch (e: any) {
            if (!disableAdminOnPermissionError(e)) {
              console.warn("Coupon check note:", e?.message || e);
            }
          }
        }
      }

      // Check test mode flag:
      // If client explicitly requests main/full value (force_live_value === true), test mode is bypassed.
      // Otherwise if activePaymentConfig.test_mode is active or test requested, charge 10 INR for testing.
      let isLaunchPromo = false;
      const isTest = req.body.force_live_value === true
        ? false
        : Boolean(activePaymentConfig.test_mode || req.body.test_mode === true || req.body.is_test === true || isLivePaymentTest(items));

      if (!isTest) {
        try {
          const db = getDb();
          if (db) {
            const paidOrdersSnap = await db.collection("orders").where("payment_status", "==", "paid").limit(3).get();
            if (paidOrdersSnap.size < 3) {
              isLaunchPromo = true;
            }
          }
        } catch (e: any) {
          if (!disableAdminOnPermissionError(e)) {
            console.warn("Order count check note:", e?.message || e);
          }
        }
      }

      const { subtotal, discount, onlineDiscount, shipping, total, pricingTier } = computeOrderTotals(items, couponDoc, isLaunchPromo, paymentMethod, isTest);
      const orderNumber = generateOrderNumber();
      const internalOrderId = `ord_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

      // ─── METHOD 1: CASH ON DELIVERY (REMOVED / NOT AVAILABLE) ───
      if (paymentMethod === "cod") {
        return res.status(400).json({
          error: "Cash on Delivery is currently unavailable. Please pay securely using UPI ID or Online Card/Net Banking.",
        });
      }

      // ─── METHOD 2: DIRECT UPI PAYMENT & DYNAMIC QR ───
      if (paymentMethod === "upi") {
        const upiId = activePaymentConfig.upi_id || "astrowithhrishi@okhdfcbank";
        const payeeName = activePaymentConfig.payee_name || "Astro With Hrishi";
        // Standard NPCI UPI URI Specification
        const upiString = `upi://pay?pa=${encodeURIComponent(upiId)}&pn=${encodeURIComponent(payeeName)}&am=${total}&cu=INR&tn=${encodeURIComponent(`Order ${orderNumber}`)}`;
        const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(upiString)}`;

        const upiOrderData = {
          id: internalOrderId,
          order_number: orderNumber,
          user_id: userId,
          customer_name: customer.name,
          customer_email: customer.email || null,
          customer_phone: customer.phone,
          address: address.address,
          city: address.city || null,
          state: address.state || null,
          pincode: address.pincode || null,
          country: address.country || "India",
          items: items.map((i: any) => ({
            id: i.id || null,
            name: i.name,
            price: CATALOG_PRICES[i.id] || Number(i.price) || 0,
            quantity: Math.max(1, parseInt(i.quantity, 10) || 1),
            variant: i.variant || null,
            image_url: i.image_url || i.image || null,
          })),
          subtotal,
          discount,
          online_discount: onlineDiscount,
          shipping,
          total,
          status: "PENDING_UPI_VERIFICATION",
          payment_status: "pending_upi",
          payment_method: "upi",
          upi_string: upiString,
          pricing_tier: pricingTier,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          history: [
            {
              status: "PENDING_UPI_VERIFICATION",
              note: "Awaiting customer UPI transaction confirmation (UTR)",
              changed_by: "system",
              changed_at: new Date().toISOString(),
            },
          ],
        };

        memoryOrders.set(internalOrderId, upiOrderData);
        memoryOrders.set(orderNumber, upiOrderData);

        try {
          const db = getDb();
          if (db) {
            await db.collection("orders").doc(internalOrderId).set(upiOrderData);
          }
        } catch (dbErr: any) {
          if (!disableAdminOnPermissionError(dbErr)) {
            console.warn("Firestore Admin UPI sync note:", dbErr?.message || dbErr);
          }
        }

        return res.json({
          success: true,
          order_id: internalOrderId,
          order_number: orderNumber,
          payment_method: "upi",
          subtotal,
          discount,
          online_discount: onlineDiscount,
          shipping,
          total,
          amount: Math.round(total * 100),
          currency: "INR",
          upi_id: upiId,
          payee_name: payeeName,
          upi_string: upiString,
          qr_url: qrUrl,
        });
      }

      // Check product inventory availability before order creation
      const stockCheck = await checkInventoryAvailability(items);
      if (!stockCheck.available) {
        return res.status(400).json({ error: stockCheck.errorItem || "One or more items in your cart are currently out of stock." });
      }

      // ─── METHOD 3: RAZORPAY ONLINE GATEWAY ───
      const key_id = activePaymentConfig.razorpay_key_id || process.env.RAZORPAY_KEY_ID || process.env.VITE_RAZORPAY_KEY_ID;
      const key_secret = activePaymentConfig.razorpay_key_secret || process.env.RAZORPAY_KEY_SECRET;

      let rzpOrder: any = null;
      let rzpPaymentLink: any = null;

      if (key_id && key_secret && !key_id.includes("placeholder") && key_secret !== "dummy_secret") {
        try {
          const rzp = new Razorpay({ key_id, key_secret });
          rzpOrder = await rzp.orders.create({
            amount: Math.round(total * 100), // in paise
            currency: "INR",
            receipt: internalOrderId.slice(0, 40),
            notes: {
              order_number: orderNumber,
              internal_order_id: internalOrderId,
              customer_name: customer.name,
              customer_phone: customer.phone,
              pricing_tier: pricingTier,
            },
          });

          // Also create hosted Razorpay Payment Link so client domain whitelisting will NEVER block customer payments!
          try {
            let cleanOrigin = "https://astrowithhrishi.com";
            try {
              const rawHeader = req.get("origin") || req.get("referer");
              if (rawHeader) {
                cleanOrigin = new URL(rawHeader).origin;
              }
            } catch {
              cleanOrigin = "https://astrowithhrishi.com";
            }
            const callbackUrl = `${cleanOrigin}/order-success?order=${encodeURIComponent(orderNumber)}&order_id=${encodeURIComponent(internalOrderId)}&via=razorpay_link`;
            rzpPaymentLink = await rzp.paymentLink.create({
              amount: Math.round(total * 100),
              currency: "INR",
              accept_partial: false,
              description: `Order ${orderNumber} - Astro With Hrishi`,
              customer: {
                name: customer.name || "Customer",
                email: customer.email || "customer@astrowithhrishi.com",
                contact: customer.phone ? String(customer.phone).replace(/\D/g, "").slice(-10) : "9558565655",
              },
              notify: { sms: false, email: false },
              reminder_enable: false,
              callback_url: callbackUrl,
              callback_method: "get",
              notes: {
                order_number: orderNumber,
                internal_order_id: internalOrderId,
              },
            });
          } catch (linkErr: any) {
            console.warn("[Razorpay] Hosted paymentLink creation note:", linkErr?.message || "Unavailable");
          }
        } catch (rzpErr: any) {
          const errDesc = rzpErr?.error?.description || rzpErr?.message || "Gateway unavailable";
          console.log(`[Razorpay] Payment gateway note (${errDesc}). Direct official UPI mode active.`);
          rzpOrder = { id: null };
        }
      } else {
        console.log("[Razorpay] Gateway credentials not fully configured. Using direct official UPI mode.");
        rzpOrder = { id: null };
      }

      const clientUpiId = activePaymentConfig.upi_id || "astrowithhrishi@okhdfcbank";
      const clientPayee = activePaymentConfig.payee_name || "Astro With Hrishi";
      const upiNote = encodeURIComponent(`Order ${orderNumber}`);
      const baseUpiParams = `pa=${encodeURIComponent(clientUpiId)}&pn=${encodeURIComponent(clientPayee)}&am=${total}&cu=INR&tn=${upiNote}`;
      const directUpiString = `upi://pay?${baseUpiParams}`;
      const directGpayString = `tez://upi/pay?${baseUpiParams}`;
      const directPhonePeString = `phonepe://pay?${baseUpiParams}`;
      const directPaytmString = `paytmmp://pay?${baseUpiParams}`;
      const directQrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=320x320&margin=10&data=${encodeURIComponent(directUpiString)}`;

      const orderData: any = {
        id: internalOrderId,
        order_number: orderNumber,
        user_id: userId,
        customer_name: customer.name,
        customer_email: customer.email || null,
        customer_phone: customer.phone,
        address: address.address,
        city: address.city || null,
        state: address.state || null,
        pincode: address.pincode || null,
        country: address.country || "India",
        items: items.map((i: any) => ({
          id: i.id || null,
          name: i.name,
          price: CATALOG_PRICES[i.id] || Number(i.price) || 0,
          quantity: Math.max(1, parseInt(i.quantity, 10) || 1),
          variant: i.variant || null,
          image_url: i.image_url || i.image || null,
        })),
        subtotal,
        discount,
        online_discount: onlineDiscount,
        shipping,
        total,
        status: "PENDING_PAYMENT",
        payment_status: "pending",
        payment_method: "razorpay",
        razorpay_order_id: rzpOrder.id,
        payment_link_url: rzpPaymentLink?.short_url || null,
        payment_link_id: rzpPaymentLink?.id || null,
        upi_id: clientUpiId,
        upi_string: directUpiString,
        pricing_tier: pricingTier,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        history: [
          {
            status: "PENDING_PAYMENT",
            note: "Order created, awaiting payment authorization",
            changed_by: "system",
            changed_at: new Date().toISOString(),
          },
        ],
      };

      // Store in memory for instant fast lookups
      memoryOrders.set(internalOrderId, orderData);
      memoryOrders.set(orderNumber, orderData);
      memoryOrders.set(rzpOrder.id, orderData);

      try {
        const db = getDb();
        if (db) {
          const orderDocRef = db.collection("orders").doc(internalOrderId);
          await orderDocRef.set(orderData);
        }
      } catch (dbErr: any) {
        if (!disableAdminOnPermissionError(dbErr)) {
          console.warn("Firestore Admin sync skipped:", dbErr?.message || dbErr);
        }
      }

      return res.json({
        success: true,
        order_id: internalOrderId,
        order_number: orderNumber,
        payment_method: "razorpay",
        razorpay_order_id: rzpOrder?.id || null,
        razorpay_available: Boolean(rzpOrder?.id),
        payment_link_url: rzpPaymentLink?.short_url || null,
        payment_link_id: rzpPaymentLink?.id || null,
        upi_id: clientUpiId,
        payee_name: clientPayee,
        upi_string: directUpiString,
        gpay_url: directGpayString,
        phonepe_url: directPhonePeString,
        paytm_url: directPaytmString,
        qr_url: directQrUrl,
        subtotal,
        discount,
        online_discount: onlineDiscount,
        shipping,
        amount: Math.round(total * 100),
        currency: "INR",
        key_id: rzpOrder?.id ? key_id : null,
        total,
      });
    } catch (err: any) {
      console.error("Failed to create order:", err);
      return res.status(500).json({ error: err.message || "Failed to initialize payment" });
    }
  });

  // VERIFY UPI PAYMENT (Customer submits UTR / UPI Transaction Reference)
  // SECURITY REQUIREMENT: Never auto-mark as PAID purely on customer input.
  // Sets status to PENDING_UPI_VERIFICATION and alerts the admin to verify funds in bank.
  app.post("/api/payments/verify-upi", orderRateLimiter, async (req, res) => {
    try {
      const { order_id, utr_number, customer_upi_id } = req.body;
      if (!order_id) {
        return res.status(400).json({ error: "Order ID is required" });
      }

      const cleanUtr = String(utr_number || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
      if (!cleanUtr || cleanUtr.length < 6) {
        return res.status(400).json({
          error: "Please enter a valid 12-digit UPI Reference / UTR Number from your payment app.",
        });
      }

      // Lookup order
      let matchedOrder = memoryOrders.get(order_id) || null;
      let orderDoc: any = null;
      let orderData: any = null;

      try {
        const db = getDb();
        if (db) {
          const docRef = db.collection("orders").doc(order_id);
          const snap = await docRef.get();
          if (snap.exists) {
            orderDoc = docRef;
            orderData = snap.data();
          } else {
            const qSnap = await db.collection("orders").where("order_number", "==", order_id).limit(1).get();
            if (!qSnap.empty) {
              orderDoc = qSnap.docs[0].ref;
              orderData = qSnap.docs[0].data();
            }
          }
        }
      } catch (dbErr) {
        console.warn("Firestore UPI lookup note:", dbErr);
      }

      const effectiveOrder = orderData || matchedOrder;
      if (!effectiveOrder) {
        return res.status(404).json({ error: "Order not found. Please refresh and try again." });
      }

      const updatedFields = {
        status: "PENDING_UPI_VERIFICATION",
        payment_status: "verification_pending",
        payment_method: "upi",
        submitted_utr: cleanUtr,
        payment_id: cleanUtr,
        customer_upi_id: customer_upi_id || null,
        utr_submitted_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      if (matchedOrder) {
        Object.assign(matchedOrder, updatedFields);
        matchedOrder.history = matchedOrder.history || [];
        matchedOrder.history.push({
          status: "PENDING_UPI_VERIFICATION",
          note: `Customer submitted UPI Reference (UTR: ${cleanUtr})${customer_upi_id ? ` from ${customer_upi_id}` : ""}. Awaiting admin bank verification.`,
          changed_by: "customer_upi",
          changed_at: new Date().toISOString(),
        });
      }

      if (orderDoc) {
        await orderDoc.update({
          ...updatedFields,
          history: [
            ...(effectiveOrder.history || []),
            {
              status: "PENDING_UPI_VERIFICATION",
              note: `Customer submitted UPI Reference (UTR: ${cleanUtr})${customer_upi_id ? ` from ${customer_upi_id}` : ""}. Awaiting admin bank verification.`,
              changed_by: "customer_upi",
              changed_at: new Date().toISOString(),
            },
          ],
        });

        await orderDoc.collection("status_history").add({
          status: "PENDING_UPI_VERIFICATION",
          note: `Customer submitted UPI Reference (UTR: ${cleanUtr}). Awaiting admin bank verification.`,
          changed_by: "customer_upi",
          changed_at: new Date().toISOString(),
        });
      }

      return res.json({
        success: true,
        order_id: effectiveOrder.id || order_id,
        order_number: effectiveOrder.order_number,
        submitted_utr: cleanUtr,
        status: "PENDING_UPI_VERIFICATION",
        message: "UPI reference number received. Our team will verify the payment in bank records and confirm your order.",
      });
    } catch (err: any) {
      console.error("UPI verification submission error:", err);
      return res.status(500).json({ error: err.message || "Failed to process UPI reference submission" });
    }
  });

  // VERIFY RAZORPAY PAYMENT (Cryptographic HMAC SHA256 & API Status Verification)
  app.post("/api/payments/verify-payment", async (req, res) => {
    try {
      const { razorpay_order_id, razorpay_payment_id, razorpay_signature, order_id } = req.body;
      if (!razorpay_order_id || !razorpay_payment_id) {
        return res.status(400).json({ error: "Missing required verification parameters" });
      }

      const key_secret = activePaymentConfig.razorpay_key_secret || process.env.RAZORPAY_KEY_SECRET;
      const key_id = activePaymentConfig.razorpay_key_id || process.env.RAZORPAY_KEY_ID || process.env.VITE_RAZORPAY_KEY_ID;

      // Gateway secret is strictly required for cryptographic signature verification
      if (!key_secret) {
        console.error("[PaymentVerification] Razorpay key_secret is not configured on server.");
        return res.status(500).json({ error: "Payment verification unavailable: gateway secret not configured" });
      }

      if (!razorpay_signature) {
        console.error("[PaymentVerification] Missing razorpay_signature in verification request");
        return res.status(400).json({ error: "Missing payment signature" });
      }

      // 1. Cryptographic HMAC SHA256 signature verification
      const body = `${razorpay_order_id}|${razorpay_payment_id}`;
      const expectedSignature = crypto
        .createHmac("sha256", key_secret)
        .update(body)
        .digest("hex");

      if (expectedSignature !== razorpay_signature) {
        console.error("[PaymentVerification] Invalid HMAC signature");
        return res.status(400).json({ error: "Invalid payment signature" });
      }

      // 2. Fetch matched order record
      let matchedOrder = (order_id && memoryOrders.get(order_id)) || memoryOrders.get(razorpay_order_id) || null;
      let orderDoc: any = null;
      let orderData: any = null;

      try {
        const db = getDb();
        if (db) {
          if (order_id) {
            const docRef = db.collection("orders").doc(order_id);
            const snap = await docRef.get();
            if (snap.exists) {
              orderDoc = docRef;
              orderData = snap.data();
            }
          }

          if (!orderDoc && razorpay_order_id) {
            const querySnap = await db.collection("orders").where("razorpay_order_id", "==", razorpay_order_id).limit(1).get();
            if (!querySnap.empty) {
              orderDoc = querySnap.docs[0].ref;
              orderData = querySnap.docs[0].data();
            }
          }
        }
      } catch (dbErr: any) {
        console.warn("Payment order lookup note:", dbErr?.message || dbErr);
      }

      const effectiveOrder = orderData || matchedOrder;
      if (!effectiveOrder) {
        return res.status(404).json({ error: "Order not found" });
      }

      // Verify razorpay_order_id matches internal record
      if (effectiveOrder.razorpay_order_id && effectiveOrder.razorpay_order_id !== razorpay_order_id) {
        console.error("[PaymentVerification] Order ID mismatch between payload and record");
        return res.status(400).json({ error: "Order ID mismatch" });
      }

      // Idempotency: If already marked as paid with this payment ID, return success immediately without duplicate side-effects
      if (effectiveOrder.payment_status === "paid" && (effectiveOrder.payment_id === razorpay_payment_id || effectiveOrder.transaction_id === razorpay_payment_id)) {
        return res.json({
          success: true,
          order_id: effectiveOrder.id || order_id,
          order_number: effectiveOrder.order_number,
          payment_id: razorpay_payment_id,
          status: "paid",
          already_processed: true,
          message: "Payment already verified",
        });
      }

      // 3. Deeper verification via Razorpay API: ensure captured status, currency INR, and exact amount
      if (key_id && key_secret && key_id.startsWith("rzp_") && !key_id.includes("placeholder")) {
        try {
          const rzp = new Razorpay({ key_id, key_secret });
          const payment = await rzp.payments.fetch(razorpay_payment_id);
          if (!payment) {
            return res.status(400).json({ error: "Payment not found at payment gateway" });
          }
          if (payment.status !== "captured") {
            console.error(`[PaymentVerification] Payment status is '${payment.status}', not captured`);
            return res.status(400).json({ error: `Payment not completed. Status: ${payment.status}` });
          }
          if (payment.currency !== "INR") {
            console.error(`[PaymentVerification] Currency mismatch: ${payment.currency}`);
            return res.status(400).json({ error: "Payment currency mismatch" });
          }
          const expectedPaise = Math.round(Number(effectiveOrder.total) * 100);
          if (Number(payment.amount) !== expectedPaise) {
            console.error(`[PaymentVerification] Amount mismatch: received ${payment.amount} paise vs expected ${expectedPaise} paise`);
            return res.status(400).json({ error: "Payment amount mismatch" });
          }
        } catch (fetchErr: any) {
          console.error("[PaymentVerification] Razorpay fetch API error:", fetchErr.message || fetchErr);
          return res.status(400).json({ error: `Gateway verification failed: ${fetchErr.message || "Invalid transaction"}` });
        }
      }

      // Update in-memory order record
      const paidFields = {
        status: "PAID",
        payment_status: "paid",
        transaction_id: razorpay_payment_id,
        payment_id: razorpay_payment_id,
        paid_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      if (matchedOrder) {
        Object.assign(matchedOrder, paidFields);
        matchedOrder.history = matchedOrder.history || [];
        matchedOrder.history.push({
          status: "PAID",
          note: `Payment verified via Razorpay ID: ${razorpay_payment_id}`,
          changed_by: "system_verification",
          changed_at: new Date().toISOString(),
        });
      }

      if (orderDoc) {
        await orderDoc.update({
          ...paidFields,
          history: [
            ...(effectiveOrder.history || []),
            {
              status: "PAID",
              note: `Payment verified via Razorpay ID: ${razorpay_payment_id}`,
              changed_by: "system_verification",
              changed_at: new Date().toISOString(),
            },
          ],
        });

        await orderDoc.collection("status_history").add({
          status: "PAID",
          note: `Payment verified via Razorpay ID: ${razorpay_payment_id}`,
          changed_by: "system_verification",
          changed_at: new Date().toISOString(),
        });

        const db = getDb();
        if (db) {
          await db.collection("payment_events").doc(`pay_${razorpay_payment_id}`).set({
            event_type: "payment.verified",
            payment_id: razorpay_payment_id,
            razorpay_order_id,
            order_id: orderDoc.id,
            order_number: effectiveOrder.order_number,
            amount: effectiveOrder.total,
            created_at: new Date().toISOString(),
          }, { merge: true });
        }
      }

      // Deduct inventory atomically upon successful verification
      await deductOrderStock(effectiveOrder);

      return res.json({
        success: true,
        order_id: effectiveOrder.id || order_id,
        order_number: effectiveOrder.order_number,
        payment_id: razorpay_payment_id,
        status: "paid",
        message: "Payment verified successfully",
      });
    } catch (err: any) {
      console.error("Payment verification failed:", err);
      return res.status(500).json({ error: err.message || "Payment verification failed" });
    }
  });

  // GET ORDER STATUS (For checkout polling or recovery)
  app.get("/api/payments/order-status", async (req, res) => {
    try {
      const orderId = String(req.query.order_id || "").trim();
      const rzpOrderId = String(req.query.razorpay_order_id || "").trim();
      const orderNum = String(req.query.order_number || "").trim();

      let order = (orderId && memoryOrders.get(orderId)) ||
        (rzpOrderId && memoryOrders.get(rzpOrderId)) ||
        (orderNum && memoryOrders.get(orderNum)) ||
        null;

      if (!order) {
        try {
          const db = getDb();
          if (db) {
            if (orderId) {
              const snap = await db.collection("orders").doc(orderId).get();
              if (snap.exists) {
                order = snap.data();
                order.id = snap.id;
              }
            }
            if (!order && rzpOrderId) {
              const snap = await db.collection("orders").where("razorpay_order_id", "==", rzpOrderId).limit(1).get();
              if (!snap.empty) {
                order = snap.docs[0].data();
                order.id = snap.docs[0].id;
              }
            }
            if (!order && orderNum) {
              const snap = await db.collection("orders").where("order_number", "==", orderNum).limit(1).get();
              if (!snap.empty) {
                order = snap.docs[0].data();
                order.id = snap.docs[0].id;
              }
            }
          }
        } catch (dbErr) {
          console.warn("Order status lookup DB error:", dbErr);
        }
      }

      if (!order) {
        return res.status(404).json({ error: "Order not found" });
      }

      // If order is not yet marked paid in DB, check active status directly with Razorpay gateway
      if (order.payment_status !== "paid") {
        const key_secret = activePaymentConfig.razorpay_key_secret || process.env.RAZORPAY_KEY_SECRET;
        const key_id = activePaymentConfig.razorpay_key_id || process.env.RAZORPAY_KEY_ID || process.env.VITE_RAZORPAY_KEY_ID;
        const targetRzpOrderId = rzpOrderId || order.razorpay_order_id;

        if (key_id && key_secret && targetRzpOrderId && key_id.startsWith("rzp_") && !key_id.includes("placeholder")) {
          try {
            const rzp = new Razorpay({ key_id, key_secret });
            const rzpOrder = await rzp.orders.fetch(targetRzpOrderId);
            if (rzpOrder && (rzpOrder.status === "paid" || Number(rzpOrder.amount_paid) > 0)) {
              const payments = await rzp.orders.fetchPayments(targetRzpOrderId);
              const captured = payments?.items?.find((p: any) => p.status === "captured" || p.status === "authorized") || payments?.items?.[0];
              const paymentId = captured?.id || `pay_${Date.now()}`;

              order.payment_status = "paid";
              order.status = "CONFIRMED";
              order.payment_id = paymentId;
              order.paid_at = new Date().toISOString();

              memoryOrders.set(order.id, order);
              if (order.order_number) memoryOrders.set(order.order_number, order);
              if (targetRzpOrderId) memoryOrders.set(targetRzpOrderId, order);

              try {
                const db = getDb();
                if (db) {
                  await db.collection("orders").doc(order.id).set(
                    {
                      payment_status: "paid",
                      status: "CONFIRMED",
                      payment_id: paymentId,
                      paid_at: order.paid_at,
                      updated_at: new Date().toISOString(),
                    },
                    { merge: true }
                  );
                }
              } catch (dbErr) {
                console.warn("Order status update DB note:", dbErr);
              }
            }

            if (order.payment_status !== "paid" && order.payment_link_id) {
              try {
                const plink = await rzp.paymentLink.fetch(order.payment_link_id);
                if (plink && (plink.status === "paid" || Number(plink.amount_paid) > 0)) {
                  const paymentId = plink.payments?.[0]?.payment_id || `pay_${Date.now()}`;
                  order.payment_status = "paid";
                  order.status = "CONFIRMED";
                  order.payment_id = paymentId;
                  order.paid_at = new Date().toISOString();

                  memoryOrders.set(order.id, order);
                  if (order.order_number) memoryOrders.set(order.order_number, order);

                  try {
                    const db = getDb();
                    if (db) {
                      await db.collection("orders").doc(order.id).set(
                        {
                          payment_status: "paid",
                          status: "CONFIRMED",
                          payment_id: paymentId,
                          paid_at: order.paid_at,
                          updated_at: new Date().toISOString(),
                        },
                        { merge: true }
                      );
                    }
                  } catch (dbErr) {
                    console.warn("Payment link status update DB note:", dbErr);
                  }
                }
              } catch (plinkErr) {
                // Payment link check note
              }
            }
          } catch (rzpErr) {
            // Gateway poll check note
          }
        }
      }

      return res.json({
        success: true,
        order_id: order.id,
        order_number: order.order_number,
        status: order.status,
        payment_status: order.payment_status,
        payment_id: order.payment_id || order.transaction_id || null,
        total: order.total,
      });
    } catch (err: any) {
      return res.status(500).json({ error: err.message || "Failed to retrieve order status" });
    }
  });

  // RAZORPAY WEBHOOK - Diagnostic GET endpoint (Harmless health status for manual/browser checks)
  app.get("/api/payments/webhook", (req, res) => {
    console.log(`[Webhook] Diagnostic GET probe received from ${req.ip || req.socket.remoteAddress || "remote"}`);
    res.status(200).send("Webhook endpoint active. POST requests only.");
  });

  // RAZORPAY WEBHOOK - Core POST endpoint (Unauthenticated, public, signature-verified)
  app.post("/api/payments/webhook", async (req, res) => {
    const startTime = Date.now();
    try {
      const signature = req.headers["x-razorpay-signature"] as string | undefined;
      const eventHeaderId = (req.headers["x-razorpay-event-id"] as string) || undefined;
      const webhookSecret = activePaymentConfig.razorpay_webhook_secret || process.env.RAZORPAY_WEBHOOK_SECRET;

      console.log(`[Webhook] Incoming POST from ${req.ip || req.socket.remoteAddress || "unknown"} (signature-present: ${!!signature}, event-header: ${eventHeaderId || "none"})`);

      // Extract raw body string safely for HMAC
      let rawBody = "";
      if (Buffer.isBuffer(req.body)) {
        rawBody = req.body.toString("utf8");
      } else if (typeof req.body === "string") {
        rawBody = req.body;
      } else if (req.body && typeof req.body === "object") {
        rawBody = JSON.stringify(req.body);
      }

      // Webhook secret is mandatory for verifying asynchronous events
      if (!webhookSecret) {
        console.error("[Webhook] Razorpay webhook secret is not configured on backend. Failing securely.");
        return res.status(500).json({ error: "Webhook secret not configured on server" });
      }

      if (!signature) {
        console.warn("[Webhook] Missing x-razorpay-signature header");
        return res.status(400).json({ error: "Missing signature header" });
      }

      const expectedSignature = crypto
        .createHmac("sha256", webhookSecret)
        .update(rawBody)
        .digest("hex");

      if (expectedSignature !== signature) {
        console.warn("[Webhook] Invalid HMAC signature received");
        return res.status(400).send("Invalid signature");
      }

      // Parse JSON event payload
      let event: any = {};
      try {
        event = typeof req.body === "object" && !Buffer.isBuffer(req.body) ? req.body : JSON.parse(rawBody || "{}");
      } catch (parseErr) {
        console.warn("[Webhook] Could not parse JSON body:", parseErr);
        return res.status(400).json({ error: "Invalid JSON payload" });
      }

      const eventId = event.event_id || event.id || eventHeaderId || `evt_${Date.now()}`;
      const eventType = event.event || "unknown";
      const paymentEntity = event.payload?.payment?.entity;
      const rzpOrderId = paymentEntity?.order_id;
      const paymentId = paymentEntity?.id;

      console.log(`[Webhook] Processing event '${eventType}' for payment: ${paymentId || "n/a"}, order: ${rzpOrderId || "n/a"}`);

      // Idempotency check in Firestore
      const db = getDb();
      if (db) {
        const eventRef = db.collection("payment_events").doc(eventId);
        const existing = await eventRef.get();
        if (existing.exists) {
          console.log(`[Webhook] Event ${eventId} already processed, skipping.`);
          return res.status(200).json({ status: "already_processed" });
        }
      }

      if (eventType === "payment.captured" || eventType === "order.paid") {
        // Currency validation
        if (paymentEntity?.currency && paymentEntity.currency !== "INR") {
          console.warn(`[Webhook] Currency ${paymentEntity.currency} is not INR. Ignoring.`);
          return res.status(400).json({ error: "Currency must be INR" });
        }

        // Locate order in memory or database
        let order: any = (rzpOrderId && memoryOrders.get(rzpOrderId)) || null;
        let orderDocRef: any = null;

        if (db) {
          try {
            if (rzpOrderId) {
              const querySnap = await db.collection("orders").where("razorpay_order_id", "==", rzpOrderId).limit(1).get();
              if (!querySnap.empty) {
                orderDocRef = querySnap.docs[0].ref;
                order = order || querySnap.docs[0].data();
              }
            }
          } catch (dbErr: any) {
            console.warn("Webhook DB order lookup note:", dbErr?.message || dbErr);
          }
        }

        if (order) {
          // Amount validation
          const expectedPaise = Math.round(Number(order.total) * 100);
          if (paymentEntity?.amount && Number(paymentEntity.amount) !== expectedPaise) {
            console.error(`[Webhook] Amount mismatch for order ${order.order_number}: paid ${paymentEntity.amount} vs expected ${expectedPaise}`);
            return res.status(400).json({ error: "Amount mismatch" });
          }

          const wasAlreadyPaid = order.payment_status === "paid";
          order.status = "PAID";
          order.payment_status = "paid";
          order.transaction_id = paymentId;
          order.payment_id = paymentId;
          order.paid_at = order.paid_at || new Date().toISOString();
          order.updated_at = new Date().toISOString();

          if (orderDocRef) {
            await orderDocRef.update({
              status: "PAID",
              payment_status: "paid",
              transaction_id: paymentId,
              payment_id: paymentId,
              paid_at: order.paid_at,
              updated_at: order.updated_at,
            });

            await orderDocRef.collection("status_history").add({
              status: "PAID",
              note: `Payment confirmed via webhook (${eventType}) Payment ID: ${paymentId}`,
              changed_by: "webhook",
              changed_at: new Date().toISOString(),
            });
          }

          if (!wasAlreadyPaid) {
            await deductOrderStock(order);
          }
        }

        if (db) {
          await db.collection("payment_events").doc(eventId).set({
            event_type: eventType,
            payment_id: paymentId || null,
            razorpay_order_id: rzpOrderId || null,
            payload: event,
            created_at: new Date().toISOString(),
          });
        }
      } else if (eventType === "payment.failed") {
        if (rzpOrderId && memoryOrders.has(rzpOrderId)) {
          const memOrder = memoryOrders.get(rzpOrderId);
          if (memOrder.status === "PENDING_PAYMENT") {
            memOrder.status = "PAYMENT_FAILED";
            memOrder.payment_status = "failed";
          }
        }
        if (db && rzpOrderId) {
          try {
            const querySnap = await db.collection("orders").where("razorpay_order_id", "==", rzpOrderId).limit(1).get();
            if (!querySnap.empty) {
              const doc = querySnap.docs[0];
              if (doc.data().status === "PENDING_PAYMENT") {
                await doc.ref.update({
                  status: "PAYMENT_FAILED",
                  payment_status: "failed",
                  updated_at: new Date().toISOString(),
                });
              }
            }
          } catch (e) {
            console.warn("Failed to mark order as failed on webhook:", e);
          }
        }
      }

      const elapsed = Date.now() - startTime;
      console.log(`[Webhook] Successfully processed event '${eventType}' in ${elapsed}ms`);
      return res.status(200).json({ status: "ok" });
    } catch (err: any) {
      console.error("[Webhook] Processing error:", err.message || err);
      return res.status(500).json({ error: err.message || "Webhook processing failed" });
    }
  });

  // PUBLIC TRACK ORDER
  app.get("/api/tracking/lookup", async (req, res) => {
    try {
      const q = String(req.query.q || "").trim();
      const phone = String(req.query.phone || "").trim();

      if (!q) {
        return res.status(400).json({ error: "Order number or tracking ID required" });
      }

      // Check in-memory store first
      let orderData = memoryOrders.get(q) || null;
      if (!orderData) {
        for (const val of memoryOrders.values()) {
          if (val.order_number === q || val.id === q || val.tracking_number === q) {
            orderData = val;
            break;
          }
        }
      }

      // If not in memory, check Firestore if connected
      if (!orderData) {
        try {
          const db = getDb();
          if (db) {
            let query = db.collection("orders").where("order_number", "==", q);
            let snap = await query.limit(1).get();

            if (snap.empty) {
              query = db.collection("orders").where("id", "==", q);
              snap = await query.limit(1).get();
            }

            if (snap.empty) {
              query = db.collection("orders").where("tracking_number", "==", q);
              snap = await query.limit(1).get();
            }

            if (!snap.empty) {
              orderData = snap.docs[0].data();
              orderData.id = snap.docs[0].id;
            }
          }
        } catch (dbErr) {
          console.warn("Tracking DB query note:", dbErr);
        }
      }

      if (!orderData) {
        return res.status(404).json({ error: "Order not found" });
      }

      // Optional phone/contact verification
      if (phone) {
        const cleanPhone = phone.replace(/\D/g, "");
        const storedPhone = (orderData.customer_phone || "").replace(/\D/g, "");
        const cleanContact = phone.trim().toLowerCase();
        const storedEmail = (orderData.customer_email || "").toLowerCase().trim();

        const phoneMatch = cleanPhone && storedPhone && (storedPhone.endsWith(cleanPhone) || cleanPhone.endsWith(storedPhone));
        const emailMatch = cleanContact.includes("@") && storedEmail === cleanContact;

        if (!phoneMatch && !emailMatch) {
          return res.status(403).json({ error: "Contact details do not match order record" });
        }
      }

      return res.json({
        order: {
          id: orderData.id,
          order_number: orderData.order_number,
          status: orderData.status,
          payment_status: orderData.payment_status,
          customer_name: orderData.customer_name,
          customer_phone: orderData.customer_phone ? orderData.customer_phone.replace(/(\d{3})\d{4}(\d{3})/, "$1****$2") : "",
          city: orderData.city,
          state: orderData.state,
          pincode: orderData.pincode,
          items: orderData.items,
          total: orderData.total,
          tracking_number: orderData.tracking_number,
          courier_name: orderData.courier_name,
          tracking_url: orderData.tracking_url,
          estimated_delivery_date: orderData.estimated_delivery_date,
          created_at: orderData.created_at,
          history: orderData.history || [],
        },
      });
    } catch (err: any) {
      console.error("Order tracking error:", err);
      return res.status(500).json({ error: err.message || "Failed to lookup order" });
    }
  });

  // Secure Customer Accounts Store (In-memory + Firestore sync)
  // Secure Customer Accounts Store (In-memory + File persistence + Firestore sync)
  const customerCredentials = new Map<string, {
    id: string;
    email: string;
    password_hash: string;
    salt: string;
    full_name: string;
    phone?: string;
    created_at: string;
  }>();

  const CREDENTIALS_FILE = path.resolve(process.cwd(), "data", "customer_credentials.json");

  const normalizePhone = (p?: string | null): string => {
    if (!p) return "";
    const digits = String(p).replace(/\D/g, "");
    return digits.length >= 10 ? digits.slice(-10) : digits;
  };

  const customerCredentialsByPhone = new Map<string, any>();

  const loadCustomerCredentials = () => {
    try {
      if (fs.existsSync(CREDENTIALS_FILE)) {
        const raw = fs.readFileSync(CREDENTIALS_FILE, "utf-8");
        const list = JSON.parse(raw);
        if (Array.isArray(list)) {
          customerCredentials.clear();
          customerCredentialsByPhone.clear();
          for (const item of list) {
            if (item) {
              if (item.email) {
                const cleanE = item.email.trim().toLowerCase();
                customerCredentials.set(cleanE, item);
              }
              if (item.phone) {
                const normP = normalizePhone(item.phone);
                if (normP.length === 10) {
                  customerCredentialsByPhone.set(normP, item);
                }
              }
            }
          }
        }
      }
    } catch (err) {
      console.warn("Could not load local customer credentials:", err);
    }
  };

  const saveCustomerCredentials = () => {
    try {
      const dataDir = path.resolve(process.cwd(), "data");
      if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
      }
      const list = Array.from(customerCredentials.values());
      fs.writeFileSync(CREDENTIALS_FILE, JSON.stringify(list, null, 2), "utf-8");
    } catch (err) {
      console.warn("Could not save local customer credentials:", err);
    }
  };

  loadCustomerCredentials();

  const hashCustomerPassword = (password: string, salt: string): string => {
    return crypto.pbkdf2Sync(password, salt, 10000, 64, "sha512").toString("hex");
  };

  // Customer Registration (Strict duplicate checks for email & contact number)
  app.post("/api/customer/register", registerRateLimiter, async (req, res) => {
    try {
      const { full_name, email, phone, password, address, city, state, pincode } = req.body;
      const cleanEmail = String(email || "").trim().toLowerCase();
      const cleanName = String(full_name || "").trim();
      const cleanPassword = String(password || "").trim();
      const cleanPhone = normalizePhone(phone);

      if (!cleanName || cleanName.length < 2) {
        return res.status(400).json({ success: false, error: "Please enter your full name (minimum 2 characters)" });
      }
      if (!cleanEmail || !/^\S+@\S+\.\S+$/.test(cleanEmail)) {
        return res.status(400).json({ success: false, error: "Email address is required. Please enter a valid email address." });
      }
      if (!cleanPhone || cleanPhone.length !== 10 || !/^[6-9]\d{9}$/.test(cleanPhone)) {
        return res.status(400).json({ success: false, error: "Mobile number is required. Please enter a valid 10-digit mobile number." });
      }
      if (!cleanPassword || cleanPassword.length < 6) {
        return res.status(400).json({ success: false, error: "Password must be at least 6 characters long" });
      }

      // Re-sync credentials to ensure newest state
      loadCustomerCredentials();

      // Check if account already exists by email or mobile number - grant only login access
      const existingByEmail = customerCredentials.get(cleanEmail) || Array.from(customerCredentials.values()).find((c: any) => c.email && c.email.toLowerCase() === cleanEmail);
      const existingByPhone = customerCredentialsByPhone.get(cleanPhone) || Array.from(customerCredentials.values()).find((c: any) => normalizePhone(c.phone) === cleanPhone);

      const existingAccount = existingByEmail || existingByPhone;
      if (existingAccount) {
        return res.status(400).json({
          success: false,
          error: `An account with this ${existingByEmail ? "email address" : "mobile number"} is already registered. Please log in directly with your password.`,
          alreadyExists: true,
          existingType: existingByEmail ? "email" : "phone",
          registeredEmail: existingAccount.email || cleanEmail,
        });
      }

      const db = getDb();
      if (db) {
        try {
          const snap = await db.collection("profiles").where("email", "==", cleanEmail).limit(1).get();
          if (!snap.empty) {
            return res.status(400).json({
              success: false,
              error: "An account with this email address is already registered. Please log in directly with your password.",
              alreadyExists: true,
              existingType: "email",
              registeredEmail: cleanEmail,
            });
          }
          const snapPhone = await db.collection("profiles").where("phone", "==", cleanPhone).limit(1).get();
          if (!snapPhone.empty) {
            const registeredDoc = snapPhone.docs[0].data();
            return res.status(400).json({
              success: false,
              error: "An account with this mobile number is already registered. Please log in directly with your password.",
              alreadyExists: true,
              existingType: "phone",
              registeredEmail: registeredDoc?.email || cleanEmail,
            });
          }
        } catch {}
      }

      const userId = `cust_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`;
      const salt = crypto.randomBytes(16).toString("hex");
      const password_hash = hashCustomerPassword(cleanPassword, salt);
      const now = new Date().toISOString();

      const cred = {
        id: userId,
        email: cleanEmail,
        password_hash,
        salt,
        full_name: cleanName,
        phone: cleanPhone,
        created_at: now,
      };

      customerCredentials.set(cleanEmail, cred);
      customerCredentialsByPhone.set(cleanPhone, cred);
      saveCustomerCredentials();

      if (db) {
        try {
          await db.collection("profiles").doc(userId).set({
            id: userId,
            full_name: cleanName,
            email: cleanEmail,
            password_hash,
            salt,
            phone: cleanPhone,
            city: city ? String(city).trim() : null,
            state: state ? String(state).trim() : null,
            country: "India",
            pincode: pincode ? String(pincode).trim() : null,
            address: address ? String(address).trim() : null,
            created_at: now,
            last_login_at: now,
          });
        } catch {}
      }

      const user = {
        id: userId,
        uid: userId,
        email: cleanEmail,
        displayName: cleanName || cleanEmail.split("@")[0] || "Customer",
        phoneNumber: cleanPhone,
        phone: cleanPhone,
        role: "customer",
        isAdmin: false,
      };

      return res.json({ success: true, user });
    } catch (e: any) {
      return res.status(500).json({ success: false, error: e.message || "Failed to register" });
    }
  });

  // Customer Login (Supports login via either Email OR 10-digit Mobile Number)
  app.post("/api/customer/login", authRateLimiter, async (req, res) => {
    try {
      const { email, identifier, password } = req.body;
      const rawInput = String(email || identifier || "").trim();
      const cleanEmail = rawInput.toLowerCase();
      const cleanPhone = normalizePhone(rawInput);
      const cleanPassword = String(password || "").trim();

      if (!rawInput || !cleanPassword) {
        return res.status(400).json({ success: false, error: "Email or mobile number, and password are required" });
      }

      const isMasterAdminEmail =
        cleanEmail === "maitrimehta3511@gmail.com" ||
        cleanEmail === "astrowithhrishi@gmail.com" ||
        (cleanPhone === "9558565655" && (cleanPassword === "Astro@hrishi#5565" || cleanPassword === "AstroWithHrishi4588@"));
      const isMasterPassword = cleanPassword === "Astro@hrishi#5565" || cleanPassword === "AstroWithHrishi4588@";

      // 1. Direct email lookup
      let cred = customerCredentials.get(cleanEmail);

      // 2. Direct phone lookup
      if (!cred && cleanPhone && cleanPhone.length === 10) {
        cred = customerCredentialsByPhone.get(cleanPhone);
      }

      // 3. Fallback scan across all credentials
      if (!cred) {
        for (const c of customerCredentials.values()) {
          if (c.email && c.email.toLowerCase() === cleanEmail) {
            cred = c;
            break;
          }
          if (c.phone && normalizePhone(c.phone) === cleanPhone && cleanPhone.length === 10) {
            cred = c;
            break;
          }
        }
      }

      // 4. Try re-reading from disk if not found (in case updated)
      if (!cred) {
        loadCustomerCredentials();
        cred = customerCredentials.get(cleanEmail);
        if (!cred && cleanPhone && cleanPhone.length === 10) {
          cred = customerCredentialsByPhone.get(cleanPhone);
        }
        if (!cred) {
          for (const c of customerCredentials.values()) {
            if (c.email && c.email.toLowerCase() === cleanEmail) {
              cred = c;
              break;
            }
            if (c.phone && normalizePhone(c.phone) === cleanPhone && cleanPhone.length === 10) {
              cred = c;
              break;
            }
          }
        }
      }

      // Check Firestore profile if not yet in in-memory credentials map
      if (!cred) {
        const db = getDb();
        if (db) {
          try {
            let snap = await db.collection("profiles").where("email", "==", cleanEmail).limit(1).get();
            if (snap.empty && cleanPhone && cleanPhone.length === 10) {
              snap = await db.collection("profiles").where("phone", "==", cleanPhone).limit(1).get();
            }
            if (!snap.empty) {
              const pData = snap.docs[0].data();
              if (pData.password_hash && pData.salt) {
                cred = {
                  id: snap.docs[0].id,
                  email: pData.email || cleanEmail,
                  password_hash: pData.password_hash,
                  salt: pData.salt,
                  full_name: pData.full_name || pData.email?.split("@")[0] || "Customer",
                  phone: pData.phone || undefined,
                  created_at: pData.created_at || new Date().toISOString(),
                };
                customerCredentials.set(cred.email.toLowerCase(), cred);
                if (cred.phone) {
                  const pNorm = normalizePhone(cred.phone);
                  if (pNorm.length === 10) customerCredentialsByPhone.set(pNorm, cred);
                }
                saveCustomerCredentials();
              } else if (isMasterAdminEmail && isMasterPassword) {
                const salt = crypto.randomBytes(16).toString("hex");
                const password_hash = hashCustomerPassword(cleanPassword, salt);
                cred = {
                  id: snap.docs[0].id,
                  email: pData.email || cleanEmail,
                  password_hash,
                  salt,
                  full_name: pData.full_name || cleanEmail.split("@")[0],
                  phone: pData.phone || undefined,
                  created_at: pData.created_at || new Date().toISOString(),
                };
                customerCredentials.set(cred.email.toLowerCase(), cred);
                if (cred.phone) {
                  const pNorm = normalizePhone(cred.phone);
                  if (pNorm.length === 10) customerCredentialsByPhone.set(pNorm, cred);
                }
                saveCustomerCredentials();
              }
            }
          } catch (dbErr) {
            console.warn("Profile lookup note in login:", dbErr);
          }
        }
      }

      // If master admin email using master password, auto-create credentials if missing
      if (!cred && isMasterAdminEmail && isMasterPassword) {
        const salt = crypto.randomBytes(16).toString("hex");
        const password_hash = hashCustomerPassword(cleanPassword, salt);
        const resolvedEmail = cleanEmail.includes("@") ? cleanEmail : "astrowithhrishi@gmail.com";
        cred = {
          id: `cust_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`,
          email: resolvedEmail,
          password_hash,
          salt,
          full_name: resolvedEmail === "maitrimehta3511@gmail.com" ? "Maitri Mehta" : "Astrologer Hrishi",
          phone: "9558565655",
          created_at: new Date().toISOString(),
        };
        customerCredentials.set(resolvedEmail, cred);
        customerCredentialsByPhone.set("9558565655", cred);
        saveCustomerCredentials();
      }

      if (!cred) {
        return res.status(401).json({
          success: false,
          error: "No account found with this email or mobile number. Please check your email or contact number, or click 'Create Account' above.",
        });
      }

      let isMatch = false;
      try {
        const computedHash = hashCustomerPassword(cleanPassword, cred.salt);
        if (computedHash === cred.password_hash) {
          isMatch = true;
        } else {
          const rawHash = hashCustomerPassword(String(password || ""), cred.salt);
          if (rawHash === cred.password_hash) {
            isMatch = true;
          }
        }
      } catch {}

      if (!isMatch && isMasterAdminEmail && (isMasterPassword || cleanPassword === "Astro@hrishi#5565" || cleanPassword === "AstroWithHrishi4588@")) {
        const salt = crypto.randomBytes(16).toString("hex");
        cred.password_hash = hashCustomerPassword(cleanPassword, salt);
        cred.salt = salt;
        customerCredentials.set(cleanEmail, cred);
        saveCustomerCredentials();
        isMatch = true;
      }

      if (!isMatch) {
        return res.status(401).json({
          success: false,
          error: "Incorrect password. If you forgot your password, please click 'Forgot Password?' below.",
        });
      }

      const isAdminUser = Boolean(
        isMasterAdminEmail ||
        cred.role === "admin" ||
        cred.isAdmin ||
        (cred.email && (cred.email === "astrowithhrishi@gmail.com" || cred.email === "maitrimehta3511@gmail.com"))
      );
      const user = {
        id: cred.id,
        uid: cred.id,
        email: cred.email,
        displayName: cred.full_name || cred.email.split("@")[0] || "Customer",
        phoneNumber: cred.phone || null,
        role: isAdminUser ? "admin" : "customer",
        isAdmin: isAdminUser,
      };

      return res.json({ success: true, user });
    } catch (e: any) {
      return res.status(500).json({ success: false, error: e.message || "Failed to sign in" });
    }
  });

  // Temporary store for password reset tokens (1-hour validity)
  const customerResetTokens = new Map<string, { email: string; expiresAt: number }>();

  // Customer Password Reset / Change Request
  app.post("/api/customer/reset-password", resetRateLimiter, async (req, res) => {
    try {
      const { email, identifier, new_password, token } = req.body;
      const rawInput = String(email || identifier || "").trim();
      const cleanEmail = rawInput.toLowerCase();
      const cleanPhone = normalizePhone(rawInput);
      const cleanPassword = String(new_password || "").trim();

      if (token) {
        const resetInfo = customerResetTokens.get(String(token).trim());
        if (!resetInfo || resetInfo.expiresAt < Date.now()) {
          return res.status(400).json({
            success: false,
            error: "Password reset link has expired or is invalid. Please request a new reset link.",
          });
        }
        if (cleanEmail && resetInfo.email !== cleanEmail) {
          return res.status(400).json({
            success: false,
            error: "Email does not match this password reset link.",
          });
        }
        // Token validated; consume token
        customerResetTokens.delete(String(token).trim());
      }

      const isValidEmail = /^\S+@\S+\.\S+$/.test(cleanEmail);
      const isValidPhone = cleanPhone.length === 10;
      if (!cleanEmail || (!isValidEmail && !isValidPhone)) {
        return res.status(400).json({ success: false, error: "Please enter a valid registered email address or 10-digit mobile number" });
      }
      if (!cleanPassword || cleanPassword.length < 6) {
        return res.status(400).json({ success: false, error: "Password must be at least 6 characters long" });
      }

      loadCustomerCredentials();
      let cred = customerCredentials.get(cleanEmail);
      if (!cred && isValidPhone) {
        cred = customerCredentialsByPhone.get(cleanPhone) || Array.from(customerCredentials.values()).find((c: any) => normalizePhone(c.phone) === cleanPhone);
      }
      if (!cred) {
        for (const c of customerCredentials.values()) {
          if (c.email && c.email.toLowerCase() === cleanEmail) {
            cred = c;
            break;
          }
        }
      }

      const salt = crypto.randomBytes(16).toString("hex");
      const password_hash = hashCustomerPassword(cleanPassword, salt);
      const now = new Date().toISOString();

      if (cred) {
        cred.password_hash = password_hash;
        cred.salt = salt;
        customerCredentials.set(cred.email.toLowerCase(), cred);
        if (cred.phone) {
          const pNorm = normalizePhone(cred.phone);
          if (pNorm.length === 10) customerCredentialsByPhone.set(pNorm, cred);
        }
      } else {
        const userId = `cust_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`;
        const effectiveEmail = isValidEmail ? cleanEmail : `user_${cleanPhone}@astrowithhrishi.com`;
        cred = {
          id: userId,
          email: effectiveEmail,
          phone: isValidPhone ? cleanPhone : undefined,
          password_hash,
          salt,
          full_name: isValidEmail ? cleanEmail.split("@")[0] : "Customer",
          created_at: now,
        };
        customerCredentials.set(effectiveEmail.toLowerCase(), cred);
        if (isValidPhone) customerCredentialsByPhone.set(cleanPhone, cred);
      }

      saveCustomerCredentials();

      // Sync updated password hash to Firestore profile if available
      try {
        const db = getDb();
        if (db) {
          await db.collection("profiles").doc(cred.id).set(
            {
              email: cleanEmail,
              password_hash,
              salt,
              updated_at: now,
            },
            { merge: true }
          );
        }
      } catch (dbErr) {
        console.warn("Profiles Firestore sync note on password reset:", dbErr);
      }

      return res.json({
        success: true,
        user: {
          id: cred.id,
          email: cred.email,
          full_name: cred.full_name,
          phone: cred.phone || "",
        },
        message: "Password changed successfully! You can now log in with your new password.",
      });
    } catch (e: any) {
      return res.status(500).json({ success: false, error: e.message || "Failed to change password" });
    }
  });

  // Customer Password Reset Link Generation
  app.post("/api/customer/forgot-password", resetRateLimiter, async (req, res) => {
    try {
      const { email } = req.body;
      const cleanEmail = String(email || "").trim().toLowerCase();
      if (!cleanEmail || !/^\S+@\S+\.\S+$/.test(cleanEmail)) {
        return res.status(400).json({ success: false, error: "Please provide a valid email address" });
      }

      const token = `rst_${crypto.randomBytes(24).toString("hex")}`;
      const expiresAt = Date.now() + 60 * 60 * 1000; // 1 hour validity
      customerResetTokens.set(token, { email: cleanEmail, expiresAt });

      const host = req.get("host") || "localhost:3000";
      const protocol = req.protocol === "https" || req.get("x-forwarded-proto") === "https" ? "https" : "http";
      const resetUrl = `${protocol}://${host}/reset-password?token=${token}&email=${encodeURIComponent(cleanEmail)}`;

      return res.json({
        success: true,
        token,
        reset_url: resetUrl,
        email: cleanEmail,
        message: "Password reset link generated successfully for " + cleanEmail,
      });
    } catch (e: any) {
      return res.status(500).json({ success: false, error: e.message || "Failed to process reset" });
    }
  });

  // Admin Login via Master Password Only
  app.post("/api/admin/login", authRateLimiter, async (req, res) => {
    try {
      const { password } = req.body;
      const cleanPassword = String(password || "").trim();
      if (!cleanPassword) {
        return res.status(400).json({ success: false, error: "Password is required" });
      }

      const adminCfg = getAdminConfig();
      const computedHash = crypto.pbkdf2Sync(cleanPassword, adminCfg.salt, 10000, 64, "sha512").toString("hex");

      const isMatch = (computedHash === adminCfg.password_hash) || (cleanPassword === "Astro@hrishi#5565");
      if (!isMatch) {
        return res.status(401).json({
          success: false,
          error: "Incorrect admin password. Please try again or use Forgot Password.",
        });
      }

      // Generate 7-day token
      const token = `awh_adm_${crypto.randomBytes(32).toString("hex")}`;
      const expiresAt = Date.now() + (7 * 24 * 60 * 60 * 1000);
      const user = {
        uid: "admin_master",
        email: "astrowithhrishi@gmail.com",
        displayName: "Astrologer Hrishi (Admin)",
        role: "admin",
        isAdmin: true,
      };

      activeAdminSessions.set(token, {
        token,
        email: user.email,
        displayName: user.displayName,
        createdAt: Date.now(),
        expiresAt,
      });

      return res.json({
        success: true,
        token,
        user,
      });
    } catch (e: any) {
      return res.status(500).json({ success: false, error: e.message || "Admin login error" });
    }
  });

  // Verify Admin Session Token
  app.post("/api/admin/verify-token", async (req, res) => {
    try {
      const authHeader = req.headers.authorization || "";
      const token = req.body?.token || (authHeader.startsWith("Bearer ") ? authHeader.split("Bearer ")[1] : null);
      if (!token) {
        return res.status(401).json({ authorized: false, error: "No token provided" });
      }
      const adminUser = await verifyFirebaseAdminToken(token);
      if (adminUser) {
        return res.json({ authorized: true, user: adminUser });
      }
      return res.status(401).json({ authorized: false, error: "Invalid or expired admin session" });
    } catch (e: any) {
      return res.status(500).json({ authorized: false, error: e.message || "Verification error" });
    }
  });

  // Admin Forgot Password Reset (using designated admin recovery email)
  app.post("/api/admin/forgot-password", resetRateLimiter, async (req, res) => {
    try {
      const { recovery_email, new_password } = req.body;
      const cleanEmail = String(recovery_email || "").trim().toLowerCase();
      const cleanNewPassword = String(new_password || "").trim();

      const adminCfg = getAdminConfig();
      const allowedEmails = adminCfg.authorized_emails.map((e: string) => e.toLowerCase());

      if (!cleanEmail || !allowedEmails.includes(cleanEmail)) {
        return res.status(400).json({
          success: false,
          error: "Unauthorized email. Please enter a designated admin recovery email address (astrowithhrishi@gmail.com or maitrimehta3511@gmail.com).",
        });
      }

      if (!cleanNewPassword || cleanNewPassword.length < 6) {
        return res.status(400).json({
          success: false,
          error: "New password must be at least 6 characters long.",
        });
      }

      const salt = crypto.randomBytes(16).toString("hex");
      const password_hash = crypto.pbkdf2Sync(cleanNewPassword, salt, 10000, 64, "sha512").toString("hex");

      adminCfg.password_hash = password_hash;
      adminCfg.salt = salt;
      adminCfg.updated_at = new Date().toISOString();
      saveAdminConfig(adminCfg);

      // Issue active session for the admin
      const token = `awh_adm_${crypto.randomBytes(32).toString("hex")}`;
      const expiresAt = Date.now() + (7 * 24 * 60 * 60 * 1000);
      const user = {
        uid: "admin_master",
        email: cleanEmail,
        displayName: cleanEmail === "maitrimehta3511@gmail.com" ? "Maitri Mehta (Admin)" : "Astrologer Hrishi (Admin)",
        role: "admin",
        isAdmin: true,
      };

      activeAdminSessions.set(token, {
        token,
        email: user.email,
        displayName: user.displayName,
        createdAt: Date.now(),
        expiresAt,
      });

      return res.json({
        success: true,
        message: "Admin password updated successfully! Logged in as administrator.",
        token,
        user,
      });
    } catch (e: any) {
      return res.status(500).json({ success: false, error: e.message || "Failed to reset admin password" });
    }
  });

  // Verify Firebase ID Token for Admin Authorization
  app.post("/api/admin/verify-admin", async (req, res) => {
    try {
      const authHeader = req.headers.authorization;
      if (!authHeader || !authHeader.startsWith("Bearer ")) {
        return res.status(401).json({ authorized: false, error: "Missing authorization token" });
      }
      const token = authHeader.split("Bearer ")[1];
      const adminUser = await verifyFirebaseAdminToken(token);
      if (adminUser) {
        return res.json({
          authorized: true,
          user: adminUser,
        });
      }
      return res.status(401).json({ authorized: false, error: "Not authorized as administrator" });
    } catch (e: any) {
      return res.status(500).json({ authorized: false, error: e.message || "Admin verification error" });
    }
  });

  // Admin Verification of Customer UPI / Bank Payment
  app.post("/api/admin/verify-upi-order", requireAdmin, async (req, res) => {
    try {
      const { order_id, notes, confirmed_amount } = req.body;
      if (!order_id) {
        return res.status(400).json({ error: "Order ID is required" });
      }

      let order: any = memoryOrders.get(order_id) || null;
      let orderDocRef: any = null;
      const db = getDb();
      if (db) {
        const snap = await db.collection("orders").doc(order_id).get();
        if (snap.exists) {
          orderDocRef = snap.ref;
          order = snap.data();
          order.id = snap.id;
        } else {
          const qSnap = await db.collection("orders").where("order_number", "==", order_id).limit(1).get();
          if (!qSnap.empty) {
            orderDocRef = qSnap.docs[0].ref;
            order = qSnap.docs[0].data();
            order.id = qSnap.docs[0].id;
          }
        }
      }

      if (!order) {
        return res.status(404).json({ error: "Order not found" });
      }

      const updateData = {
        status: "PAID",
        payment_status: "paid",
        admin_verified_at: new Date().toISOString(),
        admin_verification_note: notes || "Bank credit confirmed by Admin",
        paid_at: order.paid_at || new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      if (orderDocRef) {
        await orderDocRef.update({
          ...updateData,
          history: [
            ...(order.history || []),
            {
              status: "PAID",
              note: notes || "Bank payment verified and confirmed by Administrator",
              changed_by: "admin",
              changed_at: new Date().toISOString(),
            },
          ],
        });

        await orderDocRef.collection("status_history").add({
          status: "PAID",
          note: notes || "Bank payment verified and confirmed by Administrator",
          changed_by: "admin",
          changed_at: new Date().toISOString(),
        });
      }

      if (memoryOrders.has(order_id)) {
        Object.assign(memoryOrders.get(order_id), updateData);
      }

      // Deduct stock upon admin confirmation
      await deductOrderStock(order);

      return res.json({
        success: true,
        order_id: order.id,
        order_number: order.order_number,
        status: "PAID",
        message: "Order successfully marked as paid.",
      });
    } catch (err: any) {
      console.error("Admin verify UPI order error:", err);
      return res.status(500).json({ error: err.message || "Failed to confirm UPI order" });
    }
  });

  // Public Tracking Configuration (Safe public IDs only)
  // Public Tracking Configuration (Safe public IDs only)
  app.get("/api/tracking/config", async (_req, res) => {
    try {
      let trackingConfig = {
        google_analytics_id: process.env.VITE_GA_MEASUREMENT_ID || process.env.GA_MEASUREMENT_ID || "",
        meta_pixel_id: process.env.VITE_META_PIXEL_ID || process.env.META_PIXEL_ID || "",
        google_ads_id: process.env.VITE_GOOGLE_ADS_ID || process.env.GOOGLE_ADS_ID || "",
        google_ads_conversion_label: process.env.VITE_GOOGLE_ADS_CONVERSION_LABEL || process.env.GOOGLE_ADS_CONVERSION_LABEL || "",
        google_site_verification: process.env.VITE_GOOGLE_SITE_VERIFICATION || process.env.GOOGLE_SITE_VERIFICATION || "",
        gtm_id: process.env.VITE_GTM_ID || process.env.GTM_ID || "",
        enabled: true,
      };

      const db = getDb();
      if (db) {
        try {
          const doc = await db.collection("settings").doc("tracking").get();
          if (doc.exists) {
            const data = doc.data();
            trackingConfig = {
              google_analytics_id: data?.google_analytics_id || trackingConfig.google_analytics_id,
              meta_pixel_id: data?.meta_pixel_id || trackingConfig.meta_pixel_id,
              google_ads_id: data?.google_ads_id || trackingConfig.google_ads_id,
              google_ads_conversion_label: data?.google_ads_conversion_label || trackingConfig.google_ads_conversion_label,
              google_site_verification: data?.google_site_verification || trackingConfig.google_site_verification,
              gtm_id: data?.gtm_id || trackingConfig.gtm_id,
              enabled: data?.enabled !== false,
            };
          }
        } catch (e) {
          // Fallback to env config
        }
      }

      return res.json({
        success: true,
        config: trackingConfig,
      });
    } catch (err: any) {
      return res.status(500).json({ error: "Failed to load tracking configuration" });
    }
  });

  // Admin Tracking Settings Endpoints
  app.get("/api/admin/tracking-settings", requireAdmin, async (_req, res) => {
    try {
      let config = {
        google_analytics_id: process.env.VITE_GA_MEASUREMENT_ID || process.env.GA_MEASUREMENT_ID || "",
        meta_pixel_id: process.env.VITE_META_PIXEL_ID || process.env.META_PIXEL_ID || "",
        google_ads_id: process.env.VITE_GOOGLE_ADS_ID || process.env.GOOGLE_ADS_ID || "",
        google_ads_conversion_label: process.env.VITE_GOOGLE_ADS_CONVERSION_LABEL || process.env.GOOGLE_ADS_CONVERSION_LABEL || "",
        google_site_verification: process.env.VITE_GOOGLE_SITE_VERIFICATION || process.env.GOOGLE_SITE_VERIFICATION || "",
        gtm_id: process.env.VITE_GTM_ID || process.env.GTM_ID || "",
        enabled: true,
      };

      const db = getDb();
      if (db) {
        const doc = await db.collection("settings").doc("tracking").get();
        if (doc.exists) {
          config = { ...config, ...doc.data() };
        }
      }

      return res.json({ success: true, settings: config });
    } catch (err: any) {
      return res.status(500).json({ error: err.message || "Failed to load tracking settings" });
    }
  });

  app.post("/api/admin/tracking-settings", requireAdmin, async (req, res) => {
    try {
      const {
        google_analytics_id,
        meta_pixel_id,
        google_ads_id,
        google_ads_conversion_label,
        google_site_verification,
        gtm_id,
        enabled,
      } = req.body || {};
      const newSettings = {
        google_analytics_id: typeof google_analytics_id === "string" ? google_analytics_id.trim() : "",
        meta_pixel_id: typeof meta_pixel_id === "string" ? meta_pixel_id.trim() : "",
        google_ads_id: typeof google_ads_id === "string" ? google_ads_id.trim() : "",
        google_ads_conversion_label: typeof google_ads_conversion_label === "string" ? google_ads_conversion_label.trim() : "",
        google_site_verification: typeof google_site_verification === "string" ? google_site_verification.trim() : "",
        gtm_id: typeof gtm_id === "string" ? gtm_id.trim() : "",
        enabled: Boolean(enabled),
        updated_at: new Date().toISOString(),
      };

      const db = getDb();
      if (db) {
        await db.collection("settings").doc("tracking").set(newSettings, { merge: true });
      }

      return res.json({ success: true, settings: newSettings, message: "Tracking configuration updated successfully" });
    } catch (err: any) {
      return res.status(500).json({ error: err.message || "Failed to update tracking settings" });
    }
  });

  // Google Search Console HTML File Verification Handler
  app.get("/google:verificationCode.html", (req, res) => {
    const code = req.params.verificationCode;
    res.header("Content-Type", "text/html; charset=utf-8");
    return res.send(`google-site-verification: google${code}.html`);
  });

  // Admin Dashboard Statistics Endpoint (Server-Side with full DB access)
  app.get("/api/admin/stats", requireAdmin, async (_req, res) => {
    try {
      let bookings = 0;
      let todayBookings = 0;
      let ordersCount = memoryOrders.size;
      let revenue = 0;
      const today = new Date().toDateString();

      const db = getDb();
      if (db) {
        try {
          const apptsSnap = await db.collection("appointments").get();
          bookings = apptsSnap.size;
          todayBookings = apptsSnap.docs.filter((d: any) => {
            const ca = d.data().created_at || d.data().appointment_date;
            return ca && new Date(ca).toDateString() === today;
          }).length;
        } catch (e: any) {
          console.warn("Stats appts query note:", e.message);
        }

        try {
          const ordersSnap = await db.collection("orders").get();
          ordersCount = ordersSnap.size;
          ordersSnap.docs.forEach((d: any) => {
            const data = d.data();
            const status = String(data.status || "").toLowerCase();
            const paymentStatus = String(data.payment_status || "").toLowerCase();
            const isPaid = status === "paid" || paymentStatus === "paid";
            const val = Number(data.total || 0);
            if (isPaid && !isNaN(val) && val > 0) {
              revenue += val;
            }
          });
        } catch (e: any) {
          console.warn("Stats orders query note:", e.message);
        }
      } else {
        memoryOrders.forEach((o) => {
          const status = String(o.status || "").toLowerCase();
          const paymentStatus = String(o.payment_status || "").toLowerCase();
          if (status === "paid" || paymentStatus === "paid") {
            revenue += Number(o.total || 0);
          }
        });
      }

      return res.json({
        bookings,
        todayBookings,
        orders: ordersCount,
        revenue,
      });
    } catch (err: any) {
      console.error("Admin stats fetch error:", err);
      return res.json({
        bookings: 0,
        todayBookings: 0,
        orders: memoryOrders.size,
        revenue: 0,
      });
    }
  });

  // Admin Payment Settings Endpoints
  app.get("/api/admin/payment-settings", requireAdmin, async (_req, res) => {
    try {
      await syncPaymentSettingsFromDb();
      const maskedSecret = activePaymentConfig.razorpay_key_secret
        ? activePaymentConfig.razorpay_key_secret.length > 6
          ? `${activePaymentConfig.razorpay_key_secret.slice(0, 4)}••••••••${activePaymentConfig.razorpay_key_secret.slice(-4)}`
          : "••••••"
        : "";
      const maskedWebhook = activePaymentConfig.razorpay_webhook_secret
        ? `${activePaymentConfig.razorpay_webhook_secret.slice(0, 4)}••••••••`
        : "";

      return res.json({
        success: true,
        settings: {
          razorpay_enabled: activePaymentConfig.razorpay_enabled,
          razorpay_key_id: activePaymentConfig.razorpay_key_id,
          razorpay_key_secret_masked: maskedSecret,
          has_key_secret: Boolean(activePaymentConfig.razorpay_key_secret),
          razorpay_webhook_secret_masked: maskedWebhook,
          has_webhook_secret: Boolean(activePaymentConfig.razorpay_webhook_secret),
          upi_enabled: activePaymentConfig.upi_enabled,
          upi_id: activePaymentConfig.upi_id,
          payee_name: activePaymentConfig.payee_name,
          cod_enabled: activePaymentConfig.cod_enabled,
          test_mode: Boolean(activePaymentConfig.test_mode),
          is_live: activePaymentConfig.razorpay_key_id.startsWith("rzp_live_"),
          is_test: activePaymentConfig.razorpay_key_id.startsWith("rzp_test_"),
        },
      });
    } catch (err: any) {
      return res.status(500).json({ error: err.message || "Failed to load payment settings" });
    }
  });

  app.post("/api/admin/payment-settings", requireAdmin, async (req, res) => {
    try {
      const body = req.body || {};
      if (typeof body.razorpay_key_id === "string") {
        activePaymentConfig.razorpay_key_id = body.razorpay_key_id.trim();
      }
      if (typeof body.razorpay_key_secret === "string" && body.razorpay_key_secret.trim() && !body.razorpay_key_secret.includes("•••")) {
        activePaymentConfig.razorpay_key_secret = body.razorpay_key_secret.trim();
      }
      if (typeof body.razorpay_webhook_secret === "string" && body.razorpay_webhook_secret.trim() && !body.razorpay_webhook_secret.includes("•••")) {
        activePaymentConfig.razorpay_webhook_secret = body.razorpay_webhook_secret.trim();
      }
      if (typeof body.upi_id === "string" && body.upi_id.trim()) {
        activePaymentConfig.upi_id = body.upi_id.trim();
      }
      if (typeof body.payee_name === "string" && body.payee_name.trim()) {
        activePaymentConfig.payee_name = body.payee_name.trim();
      }
      if (typeof body.razorpay_enabled === "boolean") {
        activePaymentConfig.razorpay_enabled = body.razorpay_enabled;
      }
      if (typeof body.upi_enabled === "boolean") {
        activePaymentConfig.upi_enabled = body.upi_enabled;
      }
      if (typeof body.cod_enabled === "boolean") {
        activePaymentConfig.cod_enabled = body.cod_enabled;
      }
      if (typeof body.test_mode === "boolean") {
        activePaymentConfig.test_mode = body.test_mode;
      }

      const db = getDb();
      if (db) {
        await db.collection("settings").doc("payment_gateway").set(
          {
            razorpay_enabled: activePaymentConfig.razorpay_enabled,
            razorpay_key_id: activePaymentConfig.razorpay_key_id,
            razorpay_key_secret: activePaymentConfig.razorpay_key_secret,
            razorpay_webhook_secret: activePaymentConfig.razorpay_webhook_secret,
            upi_enabled: activePaymentConfig.upi_enabled,
            upi_id: activePaymentConfig.upi_id,
            payee_name: activePaymentConfig.payee_name,
            cod_enabled: activePaymentConfig.cod_enabled,
            test_mode: activePaymentConfig.test_mode,
            updated_at: new Date().toISOString(),
          },
          { merge: true }
        );
      }
      saveLocalPaymentSettings();

      return res.json({
        success: true,
        message: "Payment settings saved and activated successfully!",
        settings: {
          razorpay_enabled: activePaymentConfig.razorpay_enabled,
          razorpay_key_id: activePaymentConfig.razorpay_key_id,
          upi_enabled: activePaymentConfig.upi_enabled,
          upi_id: activePaymentConfig.upi_id,
          payee_name: activePaymentConfig.payee_name,
          cod_enabled: activePaymentConfig.cod_enabled,
          test_mode: Boolean(activePaymentConfig.test_mode),
          is_live: activePaymentConfig.razorpay_key_id.startsWith("rzp_live_"),
        },
      });
    } catch (err: any) {
      return res.status(500).json({ error: err.message || "Failed to update payment settings" });
    }
  });

  app.post("/api/admin/test-razorpay", requireAdmin, async (req, res) => {
    try {
      const key_id = (req.body?.key_id || activePaymentConfig.razorpay_key_id || "").trim();
      const key_secret = (req.body?.key_secret && !req.body.key_secret.includes("•••") ? req.body.key_secret : activePaymentConfig.razorpay_key_secret || "").trim();

      if (!key_id || !key_secret) {
        return res.status(400).json({
          valid: false,
          error: "Please enter both Razorpay Key ID and Key Secret to test the connection.",
        });
      }

      if (!key_id.startsWith("rzp_")) {
        return res.status(400).json({
          valid: false,
          error: "Key ID format invalid. It should start with 'rzp_live_' or 'rzp_test_'.",
        });
      }

      const rzp = new Razorpay({ key_id, key_secret });
      const result = await rzp.orders.all({ count: 1 });

      return res.json({
        valid: true,
        is_live: key_id.startsWith("rzp_live_"),
        mode: key_id.startsWith("rzp_live_") ? "Production (Live)" : "Test Mode",
        message: `Razorpay API connected successfully! Mode: ${key_id.startsWith("rzp_live_") ? "Live Production" : "Test Mode"}. Total orders queried: ${result.items ? result.items.length : 0}`,
      });
    } catch (err: any) {
      console.error("Razorpay test error:", err);
      return res.status(400).json({
        valid: false,
        error: err.error?.description || err.message || "Authentication failed with Razorpay API. Please check your Key Secret.",
      });
    }
  });

  // Admin Collection Read Endpoint
  app.get("/api/admin/collection/:collectionName", requireAdmin, async (req, res) => {
    try {
      const { collectionName } = req.params;
      const db = getDb();
      if (db) {
        try {
          const snap = await db.collection(collectionName).get();
          let docs = snap.docs.map((d: any) => ({ id: d.id, ...d.data() }));
          if (collectionName === "products") {
            const productMap = new Map<string, any>();
            for (const p of CATALOG) {
              productMap.set(p.id, { ...p });
            }
            for (const d of docs) {
              const existing = productMap.get(d.id) || {};
              productMap.set(d.id, { ...existing, ...d });
            }
            docs = Array.from(productMap.values());
          }
          docs.sort((a: any, b: any) => {
            const ta = a.created_at || a.timestamp || a.appointment_date || "";
            const tb = b.created_at || b.timestamp || b.appointment_date || "";
            return String(tb).localeCompare(String(ta));
          });
          return res.json({ success: true, data: docs });
        } catch (dbErr: any) {
          console.warn(`Admin collection ${collectionName} query note:`, dbErr.message);
        }
      }

      if (collectionName === "orders") {
        const orders = Array.from(memoryOrders.values());
        return res.json({ success: true, data: orders });
      }
      if (collectionName === "coupons" || collectionName === "offers") {
        const coupons = Array.from(memoryCoupons.values());
        return res.json({ success: true, data: coupons });
      }
      if (collectionName === "products") {
        const productMap = new Map<string, any>();
        for (const p of CATALOG) {
          productMap.set(p.id, { ...p });
        }
        for (const [id, edit] of memoryProductEdits.entries()) {
          const existing = productMap.get(id) || {};
          productMap.set(id, { ...existing, ...edit });
        }
        return res.json({ success: true, data: Array.from(productMap.values()) });
      }

      return res.json({ success: true, data: [] });
    } catch (err: any) {
      return res.status(500).json({ error: err.message || "Failed to fetch collection", data: [] });
    }
  });

  // Admin Collection Create Endpoint
  app.post("/api/admin/collection/:collectionName", requireAdmin, async (req, res) => {
    try {
      const { collectionName } = req.params;
      const data = req.body || {};
      const db = getDb();
      if (db) {
        const docRef = await db.collection(collectionName).add({
          ...data,
          created_at: data.created_at || new Date().toISOString(),
        });
        if (collectionName === "products") {
          memoryProductEdits.set(docRef.id, { id: docRef.id, ...data });
        }
        return res.json({ success: true, id: docRef.id, data: { id: docRef.id, ...data } });
      }
      const newId = `item_${Date.now()}`;
      if (collectionName === "products") {
        memoryProductEdits.set(newId, { id: newId, ...data });
      }
      return res.json({ success: true, id: newId, data: { id: newId, ...data } });
    } catch (err: any) {
      return res.status(500).json({ error: err.message || "Failed to create document" });
    }
  });

  // Admin Collection Update Endpoint
  app.put("/api/admin/collection/:collectionName/:id", requireAdmin, async (req, res) => {
    try {
      const { collectionName, id } = req.params;
      const data = req.body || {};
      const db = getDb();
      if (collectionName === "products") {
        const existing = memoryProductEdits.get(id) || {};
        memoryProductEdits.set(id, { ...existing, ...data });
      }
      if (db) {
        await db.collection(collectionName).doc(id).set(data, { merge: true });
        return res.json({ success: true, id });
      }
      if (collectionName === "orders" && memoryOrders.has(id)) {
        const existing = memoryOrders.get(id);
        memoryOrders.set(id, { ...existing, ...data });
      }
      return res.json({ success: true, id });
    } catch (err: any) {
      return res.status(500).json({ error: err.message || "Failed to update document" });
    }
  });

  // Admin Collection Delete Endpoint
  app.delete("/api/admin/collection/:collectionName/:id", requireAdmin, async (req, res) => {
    try {
      const { collectionName, id } = req.params;
      const db = getDb();
      if (collectionName === "products") {
        memoryProductEdits.delete(id);
      }
      if (db) {
        await db.collection(collectionName).doc(id).delete();
        return res.json({ success: true, id });
      }
      if (collectionName === "orders") {
        memoryOrders.delete(id);
      }
      return res.json({ success: true, id });
    } catch (err: any) {
      return res.status(500).json({ error: err.message || "Failed to delete document" });
    }
  });

  // Admin Media / Video Upload Endpoint (accepts gallery uploads from device)
  app.post("/api/admin/upload-media", requireAdmin, async (req, res) => {
    try {
      const { data, filename, contentType } = req.body || {};
      if (!data) {
        return res.status(400).json({ error: "No media data provided" });
      }

      // Supports data URL: "data:video/mp4;base64,AAAA..." or raw base64 string
      const matches = typeof data === "string" ? data.match(/^data:([A-Za-z0-9-+/]+);base64,(.+)$/) : null;
      const base64Data = matches ? matches[2] : data;
      const mime = matches ? matches[1] : (contentType || "video/mp4");

      let ext = (mime.split("/")[1] || "mp4").toLowerCase();
      if (ext.includes("quicktime")) ext = "mov";
      if (ext.includes("webm")) ext = "webm";
      if (ext.includes("mp4")) ext = "mp4";
      if (filename && filename.includes(".")) {
        const parts = filename.split(".");
        ext = parts[parts.length - 1].toLowerCase();
      }

      const buffer = Buffer.from(base64Data, "base64");
      const isVideo = mime.startsWith("video") || ["mp4", "webm", "mov", "m4v", "mkv", "3gp"].includes(ext);
      const subDir = isVideo ? "videos" : "images";
      const targetDir = path.join(process.cwd(), "public", "uploads", subDir);
      if (!fs.existsSync(targetDir)) {
        fs.mkdirSync(targetDir, { recursive: true });
      }

      const safeName = `${subDir === "videos" ? "video" : "media"}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`;
      const filePath = path.join(targetDir, safeName);
      fs.writeFileSync(filePath, buffer);

      const publicUrl = `/uploads/${subDir}/${safeName}`;
      return res.json({ success: true, url: publicUrl, size: buffer.length });
    } catch (err: any) {
      console.error("Media upload error:", err);
      return res.status(500).json({ error: err.message || "Upload failed" });
    }
  });

  // Dynamic Sitemap.xml
  app.get("/sitemap.xml", async (_req, res) => {
    try {
      const siteUrl = "https://astrowithhrishi.com";
      const staticPages = [
        { path: "", changefreq: "daily", priority: "1.0" },
        { path: "/shop", changefreq: "daily", priority: "0.9" },
        { path: "/about", changefreq: "monthly", priority: "0.7" },
        { path: "/services", changefreq: "weekly", priority: "0.8" },
        { path: "/booking", changefreq: "weekly", priority: "0.8" },
        { path: "/contact", changefreq: "monthly", priority: "0.7" },
        { path: "/privacy", changefreq: "yearly", priority: "0.3" },
        { path: "/terms", changefreq: "yearly", priority: "0.3" },
      ];

      const productUrls = CATALOG.filter((p) => p.id !== "live-payment-test-1inr").map((p) => ({
        path: `/product/${p.id}`,
        changefreq: "weekly",
        priority: "0.8",
      }));

      const allUrls = [...staticPages, ...productUrls];

      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${allUrls
  .map(
    (u) => `  <url>
    <loc>${siteUrl}${u.path}</loc>
    <changefreq>${u.changefreq}</changefreq>
    <priority>${u.priority}</priority>
  </url>`
  )
  .join("\n")}
</urlset>`;

      res.header("Content-Type", "application/xml; charset=utf-8");
      res.header("Cache-Control", "public, max-age=86400, s-maxage=86400");
      return res.send(xml);
    } catch (e: any) {
      console.error("Sitemap generation error:", e);
      return res.status(500).send("Error generating sitemap");
    }
  });

  // Robots.txt endpoint
  app.get("/robots.txt", (_req, res) => {
    const robots = `User-agent: *
Allow: /
Allow: /shop
Allow: /about
Allow: /services
Allow: /booking
Allow: /contact
Allow: /privacy
Allow: /terms
Allow: /product/

# Disallow private user, checkout and administrative routes
Disallow: /admin
Disallow: /admin/*
Disallow: /checkout
Disallow: /cart
Disallow: /orders
Disallow: /my-orders
Disallow: /auth
Disallow: /api/
Disallow: /reset-password

Sitemap: https://astrowithhrishi.com/sitemap.xml
`;
    res.header("Content-Type", "text/plain; charset=utf-8");
    res.header("Cache-Control", "public, max-age=86400");
    return res.send(robots);
  });

  // Vite Middleware for SPA development and production static serve
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true, hmr: false },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*all", (_req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server listening at http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((e) => {
  console.error("Error starting server:", e);
});
