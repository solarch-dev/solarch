import { useState, type CSSProperties, type ReactNode } from "react";
import { X } from "lucide-react";
import {
  Drawer as UiDrawer,
  DrawerContent,
  DrawerTitle,
} from "@/components/ui/drawer";
import { cn } from "@/lib/utils";

interface Tab {
  id: string;
  label: string;
  count?: number;
}

interface Props {
  family: string;
  familyColor: string;
  nodeName: string;
  tabs?: readonly Tab[];
  activeTab?: string;
  onTabChange?: (tabId: string) => void;
  baseRouteSlot?: ReactNode;
  onClose: () => void;
  /** vaul snap points — controlled drag-resize; default 3 points. */
  snapPoints?: readonly (string | number)[];
  children: ReactNode;
}

const DEFAULT_SNAPS: readonly (string | number)[] = ["280px", "560px", 0.92];

/** Bottom slide-in drawer — vaul (shadcn) based.
 *  Drag-resize with snap points (controlled activeSnapPoint), dismiss with ESC + drag-down. */
export function DrawerShell({
  family, familyColor, nodeName, tabs, activeTab, onTabChange,
  baseRouteSlot, onClose, snapPoints = DEFAULT_SNAPS, children,
}: Props) {
  const styleVars = { "--ins-family-accent": familyColor } as CSSProperties;
  // vaul snapPoints in CONTROLLED mode requires activeSnapPoint + setter;
  // otherwise drawer mounts but remains invisible.
  const [snap, setSnap] = useState<number | string | null>(snapPoints[1] ?? null);

  return (
    <UiDrawer
      open
      onOpenChange={(v) => { if (!v) onClose(); }}
      snapPoints={snapPoints as (string | number)[]}
      activeSnapPoint={snap}
      setActiveSnapPoint={setSnap}
      shouldScaleBackground={false}
    >
      <DrawerContent
        data-family={family}
        style={styleVars}
        className="flex flex-col p-0 overflow-hidden mt-0 h-full rounded-t-[10px] border-[color:var(--hairline)] bg-[color:var(--paper-raised)]"
      >
        <DrawerTitle className="sr-only">{nodeName} editor</DrawerTitle>

        {/* 3px family accent bar — below vaul's drag handle */}
        <div className="h-[3px] shrink-0" style={{ background: familyColor }} />

        {/* Header: node name + tabs + close */}
        <header className="flex items-center gap-3 px-[14px] py-2 border-b border-[color:var(--hairline)] shrink-0 bg-[color:var(--paper-raised)]">
          <span className="font-mono text-[12px] uppercase tracking-[0.08em] text-[color:var(--ink-faint)] font-semibold whitespace-nowrap overflow-hidden text-ellipsis shrink-0">
            {nodeName}
          </span>

          {tabs && tabs.length > 0 && (
            <div className="flex items-center gap-[2px] p-[2px] bg-[var(--ins-track)] rounded-md" role="tablist">
              {tabs.map((tab) => {
                const isActive = tab.id === activeTab;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    role="tab"
                    aria-selected={isActive}
                    className={cn(
                      "flex items-center gap-[5px] h-6 px-[10px] border-0 rounded font-mono text-[12px] font-semibold transition-colors cursor-pointer",
                      isActive
                        ? "bg-[color:var(--ins-tab-active)] text-[color:var(--ink)] shadow-[var(--ins-tab-shadow)]"
                        : "bg-transparent text-[color:var(--ink-soft)] hover:text-[color:var(--ink)]"
                    )}
                    onClick={() => onTabChange?.(tab.id)}
                  >
                    {tab.label}
                    {tab.count != null && (
                      <span className={cn(
                        "text-[10.5px] px-[5px] rounded-full",
                        isActive ? "bg-[var(--ins-pill-bg)] text-[color:var(--ink-soft)]" : "bg-[var(--ins-overlay-hover)] text-[color:var(--ink-faint)]"
                      )}>{tab.count}</span>
                    )}
                  </button>
                );
              })}
            </div>
          )}

          <button
            type="button"
            onClick={onClose}
            aria-label="Close drawer"
            title="Close (ESC)"
            className="ml-auto w-[26px] h-[26px] flex items-center justify-center border-0 bg-transparent text-[color:var(--ink-soft)] rounded cursor-pointer transition-colors hover:bg-[var(--ins-overlay-hover)] hover:text-[color:var(--ink)]"
          >
            <X size={14} />
          </button>
        </header>

        {baseRouteSlot && (
          <div className="px-[14px] py-2 border-b border-[color:var(--hairline)] bg-[var(--ins-track)] shrink-0">
            {baseRouteSlot}
          </div>
        )}

        <div className="flex-1 overflow-y-auto px-4 pt-[14px] pb-[18px] flex flex-col gap-[14px]">
          {children}
        </div>
      </DrawerContent>
    </UiDrawer>
  );
}
