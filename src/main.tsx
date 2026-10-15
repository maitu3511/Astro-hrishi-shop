import { createRoot } from "react-dom/client";
import { HelmetProvider } from "react-helmet-async";
import App from "./App.tsx";
import "./index.css";

// A stale tab running an old bundle can't import the new hashed chunks after a deploy.
// Reload once so visitors never get stuck on the error screen.
const STALE_FLAG = "awh_stale_bundle_reload";
const recoverFromStaleBundle = (reason: unknown) => {
  const message = String((reason as Error)?.message ?? reason ?? "");
  if (
    /dynamically imported module|Importing a module script failed|ChunkLoadError|Loading chunk|reading 'useRef'|Invalid hook call/i.test(message) &&
    !sessionStorage.getItem(STALE_FLAG)
  ) {
    sessionStorage.setItem(STALE_FLAG, "1");
    window.location.reload();
  }
};
window.addEventListener("unhandledrejection", (e) => recoverFromStaleBundle(e.reason));
window.addEventListener("error", (e) => recoverFromStaleBundle(e.error ?? e.message));

const rootElement = document.getElementById("root");


if (rootElement) {
  createRoot(rootElement).render(
    <HelmetProvider>
      <App />
    </HelmetProvider>
  );
} else {
  document.body.innerHTML = "<main style='min-height:100vh;display:grid;place-items:center;background:#090814;color:#f5e7b8;font-family:sans-serif;text-align:center;padding:24px'>Astro With Hrishi is loading. Please refresh once.</main>";
}
