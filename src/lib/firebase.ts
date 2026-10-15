import { initializeApp, getApps, getApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { initializeFirestore, getFirestore } from "firebase/firestore";
import { getStorage } from "firebase/storage";
import baseConfig from "../../firebase-applet-config.json";

// Ensure active project configuration uses verified credentials from firebase-applet-config.json
const getActiveConfig = () => {
  const envProjectId = import.meta.env.VITE_FIREBASE_PROJECT_ID;
  const isLegacy = envProjectId === "galvanic-form-jhh41";

  // Guard against invalid or stale container-injected keys
  const envKey = (import.meta.env.VITE_FIREBASE_API_KEY || "").trim();
  const isKnownBadKey =
    envKey === "AIzaSyCZfBgibTeAgR7qxJDrVxQ0t0TzzkHQ2Q" ||
    envKey.startsWith("AIzaSyBBjv");
  const validKey =
    envKey && !isKnownBadKey && envKey.length > 20
      ? envKey
      : (baseConfig.apiKey || "AIzaSyCZfBgibTeAg7R3qxJDrVxQ0t0TzzkHQ2Q");

  const validAppId =
    !isLegacy &&
    import.meta.env.VITE_FIREBASE_APP_ID &&
    !import.meta.env.VITE_FIREBASE_APP_ID.includes("298759486217")
      ? import.meta.env.VITE_FIREBASE_APP_ID
      : (baseConfig.appId || "1:370097049189:web:8571b1eed10143dda9008c");

  const validSenderId =
    !isLegacy &&
    import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID &&
    import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID !== "298759486217"
      ? import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID
      : (baseConfig.messagingSenderId || "370097049189");

  return {
    projectId: (!isLegacy && envProjectId) || baseConfig.projectId || "astro-with-hrishi",
    authDomain: (!isLegacy && import.meta.env.VITE_FIREBASE_AUTH_DOMAIN && !import.meta.env.VITE_FIREBASE_AUTH_DOMAIN.includes("galvanic-form-jhh41"))
      ? import.meta.env.VITE_FIREBASE_AUTH_DOMAIN
      : (baseConfig.authDomain || "astro-with-hrishi.firebaseapp.com"),
    storageBucket: (!isLegacy && import.meta.env.VITE_FIREBASE_STORAGE_BUCKET && !import.meta.env.VITE_FIREBASE_STORAGE_BUCKET.includes("galvanic-form-jhh41"))
      ? import.meta.env.VITE_FIREBASE_STORAGE_BUCKET
      : (baseConfig.storageBucket || "astro-with-hrishi.firebasestorage.app"),
    apiKey: validKey,
    appId: validAppId,
    messagingSenderId: validSenderId,
    measurementId: import.meta.env.VITE_GA_MEASUREMENT_ID || baseConfig.measurementId || "G-WQCLV9J913",
  };
};

const activeConfig = getActiveConfig();
const app = !getApps().length ? initializeApp(activeConfig) : getApp();

export const auth = getAuth(app);

// Initialize Firestore with auto-detect long polling and ignore undefined properties
export const db = (() => {
  const databaseId = (
    baseConfig.firestoreDatabaseId &&
    baseConfig.firestoreDatabaseId !== "(default)" &&
    !baseConfig.firestoreDatabaseId.includes("galvanic-form-jhh41") &&
    !baseConfig.firestoreDatabaseId.includes("ai-studio-originalwebprese")
  ) ? baseConfig.firestoreDatabaseId : undefined;

  if (typeof window !== "undefined") {
    try {
      return initializeFirestore(app, {
        experimentalAutoDetectLongPolling: true,
        ignoreUndefinedProperties: true,
      }, databaseId);
    } catch {
      return databaseId ? getFirestore(app, databaseId) : getFirestore(app);
    }
  }

  return databaseId ? getFirestore(app, databaseId) : getFirestore(app);
})();

export const storage = getStorage(app);
export default app;
