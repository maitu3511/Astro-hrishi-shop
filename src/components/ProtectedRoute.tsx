import { type ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";

/** Route guard: only signed-in customers may continue. */
const ProtectedRoute = ({ children }: { children: ReactNode }) => {
  const { user, loading } = useAuth();
  const loc = useLocation();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="h-10 w-10 rounded-full border-2 border-gold/30 border-t-gold animate-spin" />
      </div>
    );
  }

  // Safety fallback: inspect storage so synchronous transitions never falsely bounce user
  let effectiveUser = user;
  if (!effectiveUser && typeof window !== "undefined") {
    try {
      const saved =
        localStorage.getItem("awh_customer_session") ||
        sessionStorage.getItem("awh_customer_session") ||
        localStorage.getItem("awh_admin_session") ||
        sessionStorage.getItem("awh_admin_session");
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed && (parsed.email || parsed.id || parsed.uid || parsed.phone || parsed.phoneNumber)) {
          effectiveUser = parsed;
        }
      }
    } catch {}
  }

  if (!effectiveUser) {
    return <Navigate to={`/auth?redirect=${encodeURIComponent(loc.pathname + loc.search)}`} replace />;
  }

  return <>{children}</>;
};

export default ProtectedRoute;
