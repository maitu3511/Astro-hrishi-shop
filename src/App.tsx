import { Suspense } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/hooks/useAuth";
import AdminRoute from "@/components/AdminRoute";
import ProtectedRoute from "@/components/ProtectedRoute";
import { lazyWithRetry } from "@/lib/lazyWithRetry";
import "./lib/i18n";

import Index from "./pages/Index.tsx";
import AppErrorBoundary from "@/components/AppErrorBoundary";
import AnalyticsTracker from "@/components/AnalyticsTracker";

const NotFound = lazyWithRetry(() => import("./pages/NotFound.tsx"));
const About = lazyWithRetry(() => import("./pages/About"));
const Services = lazyWithRetry(() => import("./pages/Services"));
const Booking = lazyWithRetry(() => import("./pages/Booking"));
const Product = lazyWithRetry(() => import("./pages/Product"));
const Cart = lazyWithRetry(() => import("./pages/Cart"));
const Shop = lazyWithRetry(() => import("./pages/Shop"));
const Contact = lazyWithRetry(() => import("./pages/Contact"));
const Privacy = lazyWithRetry(() => import("./pages/Legal").then((m) => ({ default: m.Privacy })));
const Terms = lazyWithRetry(() => import("./pages/Legal").then((m) => ({ default: m.Terms })));
const Auth = lazyWithRetry(() => import("./pages/Auth"));
const Admin = lazyWithRetry(() => import("./pages/Admin"));
const AdminLogin = lazyWithRetry(() => import("./pages/AdminLogin"));
const Orders = lazyWithRetry(() => import("./pages/Orders"));
const Checkout = lazyWithRetry(() => import("./pages/Checkout"));
const TrackOrder = lazyWithRetry(() => import("./pages/TrackOrder"));
const AdminOrders = lazyWithRetry(() => import("./pages/AdminOrders"));
const ResetPassword = lazyWithRetry(() => import("./pages/ResetPassword"));
const OrderSuccess = lazyWithRetry(() => import("./pages/OrderSuccess"));

const queryClient = new QueryClient();

const RouteFallback = () => (
  <div className="min-h-screen flex items-center justify-center bg-background">
    <div className="h-10 w-10 rounded-full border-2 border-gold/30 border-t-gold animate-spin" />
  </div>
);

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <AppErrorBoundary>
        <BrowserRouter>
          <AnalyticsTracker />
          <AuthProvider>
          <Suspense fallback={<RouteFallback />}>
            <Routes>
              <Route path="/" element={<Index />} />
              <Route path="/about" element={<About />} />
              <Route path="/services" element={<Services />} />
              <Route path="/booking" element={<Booking />} />
              <Route path="/shop" element={<Shop />} />
              <Route path="/product/:id" element={<Product />} />
              <Route path="/cart" element={<Cart />} />
              <Route path="/checkout" element={<ProtectedRoute><Checkout /></ProtectedRoute>} />
              <Route path="/contact" element={<Contact />} />
              <Route path="/privacy" element={<Privacy />} />
              <Route path="/terms" element={<Terms />} />
              <Route path="/auth" element={<Auth />} />
              <Route path="/orders" element={<ProtectedRoute><Orders /></ProtectedRoute>} />
              <Route path="/my-orders" element={<ProtectedRoute><Orders /></ProtectedRoute>} />
              <Route path="/track-order" element={<TrackOrder />} />
              <Route path="/order-success" element={<OrderSuccess />} />
              <Route path="/reset-password" element={<ResetPassword />} />
              <Route path="/admin/login" element={<AdminLogin />} />
              <Route path="/admin" element={<AdminRoute><Admin /></AdminRoute>} />
              <Route path="/admin/orders" element={<AdminRoute><AdminOrders /></AdminRoute>} />
              <Route path="*" element={<NotFound />} />
            </Routes>
          </Suspense>
          </AuthProvider>
        </BrowserRouter>
      </AppErrorBoundary>
    </TooltipProvider>
  </QueryClientProvider>
);


export default App;
