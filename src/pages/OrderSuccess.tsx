import { useEffect, useState, useCallback } from "react";
import { useNavigate, useSearchParams, useLocation } from "react-router-dom";
import { motion } from "framer-motion";
import {
  CheckCircle2,
  ShoppingBag,
  Download,
  Printer,
  Truck,
  MessageCircle,
  CreditCard,
  MapPin,
  Sparkles,
  ArrowRight,
  ShieldCheck,
  Upload,
  X,
  Camera,
  AlertTriangle,
  Clock,
  RefreshCw,
} from "lucide-react";
import PageLayout from "@/components/PageLayout";
import SEO from "@/components/SEO";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { inr, deliveryEstimate } from "@/lib/shop";
import { downloadReceipt, printReceipt, type ReceiptData } from "@/lib/receipt";
import { doc, getDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { WHATSAPP_NUMBER } from "@/lib/whatsapp";
import { toast } from "sonner";

const OrderSuccess = () => {
  const nav = useNavigate();
  const loc = useLocation();
  const [params] = useSearchParams();
  const orderParam = params.get("order") || params.get("order_number") || params.get("order_id") || "";

  const [screenshotFile, setScreenshotFile] = useState<File | null>(null);
  const [screenshotPreview, setScreenshotPreview] = useState<string | null>(null);
  const [utrInput, setUtrInput] = useState("");
  const [checkingBank, setCheckingBank] = useState(false);

  const handleScreenshotChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (file.size > 10 * 1024 * 1024) {
        toast.error("Please select an image smaller than 10MB");
        return;
      }
      setScreenshotFile(file);
      const reader = new FileReader();
      reader.onloadend = () => {
        setScreenshotPreview(reader.result as string);
      };
      reader.readAsDataURL(file);
      toast.success("Payment screenshot attached! Now tap 'Send Screenshot to Owner on WhatsApp' below.");
    }
  };

  const [receipt, setReceipt] = useState<ReceiptData | null>(() => {
    // 1. From location state
    if (loc.state?.receipt) {
      return loc.state.receipt as ReceiptData;
    }
    // 2. From sessionStorage or localStorage (only if verified)
    try {
      const stored = sessionStorage.getItem("last_order_receipt") || localStorage.getItem("last_order_receipt");
      if (stored) {
        const parsed = JSON.parse(stored);
        if (!orderParam || parsed.order_number === orderParam || parsed.order_id === orderParam) {
          const rzpPayId = params.get("razorpay_payment_id");
          const rzpLinkStatus = params.get("razorpay_payment_link_status");
          if (rzpPayId && rzpLinkStatus === "paid") {
            parsed.payment_status = "PAID / CAPTURED";
            parsed.payment_id = rzpPayId;
          }
          return parsed;
        }
      }
    } catch {}
    return null;
  });

  const [loading, setLoading] = useState(false);

  // Function to actively check order payment status from backend API
  const verifyOrderStatusWithServer = useCallback(async (orderIdentifier: string, showToast = false) => {
    if (!orderIdentifier) return;
    if (showToast) setCheckingBank(true);
    try {
      const res = await fetch(`/api/payments/order-status?order_number=${encodeURIComponent(orderIdentifier)}&order_id=${encodeURIComponent(orderIdentifier)}`);
      if (res.ok) {
        const d = await res.json();
        const isPaid = d.payment_status === "paid" || d.status === "PAID" || d.status === "CONFIRMED";

        setReceipt((prev) => {
          const updated: ReceiptData = {
            order_number: d.order_number || prev?.order_number || orderIdentifier,
            order_id: d.id || d.order_id || prev?.order_id || orderIdentifier,
            payment_id: d.payment_id || prev?.payment_id || (isPaid ? "Razorpay / Bank Verified" : null),
            payment_method: d.payment_method || prev?.payment_method || "razorpay",
            payment_status: isPaid ? "PAID / CAPTURED" : "PENDING_PAYMENT",
            paid_at: d.paid_at || prev?.paid_at || new Date().toISOString(),
            customer_name: d.customer_name || prev?.customer_name || "Valued Devotee",
            customer_phone: d.customer_phone || prev?.customer_phone || "",
            customer_email: d.customer_email || prev?.customer_email || "",
            address: d.address || prev?.address || "",
            city: d.city || prev?.city || "",
            state: d.state || prev?.state || "",
            pincode: d.pincode || prev?.pincode || "",
            items: (d.items || prev?.items || []).map((i: any) => ({
              name: i.name,
              image: i.image_url || i.image || "/assets/placeholder.png",
              price: Number(i.price || 0),
              quantity: Number(i.quantity || 1),
              variant: i.variant || null,
            })),
            subtotal: d.subtotal || prev?.subtotal || d.total || 0,
            discount: d.discount || prev?.discount || 0,
            shipping: d.shipping || prev?.shipping || 0,
            gst: d.gst || prev?.gst || 0,
            total: d.total || prev?.total || 0,
          };

          if (isPaid) {
            try {
              sessionStorage.setItem("last_order_receipt", JSON.stringify(updated));
            } catch {}
          } else {
            try {
              sessionStorage.removeItem("last_order_receipt");
            } catch {}
          }
          return updated;
        });

        if (showToast) {
          if (isPaid) {
            toast.success("Payment verified! Your order is confirmed.");
          } else {
            toast.error("Bank payment not confirmed yet. Please complete payment or retry.");
          }
        }
      } else {
        if (showToast) toast.error("Could not verify status with bank. Please try again.");
      }
    } catch (e) {
      console.warn("Status check exception:", e);
      if (showToast) toast.error("Network error while checking status.");
    } finally {
      if (showToast) setCheckingBank(false);
    }
  }, []);

  // On mount or when orderParam changes: fetch live verified status from server or Firestore
  useEffect(() => {
    if (!orderParam) return;

    setLoading(true);
    const fetchOrder = async () => {
      try {
        // 1. Check live status from server endpoint (which checks Razorpay gateway)
        const res = await fetch(`/api/payments/order-status?order_number=${encodeURIComponent(orderParam)}&order_id=${encodeURIComponent(orderParam)}`);
        if (res.ok) {
          const d = await res.json();
          const isPaid = d.payment_status === "paid" || d.status === "PAID" || d.status === "CONFIRMED";
          
          setReceipt({
            order_number: d.order_number || d.id || orderParam,
            order_id: d.id || d.order_number || orderParam,
            payment_id: d.payment_id || (isPaid ? "Razorpay Verified" : null),
            payment_method: d.payment_method || "razorpay",
            payment_status: isPaid ? "PAID / CAPTURED" : "PENDING_PAYMENT",
            paid_at: d.paid_at || d.created_at || new Date().toISOString(),
            customer_name: d.customer_name || "Valued Devotee",
            customer_phone: d.customer_phone || "",
            customer_email: d.customer_email || "",
            address: d.address || "",
            city: d.city || "",
            state: d.state || "",
            pincode: d.pincode || "",
            items: (d.items || []).map((i: any) => ({
              name: i.name,
              image: i.image_url || i.image || "/assets/placeholder.png",
              price: Number(i.price || 0),
              quantity: Number(i.quantity || 1),
              variant: i.variant || null,
            })),
            subtotal: d.subtotal || d.total || 0,
            discount: d.discount || 0,
            shipping: d.shipping || 0,
            gst: d.gst || 0,
            total: d.total || 0,
          });
          return;
        }

        // 2. Fallback to Firestore client
        try {
          const docRef = doc(db, "orders", orderParam);
          const snap = await getDoc(docRef);
          if (snap.exists()) {
            const d = snap.data();
            const isPaid = d.payment_status === "paid" || d.status === "PAID" || d.status === "CONFIRMED";
            setReceipt({
              order_number: d.order_number || d.id,
              order_id: d.id,
              payment_id: d.razorpay_payment_id || d.payment_id || null,
              payment_method: d.payment_method || "razorpay",
              payment_status: isPaid ? "PAID / CAPTURED" : "PENDING_PAYMENT",
              paid_at: d.created_at || new Date().toISOString(),
              customer_name: d.customer_name || "Valued Devotee",
              customer_phone: d.customer_phone || "",
              customer_email: d.customer_email || "",
              address: d.address || "",
              city: d.city || "",
              state: d.state || "",
              pincode: d.pincode || "",
              items: (d.items || []).map((i: any) => ({
                name: i.name,
                image: i.image_url || "/assets/placeholder.png",
                price: i.price,
                quantity: i.quantity,
                variant: i.variant || null,
              })),
              subtotal: d.subtotal || d.total || 0,
              discount: d.discount || 0,
              shipping: d.shipping || 0,
              gst: d.gst || 0,
              total: d.total || 0,
            });
            return;
          }
        } catch {}
      } catch (e) {
        console.warn("Could not fetch order data:", e);
      } finally {
        setLoading(false);
      }
    };

    void fetchOrder();
  }, [orderParam]);

  // Determine whether the payment is strictly verified and received
  const isPaymentVerified = Boolean(
    receipt &&
    (receipt.payment_status === "PAID / CAPTURED" ||
     receipt.payment_status === "paid" ||
     receipt.payment_status === "PAID" ||
     receipt.payment_status === "captured")
  );

  const buildWhatsAppUrl = () => {
    if (!receipt) return `https://wa.me/${WHATSAPP_NUMBER || "919558565655"}`;
    const itemsList = (receipt.items || [])
      .map((i) => `• ${i.name}${i.variant ? ` (${i.variant})` : ""} × ${i.quantity}`)
      .join("\n");
    const msg = `🛒 *ORDER PAYMENT STATUS QUERY & DETAILS*

🙏 Namaste Astrologer Hrishi ji,

Maine website par order place karne ka prayas kiya tha:

📋 *Order ID:* ${receipt.order_number ?? receipt.order_id}
💰 *Total Amount:* ₹${receipt.total}
💳 *Payment Status:* ${isPaymentVerified ? "PAID (VERIFIED)" : "PENDING / NOT CONFIRMED"}
🔖 *Ref / UTR / Payment ID:* ${utrInput.trim() || receipt.payment_id || "Awaiting confirmation"}

👤 *Customer Name:* ${receipt.customer_name}
📞 *Mobile Number:* ${receipt.customer_phone}
📍 *Delivery Address:*
${receipt.address}, ${receipt.city}, ${receipt.state} - ${receipt.pincode}

📦 *Items Ordered:*
${itemsList}

${isPaymentVerified ? "📸 Payment verified, please dispatch soon!" : "⚠️ Agar mere account se paise deduct hue hon to kripya check karein aur confirm karein. Dhanyawad! 🙏"}`;

    return `https://wa.me/${WHATSAPP_NUMBER || "919558565655"}?text=${encodeURIComponent(msg)}`;
  };

  return (
    <PageLayout title={isPaymentVerified ? "Payment Successful" : "Payment Status"}>
      <SEO
        title={isPaymentVerified ? "Payment Successful — Order Placed | Astro With Hrishi" : "Payment Pending | Astro With Hrishi"}
        description="Check your sacred order and payment verification status."
        path="/order-success"
        noindex
      />

      <div className="container max-w-3xl pt-24 pb-32 px-4">
        {/* Dynamic Header Banner: Successful vs Unpaid/Pending */}
        {isPaymentVerified ? (
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.4 }}
            className="text-center space-y-3 mb-8"
          >
            <div className="h-20 w-20 sm:h-24 sm:w-24 rounded-full bg-emerald-500/20 border-2 border-emerald-400/40 flex items-center justify-center mx-auto shadow-2xl relative">
              <CheckCircle2 className="h-12 w-12 sm:h-14 sm:w-14 text-emerald-400" />
              <motion.div
                initial={{ scale: 0 }}
                animate={{ scale: [1, 1.2, 1] }}
                transition={{ repeat: Infinity, duration: 2 }}
                className="absolute -top-1 -right-1 h-7 w-7 rounded-full bg-gold/20 flex items-center justify-center border border-gold/40"
              >
                <Sparkles className="h-4 w-4 text-gold" />
              </motion.div>
            </div>

            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 text-xs font-semibold">
              <span>✓ Payment Verified &amp; Received</span>
            </div>

            <h1 className="text-2xl sm:text-4xl font-serif font-black text-foreground">
              Payment Successful!
            </h1>
            <p className="text-xs sm:text-sm text-cosmic-silver/80 max-w-md mx-auto leading-relaxed">
              Thank you! Your payment has been received and verified. Astrologer Hrishi &amp; team are preparing your Vedic crystals &amp; energised remedies.
            </p>
          </motion.div>
        ) : (
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.4 }}
            className="text-center space-y-3 mb-8"
          >
            <div className="h-20 w-20 sm:h-24 sm:w-24 rounded-full bg-amber-500/20 border-2 border-amber-400/40 flex items-center justify-center mx-auto shadow-2xl relative">
              <Clock className="h-12 w-12 sm:h-14 sm:w-14 text-amber-400" />
            </div>

            <div className="inline-flex items-center gap-1.5 px-3.5 py-1 rounded-full bg-amber-500/15 border border-amber-500/30 text-amber-300 text-xs font-semibold">
              <AlertTriangle className="h-3.5 w-3.5" />
              <span>Payment Not Completed / Pending</span>
            </div>

            <h1 className="text-2xl sm:text-4xl font-serif font-black text-foreground">
              Payment Incomplete
            </h1>
            <p className="text-xs sm:text-sm text-cosmic-silver/80 max-w-md mx-auto leading-relaxed">
              Bank ya Payment Gateway se payment confirmation abhi prapt nahi hua hai. Agar aapne payment nahi kiya tha ya cancel ho gaya tha, to kripya niche diye gaye button par click karke payment complete karein.
            </p>
          </motion.div>
        )}

        {loading ? (
          <div className="glass-gold rounded-3xl p-12 text-center border border-gold/20">
            <div className="h-10 w-10 rounded-full border-2 border-gold/30 border-t-gold animate-spin mx-auto mb-3" />
            <p className="text-xs text-cosmic-silver/70">Verifying payment status with bank &amp; gateway...</p>
          </div>
        ) : receipt ? (
          <motion.div
            initial={{ opacity: 0, y: 15 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: 0.1 }}
            className="space-y-6"
          >
            {/* Top Order Highlights Grid */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="glass-gold rounded-2xl p-4 border border-gold/20 text-center">
                <span className="text-[10px] sm:text-xs text-muted-foreground uppercase font-semibold">Order Number</span>
                <p className="font-mono font-bold text-xs sm:text-sm text-gold truncate mt-1">
                  {receipt.order_number ?? receipt.order_id}
                </p>
              </div>

              <div className="glass-gold rounded-2xl p-4 border border-gold/20 text-center">
                <span className="text-[10px] sm:text-xs text-muted-foreground uppercase font-semibold">
                  {isPaymentVerified ? "Amount Paid" : "Amount Due"}
                </span>
                <p className={`font-bold text-sm sm:text-base mt-1 ${isPaymentVerified ? "text-emerald-400" : "text-amber-400"}`}>
                  {inr(receipt.total)}
                </p>
              </div>

              <div className="glass-gold rounded-2xl p-4 border border-gold/20 text-center">
                <span className="text-[10px] sm:text-xs text-muted-foreground uppercase font-semibold">Payment Status</span>
                {isPaymentVerified ? (
                  <p className="font-bold text-xs sm:text-sm text-emerald-300 mt-1 flex items-center justify-center gap-1">
                    <ShieldCheck className="h-3.5 w-3.5 text-emerald-400" /> Confirmed
                  </p>
                ) : (
                  <p className="font-bold text-xs sm:text-sm text-amber-400 mt-1 flex items-center justify-center gap-1">
                    <AlertTriangle className="h-3.5 w-3.5 text-amber-400" /> Unpaid / Pending
                  </p>
                )}
              </div>

              <div className="glass-gold rounded-2xl p-4 border border-gold/20 text-center">
                <span className="text-[10px] sm:text-xs text-muted-foreground uppercase font-semibold">Estimated Delivery</span>
                <p className="font-bold text-xs sm:text-sm text-cosmic-silver mt-1">
                  {isPaymentVerified ? deliveryEstimate() : "Awaiting Payment"}
                </p>
              </div>
            </div>

            {/* Incomplete Payment Notice & Retry Card */}
            {!isPaymentVerified && (
              <div className="p-5 sm:p-6 rounded-3xl bg-amber-950/40 border border-amber-500/40 shadow-xl space-y-4">
                <div className="flex items-start gap-3">
                  <div className="h-10 w-10 rounded-xl bg-amber-500/20 border border-amber-500/30 flex items-center justify-center text-amber-400 shrink-0 mt-0.5">
                    <AlertTriangle className="h-5 w-5" />
                  </div>
                  <div className="space-y-1">
                    <h3 className="font-bold text-sm sm:text-base text-amber-300">
                      Payment Has Not Been Received Yet
                    </h3>
                    <p className="text-xs text-cosmic-silver/90 leading-relaxed">
                      Aapka order create ho gaya hai, par payment complete nahi hua hai. Agar aapke bank se paise kat gaye hain, to <strong>Check Payment Status with Bank</strong> par click karein. Ya niche diye gaye button se abhi payment complete karein.
                    </p>
                  </div>
                </div>

                <div className="pt-2 flex flex-col sm:flex-row gap-3">
                  <Button
                    onClick={() => nav("/checkout")}
                    size="lg"
                    className="flex-1 h-13 bg-gradient-gold text-primary-foreground font-black text-sm sm:text-base rounded-xl shadow-lg hover:opacity-95 flex items-center justify-center gap-2 cursor-pointer"
                  >
                    <CreditCard className="h-4 w-4" /> Complete Payment Now (Pay {inr(receipt.total)})
                  </Button>

                  <Button
                    type="button"
                    variant="outline"
                    disabled={checkingBank}
                    onClick={() => verifyOrderStatusWithServer(receipt.order_number ?? receipt.order_id, true)}
                    className="h-13 border-amber-500/40 text-amber-300 hover:text-amber-200 hover:bg-amber-950/60 rounded-xl text-xs font-bold flex items-center justify-center gap-2 px-5 cursor-pointer"
                  >
                    {checkingBank ? (
                      <>
                        <RefreshCw className="h-4 w-4 animate-spin" /> Checking Bank...
                      </>
                    ) : (
                      <>
                        <RefreshCw className="h-4 w-4" /> Check Payment Status with Bank
                      </>
                    )}
                  </Button>
                </div>
              </div>
            )}

            {/* Main Receipt Details Card */}
            <div className="glass-gold rounded-3xl p-6 sm:p-8 border border-gold/30 shadow-2xl space-y-6">
              
              {/* Ordered Items List */}
              <div>
                <h3 className="text-sm font-semibold text-foreground uppercase tracking-wider mb-4 flex items-center gap-2">
                  <ShoppingBag className="h-4 w-4 text-gold" /> Items in Your Order ({receipt.items.length})
                </h3>
                <div className="divide-y divide-gold/15">
                  {receipt.items.map((item, idx) => (
                    <div key={`${item.name}-${idx}`} className="py-3 flex items-center justify-between gap-3">
                      <div className="flex items-center gap-3 min-w-0">
                        <img
                          src={item.image}
                          alt={item.name}
                          className="h-14 w-14 rounded-xl object-cover border border-gold/20 shrink-0 bg-background/50"
                        />
                        <div className="min-w-0">
                          <p className="font-semibold text-xs sm:text-sm text-foreground truncate">{item.name}</p>
                          {item.variant && <p className="text-[11px] text-muted-foreground">{item.variant}</p>}
                          <p className="text-[11px] text-cosmic-silver/70">Qty: {item.quantity} × {inr(item.price)}</p>
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <span className="font-bold text-xs sm:text-sm text-gold">
                          {inr(item.price * item.quantity)}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Delivery Address & Price Breakdown Grid */}
              <div className="grid sm:grid-cols-2 gap-5 pt-4 border-t border-gold/20">
                {/* Shipping Details */}
                <div className="space-y-2">
                  <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                    <MapPin className="h-3.5 w-3.5 text-gold" /> Delivery Address
                  </h4>
                  <div className="p-3.5 rounded-xl bg-background/50 border border-gold/15 text-xs text-cosmic-silver/90 space-y-1">
                    <p className="font-bold text-foreground">{receipt.customer_name}</p>
                    <p>{receipt.address}</p>
                    <p>{[receipt.city, receipt.state, receipt.pincode].filter(Boolean).join(", ")}</p>
                    <p className="text-[11px] text-muted-foreground pt-1">
                      Phone: <span className="text-foreground">{receipt.customer_phone}</span> · Email: {receipt.customer_email}
                    </p>
                  </div>
                </div>

                {/* Price Breakdown */}
                <div className="space-y-2">
                  <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                    <CreditCard className="h-3.5 w-3.5 text-gold" /> Payment Summary
                  </h4>
                  <div className="p-3.5 rounded-xl bg-background/50 border border-gold/15 text-xs space-y-1.5 text-cosmic-silver/80">
                    <div className="flex justify-between">
                      <span>Subtotal</span>
                      <span>{inr(receipt.subtotal)}</span>
                    </div>
                    {receipt.discount > 0 && (
                      <div className="flex justify-between text-emerald-400 font-medium">
                        <span>Online Discount</span>
                        <span>- {inr(receipt.discount)}</span>
                      </div>
                    )}
                    <div className="flex justify-between">
                      <span>Shipping Fee</span>
                      <span className="text-emerald-400 font-medium">{receipt.shipping === 0 ? "FREE" : inr(receipt.shipping)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>GST (3%)</span>
                      <span>{inr(receipt.gst)}</span>
                    </div>
                    <div className="flex justify-between font-bold text-foreground text-sm pt-2 border-t border-gold/20">
                      <span>{isPaymentVerified ? "Total Amount Paid" : "Total Amount Due"}</span>
                      <span className="text-gold text-base">{inr(receipt.total)}</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Direct Owner WhatsApp Verification & Screenshot Card */}
              <div className="p-5 sm:p-6 rounded-3xl bg-gradient-to-br from-emerald-950/60 via-background/60 to-emerald-950/40 border border-emerald-500/40 shadow-2xl space-y-4">
                <div className="flex items-center justify-between pb-2 border-b border-emerald-500/20">
                  <div className="flex items-center gap-2.5">
                    <div className="h-9 w-9 rounded-xl bg-emerald-500/20 flex items-center justify-center text-emerald-400">
                      <Camera className="h-5 w-5" />
                    </div>
                    <div>
                      <h4 className="font-bold text-sm sm:text-base text-emerald-300">
                        {isPaymentVerified ? "Send Payment Screenshot to Owner on WhatsApp" : "Contact Owner on WhatsApp for Payment Assistance"}
                      </h4>
                      <p className="text-[11px] text-cosmic-silver/80">
                        {isPaymentVerified
                          ? "Owner ko screenshot bhejein taaki payment verify ho sake aur order turant pack ho sake!"
                          : "Agar aapke account se paise debited hue hain to screenshot bhejkar instant confirmation prapt karein."}
                      </p>
                    </div>
                  </div>
                  <span className="hidden sm:inline-flex text-[11px] bg-emerald-500/20 text-emerald-300 font-semibold px-2.5 py-0.5 rounded-full">
                    Direct Support
                  </span>
                </div>

                {/* Screenshot & UTR Inputs */}
                <div className="grid sm:grid-cols-2 gap-3 pt-1">
                  {/* Screenshot file picker */}
                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold text-cosmic-silver flex items-center justify-between">
                      <span>Attach Payment Screenshot</span>
                      <span className="text-[10px] text-emerald-400 font-semibold">Camera / Gallery</span>
                    </label>
                    <div className="flex items-center gap-2">
                      <label className="flex-1 cursor-pointer flex items-center justify-center gap-2 h-11 px-3 rounded-xl bg-background/70 border border-dashed border-emerald-500/40 hover:border-emerald-400 text-xs text-cosmic-silver transition-all">
                        <Upload className="h-4 w-4 text-emerald-400 shrink-0" />
                        <span className="truncate">{screenshotFile ? screenshotFile.name : "Select Screenshot"}</span>
                        <input type="file" accept="image/*" className="hidden" onChange={handleScreenshotChange} />
                      </label>
                      {screenshotPreview && (
                        <div className="relative h-11 w-11 shrink-0 rounded-lg overflow-hidden border border-emerald-500/50">
                          <img src={screenshotPreview} alt="Screenshot preview" className="h-full w-full object-cover" />
                          <button
                            type="button"
                            onClick={() => {
                              setScreenshotFile(null);
                              setScreenshotPreview(null);
                            }}
                            className="absolute top-0 right-0 bg-red-600 text-white rounded-bl p-0.5"
                          >
                            <X className="h-2.5 w-2.5" />
                          </button>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* UTR / Ref Input */}
                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold text-cosmic-silver flex items-center justify-between">
                      <span>Transaction UTR / Reference No.</span>
                      <span className="text-[10px] text-muted-foreground">Optional</span>
                    </label>
                    <Input
                      placeholder="e.g. 402918274819 (Bank UTR)"
                      value={utrInput}
                      onChange={(e) => setUtrInput(e.target.value)}
                      className="h-11 bg-background/70 border-emerald-500/30 rounded-xl text-xs font-mono"
                    />
                  </div>
                </div>

                {/* Big WhatsApp button */}
                <a
                  href={buildWhatsAppUrl()}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="w-full h-12 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-sm shadow-xl transition-all flex items-center justify-center gap-2 cursor-pointer"
                >
                  <MessageCircle className="h-5 w-5 fill-white" />
                  <span>Send Screenshot &amp; Order Details to Owner on WhatsApp (+91 9558565655)</span>
                </a>

                <p className="text-[11px] text-center text-muted-foreground">
                  Button par click karte hi Astrologer Hrishi ji ka WhatsApp open hoga. Aap payment query ya screenshot chat me send kar sakte hain.
                </p>
              </div>

              {/* Action Buttons: Continue Shopping & Receipts */}
              <div className="pt-2 space-y-3">
                {isPaymentVerified ? (
                  /* 1. PRIMARY PROMINENT BUTTON: CONTINUE SHOPPING (Direct redirect to /shop) */
                  <Button
                    onClick={() => nav("/shop")}
                    size="lg"
                    className="w-full h-14 bg-gradient-gold text-primary-foreground font-extrabold text-base sm:text-lg rounded-2xl shadow-xl hover:opacity-95 transition-all flex items-center justify-center gap-2 cursor-pointer"
                  >
                    <ShoppingBag className="h-5 w-5" />
                    Continue Shopping
                    <ArrowRight className="h-5 w-5" />
                  </Button>
                ) : (
                  <Button
                    onClick={() => nav("/checkout")}
                    size="lg"
                    className="w-full h-14 bg-gradient-gold text-primary-foreground font-extrabold text-base sm:text-lg rounded-2xl shadow-xl hover:opacity-95 transition-all flex items-center justify-center gap-2 cursor-pointer"
                  >
                    <CreditCard className="h-5 w-5" />
                    Complete Payment (Pay {inr(receipt.total)})
                    <ArrowRight className="h-5 w-5" />
                  </Button>
                )}

                {/* Secondary Actions */}
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 pt-1">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => downloadReceipt(receipt)}
                    className="border-gold/30 text-cosmic-silver hover:text-gold text-xs h-11 rounded-xl"
                  >
                    <Download className="h-4 w-4 mr-1.5" /> Download Invoice
                  </Button>

                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => printReceipt(receipt)}
                    className="border-gold/30 text-cosmic-silver hover:text-gold text-xs h-11 rounded-xl"
                  >
                    <Printer className="h-4 w-4 mr-1.5" /> Print Receipt
                  </Button>

                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => nav(`/track-order?order=${encodeURIComponent(receipt.order_number ?? receipt.order_id)}`)}
                    className="col-span-2 sm:col-span-1 border-gold/30 text-cosmic-silver hover:text-gold text-xs h-11 rounded-xl"
                  >
                    <Truck className="h-4 w-4 mr-1.5" /> Track Order
                  </Button>
                </div>
              </div>
            </div>
          </motion.div>
        ) : (
          /* Fallback when no receipt is stored */
          <div className="glass-gold rounded-3xl p-8 sm:p-12 text-center border border-gold/30 shadow-2xl space-y-4">
            <h2 className="text-xl font-bold text-foreground">Order Record Found</h2>
            <p className="text-xs text-cosmic-silver/80 max-w-sm mx-auto">
              You can review your purchases in your account or explore authentic Vedic crystals and energized remedies.
            </p>
            <div className="pt-4 flex flex-col sm:flex-row items-center justify-center gap-3">
              <Button
                onClick={() => nav("/shop")}
                size="lg"
                className="w-full sm:w-auto h-12 bg-gradient-gold text-primary-foreground font-bold px-8 rounded-xl shadow-lg"
              >
                <ShoppingBag className="h-4 w-4 mr-2" /> Explore Collection
              </Button>
              <Button
                variant="outline"
                onClick={() => nav("/orders")}
                className="w-full sm:w-auto h-12 border-gold/30 text-cosmic-silver px-6 rounded-xl"
              >
                View My Orders
              </Button>
            </div>
          </div>
        )}
      </div>
    </PageLayout>
  );
};

export default OrderSuccess;
