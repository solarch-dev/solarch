/** TopBar (h-12 sticky top, glass z-50)
 *  Slot 1: Logo + Project dropdown
 *  Slot 2: Tabs (project route only)
 *  Slot 3: spacer
 *  Slot 4: AI + Save + Account */

import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ChevronDown, Plus, Check, X, Sparkles, ArrowUp, Trash2, GitCompareArrows, KeyRound, CreditCard, Sun, Moon, Monitor } from "lucide-react";
import { UserButton, useOrganization } from "@clerk/clerk-react";
import { useQueryClient } from "@tanstack/react-query";
import { Z_LAYERS } from "../lib/z-layers";
import { useIsGuest } from "../lib/guest";
import { Button } from "@/components/ui/button";
import { useSubscription } from "../api/billing";
import { useCodegenStatus } from "../api/codegen";
import { ViewSwitch } from "./ViewSwitch";
import { useWorkspaceView } from "@/state/workspace-view";
import { useTheme } from "@/state/theme";
import { GuestSignupModal } from "@/features/auth/GuestSignupModal";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Separator } from "@/components/ui/separator";
import { Input } from "@/components/ui/input";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { useProjects, useCreateProject, useDeleteProject, type ProjectSummary } from "../api/projects";
import { useTabs, useCreateTab, useUpdateTab, useDeleteTab, type Tab } from "../api/tabs";
import { cn } from "@/lib/utils";

export function TopBar() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { projectId, tabId } = useParams<{ projectId?: string; tabId?: string }>();
  const { data: projects } = useProjects();
  const { data: tabs } = useTabs(projectId ?? "");
  const createProject = useCreateProject();
  const deleteProject = useDeleteProject();
  const confirm = useConfirm();
  const [newProjectName, setNewProjectName] = useState("");
  // Guest (no-login trial): target the signup modal instead of plan/billing.
  const isGuest = useIsGuest();
  const [guestModalOpen, setGuestModalOpen] = useState(false);

  // Theme switch — signed-in users via the Clerk menu, guests via a compact button.
  const themeMode = useTheme((s) => s.mode);
  const cycleTheme = useTheme((s) => s.cycle);
  const ThemeIcon = themeMode === "dark" ? Moon : themeMode === "light" ? Sun : Monitor;
  const themeLabel = `Appearance: ${themeMode === "system" ? "System" : themeMode === "light" ? "Light" : "Dark"}`;

  // Deterministic codegen (Constructor) is a Build+ feature. Since AI is now open on
  // all plans (4h quota), the OPEN gate is: canGenerateCode. canCodegen is the Surgical
  // AI reserve (Code tier) — not used in this deterministic flow.
  // subLoading: data is undefined during initial load → separate "loading" and
  // "unauthorized" states to avoid wrongly redirecting entitled users to /billing.
  const { data: subscription, isLoading: subLoading } = useSubscription();
  const canGenerateCode = subscription?.entitlements.canGenerateCode ?? false;
  // Value-first proof: tiers without canGenerateCode (guest/free/draw) get 1 FREE
  // Constructor preview per 4h (codegen meter). Let them open the panel while they have it.
  const codegenMeter = subscription?.meters.codegen ?? 0;
  const codegenUsed = subscription?.usage.codegen ?? 0;
  const hasFreeCodegenPreview = !canGenerateCode && codegenMeter > codegenUsed;
  const canOpenCodegen = canGenerateCode || hasFreeCodegenPreview;

  // Codegen freshness: if the project was generated with an older Constructor
  // version, surface a prominent "Update" prompt next to Generate Code. Disabled
  // (enabled:false) on non-project routes so it never fires off-route.
  const { data: codegenStatus } = useCodegenStatus(projectId);
  const showCodegenUpdate =
    !!projectId && canGenerateCode && (codegenStatus?.updateAvailable ?? false);
  // Diagram drift: the diagram changed structurally since generation → generated code lags.
  // Don't show a second badge when "Codebase improved" (version) already suggests regenerate.
  const driftCount = codegenStatus?.driftCount ?? 0;
  const showDrift =
    !!projectId && canOpenCodegen && (codegenStatus?.diagramDrifted ?? false) && !showCodegenUpdate;
  // If NOT on the Code ($100) plan, always show a prominent "Upgrade" button up top.
  const needsUpgrade = !!subscription && subscription.plan !== "code";
  // Has the project cap been reached (Free = 2 projects). -1 = unlimited. Don't block while sub loads.
  const projectCap = subscription?.entitlements.projectCap;
  const atProjectCap =
    !!subscription && projectCap !== undefined && projectCap !== -1 && (projects?.length ?? 0) >= projectCap;
  // Canvas ↔ Code mode switch (not a modal). The store wires the TopBar switch + ProjectPage code layer.
  const openCode = useWorkspaceView((s) => s.openCode);
  const requestRegen = useWorkspaceView((s) => s.requestRegen);
  // Code-entry gate (entitlement) — SINGLE source: ViewSwitch, Update/Drift, ⌘K, "Show Code" all go through here.
  // No plan: guest → signup modal, signed-in → /billing (switch blocked). regen=true → regenerate.
  const enterCode = useCallback(
    (opts?: { focusNodeId?: string; regen?: boolean }) => {
      if (subLoading) return;
      if (!canOpenCodegen) {
        if (isGuest) setGuestModalOpen(true);
        else navigate("/billing");
        return;
      }
      if (opts?.regen) requestRegen();
      else openCode(opts?.focusNodeId);
    },
    [subLoading, canOpenCodegen, isGuest, navigate, openCode, requestRegen],
  );

  // When active organization (workspace) changes, project list falls into a
  // different scope on backend → refresh cache.
  const { organization } = useOrganization();
  const orgId = organization?.id ?? null;
  const prevOrg = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    if (prevOrg.current !== undefined && prevOrg.current !== orgId) {
      qc.invalidateQueries({ queryKey: ["projects"] });
    }
    prevOrg.current = orgId;
  }, [orgId, qc]);

  // CommandPalette (⌘K) "Generate Code" + NodeActionBar/Inspector "Show Code" trigger.
  // If detail.focusNodeId exists, panel focuses on that node's file. Same gate:
  // entitled → panel, guest → signup modal, otherwise → /billing. If subscription
  // is loading, do nothing (prevent false-negative redirect).
  useEffect(() => {
    const onCodegenOpen = (e: Event) => {
      const detail = (e as CustomEvent<{ focusNodeId?: string }>).detail;
      enterCode({ focusNodeId: detail?.focusNodeId });
    };
    window.addEventListener("solarch:codegen-open", onCodegenOpen);
    return () => window.removeEventListener("solarch:codegen-open", onCodegenOpen);
  }, [enterCode]);

  // Remote components like LockedAiBar / OmniBar open the signup modal via event.
  useEffect(() => {
    const onOpen = () => setGuestModalOpen(true);
    window.addEventListener("solarch:guest-signup-open", onOpen);
    return () => window.removeEventListener("solarch:guest-signup-open", onOpen);
  }, []);

  const currentProject = projects?.find((p) => p.id === projectId);
  const activeTabId = tabId ?? tabs?.find((t) => t.isDefault)?.id;

  const onCreateProject = async () => {
    if (!newProjectName.trim()) return;
    const created = await createProject.mutateAsync(newProjectName.trim());
    setNewProjectName("");
    navigate(`/p/${created.id}`);
  };

  const onDeleteProject = async (e: React.MouseEvent, p: ProjectSummary) => {
    e.stopPropagation();
    e.preventDefault();
    const ok = await confirm({
      title: `Delete project '${p.name}'`,
      description: "This permanently deletes the project and all its diagrams. This action cannot be undone.",
      variant: "danger",
      confirmLabel: "Delete project",
      cancelLabel: "Cancel",
    });
    if (!ok) return;
    await deleteProject.mutateAsync(p.id);
    if (p.id === projectId) navigate("/start"); // if the deleted one is active, leave it
  };

  return (
    <header
      className="h-12 sticky top-0 flex items-center px-2 gap-2 sm:px-3 sm:gap-3
                 bg-card/95 backdrop-blur-xl border-b border-border
                 shadow-[0_1px_0_rgba(255,255,255,0.6)_inset]"
      style={{ zIndex: Z_LAYERS.CHROME }}
    >
      {/* Slot 1: Logo + Projects dropdown */}
      <button
        onClick={() => navigate("/")}
        className="flex items-center gap-2 transition-opacity hover:opacity-80"
        title="Home"
      >
        <img src="/logo.svg" alt="Solarch" style={{ width: 20, height: 20 }} />
        <span className="hidden font-mono text-[13px] font-bold tracking-[-0.01em] text-[color:var(--ink)] sm:inline">
          Solarch
        </span>
      </button>

      <Separator orientation="vertical" className="h-5" />

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            data-tour="project-menu"
            className="h-7 px-2 text-[13px] gap-1.5"
          >
            <span className="hidden font-mono text-[11px] uppercase tracking-[0.08em] text-muted-foreground sm:inline">project</span>
            <span className="max-w-[34vw] truncate font-medium sm:max-w-none">{currentProject?.name ?? "select"}</span>
            <ChevronDown size={12} className="text-muted-foreground" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-[260px]">
          <DropdownMenuLabel className="text-[11px] font-mono uppercase tracking-[0.08em] text-muted-foreground">
            Projects ({projects?.length ?? 0})
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          {projects?.map((p) => (
            <DropdownMenuItem
              key={p.id}
              onClick={() => navigate(`/p/${p.id}`)}
              className="group flex items-center justify-between gap-2"
            >
              <span className="truncate">{p.name}</span>
              <span className="flex shrink-0 items-center gap-1.5">
                {p.id === projectId && <Check size={12} className="text-brand-500" />}
                <button
                  type="button"
                  onClick={(e) => onDeleteProject(e, p)}
                  title="Delete project"
                  aria-label={`Delete project ${p.name}`}
                  className="text-muted-foreground opacity-0 transition-opacity hover:text-[color:var(--danger)] focus:opacity-100 group-hover:opacity-100"
                >
                  <Trash2 size={12} />
                </button>
              </span>
            </DropdownMenuItem>
          ))}
          {(!projects || projects.length === 0) && (
            <div className="px-2 py-1.5 text-[12px] text-muted-foreground font-mono">// no projects</div>
          )}
          <DropdownMenuSeparator />
          {atProjectCap ? (
            // DropdownMenuItem: on click Radix closes the menu — the modal won't sit
            // beneath the menu. Defer modal open by a tick: so the menu-close
            // focus restoration doesn't collide with the dialog focus-trap.
            <DropdownMenuItem
              onSelect={() => {
                if (isGuest) setTimeout(() => setGuestModalOpen(true), 0);
                else navigate("/billing");
              }}
              title={isGuest ? "Sign up for more projects" : "Upgrade for more projects"}
              style={{ width: "calc(100% - 12px)" }}
              className="m-1.5 inline-flex cursor-pointer items-center justify-center gap-1.5 rounded-md bg-[#ff6b1a] px-3 py-2 font-mono text-[13px] font-medium text-black transition-colors focus:bg-[#d94d00] focus:text-black data-[highlighted]:bg-[#d94d00] data-[highlighted]:text-black"
            >
              <Sparkles size={12} />
              {isGuest ? "Sign up for more projects" : "Upgrade for more projects"}
            </DropdownMenuItem>
          ) : (
            <div className="px-2 py-1.5 flex gap-1.5">
              <Input
                value={newProjectName}
                onChange={(e) => setNewProjectName(e.target.value)}
                placeholder="New project"
                className="h-7 text-[12.5px]"
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    onCreateProject();
                  }
                }}
              />
              <Button
                size="sm"
                onClick={onCreateProject}
                disabled={!newProjectName.trim() || createProject.isPending}
                className="h-7 px-2"
              >
                <Plus size={12} />
              </Button>
            </div>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Slot 2: Tabs (project route only) — flex-1 MIDDLE region: the tab strip scrolls
          horizontally within itself (many tabs DON'T PUSH the right cluster); overflow is picked via a "+N" dropdown. */}
      <div className="flex min-w-0 flex-1 items-center gap-3">
        {projectId && tabs && tabs.length > 0 && (
          <>
            <Separator orientation="vertical" className="h-5 shrink-0" />
            <TabBar
              projectId={projectId}
              tabs={tabs}
              activeTabId={activeTabId}
              onSelect={(tabId) => navigate(`/p/${projectId}/${tabId}`)}
            />
          </>
        )}
      </div>

      {/* Slot 4: Canvas↔Code switch (right-aligned) + codegen status + account. */}
      <div className="flex shrink-0 items-center gap-2">
        {/* Canvas ↔ Code mode switch — in the right cluster, never overlaps the tabs. The code surface
            lives in the body (ProjectPage), not a modal. */}
        {projectId && (
          <>
            <div data-tour="generate" className="flex">
              <ViewSwitch onCodeRequested={() => enterCode()} disabled={subLoading} />
            </div>
            <Separator orientation="vertical" className="h-5" />
          </>
        )}
        {/* Codebase improved — Update. Only when the project was generated with an
            older Constructor version (updateAvailable) AND the user can generate code.
            Re-runs the existing codegen-open flow; on success CodegenPanel invalidates
            ["codegen-status"], generated catches up to current, and this button drops. */}
        {showCodegenUpdate && (
          <button
            type="button"
            onClick={() =>
              enterCode({ regen: true })
            }
            title="Your codebase is now better. Regenerate with the latest Constructor."
            className="inline-flex h-7 items-center gap-1.5 rounded-md bg-[#ff6b1a] px-2.5 font-mono text-[13px] font-medium text-black shadow-sm transition-colors hover:bg-[#d94d00] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ff6b1a] focus-visible:ring-offset-1"
          >
            <Sparkles size={12} />
            <span className="hidden sm:inline">Codebase improved</span>
            <ArrowUp size={12} />
            <span>Update</span>
          </button>
        )}
        {/* Diagram drifted — the diagram changed structurally since the code was
            generated (graphRevision moved ahead of the stamped one). Regenerate to sync. */}
        {showDrift && (
          <button
            type="button"
            onClick={() => enterCode({ regen: true })}
            title={`Your diagram changed (${driftCount} structural change${driftCount === 1 ? "" : "s"}) since you generated code. Regenerate to sync.`}
            className="inline-flex h-7 items-center gap-1.5 rounded-md border border-[#e5c07b]/50 bg-[#e5c07b]/12 px-2.5 font-mono text-[13px] font-medium text-[#b88a2a] transition-colors hover:bg-[#e5c07b]/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#e5c07b] focus-visible:ring-offset-1"
          >
            <GitCompareArrows size={12} />
            <span className="hidden sm:inline">Diagram changed</span>
            {driftCount > 0 && <span>· {driftCount}</span>}
          </button>
        )}
        {isGuest ? (
          // Guest: no billing — a single orange signup CTA (also reachable from
          // the sign-in/sign-up page and the limit modal).
          <>
            <button
              onClick={cycleTheme}
              title={themeLabel}
              aria-label={themeLabel}
              className="inline-flex h-7 w-7 items-center justify-center rounded-md text-ink-soft transition-colors hover:bg-black/5 dark:hover:bg-white/10"
            >
              <ThemeIcon size={14} />
            </button>
            <Separator orientation="vertical" className="h-5" />
            <button
              onClick={() => navigate("/sign-up")}
              title="Create a free account — keep your drawing"
              className="inline-flex items-center gap-1 h-7 rounded-md bg-[#ff6b1a] px-3 font-mono text-[13px] font-medium text-black transition-colors hover:bg-[#d94d00]"
            >
              <Sparkles size={12} />
              Sign up
            </button>
          </>
        ) : (
          <>
            {/* Only the prominent CTA stays outside when an upgrade is needed; API keys + Plan
                are tucked into the user profile menu (keep TopBar clean). */}
            {needsUpgrade && (
              <button
                onClick={() => navigate("/billing")}
                title="Upgrade your plan"
                className="inline-flex items-center gap-1 h-7 rounded-md bg-[#ff6b1a] px-3 font-mono text-[13px] font-medium text-black transition-colors hover:bg-[#d94d00]"
              >
                <Sparkles size={12} />
                Upgrade
              </button>
            )}
            <UserButton afterSignOutUrl="/sign-in">
              <UserButton.MenuItems>
                <UserButton.Action
                  label={themeLabel}
                  labelIcon={<ThemeIcon size={15} />}
                  onClick={cycleTheme}
                />
                <UserButton.Action
                  label="API keys"
                  labelIcon={<KeyRound size={15} />}
                  onClick={() => navigate("/settings")}
                />
                <UserButton.Action
                  label="Plan & billing"
                  labelIcon={<CreditCard size={15} />}
                  onClick={() => navigate("/billing")}
                />
              </UserButton.MenuItems>
            </UserButton>
          </>
        )}
      </div>

      {/* Guest limit/signup modal — closes with X, drawing can continue. */}
      <GuestSignupModal open={guestModalOpen} onOpenChange={setGuestModalOpen} />
    </header>
  );
}

/** TabBar — tab list + hover X on each tab (except default) + double-click rename + trailing + button.
 *  Creating a new tab automatically switches to it and enters rename mode. */
function TabBar({
  projectId,
  tabs,
  activeTabId,
  onSelect,
}: {
  projectId: string;
  tabs: Tab[];
  activeTabId?: string;
  onSelect: (tabId: string) => void;
}) {
  const createTab = useCreateTab(projectId);
  const [editingId, setEditingId] = useState<string | null>(null);

  const onCreate = async () => {
    const created = await createTab.mutateAsync(`New Tab ${tabs.length + 1}`);
    onSelect(created.id);
    setEditingId(created.id); // auto rename
  };

  // RESPONSIVE: tabs share space and SQUEEZE (flex-1, name truncates); as many tabs as fit at a
  // readable width (MIN_TAB) stay inline, the rest go into the "{N} Tab" dropdown. ResizeObserver
  // measures the width → it self-adjusts when the window/tabs change (NO scroll).
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => setWidth(entries[0]?.contentRect.width ?? 0));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const MIN_TAB = 84; // readable min width of a squeezed tab
  const NEW_BTN = 36; // new-tab button
  const DROP_BTN = 92; // "{N} Tab" dropdown button
  const GAP = 4;
  let visibleCount: number;
  if (width === 0) {
    visibleCount = tabs.length; // before measuring: show all, RO corrects within a frame
  } else {
    const usable = Math.max(0, width - NEW_BTN);
    const capNoDrop = Math.floor((usable + GAP) / (MIN_TAB + GAP));
    visibleCount =
      tabs.length <= capNoDrop
        ? tabs.length
        : Math.max(1, Math.floor((usable - DROP_BTN + GAP) / (MIN_TAB + GAP)));
  }

  // If the active tab is in overflow, move it into the last inline slot so it always stays visible (order preserved).
  let inline = tabs.slice(0, visibleCount);
  let overflow = tabs.slice(visibleCount);
  if (activeTabId && visibleCount >= 1 && overflow.some((t) => t.id === activeTabId)) {
    const active = tabs.find((t) => t.id === activeTabId)!;
    inline = [...tabs.slice(0, visibleCount - 1), active];
    overflow = tabs.filter((t) => !inline.some((i) => i.id === t.id));
  }

  return (
    <div ref={containerRef} className="flex min-w-0 flex-1 items-center gap-1">
      <nav role="tablist" className="flex min-w-0 items-center gap-0.5 overflow-hidden animate-in fade-in duration-200">
        {inline.map((t) => (
          <TabItem
            key={t.id}
            projectId={projectId}
            tab={t}
            isActive={t.id === activeTabId}
            isEditing={editingId === t.id}
            onSelect={() => onSelect(t.id)}
            onStartEdit={() => setEditingId(t.id)}
            onEndEdit={() => setEditingId(null)}
          />
        ))}
      </nav>

      {/* New tab — labeled "Create tab" when there's a single tab (discoverability); compact "+" with many tabs. */}
      <button
        type="button"
        onClick={onCreate}
        disabled={createTab.isPending}
        title="New tab"
        aria-label="New tab"
        data-tour="new-tab"
        className={cn(
          "h-7 shrink-0 flex items-center justify-center gap-1.5 rounded-md transition-all duration-150",
          "text-muted-foreground hover:text-foreground hover:bg-muted/50",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
          tabs.length === 1 ? "px-2.5 text-[13px] font-medium" : "w-7",
          createTab.isPending && "opacity-40 cursor-wait"
        )}
      >
        <Plus size={12} />
        {tabs.length === 1 && <span>Create tab</span>}
      </button>

      {/* Overflow tabs → "{N} Tab" dropdown: lists the rest, click → jump. */}
      {overflow.length > 0 && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              title="More tabs"
              aria-label={`${overflow.length} more tabs`}
              className="h-7 shrink-0 inline-flex items-center gap-1 rounded-md px-2 text-[13px] font-medium
                         text-muted-foreground transition-colors hover:text-foreground hover:bg-muted/50
                         focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
            >
              <span className="tabular-nums">{overflow.length} Tab</span>
              <ChevronDown size={12} />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="max-h-[60vh] w-56 overflow-y-auto">
            {overflow.map((t) => (
              <DropdownMenuItem
                key={t.id}
                onClick={() => onSelect(t.id)}
                className="flex items-center gap-2 text-[13px]"
              >
                {t.id === activeTabId ? (
                  <Check size={12} className="shrink-0 text-brand-500" />
                ) : (
                  <span className="w-3 shrink-0" />
                )}
                <span className="truncate">{t.name}</span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
}

/** Single tab — active/inactive appearance + X on hover (except default) + double-click inline rename. */
function TabItem({
  projectId,
  tab,
  isActive,
  isEditing,
  onSelect,
  onStartEdit,
  onEndEdit,
}: {
  projectId: string;
  tab: Tab;
  isActive: boolean;
  isEditing: boolean;
  onSelect: () => void;
  onStartEdit: () => void;
  onEndEdit: () => void;
}) {
  const updateTab = useUpdateTab(projectId);
  const deleteTab = useDeleteTab(projectId);
  const confirm = useConfirm();
  const [draftName, setDraftName] = useState(tab.name);
  const inputRef = useRef<HTMLInputElement>(null);

  // Entered edit mode → input mount + focus + select
  useEffect(() => {
    if (isEditing) {
      setDraftName(tab.name);
      // focus after mount
      setTimeout(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      }, 0);
    }
  }, [isEditing, tab.name]);

  const commitRename = () => {
    const trimmed = draftName.trim();
    if (trimmed && trimmed !== tab.name) {
      updateTab.mutate({ tabId: tab.id, name: trimmed });
    }
    onEndEdit();
  };

  const cancelRename = () => {
    setDraftName(tab.name);
    onEndEdit();
  };

  const onDelete = async (e: React.MouseEvent) => {
    e.stopPropagation();
    const ok = await confirm({
      title: `Delete tab '${tab.name}'`,
      description:
        "Nodes in this tab will be moved to the Main Architecture tab, tab-specific references will be removed. This action cannot be undone.",
      variant: "danger",
      confirmLabel: "Delete tab",
      cancelLabel: "Cancel",
    });
    if (!ok) return;
    deleteTab.mutate(tab.id);
  };

  if (isEditing) {
    return (
      <div
        className={cn(
          "group h-7 flex items-center gap-1 pl-2.5 pr-1 rounded-md border",
          "bg-card border-brand-500/40 shadow-sm"
        )}
      >
        <input
          ref={inputRef}
          value={draftName}
          onChange={(e) => setDraftName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") { e.preventDefault(); commitRename(); }
            else if (e.key === "Escape") { e.preventDefault(); cancelRename(); }
          }}
          onBlur={commitRename}
          spellCheck={false}
          maxLength={40}
          className="bg-transparent outline-none border-0 text-[13px] font-medium w-[120px] min-w-0 text-foreground"
        />
      </div>
    );
  }

  return (
    <div
      role="tab"
      aria-selected={isActive}
      tabIndex={0}
      onClick={onSelect}
      onDoubleClick={onStartEdit}
      onKeyDown={(e) => { if (e.key === "Enter") onSelect(); }}
      className={cn(
        "group h-7 min-w-0 max-w-[180px] flex items-center gap-1 pl-3 rounded-md text-[13px] font-medium",
        "transition-colors duration-150 cursor-pointer",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
        tab.isDefault ? "pr-3" : "pr-1",
        isActive
          ? "bg-brand-500/10 text-brand-500"
          : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
      )}
      title={tab.isDefault ? `${tab.name} (default — cannot be deleted)` : `${tab.name} — double-click to rename`}
    >
      <span className="min-w-0 flex-1 truncate">{tab.name}</span>
      {!tab.isDefault && (
        <button
          type="button"
          onClick={onDelete}
          disabled={deleteTab.isPending}
          aria-label={`Delete tab ${tab.name}`}
          title="Delete tab"
          className={cn(
            "ml-0.5 w-4 h-4 shrink-0 inline-flex items-center justify-center rounded",
            "text-muted-foreground/60 hover:text-destructive hover:bg-destructive/10",
            "opacity-0 group-hover:opacity-100 transition-opacity duration-150",
            isActive && "opacity-60"
          )}
        >
          <X size={10} />
        </button>
      )}
    </div>
  );
}
