import { lazy, ComponentType, LazyExoticComponent } from "react";

const RELOAD_KEY = "awh_chunk_reload_ts";

/**
 * Robust wrapper around React.lazy() that automatically retries failed dynamic imports
 * before failing, and seamlessly recovers from stale chunk caches on new deployments or dev restarts.
 */
export function lazyWithRetry<T extends ComponentType<any>>(
  componentImport: () => Promise<{ default: T }>,
  retries = 2,
  interval = 600
): LazyExoticComponent<T> {
  return lazy(() =>
    new Promise<{ default: T }>((resolve, reject) => {
      const execute = (remaining: number) => {
        componentImport()
          .then(resolve)
          .catch((error) => {
            const errorMsg = String(error?.message || error || "");
            const isImportError =
              errorMsg.includes("dynamically imported module") ||
              errorMsg.includes("Failed to fetch") ||
              errorMsg.includes("Loading chunk") ||
              errorMsg.includes("Importing a module script failed");

            if (remaining > 0) {
              setTimeout(() => {
                execute(remaining - 1);
              }, interval);
              return;
            }

            // If retries exhausted and it's a dynamic module fetch error,
            // attempt a single fresh reload if not reloaded within the last 10 seconds.
            if (isImportError && typeof window !== "undefined") {
              const lastReload = Number(sessionStorage.getItem(RELOAD_KEY) || "0");
              const now = Date.now();
              if (now - lastReload > 10000) {
                sessionStorage.setItem(RELOAD_KEY, String(now));
                window.location.reload();
                return;
              }
            }

            reject(error);
          });
      };

      execute(retries);
    })
  );
}
