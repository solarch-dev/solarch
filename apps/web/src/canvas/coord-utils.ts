/** World coordinate → screen pixel transform helpers.
 *  Converts node bounds to screen position using CanvasView's `vp` (Viewport: zoom, x, y).
 *  Used by ActionBar, HoverCard, NameEditor floating components. */

import type { SceneNode, Viewport } from "./types";
import { nodeDisplayH } from "./renderer";

export interface ScreenBounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
  centerX: number;
  centerY: number;
}

/** Node bounds (world coords) + viewport → screen pixel bounds.
 *  Uses CanvasView vp.zoom + vp.x + vp.y. */
export function nodeScreenBounds(node: SceneNode, vp: Viewport): ScreenBounds {
  const left = node.x * vp.zoom + vp.x;
  const top = node.y * vp.zoom + vp.y;
  const width = node.w * vp.zoom;
  const height = nodeDisplayH(node) * vp.zoom;
  return {
    left,
    top,
    right: left + width,
    bottom: top + height,
    width,
    height,
    centerX: left + width / 2,
    centerY: top + height / 2,
  };
}
