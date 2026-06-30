import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "react-router-dom";
import { AppProviders } from "./app/providers";
import { GlobalErrorBoundary } from "./app/GlobalErrorBoundary";
import { router } from "./app/router";
import { installTranslateGuard } from "./lib/translate-guard";
import "./index.css";

// Install BEFORE React render starts — guards against translation-induced DOM crashes.
installTranslateGuard();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AppProviders>
      <GlobalErrorBoundary>
        <RouterProvider router={router} />
      </GlobalErrorBoundary>
    </AppProviders>
  </StrictMode>,
);
