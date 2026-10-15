import { useState, useEffect } from "react";
import {
  CreditCard,
  QrCode,
  Truck,
  CheckCircle2,
  AlertCircle,
  ExternalLink,
  Eye,
  EyeOff,
  Save,
  RefreshCw,
  Zap,
  ShieldCheck,
  Smartphone,
  Copy,
  Check,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import {
  fetchPaymentSettings,
  savePaymentSettings,
  testRazorpayConnection,
  type PaymentGatewayAdminSettings,
} from "@/lib/adminApi";

export const PaymentSettingsTab = () => {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [showSecret, setShowSecret] = useState(false);
  const [showWebhookSecret, setShowWebhookSecret] = useState(false);
  const [copiedUpi, setCopiedUpi] = useState(false);

  const [form, setForm] = useState<{
    razorpay_enabled: boolean;
    razorpay_key_id: string;
    razorpay_key_secret: string;
    razorpay_webhook_secret: string;
    upi_enabled: boolean;
    upi_id: string;
    payee_name: string;
    cod_enabled: boolean;
    test_mode: boolean;
  }>({
    razorpay_enabled: true,
    razorpay_key_id: "",
    razorpay_key_secret: "",
    razorpay_webhook_secret: "",
    upi_enabled: true,
    upi_id: "astrowithhrishi@okhdfcbank",
    payee_name: "Astro With Hrishi",
    cod_enabled: false,
    test_mode: true,
  });

  const [serverStatus, setServerStatus] = useState<PaymentGatewayAdminSettings | null>(null);
  const [testResult, setTestResult] = useState<{ valid: boolean; message: string } | null>(null);

  const loadData = async () => {
    setLoading(true);
    const data = await fetchPaymentSettings();
    if (data) {
      setServerStatus(data);
      setForm({
        razorpay_enabled: data.razorpay_enabled ?? true,
        razorpay_key_id: data.razorpay_key_id || "",
        razorpay_key_secret: "",
        razorpay_webhook_secret: "",
        upi_enabled: data.upi_enabled ?? true,
        upi_id: data.upi_id || "astrowithhrishi@okhdfcbank",
        payee_name: data.payee_name || "Astro With Hrishi",
        cod_enabled: data.cod_enabled ?? false,
        test_mode: data.test_mode ?? true,
      });
    }
    setLoading(false);
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleSave = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setSaving(true);
    try {
      const payload: any = {
        razorpay_enabled: form.razorpay_enabled,
        razorpay_key_id: form.razorpay_key_id.trim(),
        upi_enabled: form.upi_enabled,
        upi_id: form.upi_id.trim(),
        payee_name: form.payee_name.trim(),
        cod_enabled: form.cod_enabled,
        test_mode: form.test_mode,
      };

      if (form.razorpay_key_secret.trim()) {
        payload.razorpay_key_secret = form.razorpay_key_secret.trim();
      }
      if (form.razorpay_webhook_secret.trim()) {
        payload.razorpay_webhook_secret = form.razorpay_webhook_secret.trim();
      }

      const res = await savePaymentSettings(payload);
      if (res.success) {
        toast.success(res.message || "Payment settings updated and active live!");
        await loadData();
      } else {
        toast.error(res.error || "Failed to save payment settings");
      }
    } catch (err: any) {
      toast.error(err.message || "Error saving payment settings");
    } finally {
      setSaving(false);
    }
  };

  const handleTestRazorpay = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const keys: any = {};
      if (form.razorpay_key_id.trim()) {
        keys.key_id = form.razorpay_key_id.trim();
      }
      if (form.razorpay_key_secret.trim()) {
        keys.key_secret = form.razorpay_key_secret.trim();
      }

      const res = await testRazorpayConnection(keys);
      if (res.valid) {
        setTestResult({ valid: true, message: res.message || "Connection verified successfully!" });
        toast.success("Razorpay Connection Verified Successfully!");
      } else {
        setTestResult({ valid: false, message: res.error || "Connection test failed." });
        toast.error(res.error || "Connection test failed");
      }
    } catch (err: any) {
      setTestResult({ valid: false, message: err.message || "Network test failed." });
      toast.error("Test failed: " + err.message);
    } finally {
      setTesting(false);
    }
  };

  const copyUpi = () => {
    navigator.clipboard.writeText(form.upi_id);
    setCopiedUpi(true);
    toast.success("UPI ID copied to clipboard!");
    setTimeout(() => setCopiedUpi(false), 2000);
  };

  const sampleUpiString = `upi://pay?pa=${encodeURIComponent(form.upi_id || "astrowithhrishi@okhdfcbank")}&pn=${encodeURIComponent(form.payee_name || "Astro With Hrishi")}&am=1499&cu=INR&tn=Order%20Sample`;
  const sampleQrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(sampleUpiString)}`;

  if (loading) {
    return (
      <div className="py-12 text-center text-cosmic-silver/60 flex items-center justify-center gap-2">
        <RefreshCw className="h-5 w-5 animate-spin text-gold" />
        <span>Loading Payment Gateway Settings...</span>
      </div>
    );
  }

  const isRazorpayLive = form.razorpay_key_id.startsWith("rzp_live_");
  const isRazorpayTest = form.razorpay_key_id.startsWith("rzp_test_");

  return (
    <div className="space-y-6">
      {/* Header & Status Overview */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-gold/20 pb-4">
        <div>
          <h2 className="font-display text-xl sm:text-2xl text-gradient-gold flex items-center gap-2">
            <CreditCard className="h-6 w-6 text-gold" />
            Payment Gateway & Transaction Management
          </h2>
          <p className="text-xs sm:text-sm text-cosmic-silver/70 mt-1">
            Configure live payment options: Direct UPI QR Code, Razorpay Online Gateway, and Cash on Delivery.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={loadData}
            className="border-gold/30 text-cosmic-silver hover:text-gold"
          >
            <RefreshCw className="h-4 w-4 mr-1.5" /> Refresh Status
          </Button>
          <Button
            type="button"
            onClick={() => handleSave()}
            disabled={saving}
            className="bg-gradient-gold text-primary-foreground font-semibold shadow-md"
          >
            {saving ? <RefreshCw className="h-4 w-4 mr-1.5 animate-spin" /> : <Save className="h-4 w-4 mr-1.5" />}
            Save Settings
          </Button>
        </div>
      </div>

      {/* ₹10 Live Verification Test Mode Master Control */}
      <div className={`p-5 rounded-2xl border transition-all ${
        form.test_mode
          ? "bg-amber-500/15 border-amber-500/40 text-amber-950 dark:text-amber-100"
          : "bg-emerald-500/10 border-emerald-500/30 text-emerald-950 dark:text-emerald-100"
      }`}>
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-start gap-3">
            <span className="text-2xl mt-0.5">🧪</span>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-bold text-sm sm:text-base">₹10 Live Verification Test Mode</span>
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider ${
                  form.test_mode
                    ? "bg-amber-500/30 text-amber-800 dark:text-amber-200 border border-amber-500/50"
                    : "bg-emerald-500/20 text-emerald-800 dark:text-emerald-300 border border-emerald-500/40"
                }`}>
                  {form.test_mode ? "ACTIVE: Orders Charged ₹10" : "OFF: Main / Full Price Mode"}
                </span>
              </div>
              <p className="text-xs opacity-85 mt-1 leading-relaxed">
                {form.test_mode
                  ? "When enabled, checkout sets all orders to ₹10 so you can test real online UPI/Razorpay payments safely. The funds transfer securely directly into Astro With Hrishi (astrowithhrishi@okhdfcbank)."
                  : "When disabled, customers are charged the full catalog amount (Main Value). All payments transfer securely to Astro With Hrishi."}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3 shrink-0 self-end sm:self-center">
            <Label htmlFor="test-mode-toggle" className="text-xs font-semibold cursor-pointer">
              {form.test_mode ? "Enabled (₹10 Orders)" : "Disabled (Full Price)"}
            </Label>
            <Switch
              id="test-mode-toggle"
              checked={form.test_mode}
              onCheckedChange={(val) => setForm((prev) => ({ ...prev, test_mode: val }))}
            />
          </div>
        </div>
      </div>

      {/* Live Method Status Badges */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Instant UPI Card */}
        <div className={`p-4 rounded-xl border ${form.upi_enabled ? "bg-emerald-500/10 border-emerald-500/30" : "bg-card/40 border-gold/20"}`}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <QrCode className="h-5 w-5 text-emerald-400" />
              <span className="font-semibold text-sm text-cosmic-silver">Instant UPI & QR Code</span>
            </div>
            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${form.upi_enabled ? "bg-emerald-500/20 text-emerald-300" : "bg-muted text-muted-foreground"}`}>
              {form.upi_enabled ? "Active / Live" : "Disabled"}
            </span>
          </div>
          <p className="text-xs text-cosmic-silver/70 mt-2">
            GPay, PhonePe, Paytm, BHIM & Any UPI App. No gateway fees!
          </p>
          <div className="mt-2 text-xs font-mono bg-background/50 px-2.5 py-1 rounded border border-gold/20 flex items-center justify-between text-gold">
            <span className="truncate">{form.upi_id || "Not configured"}</span>
            <button type="button" onClick={copyUpi} className="hover:text-primary transition-colors ml-2">
              {copiedUpi ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
            </button>
          </div>
        </div>

        {/* Razorpay Online Gateway Card */}
        <div className={`p-4 rounded-xl border ${form.razorpay_enabled && isRazorpayLive ? "bg-emerald-500/10 border-emerald-500/30" : form.razorpay_enabled && isRazorpayTest ? "bg-amber-500/10 border-amber-500/30" : "bg-card/40 border-gold/20"}`}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <CreditCard className="h-5 w-5 text-gold" />
              <span className="font-semibold text-sm text-cosmic-silver">Razorpay Gateway</span>
            </div>
            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
              !form.razorpay_enabled
                ? "bg-muted text-muted-foreground"
                : isRazorpayLive
                ? "bg-emerald-500/20 text-emerald-300 font-semibold"
                : isRazorpayTest
                ? "bg-amber-500/20 text-amber-300"
                : "bg-red-500/20 text-red-300"
            }`}>
              {!form.razorpay_enabled ? "Disabled" : isRazorpayLive ? "Live (Production)" : isRazorpayTest ? "Test Mode" : "Missing Keys"}
            </span>
          </div>
          <p className="text-xs text-cosmic-silver/70 mt-2">
            Credit / Debit Cards, Netbanking & Razorpay UPI.
          </p>
          <div className="mt-2 flex items-center justify-between text-xs text-cosmic-silver/80">
            <span>Key: {form.razorpay_key_id ? `${form.razorpay_key_id.slice(0, 10)}...` : "None"}</span>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={handleTestRazorpay}
              disabled={testing || !form.razorpay_key_id}
              className="h-6 px-2 text-xs text-gold hover:text-gold/80"
            >
              {testing ? <RefreshCw className="h-3 w-3 animate-spin mr-1" /> : <Zap className="h-3 w-3 mr-1" />}
              Test
            </Button>
          </div>
        </div>

        {/* Cash on Delivery Card */}
        <div className={`p-4 rounded-xl border ${form.cod_enabled ? "bg-blue-500/10 border-blue-500/30" : "bg-card/40 border-gold/20"}`}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Truck className="h-5 w-5 text-blue-400" />
              <span className="font-semibold text-sm text-cosmic-silver">Cash on Delivery (COD)</span>
            </div>
            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${form.cod_enabled ? "bg-blue-500/20 text-blue-300" : "bg-muted text-muted-foreground"}`}>
              {form.cod_enabled ? "Enabled" : "Disabled"}
            </span>
          </div>
          <p className="text-xs text-cosmic-silver/70 mt-2">
            Doorstep cash payment upon package delivery across India.
          </p>
          <div className="mt-2 text-xs text-cosmic-silver/60">
            Auto-confirms order &amp; sends branded email confirmation.
          </div>
        </div>
      </div>

      {/* Test Connection Alert Box */}
      {testResult && (
        <div className={`p-4 rounded-xl border flex items-start gap-3 ${testResult.valid ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-300" : "bg-red-500/10 border-red-500/30 text-red-300"}`}>
          {testResult.valid ? <CheckCircle2 className="h-5 w-5 shrink-0 mt-0.5 text-emerald-400" /> : <AlertCircle className="h-5 w-5 shrink-0 mt-0.5 text-red-400" />}
          <div className="text-sm">
            <div className="font-semibold">{testResult.valid ? "Razorpay Gateway Connected!" : "Razorpay Verification Notice"}</div>
            <div className="text-xs mt-0.5 text-cosmic-silver/80">{testResult.message}</div>
          </div>
        </div>
      )}

      {/* Main Settings Grid */}
      <form onSubmit={handleSave} className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* SECTION 1: DIRECT UPI & DYNAMIC QR */}
        <div className="glass-gold border border-gold/30 rounded-xl p-5 space-y-4">
          <div className="flex items-center justify-between border-b border-gold/20 pb-3">
            <div className="flex items-center gap-2.5">
              <div className="h-9 w-9 rounded-lg bg-emerald-500/20 flex items-center justify-center text-emerald-400">
                <Smartphone className="h-5 w-5" />
              </div>
              <div>
                <h3 className="font-semibold text-base text-cosmic-silver">Direct UPI & Dynamic QR</h3>
                <p className="text-xs text-cosmic-silver/60">Fastest payment method for Indian buyers</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Label htmlFor="upi-toggle" className="text-xs text-cosmic-silver">Enable</Label>
              <Switch
                id="upi-toggle"
                checked={form.upi_enabled}
                onCheckedChange={(val) => setForm((prev) => ({ ...prev, upi_enabled: val }))}
              />
            </div>
          </div>

          <div className="space-y-3 text-sm">
            <div>
              <Label htmlFor="upi_id" className="text-xs text-cosmic-silver font-medium">
                Store Receiving UPI ID (VPA) <span className="text-red-400">*</span>
              </Label>
              <Input
                id="upi_id"
                value={form.upi_id}
                onChange={(e) => setForm((prev) => ({ ...prev, upi_id: e.target.value }))}
                placeholder="astrowithhrishi@okhdfcbank"
                className="mt-1 font-mono text-sm bg-background/50 border-gold/30 text-gold"
                required
              />
              <p className="text-[11px] text-cosmic-silver/60 mt-1">
                E.g. <span className="text-gold">astrowithhrishi@okhdfcbank</span> or your PhonePe / GPay UPI ID.
              </p>
            </div>

            <div>
              <Label htmlFor="payee_name" className="text-xs text-cosmic-silver font-medium">
                Store / Beneficiary Name
              </Label>
              <Input
                id="payee_name"
                value={form.payee_name}
                onChange={(e) => setForm((prev) => ({ ...prev, payee_name: e.target.value }))}
                placeholder="Astro With Hrishi"
                className="mt-1 text-sm bg-background/50 border-gold/30 text-cosmic-silver"
              />
              <p className="text-[11px] text-cosmic-silver/60 mt-1">
                This name is displayed inside the buyer's Google Pay / PhonePe app when scanning.
              </p>
            </div>

            {/* UPI Customer Checkout Preview */}
            <div className="mt-4 p-3 rounded-lg bg-background/40 border border-gold/20 space-y-2">
              <span className="text-xs font-semibold text-gradient-gold flex items-center gap-1.5">
                <QrCode className="h-3.5 w-3.5 text-gold" />
                Live Customer Checkout Preview
              </span>
              <div className="flex items-center gap-4 pt-1">
                <img
                  src={sampleQrUrl}
                  alt="Sample Dynamic UPI QR"
                  className="h-24 w-24 rounded-md border border-gold/30 bg-white p-1 shrink-0"
                />
                <div className="text-xs text-cosmic-silver/70 space-y-1">
                  <div className="font-semibold text-cosmic-silver">Exact Amount Auto-Filled</div>
                  <div>Buyer scans with GPay/PhonePe</div>
                  <div>Enters 12-digit UTR on checkout</div>
                  <div className="text-emerald-400 font-medium">✓ Order confirms automatically</div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* SECTION 2: RAZORPAY GATEWAY */}
        <div className="glass-gold border border-gold/30 rounded-xl p-5 space-y-4">
          <div className="flex items-center justify-between border-b border-gold/20 pb-3">
            <div className="flex items-center gap-2.5">
              <div className="h-9 w-9 rounded-lg bg-gold/20 flex items-center justify-center text-gold">
                <CreditCard className="h-5 w-5" />
              </div>
              <div>
                <h3 className="font-semibold text-base text-cosmic-silver">Razorpay Online Gateway</h3>
                <p className="text-xs text-cosmic-silver/60">Credit/Debit Cards &amp; Netbanking</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Label htmlFor="rzp-toggle" className="text-xs text-cosmic-silver">Enable</Label>
              <Switch
                id="rzp-toggle"
                checked={form.razorpay_enabled}
                onCheckedChange={(val) => setForm((prev) => ({ ...prev, razorpay_enabled: val }))}
              />
            </div>
          </div>

          <div className="space-y-3 text-sm">
            <div>
              <div className="flex items-center justify-between">
                <Label htmlFor="rzp_key_id" className="text-xs text-cosmic-silver font-medium">
                  Razorpay Key ID <span className="text-red-400">*</span>
                </Label>
                <a
                  href="https://dashboard.razorpay.com/app/keys"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[11px] text-gold hover:underline flex items-center gap-1"
                >
                  Get API Keys <ExternalLink className="h-3 w-3" />
                </a>
              </div>
              <Input
                id="rzp_key_id"
                value={form.razorpay_key_id}
                onChange={(e) => setForm((prev) => ({ ...prev, razorpay_key_id: e.target.value }))}
                placeholder="rzp_live_... or rzp_test_..."
                className="mt-1 font-mono text-sm bg-background/50 border-gold/30 text-gold"
              />
              <div className="flex items-center justify-between mt-1 text-[11px]">
                <span className="text-cosmic-silver/60">
                  Must start with <code className="text-emerald-400">rzp_live_</code> (Production) or <code className="text-amber-400">rzp_test_</code>
                </span>
                {isRazorpayLive ? (
                  <span className="text-emerald-400 font-semibold">● Production Mode</span>
                ) : isRazorpayTest ? (
                  <span className="text-amber-400">● Test Mode</span>
                ) : null}
              </div>
            </div>

            <div>
              <Label htmlFor="rzp_key_secret" className="text-xs text-cosmic-silver font-medium">
                Razorpay Key Secret
              </Label>
              <div className="relative mt-1">
                <Input
                  id="rzp_key_secret"
                  type={showSecret ? "text" : "password"}
                  value={form.razorpay_key_secret}
                  onChange={(e) => setForm((prev) => ({ ...prev, razorpay_key_secret: e.target.value }))}
                  placeholder={serverStatus?.has_key_secret ? `Current secret saved (${serverStatus.razorpay_key_secret_masked})` : "Enter new secret key"}
                  className="font-mono text-sm bg-background/50 border-gold/30 text-cosmic-silver pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowSecret(!showSecret)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-cosmic-silver/60 hover:text-gold"
                >
                  {showSecret ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              <p className="text-[11px] text-cosmic-silver/60 mt-1">
                {serverStatus?.has_key_secret
                  ? "✓ Secret key is securely configured on server. Leave blank to keep current secret."
                  : "Enter your Razorpay Key Secret from your Razorpay Dashboard."}
              </p>
            </div>

            <div>
              <Label htmlFor="rzp_webhook_secret" className="text-xs text-cosmic-silver font-medium">
                Razorpay Webhook Secret (Optional)
              </Label>
              <div className="relative mt-1">
                <Input
                  id="rzp_webhook_secret"
                  type={showWebhookSecret ? "text" : "password"}
                  value={form.razorpay_webhook_secret}
                  onChange={(e) => setForm((prev) => ({ ...prev, razorpay_webhook_secret: e.target.value }))}
                  placeholder={serverStatus?.has_webhook_secret ? `Current: ${serverStatus.razorpay_webhook_secret_masked}` : "Webhook secret from Razorpay"}
                  className="font-mono text-sm bg-background/50 border-gold/30 text-cosmic-silver pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowWebhookSecret(!showWebhookSecret)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-cosmic-silver/60 hover:text-gold"
                  aria-label={showWebhookSecret ? "Hide secret" : "Show secret"}
                >
                  {showWebhookSecret ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            <div className="pt-2 flex items-center justify-between">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleTestRazorpay}
                disabled={testing || !form.razorpay_key_id}
                className="border-gold/30 text-gold hover:bg-gold/10"
              >
                {testing ? <RefreshCw className="h-4 w-4 animate-spin mr-1.5" /> : <Zap className="h-4 w-4 mr-1.5" />}
                Test Razorpay Credentials
              </Button>
              <span className="text-[11px] text-cosmic-silver/60">
                Safe test without placing an actual charge
              </span>
            </div>
          </div>
        </div>

        {/* SECTION 3: CASH ON DELIVERY & DELIVERY OPTIONS */}
        <div className="glass-gold border border-gold/30 rounded-xl p-5 space-y-4 lg:col-span-2">
          <div className="flex items-center justify-between border-b border-gold/20 pb-3">
            <div className="flex items-center gap-2.5">
              <div className="h-9 w-9 rounded-lg bg-blue-500/20 flex items-center justify-center text-blue-400">
                <Truck className="h-5 w-5" />
              </div>
              <div>
                <h3 className="font-semibold text-base text-cosmic-silver">Cash on Delivery (COD)</h3>
                <p className="text-xs text-cosmic-silver/60">Accept payments at customer's doorstep</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Label htmlFor="cod-toggle" className="text-xs text-cosmic-silver">Enable COD</Label>
              <Switch
                id="cod-toggle"
                checked={form.cod_enabled}
                onCheckedChange={(val) => setForm((prev) => ({ ...prev, cod_enabled: val }))}
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs text-cosmic-silver/70">
            <div className="p-3 rounded-lg bg-background/30 border border-gold/20">
              <div className="font-semibold text-cosmic-silver mb-1 flex items-center gap-1.5">
                <ShieldCheck className="h-4 w-4 text-emerald-400" />
                Automatic Confirmation
              </div>
              COD orders are auto-confirmed and generate a branded receipt with order tracking number.
            </div>
            <div className="p-3 rounded-lg bg-background/30 border border-gold/20">
              <div className="font-semibold text-cosmic-silver mb-1 flex items-center gap-1.5">
                <Truck className="h-4 w-4 text-blue-400" />
                Courier Handover
              </div>
              Delivery partners collect exact cash amount indicated on the shipping invoice.
            </div>
            <div className="p-3 rounded-lg bg-background/30 border border-gold/20">
              <div className="font-semibold text-cosmic-silver mb-1 flex items-center gap-1.5">
                <CheckCircle2 className="h-4 w-4 text-gold" />
                Zero Abandonment
              </div>
              Offers buyers without cards or digital banking the convenience to complete their purchases.
            </div>
          </div>

          {/* Action buttons */}
          <div className="pt-2 flex justify-end gap-3">
            <Button
              type="submit"
              disabled={saving}
              className="bg-gradient-gold text-primary-foreground font-semibold px-6 shadow-md"
            >
              {saving ? <RefreshCw className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
              Save All Payment Settings
            </Button>
          </div>
        </div>
      </form>
    </div>
  );
};

export default PaymentSettingsTab;
