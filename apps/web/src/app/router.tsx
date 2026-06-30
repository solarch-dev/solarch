import { createBrowserRouter, redirect } from "react-router-dom";
import { AppShell } from "./AppShell";
import { Welcome } from "../features/welcome/Welcome";
import { ProjectPage } from "../features/canvas/ProjectPage";
import { RequireAuth, RouteError } from "./route-guards";
import { SignInPage } from "../features/auth/SignInPage";
import { SignUpPage } from "../features/auth/SignUpPage";
import { ForgotPasswordPage } from "../features/auth/ForgotPasswordPage";
import { SsoCallbackPage } from "../features/auth/SsoCallbackPage";
import { BillingPage } from "../features/billing/BillingPage";
import { SettingsPage } from "../features/settings/SettingsPage";
import { RefundPage } from "../features/legal/RefundPage";
import { TermsPage } from "../features/legal/TermsPage";
import { PrivacyPage } from "../features/legal/PrivacyPage";

export const router = createBrowserRouter([
  {
    // Root error boundary: show a branded screen on ANY route render error
    // (incl. auth/legal pages), not React Router's default dev page.
    errorElement: <RouteError />,
    children: [
      { path: "/sign-in", element: <SignInPage /> },
      { path: "/sign-up", element: <SignUpPage /> },
      { path: "/forgot-password", element: <ForgotPasswordPage /> },
      { path: "/sso-callback", element: <SsoCallbackPage /> },
      // Legal — public (no login required; Polar domain review + user access).
      { path: "/refund", element: <RefundPage /> },
      { path: "/terms", element: <TermsPage /> },
      { path: "/privacy", element: <PrivacyPage /> },
      { path: "/", loader: () => redirect("/start") },
      {
        element: (
          <RequireAuth>
            <AppShell />
          </RequireAuth>
        ),
        errorElement: <RouteError />,
        children: [
          { path: "/start", element: <Welcome /> },
          { path: "/billing", element: <BillingPage /> },
          { path: "/settings", element: <SettingsPage /> },
          { path: "/p/:projectId", element: <ProjectPage /> },
          { path: "/p/:projectId/:tabId", element: <ProjectPage /> },
        ],
      },
    ],
  },
]);
