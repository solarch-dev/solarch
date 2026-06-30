/** Solarch z-index hierarchy — web_old DNA port.
 *  Single source of truth: floating chrome (toolbar/inspector/drawer/modal/toast)
 *  uses levels defined here. */

export const Z_LAYERS = {
  BACKDROP:   0,    // canvas paper + dot grid
  GRID:       1,    // grid overlay (above canvas)
  BOUNDARIES: 5,    // trust boundary rectangles (behind nodes)
  EDGES:     10,    // edge lines
  NODES:     20,    // node frames
  SELECTION: 25,    // selection halo / ring
  GUIDES:    30,    // snap guides, hover card, alignment indicators
  OVERLAY:   40,    // swimlanes, snap-guide overlays
  CHROME:    50,    // top bar, bottom bar, action bar (floating panels)
  DRAWER:    55,    // bottom drawer, left drawer (Inspector)
  MODAL:     60,    // confirm modal, templates modal, editor modal (+1 content)
  POPOVER:   65,    // in-modal Select/Dropdown/Combobox dropdowns (above modal)
  TOAST:     70,    // ephemeral notifications
  TOUR:      80,    // onboarding spotlight tour (everything dimmed beneath)
} as const;

export type ZLayer = keyof typeof Z_LAYERS;
