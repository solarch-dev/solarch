/** ThemeController — sync OS preference when mode is "system". */

import { useEffect } from "react";
import { useTheme } from "../state/theme";

export function ThemeController() {
  const syncSystem = useTheme((s) => s.syncSystem);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => syncSystem();
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [syncSystem]);
  return null;
}
