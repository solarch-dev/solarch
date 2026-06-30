import { createBrowserRouter, redirect } from "react-router-dom";
import { AppShell } from "./AppShell";
import { Welcome } from "../features/welcome/Welcome";
import { ProjectPage } from "../features/canvas/ProjectPage";
import { RequireAuth, RouteError } from "./route-guards";
import { SettingsPage } from "../features/settings/SettingsPage";

export const router = createBrowserRouter([
  {
    errorElement: <RouteError />,
    children: [
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
          { path: "/settings", element: <SettingsPage /> },
          { path: "/p/:projectId", element: <ProjectPage /> },
          { path: "/p/:projectId/:tabId", element: <ProjectPage /> },
        ],
      },
    ],
  },
]);
