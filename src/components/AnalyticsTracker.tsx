import { useEffect, useRef } from "react";
import { useLocation } from "react-router-dom";
import { initAnalytics, trackPageView } from "@/lib/analytics";

/**
 * Route-level Analytics Tracker for client-side navigation in React/Vite.
 * Ensures page_view is fired exactly once per route change and skips private admin routes.
 */
export const AnalyticsTracker = () => {
  const location = useLocation();
  const lastTrackedRef = useRef<string>("");

  // Initialize analytics scripts once
  useEffect(() => {
    initAnalytics();
  }, []);

  // Track pageviews on location changes
  useEffect(() => {
    const currentPath = location.pathname + location.search;

    // Prevent duplicate pageview fires for the same navigation/re-render
    if (lastTrackedRef.current === currentPath) return;
    lastTrackedRef.current = currentPath;

    // Slight timeout allows Helmet/SEO component to update document.title
    const timer = setTimeout(() => {
      trackPageView(currentPath, document.title);
    }, 120);

    return () => clearTimeout(timer);
  }, [location.pathname, location.search]);

  return null;
};

export default AnalyticsTracker;
