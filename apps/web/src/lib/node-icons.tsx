/** Node type → FontAwesome icon (single source of truth).
 *  Both canvas (renderer.ts Path2D) and DOM (React SVG) consume from here.
 *  Changed in one place, both surfaces show the same icon. */

import {
  faTable, faCode, faGears, faCodeBranch, faListUl, faDatabase,
  faDesktop, faShield, faDollarSign, faTriangleExclamation, faCubes, faGlobe,
  type IconDefinition,
} from "@fortawesome/free-solid-svg-icons";

export const NODE_FA_ICON: Record<string, IconDefinition> = {
  Table: faTable, Model: faTable, View: faTable,
  DTO: faCode, Enum: faCode,
  Service: faGears, Worker: faGears, Orchestrator: faGears, EventHandler: faGears,
  Controller: faCodeBranch, APIGateway: faCodeBranch,
  MessageQueue: faListUl,
  Repository: faDatabase, Cache: faDatabase,
  ExternalService: faGlobe,
  FrontendApp: faDesktop, UIComponent: faDesktop,
  Middleware: faShield,
  EnvironmentVariable: faDollarSign,
  Exception: faTriangleExclamation,
  Module: faCubes,
};

/** React component — renders FA icon as DOM SVG.
 *  For the canvas side, renderer.ts has Path2D drawing (same NODE_FA_ICON map).
 *
 *  size: pixel (actual icon glyph size, not the icon box edge)
 *  color: no stroke, fill only (FA solid icons). If using Tailwind, pass via `style`. */
export function NodeIcon({
  type,
  size = 16,
  color = "currentColor",
  className,
}: {
  type: string;
  size?: number;
  color?: string;
  className?: string;
}) {
  const def = NODE_FA_ICON[type];
  if (!def) {
    // Fallback: small circle (same as in renderer.ts)
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        className={className}
        aria-hidden="true"
      >
        <circle cx="12" cy="12" r="6" fill="none" stroke={color} strokeWidth="2" />
        <circle cx="12" cy="12" r="2" fill={color} />
      </svg>
    );
  }
  const [vw, vh, , , pathData] = def.icon;
  const path = Array.isArray(pathData) ? pathData[0] : pathData;
  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${vw} ${vh}`}
      className={className}
      aria-hidden="true"
    >
      <path d={path} fill={color} fillRule="evenodd" />
    </svg>
  );
}
