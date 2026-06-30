/** CommandPalette — ⌘K Linear/Vercel style universal command interface.
 *  Actions + node creation + node search + tab switching/creation in a single search box.
 *  cmdk filtering is native (fuzzy + accent-aware), entire UI is keyboard-navigable. */

import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  Plus, Search, Maximize2, ZoomIn, ZoomOut, Layers,
  Undo2, Redo2, Wand2, MessageSquareText, Layout,
  BookOpen, GitBranch, Keyboard, Code2,
} from "lucide-react";
import type { DocsSection } from "./DocsModal";
import {
  CommandDialog, CommandInput, CommandList, CommandEmpty,
  CommandGroup, CommandItem, CommandSeparator,
} from "@/components/ui/command";
import { useNodeTypes, useCreateNode } from "../api/nodes";
import { useTabs, useCreateTab, type Tab } from "../api/tabs";
import { useTabGraph } from "../api/tabs";
import { defaultProperties } from "../canvas/node-templates";
import { colorOf, familyOf, nameOf } from "../canvas/families";
import { useCanvasCommands } from "../canvas/canvas-commands";
import { useSelection } from "../state/selection";
import { useHistory } from "../state/history";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  /** Docs modal open callback — with section param (nodes/edges/shortcuts) */
  onOpenDocs: (section: DocsSection) => void;
}

export function CommandPalette({ open, onOpenChange, onOpenDocs }: Props) {
  const navigate = useNavigate();
  const { projectId = "", tabId } = useParams<{ projectId?: string; tabId?: string }>();
  const { data: nodeTypes } = useNodeTypes();
  const { data: tabs } = useTabs(projectId);
  const activeTabId = tabId ?? tabs?.find((t) => t.isDefault)?.id ?? null;
  const { data: graph } = useTabGraph(projectId, activeTabId);

  const createNode = useCreateNode(projectId, activeTabId);
  const createTab = useCreateTab(projectId);
  const canvasCmds = useCanvasCommands();

  // Search input — default groups visible when empty; cmdk filters on type
  const [search, setSearch] = useState("");

  // Clear search when modal closes (start fresh on next open)
  useEffect(() => {
    if (!open) setSearch("");
  }, [open]);

  const close = () => onOpenChange(false);

  const exec = (fn: () => void | Promise<void>) => {
    fn();
    close();
  };

  // ── Actions — visible when project is open ─────────────────────────
  const actions: Array<{ id: string; label: string; icon: React.ReactNode; shortcut?: string; run: () => void; available: boolean }> = [
    // Docs first group (always visible, quick access)
    {
      id: "docs-nodes", label: "Node Library (21 types)", icon: <Layers size={14} />,
      run: () => onOpenDocs("nodes"), available: true,
    },
    {
      id: "docs-edges", label: "Edge Library (16 types)", icon: <GitBranch size={14} />,
      run: () => onOpenDocs("edges"), available: true,
    },
    {
      id: "docs-shortcuts", label: "Keyboard Shortcuts", icon: <Keyboard size={14} />,
      run: () => onOpenDocs("shortcuts"), available: true,
    },
    {
      id: "act-ai-agent", label: "AI Agent — generate architecture", icon: <Wand2 size={14} />,
      run: () => { /* OmniBar is already in BottomBar, just close */ }, available: !!projectId,
    },
    {
      id: "act-ai-instruct", label: "AI Instruct — chat", icon: <MessageSquareText size={14} />,
      run: () => { /* same */ }, available: !!projectId,
    },
    {
      id: "act-fit", label: "Fit to view", icon: <Maximize2 size={14} />, shortcut: "F",
      run: () => canvasCmds.fit?.(), available: !!canvasCmds.fit,
    },
    {
      id: "act-arrange", label: "Auto arrange", icon: <Layout size={14} />, shortcut: "⌥L",
      run: () => canvasCmds.arrange?.(), available: !!canvasCmds.arrange,
    },
    {
      // Gating + panel opening in TopBar (solarch:codegen-open listener);
      // if not entitled, redirects to /billing from there.
      id: "act-codegen", label: "Generate Code — NestJS skeleton", icon: <Code2 size={14} />,
      run: () => window.dispatchEvent(new CustomEvent("solarch:codegen-open")),
      available: !!projectId,
    },
    {
      id: "act-zoom-in", label: "Zoom in", icon: <ZoomIn size={14} />, shortcut: "+",
      run: () => canvasCmds.zoomIn?.(), available: !!canvasCmds.zoomIn,
    },
    {
      id: "act-zoom-out", label: "Zoom out", icon: <ZoomOut size={14} />, shortcut: "−",
      run: () => canvasCmds.zoomOut?.(), available: !!canvasCmds.zoomOut,
    },
    {
      id: "act-undo", label: "Undo", icon: <Undo2 size={14} />, shortcut: "⌘Z",
      run: () => useHistory.getState().undo(), available: !!projectId,
    },
    {
      id: "act-redo", label: "Redo", icon: <Redo2 size={14} />, shortcut: "⌘⇧Z",
      run: () => useHistory.getState().redo(), available: !!projectId,
    },
    {
      id: "act-new-tab", label: "New tab", icon: <Plus size={14} />, shortcut: "⌘T",
      run: async () => {
        const t = await createTab.mutateAsync(`New Tab ${(tabs?.length ?? 0) + 1}`);
        navigate(`/p/${projectId}/${t.id}`);
      },
      available: !!projectId,
    },
  ].filter((a) => a.available);

  // ── Add node — 21 types ─────────────────────────────────────
  const addNode = (type: string) => {
    const props = defaultProperties(type);
    // Position near canvas center — viewport center
    const vp = canvasCmds.viewport;
    const center = {
      x: -vp.x / vp.zoom + 200,
      y: -vp.y / vp.zoom + 150,
    };
    createNode.mutate(
      { type, position: center, properties: props },
      {
        onSuccess: (node) => {
          if (node?.id) {
            // Focus + select new node
            useSelection.getState().selectNode(node.id);
            canvasCmds.focusNode?.(node.id, { zoom: true });
          }
        },
      },
    );
  };

  // Node type grouping — by familyLabel
  const typeGroups = useMemo(() => {
    const map = new Map<string, typeof nodeTypes>();
    for (const t of nodeTypes ?? []) {
      const arr = map.get(t.familyLabel) ?? [];
      arr.push(t);
      map.set(t.familyLabel, arr);
    }
    return [...map.entries()];
  }, [nodeTypes]);

  // ── Search nodes — existing nodes in graph ──────────────────
  const graphNodes = graph?.nodes ?? [];

  // ── Tabs — switch ──────────────────────────────────────
  const goToTab = (t: Tab) => navigate(`/p/${projectId}/${t.id}`);

  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
    >
      <CommandInput
        value={search}
        onValueChange={setSearch}
        placeholder="Search commands, nodes, tabs…"
      />
      <CommandList className="max-h-[420px]">
        <CommandEmpty>
          <div className="py-6 text-center text-[13px] text-muted-foreground font-mono">
            // no results
          </div>
        </CommandEmpty>

        {actions.length > 0 && (
          <CommandGroup heading="Actions">
            {actions.map((a) => (
              <CommandItem
                key={a.id}
                value={`${a.label} ${a.id}`}
                onSelect={() => exec(a.run)}
                className="flex items-center gap-2.5"
              >
                <span className="text-muted-foreground shrink-0">{a.icon}</span>
                <span className="flex-1 text-[14px]">{a.label}</span>
                {a.shortcut && (
                  <kbd className="font-mono text-[11.5px] text-muted-foreground/80 bg-muted/50 px-1.5 py-0.5 rounded">
                    {a.shortcut}
                  </kbd>
                )}
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        {typeGroups.length > 0 && projectId && activeTabId && (
          <>
            <CommandSeparator />
            {typeGroups.map(([famLabel, types]) => (
              <CommandGroup key={famLabel} heading={`Add node · ${famLabel}`}>
                {(types ?? []).map((t) => {
                  const accent = colorOf(t.id);
                  return (
                    <CommandItem
                      key={`type-${t.id}`}
                      value={`${t.id} ${famLabel} add new`}
                      onSelect={() => exec(() => addNode(t.id))}
                      className="flex items-center gap-2.5"
                    >
                      <span
                        className="w-4 h-4 rounded-sm border shrink-0"
                        style={{
                          backgroundColor: `${accent}14`,
                          borderColor: `${accent}40`,
                        }}
                      />
                      <span className="flex-1 text-[14px]">{t.id}</span>
                      <span className="text-[11.5px] text-muted-foreground font-mono">
                        + add
                      </span>
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            ))}
          </>
        )}

        {graphNodes.length > 0 && (
          <>
            <CommandSeparator />
            <CommandGroup heading={`Search nodes (${graphNodes.length})`}>
              {graphNodes.map((n) => {
                const name = nameOf(n.properties);
                const accent = colorOf(n.type);
                const fam = familyOf(n.type);
                return (
                  <CommandItem
                    key={`node-${n.id}`}
                    value={`${name} ${n.type} ${fam}`}
                    onSelect={() => exec(() => {
                      useSelection.getState().selectNode(n.id);
                      canvasCmds.focusNode?.(n.id, { zoom: true });
                    })}
                    className="flex items-center gap-2.5"
                  >
                    <span
                      className="w-4 h-4 rounded-sm border shrink-0"
                      style={{
                        backgroundColor: `${accent}14`,
                        borderColor: `${accent}40`,
                      }}
                    />
                    <span className="flex-1 text-[14px] truncate">{name}</span>
                    <span className="text-[11.5px] text-muted-foreground font-mono shrink-0">
                      {n.type}
                    </span>
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </>
        )}

        {tabs && tabs.length > 1 && (
          <>
            <CommandSeparator />
            <CommandGroup heading="Switch tab">
              {tabs.map((t) => (
                <CommandItem
                  key={`tab-${t.id}`}
                  value={`switch tab ${t.name}`}
                  onSelect={() => exec(() => goToTab(t))}
                  disabled={t.id === activeTabId}
                  className="flex items-center gap-2.5"
                >
                  <Layers size={14} className="text-muted-foreground shrink-0" />
                  <span className="flex-1 text-[14px]">{t.name}</span>
                  {t.id === activeTabId && (
                    <span className="text-[11.5px] text-brand-500 font-mono">active</span>
                  )}
                </CommandItem>
              ))}
            </CommandGroup>
          </>
        )}

        {/* Suppress unused warning — Search/BookOpen shadcn default + future use */}
        <span hidden><Search size={0} /><BookOpen size={0} /></span>
      </CommandList>
    </CommandDialog>
  );
}
