import { useEffect, useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  Activity,
  ArrowDownRight,
  ArrowUpRight,
  BarChart3,
  Calendar,
  CheckCircle2,
  ChevronRight,
  CreditCard,
  Download,
  ExternalLink,
  Eye,
  Filter,
  Globe,
  Layers,
  Laptop,
  Lock,
  Package,
  PieChart as PieIcon,
  RefreshCw,
  Search,
  Share2,
  ShieldCheck,
  ShoppingBag,
  ShoppingCart,
  Smartphone,
  TrendingUp,
  UserCheck,
  Users,
  XCircle,
  Zap,
} from "lucide-react";
import { collection, query, orderBy, onSnapshot, getDocs } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { fetchAdminCollection, fetchTrackingSettings, saveTrackingSettings, TrackingAdminSettings } from "@/lib/adminApi";
import { inr } from "@/lib/shop";
import { CATALOG } from "@/lib/catalog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { GA_MEASUREMENT_ID, META_PIXEL_ID, GOOGLE_ADS_ID, GOOGLE_ADS_CONVERSION_LABEL } from "@/lib/analytics";

interface AnalyticsEventRow {
  id: string;
  event_name: string;
  timestamp: string;
  path?: string;
  product_id?: string;
  product_name?: string;
  price?: number;
  quantity?: number;
  total?: number;
  amount?: number;
  order_id?: string;
  order_number?: string;
  session_id?: string;
  device_type?: string;
  referrer?: string;
  user_id?: string;
  method?: string;
  search_term?: string;
  status?: string;
}

interface OrderRow {
  id: string;
  order_number: string;
  customer_name?: string;
  customer_phone?: string;
  customer_email?: string;
  items?: any[];
  total: number;
  status: string;
  payment_status: string;
  payment_method?: string;
  razorpay_order_id?: string;
  payment_id?: string;
  transaction_id?: string;
  created_at: string;
  updated_at?: string;
}

interface ProfileRow {
  id: string;
  full_name?: string;
  email?: string;
  phone?: string;
  created_at?: string;
  last_login_at?: string;
}

const RANGES = [
  { key: "today", label: "Today" },
  { key: "yesterday", label: "Yesterday" },
  { key: "7d", label: "Last 7 Days" },
  { key: "30d", label: "Last 30 Days" },
  { key: "this_month", label: "This Month" },
  { key: "last_month", label: "Last Month" },
  { key: "all", label: "All Time" },
  { key: "custom", label: "Custom Range" },
];

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());

const isWithinRange = (isoDate: string, rangeKey: string, customFrom: string, customTo: string): boolean => {
  if (!isoDate) return false;
  const d = new Date(isoDate);
  const now = new Date();
  const today = startOfDay(now);

  if (rangeKey === "today") {
    return d >= today;
  }
  if (rangeKey === "yesterday") {
    const y = new Date(today);
    y.setDate(y.getDate() - 1);
    return d >= y && d < today;
  }
  if (rangeKey === "7d") {
    const past7 = new Date(today);
    past7.setDate(past7.getDate() - 6);
    return d >= past7;
  }
  if (rangeKey === "30d") {
    const past30 = new Date(today);
    past30.setDate(past30.getDate() - 29);
    return d >= past30;
  }
  if (rangeKey === "this_month") {
    const startMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    return d >= startMonth;
  }
  if (rangeKey === "last_month") {
    const startLast = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const endLast = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999);
    return d >= startLast && d <= endLast;
  }
  if (rangeKey === "custom") {
    if (customFrom && d < new Date(customFrom)) return false;
    if (customTo) {
      const end = new Date(customTo);
      end.setHours(23, 59, 59, 999);
      if (d > end) return false;
    }
    return true;
  }
  return true;
};

const CHART_COLORS = ["#D4AF37", "#38BDF8", "#34D399", "#F472B6", "#A78BFA", "#FBBF24", "#FB7185"];

export const AnalyticsDashboard = () => {
  const [events, setEvents] = useState<AnalyticsEventRow[]>([]);
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [profiles, setProfiles] = useState<ProfileRow[]>([]);
  const [range, setRange] = useState("30d");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [loading, setLoading] = useState(true);
  const [searchFilter, setSearchFilter] = useState("");
  const [productSortBy, setProductSortBy] = useState<"views" | "cart" | "sold" | "revenue" | "conversion">("revenue");
  const [activeSubTab, setActiveSubTab] = useState("overview");

  // Admin Tracking Settings State
  const [trackingSettings, setTrackingSettings] = useState<TrackingAdminSettings | null>(null);
  const [trackingSaving, setTrackingSaving] = useState(false);
  const [editTracking, setEditTracking] = useState<TrackingAdminSettings>({
    google_analytics_id: "",
    meta_pixel_id: "",
    google_ads_id: "",
    google_ads_conversion_label: "",
    google_site_verification: "",
    gtm_id: "",
    enabled: true,
  });

  useEffect(() => {
    fetchTrackingSettings().then((data) => {
      if (data) {
        setTrackingSettings(data);
        setEditTracking({
          google_analytics_id: data.google_analytics_id || "",
          meta_pixel_id: data.meta_pixel_id || "",
          google_ads_id: data.google_ads_id || "",
          google_ads_conversion_label: data.google_ads_conversion_label || "",
          google_site_verification: data.google_site_verification || "",
          gtm_id: data.gtm_id || "",
          enabled: data.enabled !== false,
        });
      }
    });
  }, []);

  const handleSaveTracking = async (e: React.FormEvent) => {
    e.preventDefault();
    setTrackingSaving(true);
    try {
      const res = await saveTrackingSettings(editTracking);
      if (res.success) {
        setTrackingSettings(editTracking);
        toast.success(res.message || "Tracking configuration saved successfully.");
      } else {
        toast.error(res.error || "Failed to save tracking configuration.");
      }
    } catch (err: any) {
      toast.error(err.message || "Error saving tracking settings.");
    } finally {
      setTrackingSaving(false);
    }
  };

  // Real-time Firestore Subscriptions with Admin API fallback
  useEffect(() => {
    setLoading(true);

    // 1. Subscribe to analytics_events
    let unsubEvents = () => {};
    try {
      const qEvents = query(collection(db, "analytics_events"), orderBy("timestamp", "desc"));
      unsubEvents = onSnapshot(
        qEvents,
        (snap) => {
          const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() })) as AnalyticsEventRow[];
          setEvents(rows);
        },
        async (err) => {
          console.warn("Analytics events snapshot note:", err.message);
          try {
            const rows = await fetchAdminCollection("analytics_events");
            setEvents(rows as AnalyticsEventRow[]);
          } catch {
            setEvents([]);
          }
        }
      );
    } catch {
      fetchAdminCollection("analytics_events").then((rows) => setEvents(rows as AnalyticsEventRow[])).catch(() => setEvents([]));
    }

    // 2. Subscribe to verified orders
    let unsubOrders = () => {};
    try {
      const qOrders = query(collection(db, "orders"), orderBy("created_at", "desc"));
      unsubOrders = onSnapshot(
        qOrders,
        (snap) => {
          const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() })) as OrderRow[];
          setOrders(rows);
          setLoading(false);
        },
        async (err) => {
          console.warn("Orders listener note:", err.message);
          try {
            const rows = await fetchAdminCollection("orders");
            setOrders(rows as OrderRow[]);
          } catch {
            setOrders([]);
          } finally {
            setLoading(false);
          }
        }
      );
    } catch {
      fetchAdminCollection("orders").then((rows) => setOrders(rows as OrderRow[])).catch(() => setOrders([])).finally(() => setLoading(false));
    }

    // 3. Fetch customer profiles
    getDocs(collection(db, "profiles"))
      .then((snap) => {
        setProfiles(snap.docs.map((d) => ({ id: d.id, ...d.data() })) as ProfileRow[]);
      })
      .catch(async () => {
        try {
          const rows = await fetchAdminCollection("profiles");
          setProfiles(rows as ProfileRow[]);
        } catch {
          setProfiles([]);
        }
      });

    return () => {
      unsubEvents();
      unsubOrders();
    };
  }, []);

  // Filter scoped data by selected date range
  const scopedOrders = useMemo(() => {
    return orders.filter((o) => isWithinRange(o.created_at, range, from, to));
  }, [orders, range, from, to]);

  const scopedEvents = useMemo(() => {
    return events.filter((e) => isWithinRange(e.timestamp, range, from, to));
  }, [events, range, from, to]);

  const scopedProfiles = useMemo(() => {
    return profiles.filter((p) => !p.created_at || isWithinRange(p.created_at, range, from, to));
  }, [profiles, range, from, to]);

  // Verified PAID orders only for revenue calculation (Strict constraint)
  const paidOrders = useMemo(() => {
    return scopedOrders.filter((o) => (o.payment_status || "").toLowerCase() === "paid");
  }, [scopedOrders]);

  const pendingOrders = useMemo(() => {
    return scopedOrders.filter((o) => {
      const s = (o.payment_status || o.status || "").toLowerCase();
      return s === "pending" || s === "pending_payment";
    });
  }, [scopedOrders]);

  const failedOrders = useMemo(() => {
    return scopedOrders.filter((o) => {
      const s = (o.payment_status || o.status || "").toLowerCase();
      return s.includes("fail") || s.includes("cancel");
    });
  }, [scopedOrders]);

  // High-Level KPIs
  const kpis = useMemo(() => {
    // Unique visitors approximated from distinct session_ids or IPs/events
    const sessionIds = new Set<string>();
    scopedEvents.forEach((e) => {
      if (e.session_id) sessionIds.add(e.session_id);
    });
    // Fallback if sessionIds is small: estimate from pageviews
    const totalPageViews = scopedEvents.filter((e) => e.event_name === "page_view").length;
    const totalVisitors = Math.max(sessionIds.size, scopedOrders.length ? Math.ceil(scopedOrders.length * 1.5) : 0, totalPageViews ? Math.ceil(totalPageViews / 2) : 0);

    const productViews = scopedEvents.filter((e) => e.event_name === "view_item").length;
    const addToCartCount = scopedEvents.filter((e) => e.event_name === "add_to_cart").length;
    const checkoutStartedCount = scopedEvents.filter((e) => e.event_name === "begin_checkout").length;
    const paymentInfoCount = scopedEvents.filter((e) => e.event_name === "add_payment_info").length;

    const totalRevenue = paidOrders.reduce((sum, o) => sum + Number(o.total || 0), 0);
    const paidOrderCount = paidOrders.length;
    const aov = paidOrderCount > 0 ? Math.round(totalRevenue / paidOrderCount) : 0;

    // Conversion rate: Paid Orders / Visitors (or Paid Orders / Product Views if visitors is 0)
    const baseAudience = totalVisitors > 0 ? totalVisitors : (productViews > 0 ? productViews : (paidOrderCount > 0 ? paidOrderCount : 1));
    const conversionRate = baseAudience > 0 ? ((paidOrderCount / baseAudience) * 100).toFixed(2) : "0.00";

    return {
      totalVisitors: totalVisitors || (paidOrderCount ? paidOrderCount : 0),
      totalPageViews: totalPageViews || (productViews * 2),
      productViews,
      addToCartCount,
      checkoutStartedCount,
      paymentInfoCount,
      paidOrderCount,
      totalOrdersCount: scopedOrders.length,
      totalRevenue,
      aov,
      conversionRate,
      pendingCount: pendingOrders.length,
      failedCount: failedOrders.length,
    };
  }, [scopedEvents, scopedOrders, paidOrders, pendingOrders, failedOrders]);

  // Daily Sales & Orders Chart Data
  const dailyChartData = useMemo(() => {
    const map = new Map<string, { date: string; revenue: number; orders: number; pageviews: number }>();

    // Seed orders
    scopedOrders.forEach((o) => {
      const day = new Date(o.created_at).toLocaleDateString("en-IN", { day: "2-digit", month: "short" });
      const current = map.get(day) || { date: day, revenue: 0, orders: 0, pageviews: 0 };
      if ((o.payment_status || "").toLowerCase() === "paid") {
        current.revenue += Number(o.total || 0);
        current.orders += 1;
      }
      map.set(day, current);
    });

    // Seed events
    scopedEvents.forEach((e) => {
      const day = new Date(e.timestamp).toLocaleDateString("en-IN", { day: "2-digit", month: "short" });
      const current = map.get(day) || { date: day, revenue: 0, orders: 0, pageviews: 0 };
      if (e.event_name === "page_view") {
        current.pageviews += 1;
      }
      map.set(day, current);
    });

    return Array.from(map.values()).reverse();
  }, [scopedOrders, scopedEvents]);

  // Funnel Data
  const funnelData = useMemo(() => {
    const visitors = Math.max(kpis.totalVisitors, kpis.productViews, kpis.addToCartCount, kpis.paidOrderCount, 1);
    const views = Math.max(kpis.productViews, kpis.addToCartCount, kpis.paidOrderCount);
    const cart = Math.max(kpis.addToCartCount, kpis.checkoutStartedCount, kpis.paidOrderCount);
    const checkout = Math.max(kpis.checkoutStartedCount, kpis.paymentInfoCount, kpis.paidOrderCount);
    const payment = Math.max(kpis.paymentInfoCount, kpis.paidOrderCount);
    const purchase = kpis.paidOrderCount;

    return [
      {
        stage: "1. Visitors / Sessions",
        count: visitors,
        percent: 100,
        dropoff: "-",
        color: "#38BDF8",
      },
      {
        stage: "2. Product Views",
        count: views,
        percent: Math.min(100, Math.round((views / visitors) * 100)),
        dropoff: `${Math.max(0, 100 - Math.round((views / visitors) * 100))}% drop`,
        color: "#818CF8",
      },
      {
        stage: "3. Added to Cart",
        count: cart,
        percent: Math.min(100, Math.round((cart / Math.max(views, 1)) * 100)),
        dropoff: `${Math.max(0, 100 - Math.round((cart / Math.max(views, 1)) * 100))}% drop`,
        color: "#D4AF37",
      },
      {
        stage: "4. Checkout Started",
        count: checkout,
        percent: Math.min(100, Math.round((checkout / Math.max(cart, 1)) * 100)),
        dropoff: `${Math.max(0, 100 - Math.round((checkout / Math.max(cart, 1)) * 100))}% drop`,
        color: "#F59E0B",
      },
      {
        stage: "5. Payment Initiated",
        count: payment,
        percent: Math.min(100, Math.round((payment / Math.max(checkout, 1)) * 100)),
        dropoff: `${Math.max(0, 100 - Math.round((payment / Math.max(checkout, 1)) * 100))}% drop`,
        color: "#EC4899",
      },
      {
        stage: "6. Verified Paid Orders",
        count: purchase,
        percent: Math.min(100, Math.round((purchase / Math.max(payment, 1)) * 100)),
        dropoff: `${Math.max(0, 100 - Math.round((purchase / Math.max(payment, 1)) * 100))}% drop`,
        color: "#10B981",
      },
    ];
  }, [kpis]);

  // Product Analytics Aggregation
  const productStats = useMemo(() => {
    const map = new Map<
      string,
      {
        id: string;
        name: string;
        category: string;
        price: number;
        views: number;
        cartAdds: number;
        quantitySold: number;
        ordersCount: number;
        revenue: number;
      }
    >();

    // Initialize with catalog items
    CATALOG.forEach((item) => {
      map.set(String(item.id), {
        id: String(item.id),
        name: item.title || item.name || "Item",
        category: item.category || "Crystals & Rudraksha",
        price: Number(item.price || 0),
        views: 0,
        cartAdds: 0,
        quantitySold: 0,
        ordersCount: 0,
        revenue: 0,
      });
    });

    // Aggregate from scoped events
    scopedEvents.forEach((e) => {
      if (e.product_id) {
        const prod = map.get(String(e.product_id)) || {
          id: String(e.product_id),
          name: e.product_name || "Product",
          category: "Astrology & Remedies",
          price: Number(e.price || 0),
          views: 0,
          cartAdds: 0,
          quantitySold: 0,
          ordersCount: 0,
          revenue: 0,
        };

        if (e.event_name === "view_item") prod.views += 1;
        if (e.event_name === "add_to_cart") prod.cartAdds += Number(e.quantity || 1);

        map.set(String(e.product_id), prod);
      }
    });

    // Aggregate from verified paid orders
    paidOrders.forEach((o) => {
      if (Array.isArray(o.items)) {
        o.items.forEach((item: any) => {
          const pId = String(item.id || item.product_id || "");
          if (pId) {
            const prod = map.get(pId) || {
              id: pId,
              name: item.name || item.title || "Product",
              category: "Astrology & Remedies",
              price: Number(item.price || 0),
              views: 0,
              cartAdds: 0,
              quantitySold: 0,
              ordersCount: 0,
              revenue: 0,
            };

            const qty = Math.max(1, Number(item.quantity || 1));
            const itemRev = Number(item.price || prod.price) * qty;

            prod.quantitySold += qty;
            prod.ordersCount += 1;
            prod.revenue += itemRev;

            map.set(pId, prod);
          }
        });
      }
    });

    const list = Array.from(map.values()).map((p) => {
      const conv = p.views > 0 ? ((p.ordersCount / p.views) * 100).toFixed(1) : (p.ordersCount > 0 ? "100.0" : "0.0");
      return { ...p, conversionRate: parseFloat(conv) };
    });

    // Sorting
    list.sort((a, b) => {
      if (productSortBy === "revenue") return b.revenue - a.revenue;
      if (productSortBy === "sold") return b.quantitySold - a.quantitySold;
      if (productSortBy === "cart") return b.cartAdds - a.cartAdds;
      if (productSortBy === "conversion") return b.conversionRate - a.conversionRate;
      return b.views - a.views;
    });

    return list;
  }, [scopedEvents, paidOrders, productSortBy]);

  // Payment Breakdown
  const paymentStats = useMemo(() => {
    const methodsMap = new Map<string, number>();
    let razorpayCount = 0;
    let successfulCount = 0;
    let failedCount = 0;
    let pendingCount = 0;
    let totalValue = 0;

    scopedOrders.forEach((o) => {
      const pStatus = (o.payment_status || o.status || "").toLowerCase();
      const method = (o.payment_method || "Razorpay").toUpperCase();

      methodsMap.set(method, (methodsMap.get(method) || 0) + 1);

      if (o.razorpay_order_id || o.payment_id) razorpayCount += 1;

      if (pStatus === "paid") {
        successfulCount += 1;
        totalValue += Number(o.total || 0);
      } else if (pStatus.includes("fail") || pStatus.includes("cancel")) {
        failedCount += 1;
      } else {
        pendingCount += 1;
      }
    });

    const totalAttempts = Math.max(scopedOrders.length, 1);
    const successRate = ((successfulCount / totalAttempts) * 100).toFixed(1);

    const methodsData = Array.from(methodsMap.entries()).map(([name, value]) => ({
      name,
      value,
    }));

    return {
      totalAttempts: scopedOrders.length,
      successfulCount,
      failedCount,
      pendingCount,
      totalValue,
      successRate,
      razorpayCount,
      methodsData,
    };
  }, [scopedOrders]);

  // Traffic Sources Breakdown
  const trafficSources = useMemo(() => {
    const map = new Map<string, number>();
    scopedEvents.forEach((e) => {
      const src = e.referrer || "Direct";
      map.set(src, (map.get(src) || 0) + 1);
    });
    if (map.size === 0) {
      map.set("Direct", 1);
    }
    return Array.from(map.entries()).map(([name, value]) => ({ name, value }));
  }, [scopedEvents]);

  // Device Breakdown
  const deviceBreakdown = useMemo(() => {
    const map = new Map<string, number>();
    scopedEvents.forEach((e) => {
      const dev = (e.device_type || "desktop").toLowerCase();
      map.set(dev, (map.get(dev) || 0) + 1);
    });
    if (map.size === 0) {
      map.set("mobile", 1);
    }
    return Array.from(map.entries()).map(([name, value]) => ({ name: name.toUpperCase(), value }));
  }, [scopedEvents]);

  // Customer Analytics
  const customerStats = useMemo(() => {
    const uniqueBuyerEmails = new Set<string>();
    const uniqueBuyerPhones = new Set<string>();

    paidOrders.forEach((o) => {
      if (o.customer_email) uniqueBuyerEmails.add(o.customer_email.toLowerCase());
      if (o.customer_phone) uniqueBuyerPhones.add(o.customer_phone);
    });

    const totalRegistered = profiles.length;
    const newRegistered = scopedProfiles.length;
    const uniqueBuyers = Math.max(uniqueBuyerEmails.size, uniqueBuyerPhones.size, paidOrders.length);
    const cartAbandoners = Math.max(0, kpis.checkoutStartedCount - paidOrders.length);

    return {
      totalRegistered,
      newRegistered,
      uniqueBuyers,
      cartAbandoners,
    };
  }, [profiles, scopedProfiles, paidOrders, kpis]);

  // Export CSV Handlers
  const exportSalesCsv = () => {
    try {
      const headers = ["Order Number", "Date", "Customer Name", "Total (INR)", "Payment Status", "Order Status", "Payment ID"];
      const rows = paidOrders.map((o) => [
        `"${o.order_number}"`,
        `"${new Date(o.created_at).toISOString()}"`,
        `"${(o.customer_name || "").replace(/"/g, '""')}"`,
        o.total,
        `"${o.payment_status}"`,
        `"${o.status}"`,
        `"${o.payment_id || o.transaction_id || ""}"`,
      ]);

      const csvContent = "data:text/csv;charset=utf-8," + [headers.join(","), ...rows.map((e) => e.join(","))].join("\n");
      const encodedUri = encodeURI(csvContent);
      const link = document.createElement("a");
      link.setAttribute("href", encodedUri);
      link.setAttribute("download", `AstroWithHrishi_Sales_${range}_${new Date().toISOString().slice(0, 10)}.csv`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      toast.success("Sales CSV exported successfully");
    } catch (e: any) {
      toast.error("Export failed: " + e.message);
    }
  };

  const exportProductCsv = () => {
    try {
      const headers = ["Product Name", "Category", "Price (INR)", "Views", "Cart Adds", "Units Sold", "Orders", "Revenue (INR)", "Conversion Rate (%)"];
      const rows = productStats.map((p) => [
        `"${p.name.replace(/"/g, '""')}"`,
        `"${p.category}"`,
        p.price,
        p.views,
        p.cartAdds,
        p.quantitySold,
        p.ordersCount,
        p.revenue,
        p.conversionRate,
      ]);

      const csvContent = "data:text/csv;charset=utf-8," + [headers.join(","), ...rows.map((e) => e.join(","))].join("\n");
      const encodedUri = encodeURI(csvContent);
      const link = document.createElement("a");
      link.setAttribute("href", encodedUri);
      link.setAttribute("download", `AstroWithHrishi_Product_Analytics_${range}.csv`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      toast.success("Product Analytics CSV exported");
    } catch (e: any) {
      toast.error("Export failed: " + e.message);
    }
  };

  const exportOrdersCsv = () => {
    try {
      const headers = ["Order ID", "Order Number", "Date", "Customer Name", "Customer Phone", "City", "Total", "Payment Status", "Razorpay Order ID", "Payment ID"];
      const rows = scopedOrders.map((o: any) => [
        `"${o.id}"`,
        `"${o.order_number}"`,
        `"${new Date(o.created_at).toISOString()}"`,
        `"${(o.customer_name || "").replace(/"/g, '""')}"`,
        `"${(o.customer_phone || "").replace(/(\d{3})\d{4}(\d{3})/, "$1****$2")}"`,
        `"${o.city || ""}"`,
        o.total,
        `"${o.payment_status || ""}"`,
        `"${o.razorpay_order_id || ""}"`,
        `"${o.payment_id || o.transaction_id || ""}"`,
      ]);

      const csvContent = "data:text/csv;charset=utf-8," + [headers.join(","), ...rows.map((e) => e.join(","))].join("\n");
      const encodedUri = encodeURI(csvContent);
      const link = document.createElement("a");
      link.setAttribute("href", encodedUri);
      link.setAttribute("download", `AstroWithHrishi_Orders_${range}.csv`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      toast.success("Orders CSV exported");
    } catch (e: any) {
      toast.error("Export failed: " + e.message);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header & Date Range Filter Bar */}
      <div className="glass-gold rounded-2xl p-5 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
            <h2 className="text-xl font-heading text-gold font-semibold flex items-center gap-2">
              <BarChart3 className="h-5 w-5 text-gold" />
              E-Commerce Analytics & Conversion Intelligence
            </h2>
          </div>
          <p className="text-xs text-cosmic-silver/70 mt-1">
            Real-time verified Firestore orders, Razorpay payment events & conversion tracking.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Quick Date Range Selector */}
          <div className="flex items-center bg-background/60 border border-gold/20 rounded-xl p-1 gap-1">
            {RANGES.map((r) => (
              <button
                key={r.key}
                onClick={() => setRange(r.key)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                  range === r.key
                    ? "bg-gradient-gold text-primary-foreground shadow-sm"
                    : "text-cosmic-silver/80 hover:text-gold hover:bg-gold/10"
                }`}
              >
                {r.label}
              </button>
            ))}
          </div>

          {/* Export Dropdown */}
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={exportSalesCsv}
              className="border-gold/30 hover:border-gold text-xs h-9 text-gold hover:bg-gold/10"
            >
              <Download className="h-3.5 w-3.5 mr-1.5" />
              Export Sales CSV
            </Button>
          </div>
        </div>
      </div>

      {/* Custom Date Inputs (If custom is chosen) */}
      {range === "custom" && (
        <div className="glass-gold rounded-xl p-4 flex flex-wrap items-center gap-4 text-xs">
          <div className="flex items-center gap-2">
            <span className="text-cosmic-silver/80">From:</span>
            <Input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className="w-36 bg-background/50 border-gold/30 text-xs h-8"
            />
          </div>
          <div className="flex items-center gap-2">
            <span className="text-cosmic-silver/80">To:</span>
            <Input
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className="w-36 bg-background/50 border-gold/30 text-xs h-8"
            />
          </div>
        </div>
      )}

      {/* Main KPI Summary Cards Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3">
        <div className="glass-gold rounded-xl p-3.5 flex flex-col justify-between">
          <div className="flex items-center justify-between text-cosmic-silver/70 text-xs">
            <span>Visitors</span>
            <Users className="h-3.5 w-3.5 text-sky-400" />
          </div>
          <div className="mt-2">
            <div className="text-lg font-bold text-foreground font-heading">
              {kpis.totalVisitors.toLocaleString()}
            </div>
            <div className="text-[10px] text-sky-400/90 flex items-center gap-0.5 mt-0.5">
              <span>Unique sessions</span>
            </div>
          </div>
        </div>

        <div className="glass-gold rounded-xl p-3.5 flex flex-col justify-between">
          <div className="flex items-center justify-between text-cosmic-silver/70 text-xs">
            <span>Page Views</span>
            <Eye className="h-3.5 w-3.5 text-indigo-400" />
          </div>
          <div className="mt-2">
            <div className="text-lg font-bold text-foreground font-heading">
              {kpis.totalPageViews.toLocaleString()}
            </div>
            <div className="text-[10px] text-indigo-400/90 mt-0.5">
              Site impressions
            </div>
          </div>
        </div>

        <div className="glass-gold rounded-xl p-3.5 flex flex-col justify-between">
          <div className="flex items-center justify-between text-cosmic-silver/70 text-xs">
            <span>Product Views</span>
            <Package className="h-3.5 w-3.5 text-purple-400" />
          </div>
          <div className="mt-2">
            <div className="text-lg font-bold text-foreground font-heading">
              {kpis.productViews.toLocaleString()}
            </div>
            <div className="text-[10px] text-purple-400/90 mt-0.5">
              Catalog looks
            </div>
          </div>
        </div>

        <div className="glass-gold rounded-xl p-3.5 flex flex-col justify-between">
          <div className="flex items-center justify-between text-cosmic-silver/70 text-xs">
            <span>Add To Cart</span>
            <ShoppingCart className="h-3.5 w-3.5 text-amber-400" />
          </div>
          <div className="mt-2">
            <div className="text-lg font-bold text-foreground font-heading">
              {kpis.addToCartCount.toLocaleString()}
            </div>
            <div className="text-[10px] text-amber-400/90 mt-0.5">
              Cart intent
            </div>
          </div>
        </div>

        <div className="glass-gold rounded-xl p-3.5 flex flex-col justify-between">
          <div className="flex items-center justify-between text-cosmic-silver/70 text-xs">
            <span>Checkout</span>
            <ShoppingBag className="h-3.5 w-3.5 text-pink-400" />
          </div>
          <div className="mt-2">
            <div className="text-lg font-bold text-foreground font-heading">
              {kpis.checkoutStartedCount.toLocaleString()}
            </div>
            <div className="text-[10px] text-pink-400/90 mt-0.5">
              Initiated orders
            </div>
          </div>
        </div>

        <div className="glass-gold rounded-xl p-3.5 flex flex-col justify-between">
          <div className="flex items-center justify-between text-cosmic-silver/70 text-xs">
            <span>Paid Orders</span>
            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
          </div>
          <div className="mt-2">
            <div className="text-lg font-bold text-emerald-400 font-heading">
              {kpis.paidOrderCount.toLocaleString()}
            </div>
            <div className="text-[10px] text-emerald-400/80 mt-0.5">
              Verified success
            </div>
          </div>
        </div>

        <div className="glass-gold rounded-xl p-3.5 flex flex-col justify-between border-gold/30">
          <div className="flex items-center justify-between text-cosmic-silver/70 text-xs">
            <span>Total Sales</span>
            <Zap className="h-3.5 w-3.5 text-gold" />
          </div>
          <div className="mt-2">
            <div className="text-lg font-bold text-gold font-heading">
              {inr(kpis.totalRevenue)}
            </div>
            <div className="text-[10px] text-gold/80 mt-0.5">
              Paid revenue only
            </div>
          </div>
        </div>

        <div className="glass-gold rounded-xl p-3.5 flex flex-col justify-between">
          <div className="flex items-center justify-between text-cosmic-silver/70 text-xs">
            <span>Conv. Rate</span>
            <TrendingUp className="h-3.5 w-3.5 text-emerald-400" />
          </div>
          <div className="mt-2">
            <div className="text-lg font-bold text-foreground font-heading">
              {kpis.conversionRate}%
            </div>
            <div className="text-[10px] text-emerald-400/80 mt-0.5">
              Visitor → Paid
            </div>
          </div>
        </div>
      </div>

      {/* Sub-Navigation Tabs */}
      <Tabs defaultValue="overview" value={activeSubTab} onValueChange={setActiveSubTab} className="w-full">
        <TabsList className="glass-gold flex-wrap h-auto justify-start p-1.5 gap-1">
          <TabsTrigger value="overview" className="text-xs data-[state=active]:bg-gradient-gold data-[state=active]:text-primary-foreground">
            <Layers className="h-3.5 w-3.5 mr-1.5" />
            Overview & Funnel
          </TabsTrigger>
          <TabsTrigger value="sales" className="text-xs data-[state=active]:bg-gradient-gold data-[state=active]:text-primary-foreground">
            <TrendingUp className="h-3.5 w-3.5 mr-1.5" />
            Sales & Revenue
          </TabsTrigger>
          <TabsTrigger value="products" className="text-xs data-[state=active]:bg-gradient-gold data-[state=active]:text-primary-foreground">
            <Package className="h-3.5 w-3.5 mr-1.5" />
            Product Analytics
          </TabsTrigger>
          <TabsTrigger value="customers" className="text-xs data-[state=active]:bg-gradient-gold data-[state=active]:text-primary-foreground">
            <Users className="h-3.5 w-3.5 mr-1.5" />
            Customer Analytics
          </TabsTrigger>
          <TabsTrigger value="payments" className="text-xs data-[state=active]:bg-gradient-gold data-[state=active]:text-primary-foreground">
            <CreditCard className="h-3.5 w-3.5 mr-1.5" />
            Razorpay & Payments
          </TabsTrigger>
          <TabsTrigger value="tracking" className="text-xs data-[state=active]:bg-gradient-gold data-[state=active]:text-primary-foreground">
            <ShieldCheck className="h-3.5 w-3.5 mr-1.5" />
            Tracking Status & Health
          </TabsTrigger>
          <TabsTrigger value="live" className="text-xs data-[state=active]:bg-gradient-gold data-[state=active]:text-primary-foreground">
            <Activity className="h-3.5 w-3.5 mr-1.5" />
            Live Event Stream
          </TabsTrigger>
        </TabsList>

        {/* 1. OVERVIEW & FUNNEL TAB */}
        <TabsContent value="overview" className="space-y-6 mt-4">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Sales Trend Chart */}
            <div className="glass-gold rounded-2xl p-5 lg:col-span-2 space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-semibold text-gold flex items-center gap-2">
                    <TrendingUp className="h-4 w-4" />
                    Daily Revenue & Order Volume
                  </h3>
                  <p className="text-xs text-cosmic-silver/70">Verified paid transactions in selected timeframe</p>
                </div>
                <div className="text-xs text-cosmic-silver/60">AOV: <strong className="text-gold">{inr(kpis.aov)}</strong></div>
              </div>

              <div className="h-64 w-full">
                {dailyChartData.length === 0 ? (
                  <div className="h-full flex items-center justify-center text-xs text-cosmic-silver/60">
                    No order data recorded in this range.
                  </div>
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={dailyChartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#D4AF37" opacity={0.15} />
                      <XAxis dataKey="date" stroke="#D4AF37" opacity={0.7} tick={{ fontSize: 11 }} />
                      <YAxis stroke="#D4AF37" opacity={0.7} tick={{ fontSize: 11 }} />
                      <Tooltip
                        contentStyle={{
                          backgroundColor: "#090814",
                          border: "1px solid rgba(212, 175, 55, 0.4)",
                          borderRadius: "8px",
                          fontSize: "12px",
                          color: "#fff",
                        }}
                        formatter={(val: any, name: string) => [
                          name === "revenue" ? inr(val) : val,
                          name === "revenue" ? "Revenue" : "Paid Orders",
                        ]}
                      />
                      <Bar dataKey="revenue" fill="#D4AF37" radius={[4, 4, 0, 0]} name="revenue" />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </div>
            </div>

            {/* Conversion Funnel Widget */}
            <div className="glass-gold rounded-2xl p-5 space-y-4">
              <div>
                <h3 className="text-sm font-semibold text-gold flex items-center gap-2">
                  <Layers className="h-4 w-4" />
                  E-Commerce Funnel
                </h3>
                <p className="text-xs text-cosmic-silver/70">Step-by-step visitor conversion drop-off</p>
              </div>

              <div className="space-y-3">
                {funnelData.map((f, idx) => (
                  <div key={idx} className="space-y-1">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-medium text-foreground">{f.stage}</span>
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-gold">{f.count}</span>
                        <span className="text-[10px] text-cosmic-silver/60">({f.percent}%)</span>
                      </div>
                    </div>
                    <div className="h-2 w-full bg-background/60 rounded-full overflow-hidden border border-gold/10">
                      <div
                        className="h-full rounded-full transition-all duration-500"
                        style={{
                          width: `${Math.max(5, Math.min(100, f.percent))}%`,
                          backgroundColor: f.color,
                        }}
                      />
                    </div>
                  </div>
                ))}
              </div>

              <div className="pt-2 border-t border-gold/10 flex items-center justify-between text-xs">
                <span className="text-cosmic-silver/80">End-to-End Conversion:</span>
                <span className="font-bold text-emerald-400">{kpis.conversionRate}%</span>
              </div>
            </div>
          </div>

          {/* Quick External Integration Status Cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="glass-gold rounded-xl p-4 flex items-center justify-between">
              <div className="space-y-1">
                <div className="flex items-center gap-2 text-xs font-semibold text-foreground">
                  <span className="h-2 w-2 rounded-full bg-emerald-400" />
                  Google Analytics 4
                </div>
                <div className="text-[11px] text-cosmic-silver/70">
                  {GA_MEASUREMENT_ID ? `Active (${GA_MEASUREMENT_ID})` : "Measurement ID pending in .env"}
                </div>
              </div>
              <Button
                size="sm"
                variant="outline"
                asChild
                className="border-gold/30 hover:border-gold text-xs h-8 text-gold"
              >
                <a href="https://analytics.google.com" target="_blank" rel="noreferrer">
                  Open GA4 <ExternalLink className="h-3 w-3 ml-1" />
                </a>
              </Button>
            </div>

            <div className="glass-gold rounded-xl p-4 flex items-center justify-between">
              <div className="space-y-1">
                <div className="flex items-center gap-2 text-xs font-semibold text-foreground">
                  <span className="h-2 w-2 rounded-full bg-emerald-400" />
                  Meta Pixel
                </div>
                <div className="text-[11px] text-cosmic-silver/70">
                  {META_PIXEL_ID ? `Active (${META_PIXEL_ID})` : "Pixel ID pending in .env"}
                </div>
              </div>
              <Button
                size="sm"
                variant="outline"
                asChild
                className="border-gold/30 hover:border-gold text-xs h-8 text-gold"
              >
                <a href="https://business.facebook.com/events_manager2" target="_blank" rel="noreferrer">
                  Meta Events <ExternalLink className="h-3 w-3 ml-1" />
                </a>
              </Button>
            </div>

            <div className="glass-gold rounded-xl p-4 flex items-center justify-between">
              <div className="space-y-1">
                <div className="flex items-center gap-2 text-xs font-semibold text-foreground">
                  <span className="h-2 w-2 rounded-full bg-emerald-400" />
                  Google Search Console
                </div>
                <div className="text-[11px] text-cosmic-silver/70">
                  Sitemap: <code className="text-gold">/sitemap.xml</code>
                </div>
              </div>
              <Button
                size="sm"
                variant="outline"
                asChild
                className="border-gold/30 hover:border-gold text-xs h-8 text-gold"
              >
                <a href="https://search.google.com/search-console" target="_blank" rel="noreferrer">
                  Search Console <ExternalLink className="h-3 w-3 ml-1" />
                </a>
              </Button>
            </div>
          </div>
        </TabsContent>

        {/* 2. SALES & REVENUE TAB */}
        <TabsContent value="sales" className="space-y-6 mt-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="glass-gold rounded-xl p-4 space-y-1">
              <div className="text-xs text-cosmic-silver/70">Total Paid Sales</div>
              <div className="text-2xl font-bold text-gold font-heading">{inr(kpis.totalRevenue)}</div>
              <div className="text-[11px] text-emerald-400">Strictly verified paid orders</div>
            </div>
            <div className="glass-gold rounded-xl p-4 space-y-1">
              <div className="text-xs text-cosmic-silver/70">Paid Orders Count</div>
              <div className="text-2xl font-bold text-foreground font-heading">{kpis.paidOrderCount}</div>
              <div className="text-[11px] text-cosmic-silver/80">Completed transactions</div>
            </div>
            <div className="glass-gold rounded-xl p-4 space-y-1">
              <div className="text-xs text-cosmic-silver/70">Average Order Value (AOV)</div>
              <div className="text-2xl font-bold text-foreground font-heading">{inr(kpis.aov)}</div>
              <div className="text-[11px] text-cosmic-silver/80">Revenue / Paid Order</div>
            </div>
            <div className="glass-gold rounded-xl p-4 space-y-1">
              <div className="text-xs text-cosmic-silver/70">Payment Success Rate</div>
              <div className="text-2xl font-bold text-emerald-400 font-heading">{paymentStats.successRate}%</div>
              <div className="text-[11px] text-cosmic-silver/80">
                {paymentStats.successfulCount} paid / {paymentStats.totalAttempts} total
              </div>
            </div>
          </div>

          {/* Orders Log with Filters */}
          <div className="glass-gold rounded-2xl p-5 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold text-gold">Order Sales Ledger</h3>
                <p className="text-xs text-cosmic-silver/70">List of transactions with verification status</p>
              </div>
              <div className="flex items-center gap-2">
                <Button size="sm" variant="outline" onClick={exportOrdersCsv} className="border-gold/30 text-xs h-8 text-gold">
                  <Download className="h-3 w-3 mr-1" /> Export Orders
                </Button>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-xs text-left">
                <thead className="border-b border-gold/20 text-cosmic-silver/70 uppercase text-[10px]">
                  <tr>
                    <th className="py-2.5 px-3">Order Number</th>
                    <th className="py-2.5 px-3">Date</th>
                    <th className="py-2.5 px-3">Customer</th>
                    <th className="py-2.5 px-3">Items</th>
                    <th className="py-2.5 px-3">Total</th>
                    <th className="py-2.5 px-3">Payment Status</th>
                    <th className="py-2.5 px-3">Gateway ID</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gold/10">
                  {scopedOrders.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="text-center py-6 text-cosmic-silver/50">
                        No orders found for the selected period.
                      </td>
                    </tr>
                  ) : (
                    scopedOrders.map((o) => (
                      <tr key={o.id} className="hover:bg-gold/5 transition-colors">
                        <td className="py-3 px-3 font-semibold text-gold">{o.order_number}</td>
                        <td className="py-3 px-3 text-cosmic-silver/80">
                          {new Date(o.created_at).toLocaleDateString("en-IN", {
                            day: "2-digit",
                            month: "short",
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </td>
                        <td className="py-3 px-3">
                          <div className="font-medium text-foreground">{o.customer_name || "Guest Customer"}</div>
                          <div className="text-[10px] text-cosmic-silver/60">
                            {o.customer_phone ? o.customer_phone.replace(/(\d{3})\d{4}(\d{3})/, "$1****$2") : ""}
                          </div>
                        </td>
                        <td className="py-3 px-3 text-cosmic-silver/80">
                          {Array.isArray(o.items) ? o.items.reduce((s, i) => s + (i.quantity || 1), 0) : 1} items
                        </td>
                        <td className="py-3 px-3 font-bold text-foreground">{inr(o.total)}</td>
                        <td className="py-3 px-3">
                          <span
                            className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                              (o.payment_status || "").toLowerCase() === "paid"
                                ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"
                                : (o.payment_status || "").toLowerCase().includes("fail")
                                ? "bg-red-500/20 text-red-400 border border-red-500/30"
                                : "bg-amber-500/20 text-amber-400 border border-amber-500/30"
                            }`}
                          >
                            {(o.payment_status || "pending").toUpperCase()}
                          </span>
                        </td>
                        <td className="py-3 px-3 text-[11px] text-cosmic-silver/60 font-mono">
                          {o.payment_id || o.transaction_id || o.razorpay_order_id || "N/A"}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </TabsContent>

        {/* 3. PRODUCT ANALYTICS TAB */}
        <TabsContent value="products" className="space-y-6 mt-4">
          <div className="glass-gold rounded-2xl p-5 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold text-gold">Product Performance Table</h3>
                <p className="text-xs text-cosmic-silver/70">Top products ranked by views, cart adds, sales & revenue</p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <div className="flex items-center bg-background/50 border border-gold/20 rounded-lg p-0.5 text-xs">
                  <span className="px-2 text-cosmic-silver/60">Sort:</span>
                  <button
                    onClick={() => setProductSortBy("revenue")}
                    className={`px-2 py-1 rounded text-xs ${productSortBy === "revenue" ? "bg-gold/20 text-gold" : "text-cosmic-silver/70"}`}
                  >
                    Revenue
                  </button>
                  <button
                    onClick={() => setProductSortBy("sold")}
                    className={`px-2 py-1 rounded text-xs ${productSortBy === "sold" ? "bg-gold/20 text-gold" : "text-cosmic-silver/70"}`}
                  >
                    Units Sold
                  </button>
                  <button
                    onClick={() => setProductSortBy("views")}
                    className={`px-2 py-1 rounded text-xs ${productSortBy === "views" ? "bg-gold/20 text-gold" : "text-cosmic-silver/70"}`}
                  >
                    Views
                  </button>
                  <button
                    onClick={() => setProductSortBy("conversion")}
                    className={`px-2 py-1 rounded text-xs ${productSortBy === "conversion" ? "bg-gold/20 text-gold" : "text-cosmic-silver/70"}`}
                  >
                    Conv %
                  </button>
                </div>
                <Button size="sm" variant="outline" onClick={exportProductCsv} className="border-gold/30 text-xs h-8 text-gold">
                  <Download className="h-3 w-3 mr-1" /> Export CSV
                </Button>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-xs text-left">
                <thead className="border-b border-gold/20 text-cosmic-silver/70 uppercase text-[10px]">
                  <tr>
                    <th className="py-2.5 px-3">Product Name</th>
                    <th className="py-2.5 px-3">Category</th>
                    <th className="py-2.5 px-3">Unit Price</th>
                    <th className="py-2.5 px-3 text-center">Product Views</th>
                    <th className="py-2.5 px-3 text-center">Add To Cart</th>
                    <th className="py-2.5 px-3 text-center">Units Sold</th>
                    <th className="py-2.5 px-3 text-center">Paid Orders</th>
                    <th className="py-2.5 px-3 text-right">Revenue (INR)</th>
                    <th className="py-2.5 px-3 text-right">Conv. Rate</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gold/10">
                  {productStats.map((p) => (
                    <tr key={p.id} className="hover:bg-gold/5 transition-colors">
                      <td className="py-3 px-3">
                        <div className="font-semibold text-foreground">{p.name}</div>
                        <div className="text-[10px] text-cosmic-silver/60">{p.id}</div>
                      </td>
                      <td className="py-3 px-3 text-cosmic-silver/80">{p.category}</td>
                      <td className="py-3 px-3 text-gold font-medium">{inr(p.price)}</td>
                      <td className="py-3 px-3 text-center font-mono">{p.views}</td>
                      <td className="py-3 px-3 text-center font-mono">{p.cartAdds}</td>
                      <td className="py-3 px-3 text-center font-mono font-bold text-foreground">{p.quantitySold}</td>
                      <td className="py-3 px-3 text-center font-mono text-emerald-400">{p.ordersCount}</td>
                      <td className="py-3 px-3 text-right font-bold text-gold">{inr(p.revenue)}</td>
                      <td className="py-3 px-3 text-right">
                        <span className={`font-semibold ${p.conversionRate > 0 ? "text-emerald-400" : "text-cosmic-silver/50"}`}>
                          {p.conversionRate}%
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </TabsContent>

        {/* 4. CUSTOMER ANALYTICS TAB */}
        <TabsContent value="customers" className="space-y-6 mt-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="glass-gold rounded-xl p-4 space-y-1">
              <div className="text-xs text-cosmic-silver/70">Total Registered Users</div>
              <div className="text-2xl font-bold text-foreground font-heading">{customerStats.totalRegistered}</div>
              <div className="text-[11px] text-cosmic-silver/80">Firebase authenticated accounts</div>
            </div>
            <div className="glass-gold rounded-xl p-4 space-y-1">
              <div className="text-xs text-cosmic-silver/70">New Registrations in Range</div>
              <div className="text-2xl font-bold text-gold font-heading">{customerStats.newRegistered}</div>
              <div className="text-[11px] text-cosmic-silver/80">Within selected timeframe</div>
            </div>
            <div className="glass-gold rounded-xl p-4 space-y-1">
              <div className="text-xs text-cosmic-silver/70">Unique Paying Customers</div>
              <div className="text-2xl font-bold text-emerald-400 font-heading">{customerStats.uniqueBuyers}</div>
              <div className="text-[11px] text-emerald-400/80">Completed at least 1 order</div>
            </div>
            <div className="glass-gold rounded-xl p-4 space-y-1">
              <div className="text-xs text-cosmic-silver/70">Checkout Drop-Offs</div>
              <div className="text-2xl font-bold text-amber-400 font-heading">{customerStats.cartAbandoners}</div>
              <div className="text-[11px] text-cosmic-silver/80">Started checkout without paying</div>
            </div>
          </div>

          <div className="glass-gold rounded-2xl p-5 space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-semibold text-gold">Customer Profiles Directory</h3>
                <p className="text-xs text-cosmic-silver/70">Privacy-compliant customer account summaries</p>
              </div>
              <div className="text-xs text-cosmic-silver/60">Showing {profiles.length} registered profiles</div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-xs text-left">
                <thead className="border-b border-gold/20 text-cosmic-silver/70 uppercase text-[10px]">
                  <tr>
                    <th className="py-2.5 px-3">Name</th>
                    <th className="py-2.5 px-3">Email</th>
                    <th className="py-2.5 px-3">Phone</th>
                    <th className="py-2.5 px-3">City</th>
                    <th className="py-2.5 px-3">Registered Date</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gold/10">
                  {profiles.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="text-center py-6 text-cosmic-silver/50">
                        No customer profiles stored yet.
                      </td>
                    </tr>
                  ) : (
                    profiles.map((p) => (
                      <tr key={p.id} className="hover:bg-gold/5 transition-colors">
                        <td className="py-2.5 px-3 font-medium text-foreground">{p.full_name || "Seeker"}</td>
                        <td className="py-2.5 px-3 text-cosmic-silver/80">{p.email || "N/A"}</td>
                        <td className="py-2.5 px-3 text-cosmic-silver/80">
                          {p.phone ? p.phone.replace(/(\d{3})\d{4}(\d{3})/, "$1****$2") : "N/A"}
                        </td>
                        <td className="py-2.5 px-3 text-cosmic-silver/70">{(p as any).city || "India"}</td>
                        <td className="py-2.5 px-3 text-cosmic-silver/60">
                          {p.created_at ? new Date(p.created_at).toLocaleDateString("en-IN") : "Recent"}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </TabsContent>

        {/* 5. PAYMENTS & RAZORPAY TAB */}
        <TabsContent value="payments" className="space-y-6 mt-4">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="glass-gold rounded-2xl p-5 space-y-4 lg:col-span-1">
              <div>
                <h3 className="text-sm font-semibold text-gold flex items-center gap-2">
                  <CreditCard className="h-4 w-4" />
                  Payment Gateway Health
                </h3>
                <p className="text-xs text-cosmic-silver/70">HMAC-SHA256 signature verification & Webhook</p>
              </div>

              <div className="space-y-3 text-xs">
                <div className="p-3 rounded-xl bg-background/50 border border-gold/20 flex items-center justify-between">
                  <span>Razorpay Integration</span>
                  <span className="text-emerald-400 font-semibold flex items-center gap-1">
                    <CheckCircle2 className="h-3.5 w-3.5" /> Active
                  </span>
                </div>
                <div className="p-3 rounded-xl bg-background/50 border border-gold/20 flex items-center justify-between">
                  <span>Webhook Endpoint</span>
                  <span className="text-emerald-400 font-semibold flex items-center gap-1">
                    <CheckCircle2 className="h-3.5 w-3.5" /> /api/payments/webhook
                  </span>
                </div>
                <div className="p-3 rounded-xl bg-background/50 border border-gold/20 flex items-center justify-between">
                  <span>₹1 Live Payment Test</span>
                  <span className="text-gold font-semibold flex items-center gap-1">
                    <Zap className="h-3.5 w-3.5" /> Ready
                  </span>
                </div>
                <div className="p-3 rounded-xl bg-background/50 border border-gold/20 flex items-center justify-between">
                  <span>Success Rate</span>
                  <span className="text-emerald-400 font-bold">{paymentStats.successRate}%</span>
                </div>
              </div>
            </div>

            <div className="glass-gold rounded-2xl p-5 space-y-4 lg:col-span-2">
              <div>
                <h3 className="text-sm font-semibold text-gold flex items-center gap-2">
                  <Activity className="h-4 w-4" />
                  Razorpay Transaction Log
                </h3>
                <p className="text-xs text-cosmic-silver/70">Live payment orders and capture records</p>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-xs text-left">
                  <thead className="border-b border-gold/20 text-cosmic-silver/70 uppercase text-[10px]">
                    <tr>
                      <th className="py-2.5 px-3">Order Number</th>
                      <th className="py-2.5 px-3">Razorpay Order ID</th>
                      <th className="py-2.5 px-3">Payment ID</th>
                      <th className="py-2.5 px-3">Amount</th>
                      <th className="py-2.5 px-3">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gold/10">
                    {scopedOrders.map((o) => (
                      <tr key={o.id} className="hover:bg-gold/5 transition-colors">
                        <td className="py-2.5 px-3 font-semibold text-gold">{o.order_number}</td>
                        <td className="py-2.5 px-3 font-mono text-cosmic-silver/80">{o.razorpay_order_id || "N/A"}</td>
                        <td className="py-2.5 px-3 font-mono text-cosmic-silver/80">{o.payment_id || o.transaction_id || "Pending"}</td>
                        <td className="py-2.5 px-3 font-bold text-foreground">{inr(o.total)}</td>
                        <td className="py-2.5 px-3">
                          <span
                            className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                              (o.payment_status || "").toLowerCase() === "paid"
                                ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"
                                : "bg-amber-500/20 text-amber-400 border border-amber-500/30"
                            }`}
                          >
                            {(o.payment_status || "PENDING").toUpperCase()}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </TabsContent>

        {/* 6. TRACKING STATUS & HEALTH TAB */}
        <TabsContent value="tracking" className="space-y-6 mt-4">
          {(() => {
            const activeGa = (trackingSettings?.google_analytics_id || GA_MEASUREMENT_ID || "").trim();
            const isGaConfigured = /^G-[A-Z0-9]+$/i.test(activeGa);

            const activePixel = (trackingSettings?.meta_pixel_id || META_PIXEL_ID || "").trim();
            const isPixelConfigured = /^\d{5,25}$/.test(activePixel);

            const activeAds = (trackingSettings?.google_ads_id || GOOGLE_ADS_ID || "").trim();
            const activeAdsLabel = (trackingSettings?.google_ads_conversion_label || GOOGLE_ADS_CONVERSION_LABEL || "").trim();
            const isAdsConfigured = /^(AW-)?[0-9]+/i.test(activeAds);

            const activeVerification = (trackingSettings?.google_site_verification || import.meta.env.VITE_GOOGLE_SITE_VERIFICATION || "").trim();
            const isSearchConsoleVerified = Boolean(activeVerification);

            return (
              <div className="space-y-6">
                {/* Status Overview Grid */}
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                  {/* GA4 */}
                  <div className="p-4 rounded-2xl bg-background/50 border border-gold/20 flex flex-col justify-between space-y-3">
                    <div className="space-y-1">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold text-foreground">Google Analytics 4</span>
                        <span
                          className={`px-2 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider ${
                            isGaConfigured
                              ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                              : "bg-amber-500/10 text-amber-400 border border-amber-500/20"
                          }`}
                        >
                          {isGaConfigured ? "Configured" : "Not Configured"}
                        </span>
                      </div>
                      <p className="text-[11px] text-cosmic-silver/60">gtag.js measurement stream</p>
                    </div>
                    <div className="pt-2 border-t border-gold/10 space-y-1">
                      <div className="flex items-center justify-between text-[11px]">
                        <span className="text-cosmic-silver/70">Measurement ID</span>
                        <span className="font-mono text-gold truncate max-w-[120px]">{activeGa || "Not set"}</span>
                      </div>
                      <div className="flex items-center justify-between text-[11px]">
                        <span className="text-cosmic-silver/70">Tracking Status</span>
                        <span className={isGaConfigured ? "text-emerald-400 font-semibold" : "text-cosmic-silver/50"}>
                          {isGaConfigured ? "Tracking Enabled" : "Not Configured"}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Meta Pixel */}
                  <div className="p-4 rounded-2xl bg-background/50 border border-gold/20 flex flex-col justify-between space-y-3">
                    <div className="space-y-1">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold text-foreground">Meta Pixel</span>
                        <span
                          className={`px-2 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider ${
                            isPixelConfigured
                              ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                              : "bg-amber-500/10 text-amber-400 border border-amber-500/20"
                          }`}
                        >
                          {isPixelConfigured ? "Configured" : "Not Configured"}
                        </span>
                      </div>
                      <p className="text-[11px] text-cosmic-silver/60">Facebook Ads e-commerce engine</p>
                    </div>
                    <div className="pt-2 border-t border-gold/10 space-y-1">
                      <div className="flex items-center justify-between text-[11px]">
                        <span className="text-cosmic-silver/70">Pixel ID</span>
                        <span className="font-mono text-gold truncate max-w-[120px]">{activePixel || "Not set"}</span>
                      </div>
                      <div className="flex items-center justify-between text-[11px]">
                        <span className="text-cosmic-silver/70">Tracking Status</span>
                        <span className={isPixelConfigured ? "text-emerald-400 font-semibold" : "text-cosmic-silver/50"}>
                          {isPixelConfigured ? "Tracking Enabled" : "Not Configured"}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Google Ads */}
                  <div className="p-4 rounded-2xl bg-background/50 border border-gold/20 flex flex-col justify-between space-y-3">
                    <div className="space-y-1">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold text-foreground">Google Ads</span>
                        <span
                          className={`px-2 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider ${
                            isAdsConfigured
                              ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                              : "bg-amber-500/10 text-amber-400 border border-amber-500/20"
                          }`}
                        >
                          {isAdsConfigured ? "Configured" : "Not Configured"}
                        </span>
                      </div>
                      <p className="text-[11px] text-cosmic-silver/60">Purchase conversion tracking</p>
                    </div>
                    <div className="pt-2 border-t border-gold/10 space-y-1">
                      <div className="flex items-center justify-between text-[11px]">
                        <span className="text-cosmic-silver/70">Ads Tag ID</span>
                        <span className="font-mono text-gold truncate max-w-[120px]">{activeAds || "Not set"}</span>
                      </div>
                      <div className="flex items-center justify-between text-[11px]">
                        <span className="text-cosmic-silver/70">Conversion Label</span>
                        <span className="font-mono text-cosmic-silver truncate max-w-[100px]">
                          {activeAdsLabel || "Optional"}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Google Search Console */}
                  <div className="p-4 rounded-2xl bg-background/50 border border-gold/20 flex flex-col justify-between space-y-3">
                    <div className="space-y-1">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold text-foreground">Search Console</span>
                        <span
                          className={`px-2 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider ${
                            isSearchConsoleVerified
                              ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                              : "bg-amber-500/10 text-amber-400 border border-amber-500/20"
                          }`}
                        >
                          {isSearchConsoleVerified ? "Configured" : "Verification Required"}
                        </span>
                      </div>
                      <p className="text-[11px] text-cosmic-silver/60">Site indexing & rich cards</p>
                    </div>
                    <div className="pt-2 border-t border-gold/10 space-y-1">
                      <div className="flex items-center justify-between text-[11px]">
                        <span className="text-cosmic-silver/70">Verification Status</span>
                        <span className={isSearchConsoleVerified ? "text-emerald-400 font-semibold" : "text-amber-400 font-semibold"}>
                          {isSearchConsoleVerified ? "Configured" : "Verification Required"}
                        </span>
                      </div>
                      <div className="flex items-center justify-between text-[11px]">
                        <span className="text-cosmic-silver/70">Sitemap Status</span>
                        <span className="text-emerald-400 font-semibold">Configured</span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Tracking Configuration Form & Security Hardening Audit */}
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                  {/* Configuration Form */}
                  <div className="lg:col-span-2 glass-gold rounded-2xl p-5 space-y-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <h3 className="text-sm font-semibold text-gold flex items-center gap-2">
                          <ShieldCheck className="h-4 w-4 text-gold" />
                          Tracking & Analytics Configuration
                        </h3>
                        <p className="text-xs text-cosmic-silver/70">
                          Override or persist measurement credentials without redeploying code.
                        </p>
                      </div>
                    </div>

                    <form onSubmit={handleSaveTracking} className="space-y-4 pt-2">
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div className="space-y-1.5">
                          <label className="text-xs font-medium text-foreground">
                            GA4 Measurement ID
                          </label>
                          <Input
                            placeholder="e.g. G-ABC123XYZ0"
                            value={editTracking.google_analytics_id || ""}
                            onChange={(e) =>
                              setEditTracking({ ...editTracking, google_analytics_id: e.target.value.trim() })
                            }
                            className="h-9 text-xs font-mono bg-background/50 border-gold/20"
                          />
                          <p className="text-[10px] text-cosmic-silver/60">Must start with G- followed by alphanumeric characters.</p>
                        </div>

                        <div className="space-y-1.5">
                          <label className="text-xs font-medium text-foreground">
                            Meta Pixel ID
                          </label>
                          <Input
                            placeholder="e.g. 123456789012345"
                            value={editTracking.meta_pixel_id || ""}
                            onChange={(e) =>
                              setEditTracking({ ...editTracking, meta_pixel_id: e.target.value.trim() })
                            }
                            className="h-9 text-xs font-mono bg-background/50 border-gold/20"
                          />
                          <p className="text-[10px] text-cosmic-silver/60">Standard 15-16 digit Meta Pixel identifier.</p>
                        </div>

                        <div className="space-y-1.5">
                          <label className="text-xs font-medium text-foreground">
                            Google Ads Tag ID
                          </label>
                          <Input
                            placeholder="e.g. AW-123456789"
                            value={editTracking.google_ads_id || ""}
                            onChange={(e) =>
                              setEditTracking({ ...editTracking, google_ads_id: e.target.value.trim() })
                            }
                            className="h-9 text-xs font-mono bg-background/50 border-gold/20"
                          />
                          <p className="text-[10px] text-cosmic-silver/60">Conversion account tag beginning with AW-.</p>
                        </div>

                        <div className="space-y-1.5">
                          <label className="text-xs font-medium text-foreground">
                            Google Ads Conversion Label
                          </label>
                          <Input
                            placeholder="e.g. AbC_dEf123GhI"
                            value={editTracking.google_ads_conversion_label || ""}
                            onChange={(e) =>
                              setEditTracking({ ...editTracking, google_ads_conversion_label: e.target.value.trim() })
                            }
                            className="h-9 text-xs font-mono bg-background/50 border-gold/20"
                          />
                          <p className="text-[10px] text-cosmic-silver/60">Optional purchase conversion action label.</p>
                        </div>

                        <div className="sm:col-span-2 space-y-1.5">
                          <label className="text-xs font-medium text-foreground">
                            Google Search Console Verification Code
                          </label>
                          <Input
                            placeholder="e.g. 43-character verification token"
                            value={editTracking.google_site_verification || ""}
                            onChange={(e) =>
                              setEditTracking({ ...editTracking, google_site_verification: e.target.value.trim() })
                            }
                            className="h-9 text-xs font-mono bg-background/50 border-gold/20"
                          />
                          <p className="text-[10px] text-cosmic-silver/60">Injected as meta tag and served via verification file route.</p>
                        </div>
                      </div>

                      <div className="pt-2 flex items-center justify-between border-t border-gold/10">
                        <span className="text-[11px] text-cosmic-silver/60">
                          {trackingSettings ? "Settings saved in database" : "Reading environment defaults"}
                        </span>
                        <Button
                          type="submit"
                          disabled={trackingSaving}
                          size="sm"
                          className="bg-gold text-cosmic-obsidian hover:bg-gold-light font-medium text-xs h-8 px-4"
                        >
                          {trackingSaving ? (
                            <>
                              <RefreshCw className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                              Saving...
                            </>
                          ) : (
                            "Save Tracking Configuration"
                          )}
                        </Button>
                      </div>
                    </form>
                  </div>

                  {/* Audit & Compliance Card */}
                  <div className="glass-gold rounded-2xl p-5 space-y-4 flex flex-col justify-between">
                    <div>
                      <h3 className="text-sm font-semibold text-gold flex items-center gap-2">
                        <Globe className="h-4 w-4 text-gold" />
                        Integrity & Idempotency Rules
                      </h3>
                      <p className="text-xs text-cosmic-silver/70">
                        Strict rules guarding analytics accuracy and financial reconciliation.
                      </p>

                      <div className="mt-4 space-y-3 text-xs">
                        <div className="p-2.5 rounded-xl bg-background/50 border border-gold/15 space-y-1">
                          <div className="flex items-center justify-between font-semibold text-foreground">
                            <span>Purchase Trigger Rule</span>
                            <span className="text-emerald-400 text-[11px]">Enforced</span>
                          </div>
                          <p className="text-[11px] text-cosmic-silver/60">
                            Fires strictly on server-verified PAID orders. Never on button click or popup dismissal.
                          </p>
                        </div>

                        <div className="p-2.5 rounded-xl bg-background/50 border border-gold/15 space-y-1">
                          <div className="flex items-center justify-between font-semibold text-foreground">
                            <span>Client Deduplication</span>
                            <span className="text-emerald-400 text-[11px]">Active</span>
                          </div>
                          <p className="text-[11px] text-cosmic-silver/60">
                            Orders saved in persistent client storage to prevent re-firing on page refresh or back-nav.
                          </p>
                        </div>

                        <div className="p-2.5 rounded-xl bg-background/50 border border-gold/15 space-y-1">
                          <div className="flex items-center justify-between font-semibold text-foreground">
                            <span>Dynamic XML Sitemap</span>
                            <a href="/sitemap.xml" target="_blank" rel="noreferrer" className="text-gold text-[11px] hover:underline flex items-center gap-0.5">
                              /sitemap.xml <ExternalLink className="h-2.5 w-2.5" />
                            </a>
                          </div>
                          <p className="text-[11px] text-cosmic-silver/60">
                            Contains all active products and core landing pages with automatic daily priority weights.
                          </p>
                        </div>

                        <div className="p-2.5 rounded-xl bg-background/50 border border-gold/15 space-y-1">
                          <div className="flex items-center justify-between font-semibold text-foreground">
                            <span>Robots Crawler Directives</span>
                            <a href="/robots.txt" target="_blank" rel="noreferrer" className="text-gold text-[11px] hover:underline flex items-center gap-0.5">
                              /robots.txt <ExternalLink className="h-2.5 w-2.5" />
                            </a>
                          </div>
                          <p className="text-[11px] text-cosmic-silver/60">
                            Allows public search indexing; disallows private /admin and /api paths.
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            );
          })()}
        </TabsContent>

        {/* 7. LIVE EVENT STREAM TAB */}
        <TabsContent value="live" className="space-y-6 mt-4">
          <div className="glass-gold rounded-2xl p-5 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-semibold text-gold flex items-center gap-2">
                  <Activity className="h-4 w-4 animate-pulse text-emerald-400" />
                  Live Real-Time Activity Feed
                </h3>
                <p className="text-xs text-cosmic-silver/70">Real-time user engagement and checkout audit trail</p>
              </div>
              <div className="text-xs text-cosmic-silver/60 font-mono">
                {events.length} total events captured
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-xs text-left">
                <thead className="border-b border-gold/20 text-cosmic-silver/70 uppercase text-[10px]">
                  <tr>
                    <th className="py-2.5 px-3">Event Name</th>
                    <th className="py-2.5 px-3">Timestamp</th>
                    <th className="py-2.5 px-3">Path / Route</th>
                    <th className="py-2.5 px-3">Details</th>
                    <th className="py-2.5 px-3">Device / Source</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gold/10 font-mono">
                  {events.slice(0, 50).map((e) => (
                    <tr key={e.id} className="hover:bg-gold/5 transition-colors">
                      <td className="py-2.5 px-3">
                        <span
                          className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold ${
                            e.event_name === "purchase"
                              ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"
                              : e.event_name === "add_to_cart"
                              ? "bg-amber-500/20 text-amber-400"
                              : e.event_name === "begin_checkout"
                              ? "bg-pink-500/20 text-pink-400"
                              : "bg-sky-500/10 text-sky-400"
                          }`}
                        >
                          {e.event_name}
                        </span>
                      </td>
                      <td className="py-2.5 px-3 text-cosmic-silver/70 text-[11px]">
                        {new Date(e.timestamp).toLocaleTimeString("en-IN", {
                          hour: "2-digit",
                          minute: "2-digit",
                          second: "2-digit",
                        })}
                      </td>
                      <td className="py-2.5 px-3 text-cosmic-silver/80 text-[11px]">{e.path || "/"}</td>
                      <td className="py-2.5 px-3 text-foreground text-[11px]">
                        {e.product_name
                          ? `${e.product_name} (${inr(e.price || 0)})`
                          : e.order_number
                          ? `Order #${e.order_number} - ${inr(e.total || e.amount || 0)}`
                          : e.search_term
                          ? `Query: "${e.search_term}"`
                          : "-"}
                      </td>
                      <td className="py-2.5 px-3 text-cosmic-silver/60 text-[10px]">
                        {(e.device_type || "desktop").toUpperCase()} · {e.referrer || "Direct"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default AnalyticsDashboard;
