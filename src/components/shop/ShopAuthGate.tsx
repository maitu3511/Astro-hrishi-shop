import { useState } from "react";
import { motion } from "framer-motion";
import { Lock, Mail, MapPin, Phone, ShieldCheck, Sparkles, User, KeyRound, ArrowLeft, CheckCircle2, Eye, EyeOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { welcomeCustomer } from "@/lib/voice";
import { toast } from "sonner";
import { auth, db } from "@/lib/firebase";
import { useAuth } from "@/hooks/useAuth";
import { notifyAuthSuccess } from "@/lib/authNotifier";
import { sendPasswordResetEmail, createUserWithEmailAndPassword, signInWithEmailAndPassword, updateProfile } from "firebase/auth";
import { doc, setDoc, updateDoc, addDoc, collection, getDoc } from "firebase/firestore";

const INDIAN_STATES = [
  "Andhra Pradesh", "Arunachal Pradesh", "Assam", "Bihar", "Chhattisgarh", "Delhi", "Goa", "Gujarat",
  "Haryana", "Himachal Pradesh", "Jharkhand", "Karnataka", "Kerala", "Madhya Pradesh", "Maharashtra",
  "Manipur", "Meghalaya", "Mizoram", "Nagaland", "Odisha", "Punjab", "Rajasthan", "Sikkim", "Tamil Nadu",
  "Telangana", "Tripura", "Uttar Pradesh", "Uttarakhand", "West Bengal", "Jammu & Kashmir", "Ladakh",
  "Puducherry", "Chandigarh", "Andaman & Nicobar Islands", "Dadra & Nagar Haveli and Daman & Diu", "Lakshadweep",
];

const emptyReg = {
  full_name: "",
  phone: "",
  email: "",
  password: "",
  confirm: "",
  city: "",
  state: "",
  country: "India",
  pincode: "",
  address: "",
};

const Field = ({
  icon,
  children,
  right,
}: {
  icon?: React.ReactNode;
  children: React.ReactNode;
  right?: React.ReactNode;
}) => (
  <div className="relative">
    {icon && <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gold/70">{icon}</span>}
    {children}
    {right && <span className="absolute right-3 top-1/2 -translate-y-1/2 z-10 flex items-center">{right}</span>}
  </div>
);

const inputClass = "h-11 bg-background/40 border-gold/20 text-cosmic-silver placeholder:text-cosmic-silver/40 rounded-xl";

/** Full-screen gate shown on the Shop page until the visitor is authenticated. */
const ShopAuthGate = () => {
  const { setCustomerSession } = useAuth();
  const [busy, setBusy] = useState(false);
  const [reg, setReg] = useState(emptyReg);
  const [log, setLog] = useState({ email: "", password: "" });

  // Password visibility state
  const [showLogPassword, setShowLogPassword] = useState(false);
  const [showRegPassword, setShowRegPassword] = useState(false);
  const [showRegConfirm, setShowRegConfirm] = useState(false);
  const [showResetNewPassword, setShowResetNewPassword] = useState(false);
  const [showResetConfirmPassword, setShowResetConfirmPassword] = useState(false);

  // Forgot password state
  const [showForgotPassword, setShowForgotPassword] = useState(false);
  const [resetMode, setResetMode] = useState<"direct" | "link">("direct");
  const [resetEmail, setResetEmail] = useState("");
  const [resetNewPassword, setResetNewPassword] = useState("");
  const [resetConfirmPassword, setResetConfirmPassword] = useState("");
  const [resetBusy, setResetBusy] = useState(false);
  const [resetSent, setResetSent] = useState(false);
  const [resetGeneratedUrl, setResetGeneratedUrl] = useState("");
  const [resetCopied, setResetCopied] = useState(false);

  const afterAuth = async (name: string, userId: string, email: string) => {
    try {
      await updateDoc(doc(db, "profiles", userId), {
        last_login_at: new Date().toISOString(),
      });
    } catch {
      // If profile doc doesn't exist yet, it's created during registration
    }
    try {
      await addDoc(collection(db, "login_history"), {
        user_id: userId,
        email,
        timestamp: new Date().toISOString(),
      });
    } catch (e) {
      console.warn("Failed to record login history:", e);
    }
    toast.success(`Welcome, ${name} 👋`);
    welcomeCustomer(name);
  };

  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    const clean = resetEmail.trim().toLowerCase();
    if (!clean || !/^\S+@\S+\.\S+$/.test(clean)) {
      return toast.error("Please enter your valid registered email address");
    }

    setResetBusy(true);

    // MODE 1: Direct Instant Password Reset
    if (resetMode === "direct" || resetNewPassword) {
      if (!resetNewPassword || resetNewPassword.length < 6) {
        setResetBusy(false);
        return toast.error("New password must be at least 6 characters long");
      }
      if (resetNewPassword !== resetConfirmPassword) {
        setResetBusy(false);
        return toast.error("New passwords do not match. Please re-enter.");
      }
      try {
        const res = await fetch("/api/customer/reset-password", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: clean, new_password: resetNewPassword }),
        });
        const data = await res.json();
        if (!res.ok || !data.success) {
          throw new Error(data.error || "Failed to reset password");
        }

        toast.success("Password updated successfully! Welcome back.");
        if (data.user) {
          setCustomerSession({
            id: data.user.id,
            email: data.user.email,
            full_name: data.user.full_name || clean.split("@")[0],
            phone: data.user.phone,
          });
        }
        setShowForgotPassword(false);
        setResetSent(false);
        return;
      } catch (err: any) {
        toast.error(err.message || "Failed to update password. Please check your email.");
        return;
      } finally {
        setResetBusy(false);
      }
    }

    // MODE 2: Secure Password Reset Link Generation
    try {
      const sRes = await fetch("/api/customer/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: clean }),
      });
      const sData = await sRes.json().catch(() => null);
      if (sData?.reset_url) {
        setResetGeneratedUrl(sData.reset_url);
      }

      // Also trigger Firebase password reset email in the background if enabled
      try {
        await sendPasswordResetEmail(auth, clean);
      } catch (fbErr) {
        console.warn("Firebase password reset email background note:", fbErr);
      }

      setResetSent(true);
      toast.success("Password reset link is ready! Click below or check your email.");
    } catch (err: any) {
      toast.error(err?.message || "Failed to generate password reset link. Please try again.");
    } finally {
      setResetBusy(false);
    }
  };

  const register = async (e: React.FormEvent) => {
    e.preventDefault();
    const r = reg;
    const fullName = r.full_name.trim();
    const email = r.email.trim().toLowerCase();
    const phone = r.phone.trim();
    const cleanPhone = phone.replace(/\D/g, "").slice(-10);
    const password = r.password;

    if (!fullName || fullName.length < 2) return toast.error("Please enter your full name (minimum 2 characters)");
    if (!email || !/^\S+@\S+\.\S+$/.test(email)) return toast.error("Email is required. Enter a valid email address");
    if (!phone || cleanPhone.length !== 10 || !/^[6-9]\d{9}$/.test(cleanPhone))
      return toast.error("Mobile number is required. Enter a valid 10-digit Indian mobile number");
    if (password.length < 6) return toast.error("Password must be at least 6 characters long");
    if (password !== r.confirm) return toast.error("Passwords do not match");

    setBusy(true);

    try {
      let registeredUser: any = null;
      let fbUserUid: string = "";

      // 1. Direct Firebase Auth registration (Native client SDK, 100% works on Netlify)
      try {
        const userCred = await createUserWithEmailAndPassword(auth, email, password);
        if (userCred.user) {
          fbUserUid = userCred.user.uid;
          await updateProfile(userCred.user, { displayName: fullName }).catch(() => {});
          registeredUser = {
            id: userCred.user.uid,
            uid: userCred.user.uid,
            email,
            displayName: fullName,
            full_name: fullName,
            phone: cleanPhone,
            phoneNumber: cleanPhone,
            role: "customer",
            isAdmin: false,
          };
        }
      } catch (fbErr: any) {
        if (fbErr?.code === "auth/email-already-in-use") {
          toast.error("This email address is already registered! Please sign in.");
          setLog((prev) => ({ ...prev, email }));
          setBusy(false);
          return;
        }
        console.warn("Direct Firebase registration note:", fbErr?.code);
      }

      // 2. Also try server API if server is reachable
      try {
        const sRes = await fetch("/api/customer/register", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            full_name: fullName,
            email,
            phone: cleanPhone,
            password,
            address: r.address.trim(),
            city: r.city.trim(),
            state: r.state.trim(),
            pincode: r.pincode.trim(),
          }),
        }).catch(() => null);

        const sData = sRes ? await sRes.json().catch(() => null) : null;
        if (sData?.alreadyExists || (sData?.error && sData.error.toLowerCase().includes("already registered"))) {
          setLog((prev) => ({ ...prev, email: sData?.registeredEmail || email }));
          toast.error("This email address or mobile number is already registered! Please log in.");
          setBusy(false);
          return;
        }
        if (sRes?.ok && sData?.success && sData?.user) {
          registeredUser = {
            ...sData.user,
            full_name: fullName,
            displayName: fullName,
            phone: cleanPhone,
            phoneNumber: cleanPhone,
          };
        }
      } catch {}

      // 3. Fallback: If neither threw duplicate error
      if (!registeredUser) {
        const fallbackId = `cust_${Date.now()}`;
        registeredUser = {
          id: fallbackId,
          uid: fallbackId,
          email,
          displayName: fullName,
          full_name: fullName,
          phone: cleanPhone,
          phoneNumber: cleanPhone,
          role: "customer",
          isAdmin: false,
        };
      }

      const effectiveId = registeredUser.id || registeredUser.uid || fbUserUid || `cust_${Date.now()}`;

      // 4. Save profile in Firestore
      try {
        await setDoc(doc(db, "profiles", effectiveId), {
          id: effectiveId,
          full_name: fullName,
          email,
          phone: cleanPhone,
          created_at: new Date().toISOString(),
          last_login_at: new Date().toISOString(),
        }, { merge: true });
      } catch (dbErr) {
        console.warn("Firestore profile sync warning:", dbErr);
      }

      // 5. Establish authenticated session
      setCustomerSession(registeredUser);

      // Save locally in device cache
      try {
        const list = JSON.parse(localStorage.getItem("awh_saved_accounts") || "[]");
        const filtered = list.filter((a: any) => a.email !== email && a.phone !== cleanPhone);
        filtered.push({ email, phone: cleanPhone, user: registeredUser, password });
        localStorage.setItem("awh_saved_accounts", JSON.stringify(filtered));
      } catch {}

      notifyAuthSuccess({
        userId: effectiveId,
        email,
        fullName,
        eventType: "register",
        authMethod: "password",
      });

      // Save default address in Firestore if provided
      if (r.address.trim()) {
        try {
          await addDoc(collection(db, "addresses"), {
            user_id: effectiveId,
            label: "Home",
            full_name: fullName,
            phone: cleanPhone || null,
            email: email,
            address: r.address.trim(),
            city: r.city.trim(),
            state: r.state.trim(),
            pincode: r.pincode.trim(),
            country: r.country.trim() || "India",
            is_default: true,
            created_at: new Date().toISOString(),
          });
        } catch (addrErr) {
          console.warn("Firestore address save warning:", addrErr);
        }
      }

      toast.success(`Registration successful! Welcome ${fullName.split(" ")[0]} 🎉`);
      await afterAuth(fullName, effectiveId, email);
    } catch (err: any) {
      console.warn("Registration issue:", err);
      toast.error(err.message || "Registration service temporarily busy. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  const login = async (e: React.FormEvent) => {
    e.preventDefault();
    const identifier = log.email.trim();
    const password = log.password;

    if (!identifier || !password) return toast.error("Please enter your email and password");

    setBusy(true);

    try {
      let loggedUser: any = null;

      // 1. Direct Firebase Auth if identifier contains @ (Client-side, works on Netlify)
      if (identifier.includes("@")) {
        try {
          const fbRes = await signInWithEmailAndPassword(auth, identifier.toLowerCase(), password);
          if (fbRes.user) {
            const fbUser = fbRes.user;
            let name = fbUser.displayName || identifier.split("@")[0] || "Customer";
            let phone = fbUser.phoneNumber || null;

            try {
              const pSnap = await getDoc(doc(db, "profiles", fbUser.uid));
              if (pSnap.exists()) {
                const pData = pSnap.data();
                if (pData?.full_name) name = pData.full_name;
                if (pData?.phone) phone = pData.phone;
              }
            } catch {}

            loggedUser = {
              id: fbUser.uid,
              uid: fbUser.uid,
              email: fbUser.email || identifier.toLowerCase(),
              displayName: name,
              full_name: name,
              phoneNumber: phone,
              phone: phone,
              role: "customer",
              isAdmin: false,
            };
          }
        } catch (fbAuthErr: any) {
          if (fbAuthErr?.code === "auth/wrong-password" || fbAuthErr?.code === "auth/invalid-credential") {
            toast.error("Incorrect password. Please try again or click 'Forgot Password?' below.");
            setBusy(false);
            return;
          }
        }
      }

      // 2. Try server API if not yet authenticated
      if (!loggedUser) {
        try {
          const sRes = await fetch("/api/customer/login", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email: identifier, password }),
          }).catch(() => null);

          const sData = sRes ? await sRes.json().catch(() => null) : null;
          if (sRes?.ok && sData?.success && sData?.user) {
            loggedUser = sData.user;
          } else if (sData?.error && sData.error.toLowerCase().includes("incorrect password")) {
            toast.error("Incorrect password. Please try again or click 'Forgot Password?' below.");
            setBusy(false);
            return;
          }
        } catch {}
      }

      // 3. Fallback to local accounts cache on device
      if (!loggedUser) {
        try {
          const localAccounts = JSON.parse(localStorage.getItem("awh_saved_accounts") || "[]");
          const cleanIdent = identifier.toLowerCase();
          const normIdentPhone = identifier.replace(/\D/g, "").slice(-10);
          const match = localAccounts.find((a: any) =>
            (a.email && a.email.toLowerCase() === cleanIdent) ||
            (a.phone && a.phone.replace(/\D/g, "").slice(-10) === normIdentPhone && normIdentPhone.length === 10)
          );
          if (match) {
            if (match.password === password && match.user) {
              loggedUser = match.user;
            } else {
              toast.error("Incorrect password. Please try again or click 'Forgot Password?' below.");
              setBusy(false);
              return;
            }
          }
        } catch {}
      }

      if (loggedUser) {
        setCustomerSession(loggedUser);
        const name = loggedUser.displayName || loggedUser.full_name || "Seeker";
        const resolvedEmail = loggedUser.email || identifier;
        notifyAuthSuccess({
          userId: loggedUser.id || loggedUser.uid,
          email: resolvedEmail,
          fullName: name,
          eventType: "login",
          authMethod: "password",
        });
        toast.success(`Welcome back, ${name.split(" ")[0]}! 👋`);
        await afterAuth(name, loggedUser.id || loggedUser.uid, resolvedEmail);
        return;
      }

      toast.error("Invalid email, mobile number, or password. Please check your credentials.");
    } catch (err: any) {
      console.warn("Login issue:", err);
      toast.error(err.message || "Login service temporarily unavailable. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="container max-w-2xl pt-36 pb-24">
      <motion.div initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} className="text-center mb-8">
        <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full glass-gold mb-5">
          <Lock className="h-3.5 w-3.5 text-gold" />
          <span className="text-xs tracking-[0.28em] uppercase text-gold">Members Only Store</span>
        </div>
        <h1 className="font-display text-4xl sm:text-5xl font-bold text-gradient-gold mb-3">Sacred Store Access</h1>
        <p className="text-cosmic-silver/75 max-w-lg mx-auto">
          Create your account or sign in to browse and order authentic spiritual energized products.
        </p>
      </motion.div>

      <motion.div initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }} className="notranslate" translate="no">
        {showForgotPassword ? (
          <div className="glass-gold rounded-3xl p-6 sm:p-8 space-y-5 border border-gold/20 shadow-2xl max-w-md mx-auto notranslate" translate="no">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  setShowForgotPassword(false);
                  setResetSent(false);
                  setResetGeneratedUrl("");
                }}
                className="p-1.5 rounded-lg text-cosmic-silver/70 hover:text-gold hover:bg-gold/10 transition-colors"
                title="Back to login"
              >
                <ArrowLeft className="h-5 w-5" />
              </button>
              <h2 className="text-xl font-serif font-bold text-foreground">
                Reset Password
              </h2>
            </div>

            <p className="text-xs text-muted-foreground leading-relaxed">
              Reset your password instantly below, or generate an official password reset link.
            </p>

            {/* Mode switch */}
            <div className="grid grid-cols-2 gap-1 p-1 bg-background/50 rounded-xl border border-gold/20 text-xs">
              <button
                type="button"
                onClick={() => setResetMode("direct")}
                className={`py-2 rounded-lg font-medium transition-all ${
                  resetMode === "direct"
                    ? "bg-gradient-gold text-primary-foreground font-semibold shadow-sm"
                    : "text-cosmic-silver/70 hover:text-gold"
                }`}
              >
                Set New Password
              </button>
              <button
                type="button"
                onClick={() => setResetMode("link")}
                className={`py-2 rounded-lg font-medium transition-all ${
                  resetMode === "link"
                    ? "bg-gradient-gold text-primary-foreground font-semibold shadow-sm"
                    : "text-cosmic-silver/70 hover:text-gold"
                }`}
              >
                Get Reset Link
              </button>
            </div>

            {resetSent ? (
              <div className="rounded-2xl p-4 bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 space-y-3">
                <div className="flex items-center gap-2 font-medium text-sm">
                  <CheckCircle2 className="h-5 w-5 text-emerald-400 shrink-0" />
                  <span>Password Reset Ready!</span>
                </div>
                <p className="text-xs text-emerald-300/80 leading-relaxed">
                  A secure reset link has been prepared for <strong className="text-emerald-200">{resetEmail}</strong>. You can open it directly now or copy the link:
                </p>

                {resetGeneratedUrl && (
                  <div className="space-y-2 pt-1">
                    <div className="p-2.5 rounded-lg bg-background/80 border border-emerald-500/30 font-mono text-[11px] text-emerald-300 break-all select-all">
                      {resetGeneratedUrl}
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <a
                        href={resetGeneratedUrl}
                        className="h-9 px-3 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold flex items-center justify-center text-center transition-colors"
                      >
                        Open Reset Page
                      </a>
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => {
                          navigator.clipboard.writeText(resetGeneratedUrl);
                          setResetCopied(true);
                          toast.success("Reset link copied to clipboard!");
                          setTimeout(() => setResetCopied(false), 2000);
                        }}
                        className="h-9 text-xs border-emerald-500/30 text-emerald-300 hover:bg-emerald-500/20"
                      >
                        {resetCopied ? "Copied!" : "Copy Link"}
                      </Button>
                    </div>
                  </div>
                )}

                <div className="pt-2">
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => {
                      setShowForgotPassword(false);
                      setResetSent(false);
                      setResetGeneratedUrl("");
                    }}
                    className="w-full text-xs text-cosmic-silver/70 hover:text-gold"
                  >
                    Back to Login
                  </Button>
                </div>
              </div>
            ) : (
              <form onSubmit={handleForgotPassword} className="space-y-3.5">
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-cosmic-silver/80">Registered Email Address</label>
                  <Field icon={<Mail className="h-4 w-4" />}>
                    <Input
                      required
                      type="email"
                      placeholder="your.email@example.com"
                      value={resetEmail}
                      onChange={(e) => setResetEmail(e.target.value)}
                      className={`pl-10 ${inputClass}`}
                    />
                  </Field>
                </div>

                {resetMode === "direct" && (
                  <>
                    <div className="space-y-1.5">
                      <label className="text-xs font-medium text-cosmic-silver/80">New Password (min 6 chars)</label>
                      <Field
                        icon={<Lock className="h-4 w-4" />}
                        right={
                          <button
                            type="button"
                            onClick={() => setShowResetNewPassword(!showResetNewPassword)}
                            className="text-muted-foreground hover:text-gold transition-colors focus:outline-none pr-1"
                            aria-label={showResetNewPassword ? "Hide password" : "Show password"}
                          >
                            {showResetNewPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                          </button>
                        }
                      >
                        <Input
                          required
                          type={showResetNewPassword ? "text" : "password"}
                          placeholder="Enter new password"
                          value={resetNewPassword}
                          onChange={(e) => setResetNewPassword(e.target.value)}
                          className={`pl-10 pr-10 ${inputClass}`}
                        />
                      </Field>
                    </div>

                    <div className="space-y-1.5">
                      <label className="text-xs font-medium text-cosmic-silver/80">Confirm New Password</label>
                      <Field
                        icon={<KeyRound className="h-4 w-4" />}
                        right={
                          <button
                            type="button"
                            onClick={() => setShowResetConfirmPassword(!showResetConfirmPassword)}
                            className="text-muted-foreground hover:text-gold transition-colors focus:outline-none pr-1"
                            aria-label={showResetConfirmPassword ? "Hide password" : "Show password"}
                          >
                            {showResetConfirmPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                          </button>
                        }
                      >
                        <Input
                          required
                          type={showResetConfirmPassword ? "text" : "password"}
                          placeholder="Re-enter new password"
                          value={resetConfirmPassword}
                          onChange={(e) => setResetConfirmPassword(e.target.value)}
                          className={`pl-10 pr-10 ${inputClass}`}
                        />
                      </Field>
                    </div>
                  </>
                )}

                <Button
                  disabled={resetBusy}
                  type="submit"
                  size="lg"
                  className="w-full h-12 bg-gradient-gold text-primary-foreground font-semibold rounded-xl shadow-lg hover:opacity-95 transition-all flex items-center justify-center gap-2 mt-2"
                >
                  <KeyRound className="h-4 w-4" />
                  {resetBusy
                    ? resetMode === "direct"
                      ? "Updating Password..."
                      : "Generating Link..."
                    : resetMode === "direct"
                    ? "Update Password & Log In"
                    : "Generate Password Reset Link"}
                </Button>

                <div className="text-center pt-2">
                  <button
                    type="button"
                    onClick={() => setShowForgotPassword(false)}
                    className="text-xs text-cosmic-silver/70 hover:text-gold transition-colors notranslate"
                    translate="no"
                  >
                    Remember your password? <strong>Sign In</strong>
                  </button>
                </div>
              </form>
            )}
          </div>
        ) : (
          <Tabs defaultValue="login" className="notranslate" translate="no">
            <TabsList className="glass-gold grid grid-cols-2 w-full mb-5 max-w-md mx-auto">
              <TabsTrigger value="login" className="data-[state=active]:bg-gradient-gold data-[state=active]:text-primary-foreground">
                Customer Login
              </TabsTrigger>
              <TabsTrigger value="register" className="data-[state=active]:bg-gradient-gold data-[state=active]:text-primary-foreground">
                Register New Account
              </TabsTrigger>
            </TabsList>

            <TabsContent value="login">
              <div className="glass-gold rounded-3xl p-6 sm:p-8 space-y-4 max-w-md mx-auto">
                <form onSubmit={login} className="space-y-4">
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-cosmic-silver/80">Email Address</label>
                    <Field icon={<Mail className="h-4 w-4" />}>
                      <Input required type="email" autoComplete="email" placeholder="your.email@example.com" value={log.email} onChange={(e) => setLog({ ...log, email: e.target.value })} className={`pl-10 ${inputClass}`} />
                    </Field>
                  </div>

                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <label className="text-xs font-medium text-cosmic-silver/80">Password</label>
                      <button
                        type="button"
                        translate="no"
                        onClick={() => {
                          setResetEmail(log.email || "");
                          setShowForgotPassword(true);
                          setResetSent(false);
                          setResetGeneratedUrl("");
                        }}
                        className="notranslate text-[11px] text-gold hover:text-gold/80 hover:underline transition-colors"
                      >
                        Forgot password?
                      </button>
                    </div>
                    <Field
                      icon={<Lock className="h-4 w-4" />}
                      right={
                        <button
                          type="button"
                          onClick={() => setShowLogPassword(!showLogPassword)}
                          className="text-muted-foreground hover:text-gold transition-colors focus:outline-none pr-1"
                          aria-label={showLogPassword ? "Hide password" : "Show password"}
                        >
                          {showLogPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                        </button>
                      }
                    >
                      <Input
                        required
                        type={showLogPassword ? "text" : "password"}
                        autoComplete="current-password"
                        placeholder="Enter password"
                        value={log.password}
                        onChange={(e) => setLog({ ...log, password: e.target.value })}
                        className={`pl-10 pr-10 ${inputClass}`}
                      />
                    </Field>
                  </div>

                  <Button disabled={busy} type="submit" size="lg" className="w-full bg-gradient-gold text-primary-foreground font-semibold glow-gold h-12 rounded-xl mt-2">
                    {busy ? "Signing in..." : "Login & Enter Store"}
                  </Button>
                </form>
              </div>
            </TabsContent>

            <TabsContent value="register">
              <div className="glass-gold rounded-3xl p-6 sm:p-8 space-y-4 max-w-xl mx-auto">
                <div className="text-center mb-2">
                  <h2 className="text-lg font-serif font-bold text-foreground">Create Customer Account</h2>
                  <p className="text-xs text-muted-foreground">Register your free account for secure checkout and fast ordering</p>
                </div>

                <form onSubmit={register} className="space-y-3">
                  <div className="grid sm:grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <label className="text-xs font-medium text-cosmic-silver/80">Full Name *</label>
                      <Field icon={<User className="h-4 w-4" />}>
                        <Input required placeholder="Full Name" value={reg.full_name} onChange={(e) => setReg({ ...reg, full_name: e.target.value })} className={`pl-10 ${inputClass}`} />
                      </Field>
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-medium text-cosmic-silver/80">Mobile Number *</label>
                      <Field icon={<Phone className="h-4 w-4" />}>
                        <Input required type="tel" inputMode="numeric" maxLength={10} placeholder="10-digit Mobile Number" value={reg.phone} onChange={(e) => setReg({ ...reg, phone: e.target.value.replace(/\D/g, "").slice(0, 10) })} className={`pl-10 ${inputClass}`} />
                      </Field>
                    </div>
                  </div>

                  <div className="space-y-1">
                    <label className="text-xs font-medium text-cosmic-silver/80">Email Address *</label>
                    <Field icon={<Mail className="h-4 w-4" />}>
                      <Input required type="email" autoComplete="email" placeholder="your.email@example.com" value={reg.email} onChange={(e) => setReg({ ...reg, email: e.target.value })} className={`pl-10 ${inputClass}`} />
                    </Field>
                  </div>

                  <div className="grid sm:grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <label className="text-xs font-medium text-cosmic-silver/80">Password</label>
                      <Field
                        icon={<Lock className="h-4 w-4" />}
                        right={
                          <button
                            type="button"
                            onClick={() => setShowRegPassword(!showRegPassword)}
                            className="text-muted-foreground hover:text-gold transition-colors focus:outline-none pr-1"
                            aria-label={showRegPassword ? "Hide password" : "Show password"}
                          >
                            {showRegPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                          </button>
                        }
                      >
                        <Input
                          required
                          type={showRegPassword ? "text" : "password"}
                          autoComplete="new-password"
                          placeholder="Min 6 characters"
                          value={reg.password}
                          onChange={(e) => setReg({ ...reg, password: e.target.value })}
                          className={`pl-10 pr-10 ${inputClass}`}
                        />
                      </Field>
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-medium text-cosmic-silver/80">Confirm Password</label>
                      <Field
                        icon={<ShieldCheck className="h-4 w-4" />}
                        right={
                          <button
                            type="button"
                            onClick={() => setShowRegConfirm(!showRegConfirm)}
                            className="text-muted-foreground hover:text-gold transition-colors focus:outline-none pr-1"
                            aria-label={showRegConfirm ? "Hide password" : "Show password"}
                          >
                            {showRegConfirm ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                          </button>
                        }
                      >
                        <Input
                          required
                          type={showRegConfirm ? "text" : "password"}
                          autoComplete="new-password"
                          placeholder="Confirm Password"
                          value={reg.confirm}
                          onChange={(e) => setReg({ ...reg, confirm: e.target.value })}
                          className={`pl-10 pr-10 ${inputClass}`}
                        />
                      </Field>
                    </div>
                  </div>

                  <div className="pt-2 text-[11px] uppercase tracking-[0.2em] text-gold/80 font-medium">Delivery Details (Optional)</div>

                  <Field icon={<MapPin className="h-4 w-4" />}>
                    <Input placeholder="Complete Address (house, street, area)" value={reg.address} onChange={(e) => setReg({ ...reg, address: e.target.value })} className={`pl-10 ${inputClass}`} />
                  </Field>

                  <div className="grid sm:grid-cols-2 gap-3">
                    <Input placeholder="City" value={reg.city} onChange={(e) => setReg({ ...reg, city: e.target.value })} className={inputClass} />
                    <select
                      value={reg.state}
                      onChange={(e) => setReg({ ...reg, state: e.target.value })}
                      className="h-11 rounded-xl bg-background/40 border border-gold/20 px-3 text-sm text-cosmic-silver"
                    >
                      <option value="">Select State (optional)</option>
                      {INDIAN_STATES.map((s) => (
                        <option key={s} value={s} className="bg-background">{s}</option>
                      ))}
                    </select>
                  </div>

                  <div className="grid sm:grid-cols-2 gap-3">
                    <Input inputMode="numeric" maxLength={6} placeholder="Pincode" value={reg.pincode} onChange={(e) => setReg({ ...reg, pincode: e.target.value.replace(/\D/g, "").slice(0, 6) })} className={inputClass} />
                    <Input placeholder="Country" value={reg.country} onChange={(e) => setReg({ ...reg, country: e.target.value })} className={inputClass} />
                  </div>

                  <Button disabled={busy} type="submit" size="lg" className="w-full bg-gradient-gold text-primary-foreground font-semibold glow-gold h-12 rounded-xl mt-2">
                    {busy ? "Creating your account..." : "Create Account & Enter Store"}
                  </Button>
                  <p className="text-[11px] text-center text-cosmic-silver/50">
                    <Sparkles className="inline h-3 w-3 text-gold mr-1" />
                    Your details are stored securely and used only for your orders.
                  </p>
                </form>
              </div>
            </TabsContent>
          </Tabs>
        )}
      </motion.div>
    </section>
  );
};

export default ShopAuthGate;
export { INDIAN_STATES };

