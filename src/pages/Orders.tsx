import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import PageLayout from "@/components/PageLayout";
import SEO from "@/components/SEO";
import { Button } from "@/components/ui/button";
import OrderCard, { type OrderRow } from "@/components/shop/OrderCard";
import { collection, query, where, getDocs } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/hooks/useAuth";

const Orders = () => {
  const { user } = useAuth();
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) {
      setLoading(false);
      return;
    }
    let alive = true;
    (async () => {
      try {
        const q = query(
          collection(db, "orders"),
          where("user_id", "==", user.id)
        );
        const snap = await getDocs(q);
        if (!alive) return;
        const rows = snap.docs.map((d) => ({
          id: d.id,
          ...d.data(),
        })) as unknown as OrderRow[];

        // Sort latest first
        rows.sort((a, b) => new Date(b.created_at || "").getTime() - new Date(a.created_at || "").getTime());
        setOrders(rows);
      } catch (err) {
        console.warn("Failed to load user orders:", err);
      }
      setLoading(false);
    })();
    return () => {
      alive = false;
    };
  }, [user]);

  return (
    <PageLayout title="My Orders" subtitle="Track every order placed with Astro With Hrishi.">
      <SEO title="My Orders — Astro With Hrishi" description="View and track your Astro With Hrishi orders." path="/orders" noindex />
      <div className="container max-w-4xl">
        {loading ? (
          <div className="space-y-6">
            {[...Array(2)].map((_, i) => (
              <div key={i} className="h-48 rounded-2xl bg-secondary animate-pulse" />
            ))}
          </div>
        ) : orders.length === 0 ? (
          <div className="text-center py-16">
            <p className="text-muted-foreground mb-6">You have not placed any orders yet.</p>
            <Button asChild className="rounded-full bg-gradient-gold text-primary-foreground">
              <Link to="/shop">Browse the Collection</Link>
            </Button>
          </div>
        ) : (
          <div className="space-y-6">
            {orders.map((o) => (
              <OrderCard key={o.id} order={o} />
            ))}
          </div>
        )}
      </div>
    </PageLayout>
  );
};

export default Orders;
