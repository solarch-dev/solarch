/** TopBar (h-12 sticky top, glass z-50)
 *  Slot 1: Logo + Project dropdown
 *  Slot 2: Tabs (project route only)
 *  Slot 3: spacer
 *  Slot 4: AI + Save + Account */

import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ChevronDown, Plus, Check, X, Sparkles, ArrowUp, Trash2, GitCompareArrows, KeyRound, Sun, Moon, Monitor } from "lucide-react";
import { Z_LAYERS } from "../lib/z-layers";
import { Button } from "@/components/ui/button";
import { useCodegenStatus } from "../api/codegen";
import { ViewSwitch } from "./ViewSwitch";
import { useWorkspaceView } from "@/state/workspace-view";
import { useTheme } from "@/state/theme";
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
  const { projectId, tabId } = useParams<{ projectId?: string; tabId?: string }>();
  const { data: projects } = useProjects();
  const { data: tabs } = useTabs(projectId ?? "");
  const createProject = useCreateProject();
  const deleteProject = useDeleteProject();
  const confirm = useConfirm();
  const [newProjectName, setNewProjectName] = useState("");
  const themeMode = useTheme((s) => s.mode);
  const cycleTheme = useTheme((s) => s.cycle);
  const ThemeIcon = themeMode === "dark" ? Moon : themeMode === "light" ? Sun : Monitor;
  const themeLabel = `Appearance: ${themeMode === "system" ? "System" : themeMode === "light" ? "Light" : "Dark"}`;
  const { data: codegenStatus } = useCodegenStatus(projectId);
  const showCodegenUpdate = !!projectId && (codegenStatus?.updateAvailable ?? false);
  const driftCount = codegenStatus?.driftCount ?? 0;
  const showDrift =
    !!projectId && (codegenStatus?.diagramDrifted ?? false) && !showCodegenUpdate;
  const openCode = useWorkspaceView((s) => s.openCode);
  const requestRegen = useWorkspaceView((s) => s.requestRegen);
  const enterCode = useCallback(
    (opts?: { focusNodeId?: string; regen?: boolean }) => {
      if (opts?.regen) requestRegen();
      else openCode(opts?.focusNodeId);
    },
    [openCode, requestRegen],
  );

  useEffect(() => {
    const onCodegenOpen = (e: Event) => {
      const detail = (e as CustomEvent<{ focusNodeId?: string }>).detail;
      enterCode({ focusNodeId: detail?.focusNodeId });
    };
    window.addEventListener("solarch:codegen-open", onCodegenOpen);
    return () => window.removeEventListener("solarch:codegen-open", onCodegenOpen);
  }, [enterCode]);

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
    if (p.id === projectId) navigate("/start");
  };

  return (
    <header
      className="h-12 sticky top-0 flex items-center px-2 gap-2 sm:px-3 sm:gap-3
                 bg-card/95 backdrop-blur-xl border-b border-border
                 shadow-[0_1px_0_rgba(255,255,255,0.6)_inset]"
      style={{ zIndex: Z_LAYERS.CHROME }}
    >
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
          <Button variant="ghost" size="sm" data-tour="project-menu" className="h-7 px-2 text-[13px] gap-1.5">
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
        </DropdownMenuContent>
      </DropdownMenu>

      <div className="flex min-w-0 flex-1 items-center gap-3">
        {projectId && tabs && tabs.length > 0 && (
          <>
            <Separator orientation="vertical" className="h-5 shrink-0" />
            <TabBar
              projectId={projectId}
              tabs={tabs}
              activeTabId={activeTabId}
              onSelect={(id) => navigate(`/p/${projectId}/${id}`)}
            />
          </>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-2">
        {projectId && (
          <>
            <div data-tour="generate" className="flex">
              <ViewSwitch onCodeRequested={() => enterCode()} disabled={false} />
            </div>
            <Separator orientation="vertical" className="h-5" />
          </>
        )}
        {showCodegenUpdate && (
          <button
            type="button"
            onClick={() => enterCode({ regen: true })}
            title="Your codebase is now better. Regenerate with the latest Constructor."
            className="inline-flex h-7 items-center gap-1.5 rounded-md bg-[#ff6b1a] px-2.5 font-mono text-[13px] font-medium text-black shadow-sm transition-colors hover:bg-[#d94d00] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ff6b1a] focus-visible:ring-offset-1"
          >
            <Sparkles size={12} />
            <span className="hidden sm:inline">Codebase improved</span>
            <ArrowUp size={12} />
            <span>Update</span>
          </button>
        )}
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
          onClick={() => navigate("/settings")}
          title="Settings"
          aria-label="Settings"
          className="inline-flex h-7 w-7 items-center justify-center rounded-md text-ink-soft transition-colors hover:bg-black/5 dark:hover:bg-white/10"
        >
          <KeyRound size={14} />
        </button>
      </div>
    </header>
  );
}

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
    setEditingId(created.id);
  };

  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => setWidth(entries[0]?.contentRect.width ?? 0));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const MIN_TAB = 84;
  const NEW_BTN = 36;
  const DROP_BTN = 92;
  const GAP = 4;
  let visibleCount: number;
  if (width === 0) {
    visibleCount = tabs.length;
  } else {
    const usable = Math.max(0, width - NEW_BTN);
    const capNoDrop = Math.floor((usable + GAP) / (MIN_TAB + GAP));
    visibleCount =
      tabs.length <= capNoDrop
        ? tabs.length
        : Math.max(1, Math.floor((usable - DROP_BTN + GAP) / (MIN_TAB + GAP)));
  }

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
          createTab.isPending && "opacity-40 cursor-wait",
        )}
      >
        <Plus size={12} />
        {tabs.length === 1 && <span>Create tab</span>}
      </button>
      {overflow.length > 0 && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              title="More tabs"
              aria-label={`${overflow.length} more tabs`}
              className="h-7 shrink-0 inline-flex items-center gap-1 rounded-md px-2 text-[13px] font-medium text-muted-foreground transition-colors hover:text-foreground hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
            >
              <span className="tabular-nums">{overflow.length} Tab</span>
              <ChevronDown size={12} />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="max-h-[60vh] w-56 overflow-y-auto">
            {overflow.map((t) => (
              <DropdownMenuItem key={t.id} onClick={() => onSelect(t.id)} className="flex items-center gap-2 text-[13px]">
                {t.id === activeTabId ? <Check size={12} className="shrink-0 text-brand-500" /> : <span className="w-3 shrink-0" />}
                <span className="truncate">{t.name}</span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
}

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

  useEffect(() => {
    if (isEditing) {
      setDraftName(tab.name);
      setTimeout(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      }, 0);
    }
  }, [isEditing, tab.name]);

  const commitRename = () => {
    const trimmed = draftName.trim();
    if (trimmed && trimmed !== tab.name) updateTab.mutate({ tabId: tab.id, name: trimmed });
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
      description: "Nodes in this tab will be moved to the Main Architecture tab. This action cannot be undone.",
      variant: "danger",
      confirmLabel: "Delete tab",
      cancelLabel: "Cancel",
    });
    if (!ok) return;
    deleteTab.mutate(tab.id);
  };

  if (isEditing) {
    return (
      <div className={cn("group h-7 flex items-center gap-1 pl-2.5 pr-1 rounded-md border", "bg-card border-brand-500/40 shadow-sm")}>
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
        "group h-7 min-w-0 max-w-[180px] flex items-center gap-1 pl-3 rounded-md text-[13px] font-medium transition-colors duration-150 cursor-pointer",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
        tab.isDefault ? "pr-3" : "pr-1",
        isActive ? "bg-brand-500/10 text-brand-500" : "text-muted-foreground hover:text-foreground hover:bg-muted/50",
      )}
      title={tab.isDefault ? `${tab.name} (default)` : `${tab.name} — double-click to rename`}
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
            "ml-0.5 w-4 h-4 shrink-0 inline-flex items-center justify-center rounded text-muted-foreground/60 hover:text-destructive hover:bg-destructive/10",
            "opacity-0 group-hover:opacity-100 transition-opacity duration-150",
            isActive && "opacity-60",
          )}
        >
          <X size={10} />
        </button>
      )}
    </div>
  );
}
