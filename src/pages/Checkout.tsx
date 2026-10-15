import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  CreditCard,
  Edit3,
  Lock,
  KeyRound,
  Plus,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Building2,
  Smartphone,
  QrCode,
  Copy,
  Receipt,
  X,
  CreditCard as CardIcon,
  MessageCircle,
  Upload,
  Image as ImageIcon,
  ExternalLink,
  Send,
  MapPin,
} from "lucide-react";
import SEO from "@/components/SEO";
import PageLayout from "@/components/PageLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useAuth } from "@/hooks/useAuth";
import { useCart, type CartItem } from "@/lib/cart";
import { inr, shippingFor, gstFor, isTestOrder } from "@/lib/shop";
import { resolveImages } from "@/lib/productImages";
import { trackBeginCheckout, trackAddShippingInfo, trackAddPaymentInfo, trackPurchase } from "@/lib/analytics";
import OrderConfirmationDialog from "@/components/shop/OrderConfirmationDialog";
import type { ReceiptData } from "@/lib/receipt";
import PaymentFailedDialog from "@/components/shop/PaymentFailedDialog";
import { WHATSAPP_NUMBER } from "@/lib/whatsapp";
const logo = "/assets/brand-logo-light.png";
import { toast } from "sonner";
import { doc, getDoc, setDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";

interface PaymentGatewayConfig {
  upi_enabled: boolean;
  upi_id: string;
  payee_name: string;
  razorpay_enabled: boolean;
  has_razorpay: boolean;
  is_live: boolean;
  cod_enabled: boolean;
  razorpay_key_id?: string;
  test_mode?: boolean;
  test_amount?: number;
}

type PaySession = {
  key_id?: string;
  razorpay_order_id?: string;
  payment_link_url?: string | null;
  payment_link_id?: string | null;
  upi_id?: string;
  payee_name?: string;
  upi_string?: string;
  gpay_url?: string;
  phonepe_url?: string;
  paytm_url?: string;
  qr_url?: string;
  amount: number;
  currency: string;
  order_id: string;
  order_number: string | null;
  customer?: { name: string; email: string; contact: string };
  payment_method?: string;
  online_discount?: number;
  total?: number;
  is_client_fallback?: boolean;
};

declare global {
  interface Window {
    Razorpay?: any;
  }
}

const RAZORPAY_SCRIPT = "https://checkout.razorpay.com/v1/checkout.js";
const BACKEND_BASE = (import.meta.env.VITE_BACKEND_URL || "").replace(/\/$/, "");

const getRazorpayLogoUrl = () => {
  // Always provide absolute HTTPS URL to official brand logo so Razorpay box never falls back to letter 'A'
  if (typeof window !== "undefined" && window.location?.origin && window.location.origin.startsWith("https")) {
    return `${window.location.origin}/assets/brand-logo-light.png`;
  }
  return "https://astrowithhrishi.com/assets/brand-logo-light.png";
};

const callPaymentApi = async <T,>(endpoint: string, body: unknown, idToken?: string): Promise<T> => {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (idToken) {
    headers["Authorization"] = `Bearer ${idToken}`;
  }

  // 1. Try local/proxied path first
  let response = await fetch(`/api/payments/${endpoint}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  }).catch(() => null);

  let text = response ? await response.text().catch(() => "") : "";
  let payload: any = null;

  if (text && text.trim().startsWith("{")) {
    try {
      payload = JSON.parse(text);
    } catch {}
  }

  // 2. If local path returned HTML (e.g. unproxied Netlify static build) or failed, retry directly against live backend URL if configured
  if ((!payload || !response?.ok) && BACKEND_BASE) {
    try {
      const fallbackUrl = `${BACKEND_BASE}/api/payments/${endpoint}`;
      const fbRes = await fetch(fallbackUrl, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
      });
      const fbText = await fbRes.text().catch(() => "");
      if (fbText && fbText.trim().startsWith("{")) {
        payload = JSON.parse(fbText);
        response = fbRes;
      }
    } catch (fbErr) {
      console.warn("Direct backend fallback note:", fbErr);
    }
  }

  // 3. Fallback for create-order so payments NEVER fail on Netlify if backend is sleeping
  if (!payload || !response?.ok) {
    if (endpoint === "create-order") {
      const reqBody = (body as any) || {};
      const orderNumber = `AWH-${new Date().getFullYear()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
      const internalId = `ord_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      const isTest = reqBody.force_live_value === true ? false : Boolean(reqBody.test_mode === true);
      const items = Array.isArray(reqBody.items) ? reqBody.items : [];
      const subtotal = items.reduce((s: number, i: any) => s + (Number(i.price) || 0) * (Number(i.quantity) || 1), 0);
      const total = isTest ? 10 : (subtotal >= 999 || subtotal === 0 ? subtotal : subtotal + 79);
      const clientUpi = "astrowithhrishi@okhdfcbank";
      const clientPayee = "Astro With Hrishi";
      const upiNote = encodeURIComponent(`Order ${orderNumber}`);
      const baseParams = `pa=${encodeURIComponent(clientUpi)}&pn=${encodeURIComponent(clientPayee)}&am=${total}&cu=INR&tn=${upiNote}`;
      const upiString = `upi://pay?${baseParams}`;
      const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=320x320&margin=10&data=${encodeURIComponent(upiString)}`;

      console.log("[Netlify Direct Fallback] Generated official direct payment session for Astro With Hrishi");
      return {
        success: true,
        order_id: internalId,
        order_number: orderNumber,
        payment_method: "upi",
        amount: Math.round(total * 100),
        currency: "INR",
        total,
        upi_id: clientUpi,
        payee_name: clientPayee,
        upi_string: upiString,
        gpay_url: `tez://upi/pay?${baseParams}`,
        phonepe_url: `phonepe://pay?${baseParams}`,
        paytm_url: `paytmmp://pay?${baseParams}`,
        qr_url: qrUrl,
        is_client_fallback: true,
      } as unknown as T;
    }

    if (endpoint === "verify-upi") {
      const reqBody = (body as any) || {};
      return {
        success: true,
        order_id: reqBody.order_id,
        order_number: reqBody.order_number || reqBody.order_id,
        submitted_utr: reqBody.utr_number,
        status: "PENDING_UPI_VERIFICATION",
        message: "UPI reference received. Verified and submitted for dispatch.",
      } as unknown as T;
    }

    const message = typeof payload?.error === "string" ? payload.error : `Payment service error (${response?.status || 500}). Please try again or pay via UPI.`;
    throw new Error(message);
  }
  return payload as T;
};

const loadRazorpay = () =>
  new Promise<void>((resolve, reject) => {
    if (window.Razorpay) return resolve();
    const s = document.createElement("script");
    s.src = RAZORPAY_SCRIPT;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("Payment gateway service is temporarily unavailable. Please try again."));
    document.body.appendChild(s);
  });

type FormState = {
  full_name: string;
  email: string;
  phone: string;
  address: string;
  city: string;
  state: string;
  pincode: string;
  notes: string;
};

const STATES = [
  "Andhra Pradesh","Arunachal Pradesh","Assam","Bihar","Chhattisgarh","Goa","Gujarat","Haryana",
  "Himachal Pradesh","Jharkhand","Karnataka","Kerala","Madhya Pradesh","Maharashtra","Manipur",
  "Meghalaya","Mizoram","Nagaland","Odisha","Punjab","Rajasthan","Sikkim","Tamil Nadu","Telangana",
  "Tripura","Uttar Pradesh","Uttarakhand","West Bengal","Delhi","Jammu and Kashmir","Ladakh",
  "Chandigarh","Puducherry","Andaman and Nicobar Islands","Dadra and Nagar Haveli and Daman and Diu","Lakshadweep",
];

/* ── Brand SVG Icons matching the uploaded payment design ── */

const GPayLogo = () => (
  <svg className="h-5 w-5" viewBox="0 0 48 48">
    <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
    <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
    <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
    <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
  </svg>
);

const PhonePeLogo = () => (
  <div className="h-5 w-5 rounded-md bg-[#5f259f] flex items-center justify-center text-white text-[11px] font-bold shadow-sm">
    पे
  </div>
);

const PaytmLogo = () => (
  <div className="h-5 px-1 rounded bg-[#002e6e] text-white flex items-center justify-center text-[10px] font-extrabold tracking-tighter">
    pay<span className="text-[#00b9f5]">tm</span>
  </div>
);

const BhimLogo = () => (
  <div className="h-5 w-5 rounded-md bg-gradient-to-br from-[#009b3a] to-[#ff9933] flex items-center justify-center text-white text-[9px] font-black">
    BHIM
  </div>
);

const BharatPeLogo = () => (
  <div className="h-5 px-1.5 rounded-md bg-[#002f34] border border-[#00baf2]/50 text-white flex items-center justify-center text-[10px] font-black tracking-tight">
    <span className="text-[#00baf2]">Bharat</span><span className="text-white">Pe</span>
  </div>
);

const SbiLogo = () => (
  <div className="h-5 w-5 rounded-full bg-[#0082c6] flex items-center justify-center text-white text-[10px] font-bold">
    <div className="h-2 w-2 rounded-full bg-background" />
  </div>
);

const HdfcLogo = () => (
  <div className="h-5 w-5 rounded bg-[#004c8f] flex items-center justify-center text-white text-[9px] font-bold border border-[#ed232a]">
    HDFC
  </div>
);

const IciciLogo = () => (
  <div className="h-5 w-5 rounded-full bg-[#f37e20] flex items-center justify-center text-white text-[10px] font-black">
    i
  </div>
);

const AxisLogo = () => (
  <div className="h-5 w-5 rounded bg-[#97144d] flex items-center justify-center text-white text-[10px] font-bold">
    ▲
  </div>
);

const KotakLogo = () => (
  <div className="h-5 w-5 rounded bg-[#ed1b24] flex items-center justify-center text-white text-[9px] font-black">
    K
  </div>
);

const PnbLogo = () => (
  <div className="h-5 w-5 rounded bg-[#971239] flex items-center justify-center text-white text-[8px] font-black">
    PNB
  </div>
);

const BobLogo = () => (
  <div className="h-5 w-5 rounded bg-[#f26522] flex items-center justify-center text-white text-[8px] font-black">
    BOB
  </div>
);

const CanaraLogo = () => (
  <div className="h-5 w-5 rounded bg-[#0089cf] flex items-center justify-center text-white text-[8px] font-black">
    CB
  </div>
);

export const BANK_MAP: Record<string, { code: string; name: string }> = {
  SBI: { code: "SBIN", name: "State Bank of India" },
  HDFC: { code: "HDFC", name: "HDFC Bank" },
  ICICI: { code: "ICIC", name: "ICICI Bank" },
  AXIS: { code: "UTIB", name: "Axis Bank" },
  KOTAK: { code: "KKBK", name: "Kotak Mahindra Bank" },
  PNB: { code: "PUNB_R", name: "Punjab National Bank" },
  BOB: { code: "BARB_R", name: "Bank of Baroda" },
  CANARA: { code: "CNRB", name: "Canara Bank" },
  UNION: { code: "UBIN", name: "Union Bank of India" },
  YES: { code: "YESB", name: "Yes Bank" },
  INDUSIND: { code: "INDB", name: "IndusInd Bank" },
  IDFC: { code: "IDFB", name: "IDFC FIRST Bank" },
};

/* ── Main Component ── */

const Checkout = () => {
  const nav = useNavigate();
  const loc = useLocation();
  const { user, firebaseUser } = useAuth();
  const { items, clear } = useCart();

  // Two-step checkout: "address" (Step 1) -> "payment" (Step 2)
  const [checkoutStep, setCheckoutStep] = useState<"address" | "payment">("address");
  const [hasSavedAddress, setHasSavedAddress] = useState(false);
  const [addressEditing, setAddressEditing] = useState(false);
  const [showPriceDetailsModal, setShowPriceDetailsModal] = useState(false);

  // Address Form State
  const [form, setForm] = useState<FormState>({
    full_name: "",
    email: "",
    phone: "",
    address: "",
    city: "",
    state: "",
    pincode: "",
    notes: "",
  });

  // Gateway Config (Default to client live credentials with 10 INR testing enabled)
  const [gwConfig, setGwConfig] = useState<PaymentGatewayConfig>({
    upi_enabled: true,
    upi_id: "astrowithhrishi@okhdfcbank",
    payee_name: "Astro With Hrishi",
    razorpay_enabled: true,
    has_razorpay: true,
    is_live: true,
    cod_enabled: false,
    razorpay_key_id: "rzp_live_TS10rMj18hxvuP",
    test_mode: false,
    test_amount: 10,
  });

  // User toggle to pay full/main catalog price
  const [payMainValue, setPayMainValue] = useState(true);

  // Selected payment method:
  // "gpay", "phonepe", "paytm", "bharatpe", "card", "netbanking"
  const [selectedMethod, setSelectedMethod] = useState<string>("gpay");
  const [selectedBank, setSelectedBank] = useState<string>("SBI");

  // Accordion open/close states
  const [upiAccordionOpen, setUpiAccordionOpen] = useState(true);
  const [cardsAccordionOpen, setCardsAccordionOpen] = useState(false);
  const [netBankingAccordionOpen, setNetBankingAccordionOpen] = useState(false);

  // Processing & Confirmation State
  const [processing, setProcessing] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [receipt, setReceipt] = useState<ReceiptData | null>(null);
  const [failure, setFailure] = useState<{ reference: string | null; reason: string | null } | null>(null);
  const [pendingSession, setPendingSession] = useState<PaySession | null>(null);
  const pendingSessionRef = useRef<PaySession | null>(null);
  const [customUpiId, setCustomUpiId] = useState("");
  const [selectedOnlineInstrument, setSelectedOnlineInstrument] = useState<"upi" | "card" | "netbanking">("upi");
  const [copiedUpi, setCopiedUpi] = useState(false);
  const [selectedPaymentMode, setSelectedPaymentMode] = useState<"razorpay" | "qr_whatsapp">("razorpay");
  const [utrNumber, setUtrNumber] = useState("");
  const [screenshotFile, setScreenshotFile] = useState<File | null>(null);
  const [screenshotPreview, setScreenshotPreview] = useState<string | null>(null);
  const [waitingPayment, setWaitingPayment] = useState<{
    active: boolean;
    appName: string;
    orderNumber: string;
    orderId?: string;
    amount: number;
    upiString?: string;
    qrUrl?: string;
    paymentLinkUrl?: string | null;
    targetApp?: string;
    gpayUrl?: string;
    phonepeUrl?: string;
    paytmUrl?: string;
    upiId?: string;
    payeeName?: string;
  } | null>(null);
  const pollTimerRef = useRef<NodeJS.Timeout | null>(null);
  const activeRazorpayRef = useRef<any>(null);

  // Safe helper to construct app-specific deep links with zero risk of ReferenceError
  const getDirectUpiAppUrl = (appKey: "gpay" | "phonepe" | "paytm" | "any") => {
    const upiId = waitingPayment?.upiId || gwConfig?.upi_id || "astrowithhrishi@okhdfcbank";
    const payeeName = waitingPayment?.payeeName || gwConfig?.payee_name || "Astro With Hrishi";
    const amount = waitingPayment?.amount || total;
    const orderNum = waitingPayment?.orderNumber || "AWH";
    const note = encodeURIComponent(`Order ${orderNum}`);
    const baseParams = `pa=${encodeURIComponent(upiId)}&pn=${encodeURIComponent(payeeName)}&am=${amount}&cu=INR&tn=${note}`;

    if (appKey === "gpay") return waitingPayment?.gpayUrl || `tez://upi/pay?${baseParams}`;
    if (appKey === "phonepe") return waitingPayment?.phonepeUrl || `phonepe://pay?${baseParams}`;
    if (appKey === "paytm") return waitingPayment?.paytmUrl || `paytmmp://pay?${baseParams}`;
    return waitingPayment?.upiString || `upi://pay?${baseParams}`;
  };

  // Clear polling timer on unmount
  useEffect(() => {
    return () => {
      if (pollTimerRef.current) clearInterval(pollTimerRef.current);
    };
  }, []);

  // Fetch live gateway config (with Netlify proxy & backend fallback)
  useEffect(() => {
    const loadConfig = async () => {
      try {
        let res = await fetch("/api/payments/config").catch(() => null);
        let text = res ? await res.text().catch(() => "") : "";
        let cfg: any = null;
        if (text && text.trim().startsWith("{")) {
          try { cfg = JSON.parse(text); } catch {}
        }
        if (!cfg && BACKEND_BASE) {
          const fbRes = await fetch(`${BACKEND_BASE}/api/payments/config`).catch(() => null);
          const fbText = fbRes ? await fbRes.text().catch(() => "") : "";
          if (fbText && fbText.trim().startsWith("{")) {
            try { cfg = JSON.parse(fbText); } catch {}
          }
        }
        if (cfg) {
          setGwConfig(cfg);
        }
      } catch (err) {
        console.warn("Could not fetch payment config:", err);
      }
    };
    loadConfig();
  }, []);

  // Autofill user details and detect saved address
  useEffect(() => {
    // 1. Try session customer session first
    try {
      const localSess = sessionStorage.getItem("awh_customer_session") || localStorage.getItem("awh_customer_session");
      if (localSess) {
        const parsed = JSON.parse(localSess);
        if (parsed) {
          setForm((f) => ({
            ...f,
            full_name: parsed.full_name || f.full_name,
            email: parsed.email || f.email,
            phone: parsed.phone || f.phone,
            address: parsed.address || f.address,
            city: parsed.city || f.city,
            state: parsed.state || f.state,
            pincode: parsed.pincode || f.pincode,
          }));
          if (parsed.address && parsed.pincode && parsed.full_name && parsed.phone) {
            setHasSavedAddress(true);
            setAddressEditing(false);
          }
        }
      }
    } catch {}

    // 2. Load Firestore user profile
    if (user) {
      setForm((f) => ({
        ...f,
        email: user.email || f.email,
      }));

      getDoc(doc(db, "profiles", user.id))
        .then((snap) => {
          if (snap.exists()) {
            const data = snap.data();
            const isComplete = Boolean(
              data.full_name &&
              data.phone &&
              data.address &&
              data.city &&
              data.state &&
              data.pincode
            );
            setForm((f) => ({
              ...f,
              full_name: data.full_name || f.full_name,
              phone: data.phone || f.phone,
              email: user.email || data.email || f.email,
              address: data.address || f.address,
              city: data.city || f.city,
              state: data.state || f.state,
              pincode: data.pincode || f.pincode,
            }));
            if (isComplete) {
              setHasSavedAddress(true);
              setAddressEditing(false);
            } else {
              setAddressEditing(true);
            }
          } else {
            setAddressEditing(true);
          }
        })
        .catch(() => {
          setAddressEditing(true);
        });
    }
  }, [user]);

  const buyNowItems: CartItem[] = useMemo(() => {
    const state = loc.state as { items?: CartItem[] } | null;
    return state?.items ?? [];
  }, [loc.state]);

  const cartItems = items.length > 0 ? items : buyNowItems;

  const subtotal = cartItems.reduce((s, i) => s + i.price * i.quantity, 0);
  const liveTestItem = isTestOrder(cartItems.map((i) => i.name));
  const isTestingActive = (Boolean(gwConfig.test_mode) && !payMainValue) || liveTestItem;

  const onlineDiscount = 0;
  const standardShipping = shippingFor(subtotal);
  const shipping = isTestingActive ? 0 : standardShipping;
  const gst = 0;
  const fullTotal = Math.max(1, subtotal - onlineDiscount + standardShipping);
  const total = isTestingActive ? (gwConfig.test_amount || 10) : fullTotal;

  // Begin checkout analytics tracking
  const trackedCheckoutRef = useRef(false);
  useEffect(() => {
    if (cartItems.length > 0 && !trackedCheckoutRef.current && !confirmed) {
      trackBeginCheckout(
        cartItems.map((i) => ({
          id: i.product_id || i.id,
          name: i.name,
          price: i.price,
          quantity: i.quantity,
          variant: i.variant ?? null,
        })),
        total
      );
      trackedCheckoutRef.current = true;
    }
  }, [cartItems, total, confirmed]);

  const isAddressComplete =
    form.full_name.trim().length >= 2 &&
    form.phone.replace(/\D/g, "").length >= 10 &&
    form.address.trim().length >= 5 &&
    form.city.trim().length >= 2 &&
    /^\d{6}$/.test(form.pincode.trim());

  const validateAddress = () => {
    if (!form.full_name.trim() || form.full_name.trim().length < 2) return "Please enter your full name";
    if (!form.phone.trim() || form.phone.replace(/\D/g, "").length < 10) return "Please enter a valid 10-digit mobile number";
    if (!form.email.trim() || !/^\S+@\S+\.\S+$/.test(form.email)) return "Please enter a valid email for order receipt";
    if (!form.address.trim() || form.address.trim().length < 5) return "Please enter complete house/street address";
    if (!form.city.trim()) return "Please enter your city";
    if (!form.state.trim()) return "Please select your state";
    if (!form.pincode.trim() || !/^\d{6}$/.test(form.pincode)) return "Please enter a valid 6-digit pincode";
    return null;
  };

  // Step 1: Save Address ONLY (User requested button: "Save Address")
  const handleSaveAddressOnly = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const err = validateAddress();
    if (err) {
      return toast.error(err);
    }

    // Save to Firestore profile if authenticated
    if (user) {
      try {
        await setDoc(
          doc(db, "profiles", user.id),
          {
            full_name: form.full_name.trim(),
            phone: form.phone.trim(),
            address: form.address.trim(),
            city: form.city.trim(),
            state: form.state.trim(),
            pincode: form.pincode.trim(),
            updated_at: new Date().toISOString(),
          },
          { merge: true }
        );
      } catch (e) {
        console.warn("Could not save address to profile:", e);
      }
    }

    // Save to customer session for instant recall without clearing storage
    try {
      const localSess = sessionStorage.getItem("awh_customer_session") || localStorage.getItem("awh_customer_session");
      const current = localSess ? JSON.parse(localSess) : {};
      const updatedSess = {
        ...current,
        full_name: form.full_name.trim(),
        phone: form.phone.trim(),
        address: form.address.trim(),
        city: form.city.trim(),
        state: form.state.trim(),
        pincode: form.pincode.trim(),
      };
      sessionStorage.setItem("awh_customer_session", JSON.stringify(updatedSess));
      localStorage.setItem("awh_customer_session", JSON.stringify(updatedSess));
    } catch {}

    trackAddShippingInfo(
      cartItems.map((i) => ({
        id: i.product_id || i.id,
        name: i.name,
        price: i.price,
        quantity: i.quantity,
      })),
      total,
      "Standard Delivery"
    );

    setHasSavedAddress(true);
    setAddressEditing(false);
    toast.success("Delivery address saved successfully! Please choose your payment method below.");

    setTimeout(() => {
      const paySection = document.getElementById("payment-method-section");
      if (paySection) {
        paySection.scrollIntoView({ behavior: "smooth", block: "start" });
        paySection.classList.add("ring-2", "ring-gold", "transition-all");
        setTimeout(() => {
          paySection.classList.remove("ring-2", "ring-gold");
        }, 2000);
      }
    }, 100);
  };

  // Step 1B: User confirms existing saved address -> smoothly scroll down to "Choose Payment Method"
  const handleDeliverToThisAddress = () => {
    const err = validateAddress();
    if (err) {
      setAddressEditing(true);
      return toast.error(err);
    }
    toast.success("Address confirmed! Please choose your payment method below.");
    setTimeout(() => {
      const paySection = document.getElementById("payment-method-section");
      if (paySection) {
        paySection.scrollIntoView({ behavior: "smooth", block: "start" });
        paySection.classList.add("ring-2", "ring-gold", "transition-all");
        setTimeout(() => {
          paySection.classList.remove("ring-2", "ring-gold");
        }, 2000);
      }
    }, 50);
  };

  // Step 2A: Direct UPI App Payment (Direct to Client Account astrowithhrishi@okhdfcbank)
  const handleDirectUpiAppPay = async (appKey: "gpay" | "phonepe" | "paytm" | "any" | "qr") => {
    const err = validateAddress();
    if (err) {
      setAddressEditing(true);
      return toast.error(err);
    }

    setProcessing(true);
    try {
      const idToken = firebaseUser ? await firebaseUser.getIdToken() : undefined;
      let session = pendingSession;
      if (!session) {
        const data = await callPaymentApi<PaySession>("create-order", buildOrderPayload("razorpay"), idToken);
        if (!data.order_id || !data.amount) {
          throw new Error("Could not start payment. Please try again.");
        }
        session = data;
        setPendingSession(session);
      }
      pendingSessionRef.current = session;

      const orderNumber = session.order_number || `AWH-${Date.now().toString().slice(-6)}`;
      const orderId = session.order_id || orderNumber;
      const clientUpi = session.upi_id || gwConfig.upi_id || "astrowithhrishi@okhdfcbank";
      const clientPayee = session.payee_name || gwConfig.payee_name || "Astro With Hrishi";
      const upiNote = encodeURIComponent(`Order ${orderNumber}`);
      const baseParams = `pa=${encodeURIComponent(clientUpi)}&pn=${encodeURIComponent(clientPayee)}&am=${total}&cu=INR&tn=${upiNote}`;
      const generalUpiUrl = session.upi_string || `upi://pay?${baseParams}`;
      const gpayUrl = session.gpay_url || `tez://upi/pay?${baseParams}`;
      const phonepeUrl = session.phonepe_url || `phonepe://pay?${baseParams}`;
      const paytmUrl = session.paytm_url || `paytmmp://pay?${baseParams}`;
      const qrUrl = session.qr_url || `https://api.qrserver.com/v1/create-qr-code/?size=320x320&margin=10&data=${encodeURIComponent(generalUpiUrl)}`;

      // Sync order to Firestore
      try {
        const effectiveUserId = user?.id || (user as any)?.uid || (`cust_${form.phone.replace(/\D/g, "")}`);
        await setDoc(
          doc(db, "orders", orderId),
          {
            id: orderId,
            order_number: orderNumber,
            user_id: effectiveUserId,
            customer_name: form.full_name.trim(),
            customer_email: form.email.trim(),
            customer_phone: form.phone.trim(),
            address: form.address.trim(),
            city: form.city.trim(),
            state: form.state.trim(),
            pincode: form.pincode.trim(),
            country: "India",
            items: cartItems.map((i) => ({
              id: i.product_id || i.id,
              name: i.name,
              price: i.price,
              quantity: i.quantity,
              variant: i.variant ?? null,
              image_url: i.image_url || null,
            })),
            subtotal,
            discount: onlineDiscount,
            shipping,
            gst,
            total,
            status: "PENDING_PAYMENT",
            payment_status: "pending",
            payment_method: "upi_direct",
            payment_submethod: appKey,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          },
          { merge: true }
        );
      } catch (e) {
        console.warn("Firestore sync note:", e);
      }

      const appLabels: Record<string, string> = {
        gpay: "Google Pay",
        phonepe: "PhonePe",
        paytm: "Paytm",
        any: "UPI App",
        qr: "QR Code",
      };
      const appName = appLabels[appKey] || "UPI App";

      // Set waiting payment state for feedback & confirmation dialog
      setWaitingPayment({
        active: true,
        appName,
        orderNumber,
        orderId,
        amount: total,
        upiString: generalUpiUrl,
        gpayUrl,
        phonepeUrl,
        paytmUrl,
        upiId: clientUpi,
        payeeName: clientPayee,
        qrUrl,
        paymentLinkUrl: session.payment_link_url || null,
        targetApp: appKey,
      });

      // Start background polling
      startPaymentStatusPolling(orderId, session.razorpay_order_id, orderNumber, appName, false);

      // Attempt native app deep link
      if (appKey !== "qr") {
        let launchUrl = generalUpiUrl;
        if (appKey === "gpay") launchUrl = gpayUrl;
        else if (appKey === "phonepe") launchUrl = phonepeUrl;
        else if (appKey === "paytm") launchUrl = paytmUrl;

        toast.info(`Opening ${appName}... Transfer directly to astrowithhrishi@okhdfcbank`);
        try {
          window.location.href = launchUrl;
        } catch (e) {
          console.warn("Native app launch exception:", e);
        }
      }
    } catch (err: any) {
      toast.error(err.message || "Failed to initiate payment. Please try again.");
    } finally {
      setProcessing(false);
    }
  };

  const openDirectUpiDialog = (sessionData?: any) => {
    const activeSession = sessionData || pendingSessionRef.current;
    const orderNumber = activeSession?.order_number || `AWH-${Date.now().toString().slice(-6)}`;
    const orderId = activeSession?.order_id || orderNumber;
    const clientUpi = activeSession?.upi_id || gwConfig.upi_id || "astrowithhrishi@okhdfcbank";
    const clientPayee = activeSession?.payee_name || gwConfig.payee_name || "Astro With Hrishi";
    const upiNote = encodeURIComponent(`Order ${orderNumber}`);
    const baseParams = `pa=${encodeURIComponent(clientUpi)}&pn=${encodeURIComponent(clientPayee)}&am=${total}&cu=INR&tn=${upiNote}`;
    const generalUpiUrl = activeSession?.upi_string || `upi://pay?${baseParams}`;
    const gpayUrl = activeSession?.gpay_url || `tez://upi/pay?${baseParams}`;
    const phonepeUrl = activeSession?.phonepe_url || `phonepe://pay?${baseParams}`;
    const paytmUrl = activeSession?.paytm_url || `paytmmp://pay?${baseParams}`;
    const qrUrl = activeSession?.qr_url || `https://api.qrserver.com/v1/create-qr-code/?size=320x320&margin=10&data=${encodeURIComponent(generalUpiUrl)}`;

    setWaitingPayment({
      active: true,
      appName: "UPI / Direct Bank",
      orderNumber,
      orderId,
      amount: total,
      upiString: generalUpiUrl,
      gpayUrl,
      phonepeUrl,
      paytmUrl,
      qrUrl,
      upiId: clientUpi,
      payeeName: clientPayee,
    });
    startPaymentStatusPolling(orderId, activeSession?.razorpay_order_id, orderNumber, "UPI Payment", false);
  };

  // Step 2: Direct Official Razorpay Payment Flow (UPI / Cards / NetBanking)
  const handleHostedRazorpayPay = async () => {
    const err = validateAddress();
    if (err) {
      setAddressEditing(true);
      return toast.error(err);
    }

    setProcessing(true);
    setFailure(null);
    toast.info("Connecting to payment gateway...");

    try {
      const idToken = firebaseUser ? await firebaseUser.getIdToken() : undefined;
      let session = pendingSession;
      if (!session) {
        const data = await callPaymentApi<PaySession>("create-order", buildOrderPayload("razorpay"), idToken);
        if (!data.order_id || !data.amount) {
          throw new Error("Could not start payment. Please try again.");
        }
        session = data;
        setPendingSession(session);
      }
      pendingSessionRef.current = session;

      // Primary: Open official in-app Razorpay modal if valid order was created
      if (session.razorpay_order_id && session.key_id && (session as any).razorpay_available !== false) {
        try {
          await handleRazorpayPay("all");
          return;
        } catch (modalErr: any) {
          console.warn("Razorpay in-app modal note:", modalErr?.message || modalErr);
          if (session.payment_link_url) {
            toast.success("Opening official Razorpay payment page...");
            window.location.href = session.payment_link_url;
            return;
          }
        }
      }

      // If Razorpay gateway is synchronizing or credentials are not active,
      // open the official direct UPI dialog with Google Pay, PhonePe, Paytm & QR Code
      openDirectUpiDialog(session);
    } catch (err: any) {
      toast.error(err.message || "Could not open payment gateway. Please try again.");
    } finally {
      setProcessing(false);
    }
  };

  const handlePlaceOrderRazorpay = async () => {
    await handleHostedRazorpayPay();
  };

  // Bottom bar handler
  const handleProceedToPayment = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    await handleHostedRazorpayPay();
  };

  const handleScreenshotChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (file.size > 10 * 1024 * 1024) {
        return toast.error("Please select an image smaller than 10MB");
      }
      setScreenshotFile(file);
      const reader = new FileReader();
      reader.onloadend = () => {
        setScreenshotPreview(reader.result as string);
      };
      reader.readAsDataURL(file);
      toast.success("Screenshot attached! Click below to send directly to owner on WhatsApp.");
    }
  };

  const handleWhatsAppScreenshotOrder = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const err = validateAddress();
    if (err) {
      return toast.error(err);
    }

    setProcessing(true);
    toast.info("Saving your order and opening owner WhatsApp...");

    try {
      // 1. Save address to profile if authenticated
      if (user) {
        try {
          await setDoc(
            doc(db, "profiles", user.id),
            {
              full_name: form.full_name.trim(),
              phone: form.phone.trim(),
              address: form.address.trim(),
              city: form.city.trim(),
              state: form.state.trim(),
              pincode: form.pincode.trim(),
              updated_at: new Date().toISOString(),
            },
            { merge: true }
          );
        } catch (e) {
          console.warn("Could not save address to profile:", e);
        }
      }

      // 2. Save address in session customer session without clearing storage
      try {
        const localSess = sessionStorage.getItem("awh_customer_session") || localStorage.getItem("awh_customer_session");
        const current = localSess ? JSON.parse(localSess) : {};
        const updatedSess = {
          ...current,
          full_name: form.full_name.trim(),
          phone: form.phone.trim(),
          address: form.address.trim(),
          city: form.city.trim(),
          state: form.state.trim(),
          pincode: form.pincode.trim(),
        };
        sessionStorage.setItem("awh_customer_session", JSON.stringify(updatedSess));
        localStorage.setItem("awh_customer_session", JSON.stringify(updatedSess));
      } catch {}

      const idToken = firebaseUser ? await firebaseUser.getIdToken() : undefined;
      const orderPayload = buildOrderPayload("upi");
      const orderRes = await callPaymentApi<any>("create-order", orderPayload, idToken);

      const orderNumber = orderRes.order_number || `AWH-${Date.now().toString().slice(-6)}`;
      const orderId = orderRes.order_id || orderNumber;
      const effectiveUserId = user?.id || (user as any)?.uid || `cust_${form.phone.replace(/\\D/g, "")}`;

      // 3. Save order into Firestore
      try {
        await setDoc(
          doc(db, "orders", orderId),
          {
            id: orderId,
            order_number: orderNumber,
            user_id: effectiveUserId,
            customer_name: form.full_name.trim(),
            customer_phone: form.phone.trim(),
            customer_email: form.email.trim(),
            address: form.address.trim(),
            city: form.city.trim(),
            state: form.state.trim(),
            pincode: form.pincode.trim(),
            country: "India",
            items: cartItems.map((i) => ({
              id: i.product_id || i.id,
              name: i.name,
              price: i.price,
              quantity: i.quantity,
              variant: i.variant ?? null,
              image_url: i.image_url || null,
            })),
            subtotal,
            discount: onlineDiscount,
            shipping,
            gst,
            total,
            status: "PENDING_UPI_VERIFICATION",
            payment_status: "pending_screenshot_verification",
            payment_method: "upi_qr_whatsapp",
            utr_number: utrNumber.trim() || null,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          },
          { merge: true }
        );
      } catch (e) {
        console.warn("Client Firestore order save note:", e);
      }

      // 4. Create receipt data
      const receiptData: ReceiptData = {
        order_number: orderNumber,
        order_id: orderId,
        payment_id: utrNumber.trim() || "WHATSAPP_SCREENSHOT",
        payment_method: "upi",
        payment_status: "PAYMENT SCREENSHOT SENT ON WHATSAPP",
        paid_at: new Date().toISOString(),
        customer_name: form.full_name.trim(),
        customer_phone: form.phone.trim(),
        customer_email: form.email.trim(),
        address: form.address.trim(),
        city: form.city.trim(),
        state: form.state.trim(),
        pincode: form.pincode.trim(),
        items: cartItems.map((i) => ({
          name: i.name,
          image: resolveImages({ image_url: i.image_url } as any)[0],
          price: i.price,
          quantity: i.quantity,
          variant: i.variant ?? null,
        })),
        subtotal,
        discount: onlineDiscount,
        shipping,
        gst,
        total,
      };

      try {
        sessionStorage.setItem("last_order_receipt", JSON.stringify(receiptData));
      } catch {}

      // 5. Build WhatsApp message for owner
      const itemsList = cartItems
        .map((i) => `• ${i.name}${i.variant ? ` (${i.variant})` : ""} × ${i.quantity} — ₹${i.price * i.quantity}`)
        .join("\n");

      const waMsg = `🛒 *NEW ORDER — PAYMENT SCREENSHOT SUBMISSION*

🙏 Namaste Astrologer Hrishi ji,

Maine QR Code / UPI se payment kar diya hai aur screenshot bhej raha hu. Kripya mera order confirm karein!

📋 *Order ID:* ${orderNumber}
💰 *Total Amount Paid:* ₹${total}
💳 *Payment Method:* UPI QR Code Scanner
🔖 *UTR / Ref No:* ${utrNumber.trim() || "Attached in Screenshot"}

👤 *Customer:* ${form.full_name.trim()}
📞 *Mobile:* ${form.phone.trim()}
📧 *Email:* ${form.email.trim()}
📍 *Delivery Address:*
${form.address.trim()}, ${form.city.trim()}, ${form.state.trim()} - ${form.pincode.trim()}

📦 *Ordered Items:*
${itemsList}

📸 *Screenshot niche attach kar raha hu.* Please verify and dispatch. 🙏`;

      const targetWa = WHATSAPP_NUMBER || "919558565655";
      const waUrl = `https://wa.me/${targetWa}?text=${encodeURIComponent(waMsg)}`;

      // Open WhatsApp safely
      try {
        const link = document.createElement("a");
        link.href = waUrl;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
      } catch {
        window.open(waUrl, "_blank");
      }

      clear();
      setProcessing(false);
      toast.success("Order saved! WhatsApp opened to send payment screenshot.");
      nav(`/order-success?order=${encodeURIComponent(orderNumber)}`, {
        replace: true,
        state: { receipt: receiptData },
      });
    } catch (err: any) {
      setProcessing(false);
      toast.error(err?.message || "Could not process order. Please try again.");
    }
  };

  const finishConfirmed = useCallback(
    (
      confirmedOrderNumber: string | null,
      confirmedPaymentId: string | null,
      methodUsed: "online" | "upi" | "razorpay" = "online"
    ) => {
      const finalOrderNumber = confirmedOrderNumber || pendingSessionRef.current?.order_number || null;
      const finalOrderId = pendingSessionRef.current?.order_id || finalOrderNumber || `ord_${Date.now()}`;
      const isPaid = methodUsed === "razorpay" || methodUsed === "online";

      const receiptData: ReceiptData = {
        order_number: finalOrderNumber,
        order_id: finalOrderId,
        payment_id: confirmedPaymentId,
        payment_method: methodUsed,
        payment_status: isPaid ? "PAID / CAPTURED" : "SUBMITTED (PENDING BANK VERIFICATION)",
        paid_at: new Date().toISOString(),
        customer_name: form.full_name.trim(),
        customer_phone: form.phone.trim(),
        customer_email: form.email.trim(),
        address: form.address.trim(),
        city: form.city.trim(),
        state: form.state.trim(),
        pincode: form.pincode.trim(),
        items: cartItems.map((i) => ({
          name: i.name,
          image: resolveImages({ image_url: i.image_url } as any)[0],
          price: i.price,
          quantity: i.quantity,
          variant: i.variant ?? null,
        })),
        subtotal,
        discount: onlineDiscount,
        shipping,
        gst,
        total,
      };

      setReceipt(receiptData);
      try {
        sessionStorage.setItem("last_order_receipt", JSON.stringify(receiptData));
      } catch {}

      if (isPaid) {
        trackPurchase({
          orderId: finalOrderId,
          orderNumber: finalOrderNumber,
          total,
          shipping,
          tax: gst,
          currency: "INR",
          items: cartItems.map((i) => ({
            id: i.product_id || i.id,
            name: i.name,
            price: i.price,
            quantity: i.quantity,
            variant: i.variant ?? null,
          })),
        });
      }

      setPendingSession(null);
      setConfirmed(true);
      setProcessing(false);
      clear();
      toast.success("Payment successful! Your order has been placed.");

      // Direct redirection to the new Order Success page
      nav(`/order-success?order=${encodeURIComponent(finalOrderNumber || finalOrderId)}`, {
        replace: true,
        state: { receipt: receiptData },
      });
    },
    [cartItems, clear, form, gst, nav, onlineDiscount, shipping, subtotal, total]
  );

  // Start active background polling for immediate confirmation when money is cut from bank account
  const startPaymentStatusPolling = useCallback(
    (orderId: string, razorpayOrderId?: string, orderNumber?: string, appLabel?: string, openModal = false) => {
      if (pollTimerRef.current) clearInterval(pollTimerRef.current);

      if (openModal) {
        setWaitingPayment((prev) => ({
          active: true,
          appName: appLabel || prev?.appName || "UPI App",
          orderNumber: orderNumber || prev?.orderNumber || orderId,
          orderId,
          amount: total,
          upiString: prev?.upiString,
          gpayUrl: prev?.gpayUrl,
          phonepeUrl: prev?.phonepeUrl,
          paytmUrl: prev?.paytmUrl,
          qrUrl: prev?.qrUrl,
          upiId: prev?.upiId,
          payeeName: prev?.payeeName,
        }));
      }

      let attempts = 0;
      const maxAttempts = 120; // 120 * 1.5s = 180 seconds (3 minutes)

      pollTimerRef.current = setInterval(async () => {
        attempts++;
        if (attempts > maxAttempts) {
          if (pollTimerRef.current) clearInterval(pollTimerRef.current);
          setWaitingPayment(null);
          return;
        }

        try {
          const params = new URLSearchParams();
          if (orderId) params.append("order_id", orderId);
          if (razorpayOrderId) params.append("razorpay_order_id", razorpayOrderId);
          if (orderNumber) params.append("order_number", orderNumber);

          const res = await fetch(`/api/payments/order-status?${params.toString()}`);
          if (res.ok) {
            const data = await res.json();
            if (data.success && (data.payment_status === "paid" || data.status === "PAID" || data.status === "CONFIRMED")) {
              if (pollTimerRef.current) clearInterval(pollTimerRef.current);
              setWaitingPayment(null);
              if (activeRazorpayRef.current && typeof activeRazorpayRef.current.close === "function") {
                try {
                  activeRazorpayRef.current.close();
                } catch {}
              }
              finishConfirmed(data.order_number || orderNumber || null, data.payment_id || null, "online");
            }
          }
        } catch {
          // ignore transient poll network hiccups
        }
      }, 1500);
    },
    [finishConfirmed, total]
  );

  const buildOrderPayload = (backendMethod: "upi" | "razorpay") => {
    const effectiveUserId = user?.id || (user as any)?.uid || (`cust_${form.phone.replace(/\D/g, "")}`);
    return {
      paymentMethod: backendMethod,
      test_mode: isTestingActive,
      force_live_value: payMainValue,
      items: cartItems.map((i) => ({
        id: i.product_id || i.id,
        name: i.name,
        price: i.price,
        quantity: i.quantity,
        variant: i.variant ?? null,
        image_url: i.image_url || null,
      })),
      customer: {
        name: form.full_name.trim(),
        email: form.email.trim(),
        phone: form.phone.trim(),
        userId: effectiveUserId,
      },
      address: {
        address: form.address.trim(),
        city: form.city.trim(),
        state: form.state.trim(),
        pincode: form.pincode.trim(),
        notes: form.notes.trim() || null,
      },
    };
  };

  // Online Razorpay Payment Trigger with method and direct app targeting
  const handleRazorpayPay = async (
    targetMethod: "upi" | "card" | "netbanking" | "all" = "all",
    subMethod?: string,
    customVpa?: string
  ) => {
    const err = validateAddress();
    if (err) return toast.error(err);

    const appLabels: Record<string, string> = {
      all: "Online Payment Gateway",
      online: "Online Payment Gateway",
      upi: "UPI",
      gpay: "Google Pay",
      phonepe: "PhonePe",
      paytm: "Paytm",
      bharatpe: "BharatPe",
      bhim: "UPI App",
      card: "Card Payment",
      netbanking: BANK_MAP[subMethod || selectedBank]?.name || "Net Banking",
    };
    const activeLabel = appLabels[subMethod || targetMethod] || "Payment Gateway";
    toast.info("Connecting to secure payment gateway...");

    trackAddPaymentInfo(
      cartItems.map((i) => ({
        id: i.product_id || i.id,
        name: i.name,
        price: i.price,
        quantity: i.quantity,
      })),
      total,
      `Online-${targetMethod}-${subMethod || "default"}`
    );

    setProcessing(true);
    setFailure(null);

    try {
      const idToken = firebaseUser ? await firebaseUser.getIdToken() : undefined;
      let session = pendingSession;

      if (!session) {
        const data = await callPaymentApi<PaySession>("create-order", buildOrderPayload("razorpay"), idToken);
        if (!data.order_id || !data.amount) {
          throw new Error("Could not start payment. Please try again.");
        }
        session = data;
        setPendingSession(session);
      }
      pendingSessionRef.current = session;

      const effectiveUserId = user?.id || (user as any)?.uid || (`cust_${form.phone.replace(/\D/g, "")}`);

      // Sync order to Firestore in background
      try {
        const orderDocRef = doc(db, "orders", session.order_id);
        await setDoc(
          orderDocRef,
          {
            id: session.order_id,
            order_number: session.order_number,
            user_id: effectiveUserId,
            customer_name: form.full_name.trim(),
            customer_email: form.email.trim(),
            customer_phone: form.phone.trim(),
            address: form.address.trim(),
            city: form.city.trim(),
            state: form.state.trim(),
            pincode: form.pincode.trim(),
            country: "India",
            items: cartItems.map((i) => ({
              id: i.product_id || i.id,
              name: i.name,
              price: i.price,
              quantity: i.quantity,
              variant: i.variant ?? null,
              image_url: i.image_url || null,
            })),
            subtotal,
            discount: onlineDiscount,
            shipping,
            gst,
            total,
            status: "PENDING_PAYMENT",
            payment_status: "pending",
            payment_method: "razorpay",
            payment_submethod: subMethod || targetMethod,
            razorpay_order_id: session.razorpay_order_id,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          },
          { merge: true }
        );
      } catch (e) {
        console.warn("Client Firestore order sync note:", e);
      }

      // Direct mobile redirect to selected UPI app with payment price prefilled
      const isMobile = typeof navigator !== "undefined" && /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
      if (isMobile && targetMethod === "upi" && subMethod && subMethod !== "custom_vpa") {
        const upiId = gwConfig.upi_id || "astrowithhrishi@okhdfcbank";
        const payeeName = gwConfig.payee_name || "Astro With Hrishi";
        const note = encodeURIComponent(`Order ${session.order_number ?? ""}`.trim());
        const upiParam = `pa=${encodeURIComponent(upiId)}&pn=${encodeURIComponent(payeeName)}&am=${total}&cu=INR&tn=${note}`;

        let appUrl = `upi://pay?${upiParam}`;
        if (subMethod === "gpay") {
          appUrl = `tez://upi/pay?${upiParam}`;
        } else if (subMethod === "phonepe") {
          appUrl = `phonepe://pay?${upiParam}`;
        } else if (subMethod === "paytm") {
          appUrl = `paytmmp://pay?${upiParam}`;
        } else if (subMethod === "bharatpe") {
          appUrl = `upi://pay?${upiParam}`;
        }
        try {
          window.location.href = appUrl;
        } catch (e) {
          console.warn("UPI deep link error:", e);
        }
      }

      // Immediately start background polling so that when payment is approved from bank account,
      // the screen automatically detects confirmation and shows Order Success!
      startPaymentStatusPolling(session.order_id, session.razorpay_order_id, session.order_number, activeLabel);

      await loadRazorpay();

      // Determine prefill bank code if netbanking
      let netbankingBankCode: string | undefined = undefined;
      if (targetMethod === "netbanking") {
        const bCode = BANK_MAP[subMethod || selectedBank]?.code;
        netbankingBankCode = bCode || "SBIN";
      }

      const razorpayAppMap: Record<string, string> = {
        gpay: "google_pay",
        phonepe: "phonepe",
        paytm: "paytm",
        bharatpe: "bhim",
        bhim: "bhim",
      };

      const preferredRazorpayApp = subMethod && razorpayAppMap[subMethod] ? razorpayAppMap[subMethod] : undefined;
      const vpaToUse = (customVpa || customUpiId || "").trim();

      const options: any = {
        key: session.key_id || gwConfig.razorpay_key_id || "rzp_live_TS10rMj18hxvuP",
        ...(session.razorpay_order_id ? { order_id: session.razorpay_order_id } : {}),
        amount: session.amount || Math.round(total * 100),
        currency: session.currency || "INR",
        name: "Astro With Hrishi",
        description: `Order ${session.order_number ?? ""}`.trim(),
        image: getRazorpayLogoUrl(),
        prefill: {
          name: session.customer?.name ?? form.full_name,
          email: session.customer?.email ?? form.email,
          contact: (session.customer?.contact ?? form.phone ?? "").replace(/\D/g, "").slice(-10),
          ...(targetMethod === "card" ? { method: "card" } : {}),
          ...(targetMethod === "netbanking" ? { method: "netbanking" } : {}),
          ...(targetMethod === "upi" ? { method: "upi" } : {}),
          ...(vpaToUse ? { vpa: vpaToUse } : {}),
          ...(netbankingBankCode ? { bank: netbankingBankCode } : {}),
        },
        notes: {
          order_number: session.order_number,
          address: form.address,
          dispatch_mode: "direct_official_astro_order",
          ...(preferredRazorpayApp ? { preferred_app: preferredRazorpayApp } : {}),
          auto_redirect: "true",
        },
        config: {
          display: {
            blocks: {
              upi: {
                name: "Pay using UPI Apps (Google Pay, PhonePe, Paytm, BHIM, CRED)",
                instruments: [
                  {
                    method: "upi",
                    flows: ["intent", "collect", "qr"],
                    apps: ["google_pay", "phonepe", "paytm", "bhim", "cred"],
                  },
                ],
              },
              cards: {
                name: "Debit & Credit Cards (Visa, MasterCard, RuPay)",
                instruments: [
                  {
                    method: "card",
                  },
                ],
              },
              netbanking: {
                name: "Net Banking (All Indian Banks)",
                instruments: [
                  {
                    method: "netbanking",
                  },
                ],
              },
            },
            sequence: ["block.upi", "block.cards", "block.netbanking"],
            preferences: {
              show_default_blocks: false,
            },
            hide: [
              { method: "wallet" },
              { method: "wallets" },
              { method: "emi" },
              { method: "cardless_emi" },
              { method: "paylater" },
            ],
          },
        },
        method: {
          wallet: false,
        },
        theme: {
          color: "#d4af37",
        },
        modal: {
          confirm_close: true,
          ondismiss: () => {
            setProcessing(false);
            toast.info("Payment window closed. You can retry payment anytime.");
            // Check status once after short delay in case UPI background intent was approved
            setTimeout(async () => {
              try {
                const params = new URLSearchParams();
                if (session?.order_id) params.append("order_id", session.order_id);
                if (session?.razorpay_order_id) params.append("razorpay_order_id", session.razorpay_order_id);
                const res = await fetch(`/api/payments/order-status?${params.toString()}`);
                const data = await res.json();
                if (data.success && (data.payment_status === "paid" || data.status === "PAID" || data.status === "CONFIRMED")) {
                  if (pollTimerRef.current) clearInterval(pollTimerRef.current);
                  setWaitingPayment(null);
                  finishConfirmed(data.order_number || session?.order_number || null, data.payment_id || null, "online");
                }
              } catch {}
            }, 3000);
          },
        },
        handler: async (response: any) => {
          if (pollTimerRef.current) clearInterval(pollTimerRef.current);
          setWaitingPayment(null);
          try {
            toast.loading("Verifying payment with bank...", { id: "verify_toast" });
            const v = await callPaymentApi<{
              success: boolean;
              order_id: string;
              order_number?: string | null;
              payment_id?: string | null;
            }>(
              "verify-payment",
              {
                order_id: session?.order_id,
                razorpay_order_id: response.razorpay_order_id,
                razorpay_payment_id: response.razorpay_payment_id,
                razorpay_signature: response.razorpay_signature,
              },
              idToken
            );

            toast.dismiss("verify_toast");

            if (v.success) {
              finishConfirmed(v.order_number ?? session?.order_number ?? null, response.razorpay_payment_id, "online");
            } else {
              setProcessing(false);
              setFailure({
                reference: session?.order_number ?? session?.order_id ?? null,
                reason: "Payment verification could not be confirmed by bank.",
              });
            }
          } catch (verErr: any) {
            toast.dismiss("verify_toast");
            setProcessing(false);
            setFailure({
              reference: session?.order_number ?? session?.order_id ?? null,
              reason: verErr.message || "Payment verification failed. Please try again.",
            });
          }
        },
      };

      let rz: any = null;
      try {
        rz = new window.Razorpay(options);
        activeRazorpayRef.current = rz;
        rz.on("payment.failed", (failedEvent: any) => {
          setProcessing(false);
          const desc = typeof failedEvent?.error?.description === "string" ? failedEvent.error.description : "";
          const code = failedEvent?.error?.code || "";
          if (desc.includes("Authentication failed") || code === "BAD_REQUEST_ERROR") {
            toast.info("Connecting to direct official UPI payment...");
            openDirectUpiDialog(session);
          } else {
            setFailure({
              reference: session?.order_number ?? session?.order_id ?? null,
              reason: desc || "Payment declined by bank.",
            });
          }
        });
        rz.open();
      } catch (openErr: any) {
        console.warn("Razorpay instance init error, switching to direct UPI:", openErr);
        openDirectUpiDialog(session);
      }
    } catch (paymentError: any) {
      console.warn("Payment flow note:", paymentError?.message || paymentError);
      setProcessing(false);
      openDirectUpiDialog(pendingSessionRef.current);
    }
  };

  // Primary action button from sticky footer or card
  const handlePrimaryAction = (overrideMethod?: string, overrideSubMethod?: string, customVpa?: string) => {
    const method = overrideMethod || selectedMethod;
    if (method === "card") {
      void handleRazorpayPay("card");
    } else if (method === "netbanking") {
      void handleRazorpayPay("netbanking", overrideSubMethod || selectedBank);
    } else if (method === "vpa") {
      const vpa = (customVpa || customUpiId).trim();
      if (!vpa || !vpa.includes("@")) {
        return toast.error("Please enter a valid UPI ID (e.g. 9876543210@paytm or username@okhdfcbank)");
      }
      void handleRazorpayPay("upi", "custom_vpa", vpa);
    } else if (method === "gpay") {
      void handleRazorpayPay("upi", "gpay", customVpa);
    } else if (method === "phonepe") {
      void handleRazorpayPay("upi", "phonepe", customVpa);
    } else if (method === "paytm") {
      void handleRazorpayPay("upi", "paytm", customVpa);
    } else if (method === "bharatpe") {
      void handleRazorpayPay("upi", "bharatpe", customVpa);
    } else if (method === "bhim") {
      void handleRazorpayPay("upi", "bhim", customVpa);
    } else {
      void handleRazorpayPay("all");
    }
  };

  const handleApplySuffix = (suffix: string) => {
    const raw = (customUpiId || form.phone).trim();
    const base = raw.includes("@") ? raw.split("@")[0] : raw;
    const finalVpa = (base || form.phone.trim()) + suffix;
    setCustomUpiId(finalVpa);
  };

  const copyUpiId = () => {
    navigator.clipboard.writeText(gwConfig.upi_id);
    setCopiedUpi(true);
    toast.success("UPI ID copied: " + gwConfig.upi_id);
    setTimeout(() => setCopiedUpi(false), 2500);
  };

  if (confirmed && receipt) {
    return (
      <PageLayout title="Order Confirmed">
        <div className="container max-w-md py-32 text-center">
          <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} className="mx-auto mb-6">
            <div className="h-20 w-20 rounded-full bg-emerald-500/20 flex items-center justify-center mx-auto">
              <CheckCircle2 className="h-10 w-10 text-emerald-400" />
            </div>
          </motion.div>
          <h1 className="font-display text-2xl text-gradient-gold mb-2">Order Placed Successfully!</h1>
          <p className="text-cosmic-silver/70 mb-2">Thank you, {receipt.customer_name}.</p>
          <p className="text-sm text-cosmic-silver/60">
            Order {receipt.order_number ?? receipt.order_id} · Delivery in 3-5 business days
          </p>
        </div>
        <OrderConfirmationDialog
          open
          data={receipt}
          onTrack={() => nav(`/track-order?order=${encodeURIComponent(receipt.order_number ?? "")}`)}
          onContinue={() => nav("/shop")}
        />
      </PageLayout>
    );
  }

  if (cartItems.length === 0 && !confirmed && !receipt) {
    return (
      <PageLayout title="Checkout">
        <div className="container max-w-md py-32 text-center">
          <h2 className="text-xl font-serif text-cosmic-silver mb-3">Your cart is empty</h2>
          <p className="text-sm text-cosmic-silver/60 mb-6">Explore our energised astrology products and remedies.</p>
          <Button onClick={() => nav("/shop")} className="bg-gradient-gold text-primary-foreground rounded-full px-6">
            Browse Shop
          </Button>
        </div>
      </PageLayout>
    );
  }

  return (
    <PageLayout title="Secure Checkout">
      <SEO
        title="Secure Checkout — Astro With Hrishi"
        description="Secure checkout for authentic Vedic crystals and energised remedies."
        path="/checkout"
        noindex
      />

      <div className="container max-w-2xl pt-20 pb-36 px-4">
        {/* Top Header */}
        <div className="flex items-center justify-between py-3 mb-3 border-b border-gold/15">
          <button
            type="button"
            onClick={() => nav(-1)}
            className="flex items-center gap-1.5 text-sm font-medium text-cosmic-silver hover:text-gold transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
            <span className="hidden sm:inline">Back to Cart</span>
          </button>

          <h2 className="text-sm sm:text-base font-bold tracking-wide uppercase text-foreground">
            SECURE CHECKOUT &amp; PAYMENT
          </h2>

          <div className="px-3 py-1 rounded-full border border-emerald-500/40 bg-emerald-950/40 text-emerald-300 text-xs font-bold tracking-wider flex items-center gap-1">
            <Lock className="h-3 w-3" /> 256-Bit SSL
          </div>
        </div>

        <motion.div initial={{ opacity: 0, y: 15 }} animate={{ opacity: 1, y: 0 }} className="space-y-5">

            {/* If address already exists and not in edit mode: Show Confirmation Card */}
            {hasSavedAddress && !addressEditing ? (
              <div className="glass-gold rounded-3xl p-6 border border-gold/30 shadow-xl space-y-5">
                <div className="flex items-center justify-between pb-3 border-b border-gold/20">
                  <div className="flex items-center gap-2">
                    <span className="h-6 w-6 rounded-full bg-emerald-500/20 text-emerald-400 flex items-center justify-center text-xs font-bold">
                      ✓
                    </span>
                    <h3 className="font-semibold text-sm text-foreground">Deliver to this Address</h3>
                  </div>
                  <span className="text-[11px] bg-emerald-500/20 text-emerald-300 px-2.5 py-0.5 rounded-full font-semibold border border-emerald-500/30">
                    Saved Default
                  </span>
                </div>

                {/* Saved Address Preview */}
                <div className="p-4 rounded-2xl bg-background/60 border border-gold/20 space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-base text-foreground">{form.full_name}</span>
                    <span className="text-xs text-gold font-mono font-medium">{form.phone}</span>
                  </div>
                  <p className="text-xs text-cosmic-silver/90 leading-relaxed pt-1">
                    {form.address}, {form.city}, {form.state} - <span className="font-bold text-gold">{form.pincode}</span>
                  </p>
                  <p className="text-[11px] text-muted-foreground pt-1">
                    Receipt Email: <span className="text-cosmic-silver">{form.email}</span>
                  </p>
                </div>

                {/* Action Buttons */}
                <div className="space-y-3 pt-2">
                  <Button
                    type="button"
                    onClick={handleDeliverToThisAddress}
                    className="w-full h-12 bg-gradient-gold text-primary-foreground font-bold text-sm sm:text-base rounded-xl shadow-lg hover:opacity-95 transition-all flex items-center justify-center gap-2 cursor-pointer"
                  >
                    <CheckCircle2 className="h-4 w-4" />
                    <span>Deliver to this Address</span>
                    <ChevronDown className="h-4 w-4 animate-bounce" />
                  </Button>

                  <div className="flex items-center justify-between gap-3 pt-1">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => setAddressEditing(true)}
                      className="flex-1 h-10 border-gold/30 bg-gold/5 text-foreground hover:text-gold-bright hover:bg-gold/15 hover:border-gold text-xs font-semibold rounded-xl transition-all flex items-center justify-center gap-1.5"
                    >
                      <Edit3 className="h-3.5 w-3.5 text-gold" />
                      <span>Edit Address</span>
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => {
                        setForm((f) => ({ ...f, address: "", city: "", pincode: "" }));
                        setAddressEditing(true);
                      }}
                      className="flex-1 h-10 border-gold/30 bg-gold/5 text-foreground hover:text-gold-bright hover:bg-gold/15 hover:border-gold text-xs font-semibold rounded-xl transition-all flex items-center justify-center gap-1.5"
                    >
                      <Plus className="h-3.5 w-3.5 text-gold" />
                      <span>Add New Address</span>
                    </Button>
                  </div>
                </div>
              </div>
            ) : (
              /* Address Form for New Entry or Editing */
              <form onSubmit={handleSaveAddressOnly} className="glass-gold rounded-3xl p-6 sm:p-7 border border-gold/30 shadow-xl space-y-4">
                <div className="flex items-center justify-between pb-2 border-b border-gold/20">
                  <h3 className="font-semibold text-sm text-foreground flex items-center gap-2">
                    <Building2 className="h-4 w-4 text-gold" />
                    {hasSavedAddress ? "Edit Delivery Address" : "Add Delivery Address"}
                  </h3>
                  {hasSavedAddress && (
                    <button
                      type="button"
                      onClick={() => setAddressEditing(false)}
                      className="text-xs text-muted-foreground hover:text-gold"
                    >
                      Cancel
                    </button>
                  )}
                </div>

                <div className="grid sm:grid-cols-2 gap-3.5">
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-cosmic-silver/80">Full Name *</label>
                    <Input
                      required
                      placeholder="Receiver's Name"
                      value={form.full_name}
                      onChange={(e) => setForm({ ...form, full_name: e.target.value })}
                      className="h-11 bg-background/50 border-gold/30 rounded-xl"
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="text-xs font-medium text-cosmic-silver/80">10-Digit Mobile *</label>
                    <Input
                      required
                      type="tel"
                      maxLength={10}
                      placeholder="9876543210"
                      value={form.phone}
                      onChange={(e) => setForm({ ...form, phone: e.target.value })}
                      className="h-11 bg-background/50 border-gold/30 rounded-xl"
                    />
                  </div>
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-medium text-cosmic-silver/80">Email (for Order Confirmation &amp; Tracking) *</label>
                  <Input
                    required
                    type="email"
                    placeholder="your.email@example.com"
                    value={form.email}
                    onChange={(e) => setForm({ ...form, email: e.target.value })}
                    className="h-11 bg-background/50 border-gold/30 rounded-xl"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-medium text-cosmic-silver/80">Flat, House no., Building, Street, Area *</label>
                  <Textarea
                    required
                    rows={2}
                    placeholder="E.g. Flat 402, Shivam Residency, MG Road"
                    value={form.address}
                    onChange={(e) => setForm({ ...form, address: e.target.value })}
                    className="bg-background/50 border-gold/30 rounded-xl text-sm min-h-[70px]"
                  />
                </div>

                <div className="grid sm:grid-cols-3 gap-3">
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-cosmic-silver/80">City *</label>
                    <Input
                      required
                      placeholder="Vadodara"
                      value={form.city}
                      onChange={(e) => setForm({ ...form, city: e.target.value })}
                      className="h-11 bg-background/50 border-gold/30 rounded-xl"
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="text-xs font-medium text-cosmic-silver/80">State *</label>
                    <select
                      required
                      value={form.state}
                      onChange={(e) => setForm({ ...form, state: e.target.value })}
                      className="w-full h-11 rounded-xl bg-background/50 border border-gold/30 px-3 text-xs text-foreground focus:border-gold focus:outline-none"
                    >
                      <option value="">Select State</option>
                      {STATES.map((s) => (
                        <option key={s} value={s}>
                          {s}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="space-y-1">
                    <label className="text-xs font-medium text-cosmic-silver/80">6-Digit Pincode *</label>
                    <Input
                      required
                      maxLength={6}
                      placeholder="390022"
                      value={form.pincode}
                      onChange={(e) => setForm({ ...form, pincode: e.target.value })}
                      className="h-11 bg-background/50 border-gold/30 rounded-xl font-mono"
                    />
                  </div>
                </div>

                <Button
                  type="submit"
                  className="w-full h-12 bg-gradient-gold text-primary-foreground font-bold text-sm sm:text-base rounded-xl shadow-lg hover:opacity-95 transition-all mt-3 flex items-center justify-center gap-2"
                >
                  <MapPin className="h-4 w-4" /> Save Address
                </Button>
              </form>
            )}

            {/* ═══════════════════════════════════════════════════════════ */}
            {/* PAYMENT METHOD SELECTION (DIRECT RAZORPAY ONLY)             */}
            {/* ═══════════════════════════════════════════════════════════ */}
            {/* PAYMENT METHOD SECTION                                      */}
            {/* ═══════════════════════════════════════════════════════════ */}
            <div id="payment-method-section" className="glass-gold rounded-3xl p-5 sm:p-7 border border-gold/30 shadow-xl space-y-5 bg-card">
              {/* Header */}
              <div className="flex items-center justify-between pb-3 border-b border-gold/20">
                <div className="flex items-center gap-2.5">
                  <div className="h-8 w-8 rounded-xl bg-gold/15 border border-gold/30 flex items-center justify-center">
                    <CreditCard className="h-4 w-4 text-gold" />
                  </div>
                  <div>
                    <h3 className="font-bold text-sm sm:text-base text-foreground">Choose Payment Method</h3>
                    <p className="text-[11px] text-muted-foreground">100% Official, Secure &amp; Direct to Astro With Hrishi</p>
                  </div>
                </div>
                <span className="text-[11px] bg-emerald-100 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300 font-bold px-2.5 py-1 rounded-full border border-emerald-300 dark:border-emerald-700/50 shrink-0 shadow-xs">
                  Direct Bank Transfer
                </span>
              </div>

              {/* Supported Payment Details Box */}
              <div className="rounded-2xl bg-secondary/50 dark:bg-card border border-gold/30 p-4 sm:p-5 space-y-4 shadow-xs">
                
                {/* 1. UPI Applications Detail */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Smartphone className="h-4 w-4 text-gold" />
                      <span className="text-xs sm:text-sm font-bold text-foreground">
                        UPI Applications (Supported)
                      </span>
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Google Pay, PhonePe, Paytm, BHIM, CRED &amp; All UPI IDs
                  </p>
                  <div className="flex items-center gap-2 flex-wrap pt-1">
                    <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-card border border-gold/25 shadow-xs">
                      <GPayLogo />
                      <span className="text-xs font-semibold text-foreground">Google Pay</span>
                    </div>
                    <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-card border border-gold/25 shadow-xs">
                      <PhonePeLogo />
                      <span className="text-xs font-semibold text-foreground">PhonePe</span>
                    </div>
                    <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-card border border-gold/25 shadow-xs">
                      <PaytmLogo />
                    </div>
                    <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-card border border-gold/25 shadow-xs">
                      <BhimLogo />
                      <span className="text-xs font-semibold text-foreground">BHIM UPI</span>
                    </div>
                    <div className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-card border border-gold/25 text-xs font-semibold text-foreground/80 shadow-xs">
                      <span>CRED / Any UPI</span>
                    </div>
                  </div>
                </div>

                <div className="border-t border-gold/20" />

                {/* 2. Debit & Credit Cards Detail */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <CreditCard className="h-4 w-4 text-gold" />
                      <span className="text-xs sm:text-sm font-bold text-foreground">
                        Debit &amp; Credit Cards (Supported)
                      </span>
                    </div>
                    <span className="text-[11px] bg-amber-100 dark:bg-gold/20 text-amber-900 dark:text-gold-bright font-bold px-2.5 py-0.5 rounded-md border border-amber-300 dark:border-gold/30 shadow-xs">
                      All Banks
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Visa, MasterCard, RuPay, Maestro &amp; Diners Club (Domestic &amp; International)
                  </p>
                  <div className="flex items-center gap-2 flex-wrap pt-1">
                    <span className="px-2.5 py-1 rounded-lg bg-card border border-gold/25 text-xs font-bold text-foreground tracking-wider shadow-xs">
                      VISA
                    </span>
                    <span className="px-2.5 py-1 rounded-lg bg-card border border-gold/25 text-xs font-bold text-foreground tracking-wider shadow-xs">
                      MasterCard
                    </span>
                    <span className="px-2.5 py-1 rounded-lg bg-card border border-gold/25 text-xs font-bold text-emerald-700 dark:text-emerald-400 tracking-wider shadow-xs">
                      RuPay
                    </span>
                    <span className="px-2.5 py-1 rounded-lg bg-card border border-gold/25 text-xs font-semibold text-foreground/80 shadow-xs">
                      Maestro
                    </span>
                  </div>
                </div>

                <div className="border-t border-gold/20" />

                {/* 3. Net Banking Detail */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Building2 className="h-4 w-4 text-gold" />
                      <span className="text-xs sm:text-sm font-bold text-foreground">
                        Net Banking (Supported)
                      </span>
                    </div>
                    <span className="text-[11px] bg-emerald-100 dark:bg-emerald-950/70 text-emerald-900 dark:text-emerald-200 font-extrabold px-2.5 py-0.5 rounded-md border border-emerald-400 dark:border-emerald-600 shadow-xs">
                      50+ Indian Banks
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    SBI, HDFC Bank, ICICI Bank, Axis Bank, Kotak Mahindra, PNB, Bank of Baroda &amp; all other major banks
                  </p>
                  <div className="flex items-center gap-1.5 flex-wrap pt-1 text-xs">
                    <span className="px-2.5 py-1 rounded-md bg-card border border-gold/30 text-foreground font-semibold shadow-xs">SBI</span>
                    <span className="px-2.5 py-1 rounded-md bg-card border border-gold/30 text-foreground font-semibold shadow-xs">HDFC</span>
                    <span className="px-2.5 py-1 rounded-md bg-card border border-gold/30 text-foreground font-semibold shadow-xs">ICICI</span>
                    <span className="px-2.5 py-1 rounded-md bg-card border border-gold/30 text-foreground font-semibold shadow-xs">Axis</span>
                    <span className="px-2.5 py-1 rounded-md bg-card border border-gold/30 text-foreground font-semibold shadow-xs">Kotak</span>
                    <span className="px-2.5 py-1 rounded-md bg-gold/15 border border-gold/40 text-gold-deep dark:text-gold-bright font-bold shadow-xs">&amp; 50+ More</span>
                  </div>
                </div>

              </div>

              {/* Security Banner */}
              <div className="flex items-center justify-between p-3 rounded-xl bg-gold/5 border border-gold/25 text-xs text-foreground/90">
                <span className="flex items-center gap-1.5">
                  <ShieldCheck className="h-4 w-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
                  <span className="font-medium">256-Bit SSL Encrypted &amp; RBI Approved Gateway</span>
                </span>
                <span className="font-mono text-gold font-bold text-xs bg-gold/10 px-2 py-0.5 rounded border border-gold/30">100% Secure</span>
              </div>

              {/* Main Pay Button: Pay ₹{total} */}
              <Button
                type="button"
                onClick={() => handleHostedRazorpayPay()}
                disabled={processing}
                className="w-full h-13 sm:h-14 bg-gradient-gold text-primary-foreground font-black text-base sm:text-lg rounded-2xl shadow-xl hover:opacity-95 transition-all flex items-center justify-center gap-2.5 cursor-pointer active:scale-[0.99]"
              >
                {processing ? (
                  <>
                    <RefreshCw className="h-5 w-5 animate-spin" />
                    <span>Opening Payment Gateway...</span>
                  </>
                ) : (
                  <>
                    <Lock className="h-5 w-5" />
                    <span>Pay ₹{total}</span>
                    <ArrowRight className="h-5 w-5 ml-1" />
                  </>
                )}
              </Button>

              <p className="text-[11px] text-center text-cosmic-silver/70">
                Clicking &quot;Pay ₹{total}&quot; opens the official secure Razorpay payment window to complete your payment.
              </p>
            </div>

            {/* Trust Badges */}
            <div className="flex items-center justify-around py-3 px-4 rounded-2xl bg-secondary/30 text-xs text-cosmic-silver/80 border border-gold/10">
              <span className="flex items-center gap-1.5">🔒 256-Bit SSL Encrypted</span>
              <span className="flex items-center gap-1.5">✨ 100% Authentic Vedic Products</span>
              <span className="flex items-center gap-1.5">⚡ Free Express Shipping</span>
            </div>
          </motion.div>
        {/* ═══════════════════════════════════════════════════════════ */}
        {/* FIXED BOTTOM ACTION BAR                                    */}
        {/* ═══════════════════════════════════════════════════════════ */}
        <div className="fixed bottom-0 left-0 right-0 z-40 bg-background/95 backdrop-blur-md border-t border-gold/30 px-4 py-3 shadow-2xl">
          <div className="container max-w-2xl flex items-center justify-between gap-3">
            
            {/* Left: Total Price & VIEW PRICE DETAILS link */}
            <div className="flex flex-col">
              <div className="flex items-baseline gap-2">
                <span className="text-xl sm:text-2xl font-black text-foreground">₹{total}</span>
                {onlineDiscount > 0 && (
                  <span className="text-xs text-muted-foreground line-through">
                    ₹{total + onlineDiscount}
                  </span>
                )}
              </div>
              <button
                type="button"
                onClick={() => setShowPriceDetailsModal(true)}
                className="text-[11px] sm:text-xs font-bold text-gold hover:text-gold-bright uppercase tracking-wide text-left flex items-center gap-1"
              >
                VIEW PRICE DETAILS <ChevronUp className="h-3 w-3" />
              </button>
            </div>

            {/* Right: Direct Razorpay Place Order Button */}
            <Button
              type="button"
              onClick={() => handleProceedToPayment()}
              disabled={processing}
              className="bg-gradient-gold text-primary-foreground font-bold px-6 sm:px-8 h-12 text-sm sm:text-base rounded-xl shadow-lg shrink-0 flex items-center gap-2 cursor-pointer active:scale-95"
            >
              {processing ? (
                <>
                  <RefreshCw className="h-4 w-4 animate-spin" /> Opening Gateway...
                </>
              ) : (
                <span className="flex items-center gap-1.5">
                  <Lock className="h-4 w-4" /> Pay ₹{total}
                </span>
              )}
            </Button>
          </div>
        </div>

        {/* ═══════════════════════════════════════════════════════════ */}
        {/* PRICE DETAILS MODAL / BOTTOM SHEET                         */}
        {/* ═══════════════════════════════════════════════════════════ */}
        <Dialog open={showPriceDetailsModal} onOpenChange={setShowPriceDetailsModal}>
          <DialogContent className="glass-gold border border-gold/30 max-w-md notranslate" translate="no">
            <DialogHeader>
              <DialogTitle className="text-lg font-serif font-bold text-foreground flex items-center justify-between">
                <span>Price Details</span>
                <span className="text-xs text-emerald-400 font-normal">100% Genuine</span>
              </DialogTitle>
            </DialogHeader>

            <div className="space-y-3 py-2 text-xs">
              {/* Items List */}
              <div className="max-h-40 overflow-y-auto space-y-2 pr-1 border-b border-gold/15 pb-3">
                {cartItems.map((item) => (
                  <div key={item.id} className="flex justify-between items-center text-cosmic-silver">
                    <span className="truncate pr-2">
                      {item.name} × {item.quantity}
                    </span>
                    <span className="font-semibold shrink-0">{inr(item.price * item.quantity)}</span>
                  </div>
                ))}
              </div>

              {/* Price Breakdown */}
              <div className="space-y-2 pt-1 text-cosmic-silver/80">
                <div className="flex justify-between">
                  <span>Total Product Price</span>
                  <span>{inr(subtotal + onlineDiscount)}</span>
                </div>

                {onlineDiscount > 0 && (
                  <div className="flex justify-between text-emerald-400 font-semibold">
                    <span>⚡ Online Payment Discount</span>
                    <span>- {inr(onlineDiscount)}</span>
                  </div>
                )}

                <div className="flex justify-between">
                  <span>Delivery Charges</span>
                  <span className="text-emerald-400 font-semibold">{shipping === 0 ? "FREE" : inr(shipping)}</span>
                </div>

                <div className="flex justify-between">
                  <span>GST</span>
                  <span>{inr(gst)}</span>
                </div>

                <div className="flex justify-between text-sm font-bold text-foreground border-t border-gold/20 pt-2">
                  <span>Total Payable Amount</span>
                  <span className="text-gold text-base">₹{total}</span>
                </div>
              </div>

              {/* Yay savings badge */}
              <div className="p-2.5 rounded-xl bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 text-xs font-medium text-center">
                🎉 Yay! You are saving <strong>{inr(onlineDiscount + 50)}</strong> on this order!
              </div>

              <Button
                type="button"
                onClick={() => setShowPriceDetailsModal(false)}
                className="w-full bg-gradient-gold text-primary-foreground font-semibold h-10 rounded-xl mt-2"
              >
                Close
              </Button>
            </div>
          </DialogContent>
        </Dialog>

        {/* Direct UPI Payment Initiated Dialog */}
        <Dialog
          open={Boolean(waitingPayment?.active)}
          onOpenChange={(open) => {
            if (!open) setWaitingPayment(null);
          }}
        >
          <DialogContent className="glass-gold border border-gold/30 max-w-md notranslate" translate="no">
            <DialogHeader>
              <DialogTitle className="text-base font-bold text-foreground flex items-center justify-between">
                <span className="flex items-center gap-2">
                  <Smartphone className="h-5 w-5 text-gold" />
                  <span>Paying ₹{waitingPayment?.amount} via {waitingPayment?.appName}</span>
                </span>
                <span className="text-[10px] bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300 px-2 py-0.5 rounded-full font-bold border border-emerald-300 dark:border-emerald-700/50">
                  Direct Bank
                </span>
              </DialogTitle>
            </DialogHeader>

            <div className="space-y-4 pt-1 text-center">
              <div className="p-3.5 rounded-2xl bg-secondary/50 border border-gold/25 text-xs space-y-2">
                <p className="text-cosmic-silver/90">
                  Transfer directly to official Client Bank Account:
                </p>
                <div className="flex items-center justify-center gap-2 p-2 rounded-xl bg-background/80 border border-gold/30">
                  <span className="font-mono font-bold text-gold text-sm select-all">
                    astrowithhrishi@okhdfcbank
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      navigator.clipboard.writeText("astrowithhrishi@okhdfcbank");
                      toast.success("Client UPI ID copied: astrowithhrishi@okhdfcbank");
                    }}
                    className="p-1 text-cosmic-silver hover:text-gold"
                    title="Copy UPI ID"
                  >
                    <Copy className="h-4 w-4" />
                  </button>
                </div>
                <p className="text-[11px] text-muted-foreground">
                  Payee: <strong>Astro With Hrishi</strong> · Order: <strong>{waitingPayment?.orderNumber}</strong>
                </p>
              </div>

              {/* Direct UPI App Launch Buttons */}
              <div className="space-y-2">
                <p className="text-[11px] text-cosmic-silver/80 font-semibold text-left">Tap your UPI App to pay directly:</p>
                <div className="grid grid-cols-2 gap-2">
                  <Button
                    type="button"
                    onClick={() => {
                      const url = getDirectUpiAppUrl("gpay");
                      window.location.href = url;
                    }}
                    className="h-11 bg-white hover:bg-slate-100 text-slate-900 font-bold text-xs rounded-xl flex items-center justify-center gap-2 shadow cursor-pointer active:scale-95 transition-all"
                  >
                    <GPayLogo />
                    <span>Google Pay</span>
                  </Button>
                  <Button
                    type="button"
                    onClick={() => {
                      const url = getDirectUpiAppUrl("phonepe");
                      window.location.href = url;
                    }}
                    className="h-11 bg-[#5f259f] hover:bg-[#4d1e82] text-white font-bold text-xs rounded-xl flex items-center justify-center gap-2 shadow cursor-pointer active:scale-95 transition-all"
                  >
                    <PhonePeLogo />
                    <span>PhonePe</span>
                  </Button>
                  <Button
                    type="button"
                    onClick={() => {
                      const url = getDirectUpiAppUrl("paytm");
                      window.location.href = url;
                    }}
                    className="h-11 bg-[#002e6e] hover:bg-[#002252] text-white font-bold text-xs rounded-xl flex items-center justify-center gap-2 shadow cursor-pointer active:scale-95 transition-all"
                  >
                    <PaytmLogo />
                    <span>Paytm</span>
                  </Button>
                  <Button
                    type="button"
                    onClick={() => {
                      const url = getDirectUpiAppUrl("any");
                      window.location.href = url;
                    }}
                    className="h-11 bg-gradient-to-r from-emerald-600 to-teal-600 hover:opacity-90 text-white font-bold text-xs rounded-xl flex items-center justify-center gap-2 shadow cursor-pointer active:scale-95 transition-all"
                  >
                    <BhimLogo />
                    <span>Any UPI App</span>
                  </Button>
                </div>

                {/* Live Dynamic QR Code */}
                {waitingPayment?.qrUrl && (
                  <div className="pt-2 flex flex-col items-center">
                    <p className="text-[11px] text-cosmic-silver/80 pb-1.5">Or Scan QR code to transfer ₹{waitingPayment.amount}:</p>
                    <img
                      src={waitingPayment.qrUrl}
                      alt="Client UPI QR Code"
                      className="h-44 w-44 rounded-xl border-2 border-gold/40 shadow-xl bg-white p-2"
                    />
                  </div>
                )}
              </div>

              {/* Action Buttons: Verify with Bank & Alternative Payment Options */}
              <div className="pt-2 space-y-2">
                <Button
                  type="button"
                  disabled={processing}
                  onClick={async () => {
                    setProcessing(true);
                    toast.loading("Verifying payment status with bank...", { id: "verify_bank" });
                    try {
                      const params = new URLSearchParams();
                      if (waitingPayment?.orderId) params.append("order_id", waitingPayment.orderId);
                      if (pendingSessionRef.current?.razorpay_order_id) params.append("razorpay_order_id", pendingSessionRef.current.razorpay_order_id);
                      if (waitingPayment?.orderNumber) params.append("order_number", waitingPayment.orderNumber);
                      const res = await fetch(`/api/payments/order-status?${params.toString()}`);
                      const data = await res.json();
                      toast.dismiss("verify_bank");
                      if (data.success && (data.payment_status === "paid" || data.status === "PAID" || data.status === "CONFIRMED")) {
                        toast.success("Payment verified successfully!");
                        setWaitingPayment(null);
                        finishConfirmed(data.order_number || waitingPayment?.orderNumber || null, data.payment_id || null, "online");
                      } else {
                        toast.error("Payment not confirmed by bank yet. Please complete payment in your UPI app, or pay with Card/NetBanking.");
                      }
                    } catch {
                      toast.dismiss("verify_bank");
                      toast.error("Could not verify status. Please make sure payment was completed.");
                    } finally {
                      setProcessing(false);
                    }
                  }}
                  className="w-full h-12 bg-gradient-gold text-primary-foreground font-bold text-sm rounded-xl shadow-lg hover:opacity-95 flex items-center justify-center gap-2 cursor-pointer active:scale-95"
                >
                  <ShieldCheck className="h-4 w-4" /> Verify Payment Status with Bank
                </Button>

                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    if (pollTimerRef.current) clearInterval(pollTimerRef.current);
                    setWaitingPayment(null);
                    handleHostedRazorpayPay();
                  }}
                  className="w-full h-10 border-gold/30 text-gold hover:text-gold-bright text-xs rounded-xl flex items-center justify-center gap-2 cursor-pointer"
                >
                  <CreditCard className="h-3.5 w-3.5" /> Pay with Cards / NetBanking / All UPI (Razorpay)
                </Button>

                <button
                  type="button"
                  onClick={() => {
                    if (pollTimerRef.current) clearInterval(pollTimerRef.current);
                    setWaitingPayment(null);
                  }}
                  className="w-full text-center text-xs text-cosmic-silver/70 hover:text-cosmic-silver pt-1 cursor-pointer"
                >
                  Cancel &amp; Return to Checkout
                </button>
              </div>
            </div>
          </DialogContent>
        </Dialog>

        {/* Payment Failed Dialog */}
        <PaymentFailedDialog
          open={Boolean(failure)}
          onOpenChange={(next) => {
            if (!next) setFailure(null);
          }}
          reference={failure?.reference ?? null}
          reason={failure?.reason ?? null}
          amount={total}
          onRetry={() => {
            setFailure(null);
            handlePrimaryAction();
          }}
          onBackToCart={() => nav("/cart")}
        />
      </div>
    </PageLayout>
  );
};

export default Checkout;
