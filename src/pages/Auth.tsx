import { useState } from "react";
import { Link, Navigate, useNavigate, useSearchParams } from "react-router-dom";
import PageLayout from "@/components/PageLayout";
import SEO from "@/components/SEO";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  sendPasswordResetEmail,
  GoogleAuthProvider,
  signInWithPopup,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  updateProfile,
} from "firebase/auth";
import { doc, getDoc, setDoc, collection, query, where, getDocs } from "firebase/firestore";
import { auth, db } from "@/lib/firebase";
import { useAuth } from "@/hooks/useAuth";
import { notifyAuthSuccess } from "@/lib/authNotifier";
import { trackLogin, trackSignUp } from "@/lib/analytics";
import { toast } from "sonner";
import { User, Phone, Mail, Lock, KeyRound, ArrowLeft, CheckCircle2, ShieldCheck, Eye, EyeOff } from "lucide-react";

const BACKEND_BASE = (import.meta.env.VITE_BACKEND_URL || "").replace(/\/$/, "");

async function postCustomerApi(path: string, body: any): Promise<{ ok: boolean; data: any }> {
  try {
    const res = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).catch(() => null);

    const text = res ? await res.text().catch(() => "") : "";
    if (text && text.trim().startsWith("{")) {
      try {
        const data = JSON.parse(text);
        return { ok: Boolean(res?.ok), data };
      } catch {}
    }

    if (BACKEND_BASE) {
      const fbRes = await fetch(`${BACKEND_BASE}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }).catch(() => null);
      const fbText = fbRes ? await fbRes.text().catch(() => "") : "";
      if (fbText && fbText.trim().startsWith("{")) {
        try {
          return { ok: Boolean(fbRes?.ok), data: JSON.parse(fbText) };
        } catch {}
      }
    }
  } catch {}
  return { ok: false, data: null };
}

const Auth = () => {
  const { user, loading, setCustomerSession, signOut } = useAuth();
  const nav = useNavigate();
  const [params] = useSearchParams();
  const rawRedirect = params.get("redirect") || "";
  const redirectTo = (!rawRedirect || rawRedirect.startsWith("/auth") || rawRedirect.startsWith("/login"))
    ? "/checkout"
    : rawRedirect;
  const [busy, setBusy] = useState(false);
  const [activeTab, setActiveTab] = useState<"login" | "register">("login");

  const [reg, setReg] = useState({ full_name: "", email: "", phone: "", password: "", confirm: "" });
  const [log, setLog] = useState({ email: "", password: "" });

  // Password visibility state
  const [showLoginPassword, setShowLoginPassword] = useState(false);
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

  if (loading)
    return (
      <PageLayout title="Sign In">
        <div className="min-h-[60vh] flex items-center justify-center">
          <div className="h-10 w-10 rounded-full border-2 border-gold/30 border-t-gold animate-spin" />
        </div>
      </PageLayout>
    );

  if (user) {
    if (rawRedirect) {
      return <Navigate to={redirectTo} replace />;
    }
    return (
      <PageLayout title="My Account">
        <SEO title="My Account | Astro With Hrishi" description="Manage your customer account and view recent orders." />
        <div className="max-w-md mx-auto pt-6 pb-14 px-4 notranslate" translate="no">
          <div className="glass-gold rounded-3xl p-6 sm:p-8 space-y-6 border border-gold/30 shadow-2xl text-center">
            <div className="mx-auto w-16 h-16 rounded-full bg-gradient-gold flex items-center justify-center text-primary-foreground text-2xl font-bold shadow-lg">
              {(user.displayName || user.email || (user as any).full_name || "U")[0].toUpperCase()}
            </div>
            <div className="space-y-1">
              <div className="flex items-center justify-center gap-2">
                <h2 className="text-xl font-bold text-foreground">
                  {user.displayName || (user as any).full_name || "Valued Customer"}
                </h2>
                <span className="text-[10px] bg-emerald-500/20 text-emerald-300 font-bold px-2 py-0.5 rounded-full border border-emerald-500/30">
                  Logged In ✓
                </span>
              </div>
              <p className="text-xs text-cosmic-silver">{user.email || user.phoneNumber || (user as any).phone || "Active Customer"}</p>
              {(user.phoneNumber || (user as any).phone) && (
                <p className="text-xs text-gold font-mono">{user.phoneNumber || (user as any).phone}</p>
              )}
            </div>

            <div className="p-3.5 rounded-2xl bg-background/50 border border-gold/20 text-xs text-cosmic-silver/90 text-left space-y-1.5">
              <div className="flex items-center justify-between text-[11px] text-muted-foreground pb-1 border-b border-gold/10">
                <span>Account Status:</span>
                <span className="text-emerald-400 font-bold">Authenticated</span>
              </div>
              <div className="flex items-center justify-between text-[11px]">
                <span className="text-muted-foreground">Customer ID:</span>
                <span className="font-mono text-gold text-[10px] truncate max-w-[180px]">{user.id || user.uid}</span>
              </div>
            </div>

            <div className="space-y-2.5 pt-2">
              <Button
                asChild
                className="w-full h-11 bg-gradient-gold text-primary-foreground font-semibold rounded-xl shadow-md"
              >
                <Link to="/checkout">Proceed to Checkout</Link>
              </Button>
              <Button
                asChild
                variant="outline"
                className="w-full h-11 border-gold/30 hover:bg-gold/10 rounded-xl font-medium"
              >
                <Link to="/orders">View My Orders</Link>
              </Button>
              <Button
                asChild
                variant="outline"
                className="w-full h-11 border-gold/30 hover:bg-gold/10 rounded-xl font-medium"
              >
                <Link to="/shop">Browse Sacred Collection</Link>
              </Button>
              <Button
                type="button"
                variant="ghost"
                onClick={() => signOut()}
                className="w-full h-10 text-destructive hover:bg-destructive/10 text-xs font-semibold rounded-xl"
              >
                Log Out from this Device
              </Button>
            </div>
          </div>
        </div>
      </PageLayout>
    );
  }

  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    const clean = resetEmail.trim().toLowerCase();
    const cleanPhone = clean.replace(/\D/g, "").slice(-10);
    const isEmail = /^\S+@\S+\.\S+$/.test(clean);
    const isPhone = cleanPhone.length === 10;

    if (!clean || (!isEmail && !isPhone)) {
      return toast.error("Please enter a valid registered email address or 10-digit mobile number");
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
        const { ok, data } = await postCustomerApi("/api/customer/reset-password", {
          email: clean,
          identifier: clean,
          new_password: resetNewPassword,
        });

        if (ok && data?.success) {
          toast.success("Password updated successfully! Welcome back.");
          if (data.user) {
            setCustomerSession(data.user);
          }
          setShowForgotPassword(false);
          setResetSent(false);
          return;
        }

        // Fallback for Netlify / static hosts: check local saved accounts
        try {
          const list = JSON.parse(localStorage.getItem("awh_saved_accounts") || "[]");
          const idx = list.findIndex((a: any) =>
            (a.email && a.email.toLowerCase() === clean) ||
            (a.phone && a.phone.replace(/\D/g, "").slice(-10) === cleanPhone && cleanPhone.length === 10)
          );
          if (idx !== -1) {
            list[idx].password = resetNewPassword;
            localStorage.setItem("awh_saved_accounts", JSON.stringify(list));
            if (list[idx].user) {
              setCustomerSession(list[idx].user);
            }
            toast.success("Password updated successfully! Welcome back.");
            setShowForgotPassword(false);
            setResetSent(false);
            return;
          }
        } catch {}

        // If email, send official Firebase reset link as safe guarantee
        if (isEmail) {
          try {
            await sendPasswordResetEmail(auth, clean);
            toast.success("Password reset email sent to " + clean + ". Please check your inbox!");
            setShowForgotPassword(false);
            return;
          } catch {}
        }

        throw new Error(data?.error || "Could not update password. Please check your email or phone.");
      } catch (err: any) {
        toast.error(err.message || "Failed to update password. Please check your email or phone.");
        return;
      } finally {
        setResetBusy(false);
      }
    }

    // MODE 2: Secure Password Reset Link Generation
    try {
      if (isEmail) {
        try {
          await sendPasswordResetEmail(auth, clean);
          setResetSent(true);
          toast.success("Password reset email sent! Please check your inbox at " + clean);
          return;
        } catch (fbErr: any) {
          console.warn("Firebase password reset email note:", fbErr?.code);
        }
      }

      const { ok, data: sData } = await postCustomerApi("/api/customer/forgot-password", { email: clean });
      if (sData?.reset_url) {
        setResetGeneratedUrl(sData.reset_url);
        setResetSent(true);
        toast.success("Password reset link is ready! Click below or check your email.");
      } else if (!isEmail) {
        toast.error("Please enter a valid registered email to receive the password reset link.");
      }
    } catch (err: any) {
      toast.error(err?.message || "Failed to generate password reset link. Please try again.");
    } finally {
      setResetBusy(false);
    }
  };

  // Helper to execute login logic reusable from both form submit and auto-login
  const executeCustomerLogin = async (idInput: string, passInput: string) => {
    const identifier = idInput.trim();
    const password = passInput.trim();

    if (!identifier || !password) {
      toast.error("Please enter your email and password");
      return;
    }

    setBusy(true);
    try {
      let loggedUser: any = null;

      // 1. Direct Firebase Auth login if identifier is email (Native client-side, 100% works on Netlify)
      if (identifier.includes("@")) {
        try {
          const fbRes = await signInWithEmailAndPassword(auth, identifier.toLowerCase(), password);
          if (fbRes.user) {
            const fbUser = fbRes.user;
            let name = fbUser.displayName || identifier.split("@")[0] || "Customer";
            let phone = fbUser.phoneNumber || null;

            // Load profile details from Firestore
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
          console.warn("Direct Firebase Auth sign in note:", fbAuthErr?.code);
        }
      }

      // 2. Check server API if not yet logged in
      if (!loggedUser) {
        const { ok, data: sData } = await postCustomerApi("/api/customer/login", { email: identifier, identifier, password });
        if (ok && sData?.success && sData?.user) {
          loggedUser = sData.user;
        } else if (sData?.error && sData.error.toLowerCase().includes("incorrect password")) {
          toast.error("Incorrect password. Please try again or click 'Forgot Password?' below.");
          setBusy(false);
          return;
        }
      }

      // 3. Fallback: Check local saved accounts on this device (for offline or phone-number login)
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

      // 4. If identifier is a 10-digit phone number, search Firestore profiles
      if (!loggedUser && !identifier.includes("@")) {
        const normPhone = identifier.replace(/\D/g, "").slice(-10);
        if (normPhone.length === 10) {
          try {
            const q = query(collection(db, "profiles"), where("phone", "==", normPhone));
            const qSnap: any = await Promise.race([
              getDocs(q).catch(() => null),
              new Promise<null>((resolve) => setTimeout(() => resolve(null), 2500)),
            ]);
            if (qSnap && !qSnap.empty) {
              const matchedProfile = qSnap.docs[0].data();
              if (matchedProfile?.email) {
                try {
                  const fbRes = await signInWithEmailAndPassword(auth, matchedProfile.email, password);
                  if (fbRes.user) {
                    loggedUser = {
                      id: fbRes.user.uid,
                      uid: fbRes.user.uid,
                      email: matchedProfile.email,
                      displayName: matchedProfile.full_name || fbRes.user.displayName || "Customer",
                      phoneNumber: normPhone,
                      phone: normPhone,
                      role: "customer",
                      isAdmin: false,
                    };
                  }
                } catch (pErr: any) {
                  if (pErr?.code === "auth/wrong-password" || pErr?.code === "auth/invalid-credential") {
                    toast.error("Incorrect password. Please try again or click 'Forgot Password?' below.");
                    setBusy(false);
                    return;
                  }
                }
              }
            }
          } catch {}
        }
      }

      // 5. If user successfully authenticated through any provider:
      if (loggedUser) {
        setCustomerSession(loggedUser);

        // Update local cache
        try {
          const list = JSON.parse(localStorage.getItem("awh_saved_accounts") || "[]");
          const filtered = list.filter((a: any) => a.email !== loggedUser.email);
          filtered.push({ email: loggedUser.email, phone: loggedUser.phoneNumber || loggedUser.phone, user: loggedUser, password });
          localStorage.setItem("awh_saved_accounts", JSON.stringify(filtered));
        } catch {}

        const resolvedEmail = loggedUser.email || identifier;
        const firstName = (loggedUser.displayName || loggedUser.full_name || resolvedEmail.split("@")[0] || "User").split(" ")[0];
        notifyAuthSuccess({
          userId: loggedUser.id || loggedUser.uid,
          email: resolvedEmail,
          fullName: loggedUser.displayName || loggedUser.full_name || firstName,
          eventType: "login",
          authMethod: "password",
        });
        trackLogin("password");

        toast.success(`Welcome back, ${firstName}! 👋`);
        nav(redirectTo, { replace: true });
        return;
      }

      // If no account was matched
      toast.error("No account found with this email/mobile, or password incorrect. Click 'Create Account' to register.");
    } catch (error: any) {
      toast.error(error.message || "Sign in failed. Please check your credentials.");
    } finally {
      setBusy(false);
    }
  };

  const register = async (e: React.FormEvent) => {
    e.preventDefault();
    const fullName = reg.full_name.trim();
    const email = reg.email.trim().toLowerCase();
    const phone = reg.phone.trim();
    const cleanPhone = phone.replace(/\D/g, "").slice(-10);
    const password = reg.password.trim();
    const confirm = reg.confirm.trim();

    if (!fullName || fullName.length < 2)
      return toast.error("Please enter your full name (minimum 2 characters)");
    if (!email || !/^\S+@\S+\.\S+$/.test(email))
      return toast.error("Email is required. Please enter a valid email address");
    if (!phone || cleanPhone.length !== 10 || !/^[6-9]\d{9}$/.test(cleanPhone))
      return toast.error("Mobile number is required. Please enter a valid 10-digit Indian mobile number");
    if (password.length < 6)
      return toast.error("Password must be at least 6 characters long");
    if (password !== confirm)
      return toast.error("Passwords do not match. Please re-enter your password");

    setBusy(true);

    try {
      let registeredUser: any = null;
      let fbUserUid: string = "";

      // 1. Direct Firebase Auth registration (native client-side SDK — works 100% on Netlify)
      try {
        const userCred = await createUserWithEmailAndPassword(auth, email, password);
        if (userCred.user) {
          fbUserUid = userCred.user.uid;
          await updateProfile(userCred.user, { displayName: fullName }).catch(() => {});
          registeredUser = {
            id: userCred.user.uid,
            uid: userCred.user.uid,
            email: email,
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
          setLog({ email, password: "" });
          setActiveTab("login");
          setBusy(false);
          return;
        }
        console.warn("Direct Firebase Auth registration note:", fbErr?.code || fbErr?.message);
      }

      // 2. Also sync to server API if server is reachable
      const { ok: sOk, data: sData } = await postCustomerApi("/api/customer/register", {
        full_name: fullName,
        email,
        phone: cleanPhone,
        password,
      });

      if (sData?.alreadyExists || (sData?.error && sData.error.toLowerCase().includes("already registered"))) {
        toast.error("This email address or mobile number is already registered! Please sign in.");
        setLog({ email: sData?.registeredEmail || email, password: "" });
        setActiveTab("login");
        setBusy(false);
        return;
      }

      if (sOk && sData?.success && sData?.user) {
        registeredUser = {
          ...sData.user,
          full_name: fullName,
          displayName: fullName,
          phone: cleanPhone,
          phoneNumber: cleanPhone,
        };
      }

      // 3. Fallback: If neither threw "already exists" but Firebase/server didn't return (e.g. offline/restricted)
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

      // 4. Save/merge profile in Firestore
      const effectiveId = registeredUser.id || registeredUser.uid || fbUserUid || `cust_${Date.now()}`;
      try {
        await setDoc(doc(db, "profiles", effectiveId), {
          id: effectiveId,
          full_name: fullName,
          email: email,
          phone: cleanPhone,
          created_at: new Date().toISOString(),
          last_login_at: new Date().toISOString(),
        }, { merge: true });
      } catch (dbErr) {
        console.warn("Firestore profile sync note:", dbErr);
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

      const firstName = fullName.split(" ")[0] || "Seeker";
      notifyAuthSuccess({
        userId: effectiveId,
        email: email,
        fullName: fullName,
        eventType: "register",
        authMethod: "password",
      });
      trackSignUp("password");

      toast.success(`Registration successful! Welcome ${firstName} 🎉`);
      nav(redirectTo, { replace: true });
    } catch (error: any) {
      toast.error(error.message || "Failed to create account. Please check your information.");
    } finally {
      setBusy(false);
    }
  };

  const customerLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    await executeCustomerLogin(log.email, log.password);
  };

  const handleGoogleSignIn = async () => {
    setBusy(true);
    try {
      const provider = new GoogleAuthProvider();
      const res = await signInWithPopup(auth, provider);
      if (res.user) {
        const fbUser = res.user;
        const name = fbUser.displayName || fbUser.email?.split("@")[0] || "Seeker";
        const email = (fbUser.email || "").trim().toLowerCase();

        try {
          await setDoc(doc(db, "profiles", fbUser.uid), {
            id: fbUser.uid,
            full_name: name,
            email: email,
            phone: fbUser.phoneNumber || null,
            last_login_at: new Date().toISOString(),
          }, { merge: true });
        } catch {}

        notifyAuthSuccess({
          userId: fbUser.uid,
          email: email,
          fullName: name,
          eventType: "login",
          authMethod: "google",
        });
        trackLogin("google");
        toast.success(`Welcome, ${name.split(" ")[0]}! 👋`);
        nav(redirectTo);
      }
    } catch (err: any) {
      if (err.code !== "auth/popup-closed-by-user" && err.code !== "auth/cancelled-popup-request") {
        toast.error(err.message || "Google sign in could not be completed.");
      }
    } finally {
      setBusy(false);
    }
  };

  const field = (icon: React.ReactNode, input: React.ReactNode, rightElement?: React.ReactNode) => (
    <div className="relative">
      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gold/70">{icon}</span>
      {input}
      {rightElement && (
        <span className="absolute right-3 top-1/2 -translate-y-1/2 z-10 flex items-center">{rightElement}</span>
      )}
    </div>
  );

  return (
    <PageLayout title="Sign In">
      <SEO title="Sign In — Astro With Hrishi" description="Sign in to your Astro With Hrishi account to track orders and checkout securely." path="/auth" noindex />
      <div className="container max-w-md py-6 notranslate" translate="no">
        
        {/* Logged in state dashboard view */}
        {user ? (
          <div className="glass-gold rounded-3xl p-6 sm:p-8 space-y-6 border border-gold/30 shadow-2xl text-center notranslate" translate="no">
            <div className="mx-auto w-16 h-16 rounded-full bg-gradient-gold flex items-center justify-center text-primary-foreground font-bold text-2xl shadow-lg">
              {((user.displayName || user.email || "U")[0]).toUpperCase()}
            </div>
            <div className="space-y-1">
              <h2 className="text-xl font-serif font-bold text-foreground">
                Welcome, {user.displayName || "Customer"}!
              </h2>
              <p className="text-xs text-muted-foreground">
                You are currently signed in as <strong className="text-gold">{user.email || user.phoneNumber || user.id}</strong>
              </p>
            </div>

            <div className="grid grid-cols-1 gap-2.5 pt-2">
              <Button asChild size="lg" className="h-12 bg-gradient-gold text-primary-foreground font-semibold rounded-xl">
                <Link to="/checkout">Proceed to Checkout</Link>
              </Button>
              <Button asChild variant="outline" size="lg" className="h-11 border-gold/40 text-gold hover:bg-gold/10 rounded-xl">
                <Link to="/orders">View My Orders</Link>
              </Button>
            </div>

            <div className="pt-3 flex items-center justify-between border-t border-gold/15">
              <Button asChild variant="ghost" size="sm" className="text-xs text-cosmic-silver/80 hover:text-gold">
                <Link to="/shop">Continue Shopping</Link>
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={async () => {
                  await signOut();
                  toast.success("Signed out successfully");
                }}
                className="text-xs text-destructive hover:bg-destructive/10"
              >
                Sign Out
              </Button>
            </div>
          </div>
        ) : showForgotPassword ? (
          <div className="glass-gold rounded-3xl p-6 sm:p-8 space-y-5 border border-gold/20 shadow-2xl notranslate" translate="no">
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
                  {field(
                    <Mail className="h-4 w-4" />,
                    <Input
                      required
                      type="email"
                      placeholder="your.email@example.com"
                      value={resetEmail}
                      onChange={(e) => setResetEmail(e.target.value)}
                      className="pl-10 h-12 bg-background/50 border-gold/30 rounded-xl"
                    />
                  )}
                </div>

                {resetMode === "direct" && (
                  <>
                    <div className="space-y-1.5">
                      <label className="text-xs font-medium text-cosmic-silver/80">New Password (min 6 chars)</label>
                      {field(
                        <Lock className="h-4 w-4" />,
                        <Input
                          required
                          type={showResetNewPassword ? "text" : "password"}
                          placeholder="Enter new password"
                          value={resetNewPassword}
                          onChange={(e) => setResetNewPassword(e.target.value)}
                          className="pl-10 pr-10 h-12 bg-background/50 border-gold/30 rounded-xl"
                        />,
                        <button
                          type="button"
                          onClick={() => setShowResetNewPassword(!showResetNewPassword)}
                          className="text-muted-foreground hover:text-gold transition-colors focus:outline-none pr-3"
                          aria-label={showResetNewPassword ? "Hide password" : "Show password"}
                        >
                          {showResetNewPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                        </button>
                      )}
                    </div>

                    <div className="space-y-1.5">
                      <label className="text-xs font-medium text-cosmic-silver/80">Confirm New Password</label>
                      {field(
                        <KeyRound className="h-4 w-4" />,
                        <Input
                          required
                          type={showResetConfirmPassword ? "text" : "password"}
                          placeholder="Re-enter new password"
                          value={resetConfirmPassword}
                          onChange={(e) => setResetConfirmPassword(e.target.value)}
                          className="pl-10 pr-10 h-12 bg-background/50 border-gold/30 rounded-xl"
                        />,
                        <button
                          type="button"
                          onClick={() => setShowResetConfirmPassword(!showResetConfirmPassword)}
                          className="text-muted-foreground hover:text-gold transition-colors focus:outline-none pr-3"
                          aria-label={showResetConfirmPassword ? "Hide password" : "Show password"}
                        >
                          {showResetConfirmPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                        </button>
                      )}
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
          <Tabs value={activeTab} onValueChange={(val) => setActiveTab(val as "login" | "register")} className="notranslate" translate="no">
            <TabsList className="grid grid-cols-2 w-full mb-5 bg-background/40 p-1 rounded-2xl border border-gold/20">
              <TabsTrigger value="login" className="rounded-xl data-[state=active]:bg-gradient-gold data-[state=active]:text-primary-foreground font-medium">
                Customer Login
              </TabsTrigger>
              <TabsTrigger value="register" className="rounded-xl data-[state=active]:bg-gradient-gold data-[state=active]:text-primary-foreground font-medium">
                Create Account
              </TabsTrigger>
            </TabsList>

            {/* LOGIN TAB */}
            <TabsContent value="login">
              <div className="glass-gold rounded-3xl p-6 sm:p-8 space-y-5 border border-gold/20 shadow-2xl">
                <div className="text-center space-y-1">
                  <h2 className="text-xl font-serif font-bold text-foreground">Welcome Back</h2>
                </div>

                <form onSubmit={customerLogin} className="space-y-4">
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-cosmic-silver/80">Email Address</label>
                    {field(
                      <Mail className="h-4 w-4" />,
                      <Input
                        required
                        type="email"
                        autoComplete="email"
                        placeholder="your.email@example.com"
                        value={log.email}
                        onChange={(e) => setLog({ ...log, email: e.target.value })}
                        className="pl-10 h-12 bg-background/50 border-gold/30 rounded-xl"
                      />
                    )}
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
                    {field(
                      <Lock className="h-4 w-4" />,
                      <Input
                        required
                        type={showLoginPassword ? "text" : "password"}
                        autoComplete="current-password"
                        placeholder="Enter your password"
                        value={log.password}
                        onChange={(e) => setLog({ ...log, password: e.target.value })}
                        className="pl-10 pr-10 h-12 bg-background/50 border-gold/30 rounded-xl"
                      />,
                      <button
                        type="button"
                        onClick={() => setShowLoginPassword(!showLoginPassword)}
                        className="text-muted-foreground hover:text-gold transition-colors focus:outline-none pr-3"
                        aria-label={showLoginPassword ? "Hide password" : "Show password"}
                      >
                        {showLoginPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    )}
                  </div>

                  <Button
                    disabled={busy}
                    type="submit"
                    size="lg"
                    className="w-full h-12 bg-gradient-gold text-primary-foreground font-semibold rounded-xl shadow-lg hover:opacity-95 transition-all mt-2"
                  >
                    {busy ? "Signing in..." : "Sign In to Account"}
                  </Button>
                </form>
              </div>
            </TabsContent>

            {/* REGISTER TAB */}
            <TabsContent value="register">
              <div className="glass-gold rounded-3xl p-6 sm:p-8 space-y-5 border border-gold/20 shadow-2xl">
                <div className="text-center space-y-1">
                  <h2 className="text-xl font-serif font-bold text-foreground">Create Customer Account</h2>
                  <p className="text-xs text-muted-foreground">Register your free account for secure checkout and fast ordering</p>
                </div>

                <form onSubmit={register} className="space-y-4">
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-cosmic-silver/80">Full Name *</label>
                    {field(
                      <User className="h-4 w-4" />,
                      <Input
                        required
                        placeholder="Full Name (e.g. Ramesh Kumar)"
                        value={reg.full_name}
                        onChange={(e) => setReg({ ...reg, full_name: e.target.value })}
                        className="pl-10 h-12 bg-background/50 border-gold/30 rounded-xl"
                      />
                    )}
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-cosmic-silver/80">Email Address *</label>
                    {field(
                      <Mail className="h-4 w-4" />,
                      <Input
                        required
                        type="email"
                        autoComplete="email"
                        placeholder="your.email@example.com"
                        value={reg.email}
                        onChange={(e) => setReg({ ...reg, email: e.target.value })}
                        className="pl-10 h-12 bg-background/50 border-gold/30 rounded-xl"
                      />
                    )}
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-cosmic-silver/80">Mobile Number *</label>
                    {field(
                      <Phone className="h-4 w-4" />,
                      <Input
                        required
                        type="tel"
                        inputMode="numeric"
                        maxLength={10}
                        placeholder="10-digit mobile number"
                        value={reg.phone}
                        onChange={(e) => setReg({ ...reg, phone: e.target.value.replace(/\D/g, "").slice(0, 10) })}
                        className="pl-10 h-12 bg-background/50 border-gold/30 rounded-xl"
                      />
                    )}
                  </div>

                  {/* Password & Confirm Password stacked vertically (upar-niche) for proper view */}
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-cosmic-silver/80">Password (min 6 characters) *</label>
                    {field(
                      <Lock className="h-4 w-4" />,
                      <Input
                        required
                        type={showRegPassword ? "text" : "password"}
                        autoComplete="new-password"
                        placeholder="Enter password (min 6 characters)"
                        value={reg.password}
                        onChange={(e) => setReg({ ...reg, password: e.target.value })}
                        className="pl-10 pr-10 h-12 bg-background/50 border-gold/30 rounded-xl"
                      />,
                      <button
                        type="button"
                        onClick={() => setShowRegPassword(!showRegPassword)}
                        className="text-muted-foreground hover:text-gold transition-colors focus:outline-none pr-3"
                        aria-label={showRegPassword ? "Hide password" : "Show password"}
                      >
                        {showRegPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    )}
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-cosmic-silver/80">Confirm Password *</label>
                    {field(
                      <ShieldCheck className="h-4 w-4" />,
                      <Input
                        required
                        type={showRegConfirm ? "text" : "password"}
                        autoComplete="new-password"
                        placeholder="Re-enter your password to confirm"
                        value={reg.confirm}
                        onChange={(e) => setReg({ ...reg, confirm: e.target.value })}
                        className="pl-10 pr-10 h-12 bg-background/50 border-gold/30 rounded-xl"
                      />,
                      <button
                        type="button"
                        onClick={() => setShowRegConfirm(!showRegConfirm)}
                        className="text-muted-foreground hover:text-gold transition-colors focus:outline-none pr-3"
                        aria-label={showRegConfirm ? "Hide password" : "Show password"}
                      >
                        {showRegConfirm ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    )}
                  </div>

                  <Button
                    disabled={busy}
                    type="submit"
                    size="lg"
                    className="w-full h-12 bg-gradient-gold text-primary-foreground font-semibold rounded-xl shadow-lg hover:opacity-95 transition-all mt-2"
                  >
                    {busy ? "Creating Account..." : "Create Account & Proceed"}
                  </Button>
                </form>
              </div>
            </TabsContent>
          </Tabs>
        )}
      </div>
    </PageLayout>
  );
};

export default Auth;

