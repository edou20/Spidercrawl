import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import * as Sentry from "@sentry/react";
import App from "./App";
import { resolveRouterBasename } from "./api-base";
import "./styles.css";

if (import.meta.env.VITE_SENTRY_DSN) {
  Sentry.init({
    dsn: import.meta.env.VITE_SENTRY_DSN,
    environment: import.meta.env.MODE,
    tracesSampleRate: 0.1,
    integrations: [Sentry.browserTracingIntegration()],
  });
}

const currentOrigin = typeof window !== "undefined" ? window.location.origin : "http://localhost:3200";
const routerBasename = resolveRouterBasename(
  currentOrigin,
  import.meta.env.VITE_BACKEND_URL,
  import.meta.env.VITE_ROUTER_BASENAME
);

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter basename={routerBasename} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <App />
    </BrowserRouter>
  </React.StrictMode>
);
