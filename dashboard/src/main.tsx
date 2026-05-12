import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import { resolveRouterBasename } from "./api-base";
import "./styles.css";

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
