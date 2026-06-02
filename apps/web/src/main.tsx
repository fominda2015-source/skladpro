import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import "./styles/erp-design.css";
import "./styles/viewport.css";
import "./styles/fluid-mobile.css";
import App from "./App.tsx";
import { ErrorBoundary } from "./shared/ui/ErrorBoundary";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>
);
