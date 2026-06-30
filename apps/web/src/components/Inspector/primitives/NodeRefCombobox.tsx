/** NodeRefCombobox — autocomplete among nodes of a specific type within the project.
 *  Exception for Throws, DTO for NestedDTORef, Enum for EnumRef, etc.
 *  Search input + filtered list + "+ Create new X 'foo'" item (zero matches).
 *  cmdk + Radix Popover, popover at Z_LAYERS.POPOVER above modals. */

import { useState, useMemo, useRef, useEffect } from "react";
import { useParams } from "react-router-dom";
import * as PopoverPrimitive from "@radix-ui/react-popover";
import { ChevronDown, Plus, Check } from "lucide-react";
import { Command as CommandPrimitive } from "cmdk";
import { toast } from "sonner";
import { useProjectNodes, useCreateNode } from "../../../api/nodes";
import { useCreateEdge } from "../../../api/edges";
import { useTabs } from "../../../api/tabs";
import { defaultProperties } from "../../../canvas/node-templates";
import { nameOf, colorOf } from "../../../canvas/families";
import { NodeIcon } from "../../../lib/node-icons";
import { Z_LAYERS } from "../../../lib/z-layers";
import { useConfirm } from "../../ui/confirm-dialog";
import { cn } from "@/lib/utils";

interface Props {
  /** Which node type to list (e.g. "Exception", "DTO", "Enum") */
  nodeType: string;
  /** Current value — name of the referenced node (name-based reference in Solarch) */
  value: string;
  onChange: (value: string) => void;
  /** Placeholder */
  placeholder?: string;
  ariaLabel?: string;
  className?: string;
  /** "cell" → dense grid cell: h-8, borderless/transparent, hover affordance (aligned with cell inputs). */
  density?: "default" | "cell";
  /** Auto-create edge — after selection or create, source → target (kind) edge.
   *  E.g. for Service.Throws: { sourceNodeId: serviceId, kind: "THROWS" }.
   *  Backend rejects duplicate edges with 409; silently swallowed. */
  linkAs?: { sourceNodeId: string; kind: string };
}

export function NodeRefCombobox({
  nodeType, value, onChange, placeholder, ariaLabel, className, density = "default", linkAs,
}: Props) {
  const cell = density === "cell";
  const { projectId = "", tabId } = useParams<{ projectId?: string; tabId?: string }>();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const { data: tabs } = useTabs(projectId);
  const activeTabId = tabId ?? tabs?.find((t) => t.isDefault)?.id ?? null;

  const { data: nodes = [] } = useProjectNodes(projectId, nodeType);
  const createNode = useCreateNode(projectId, activeTabId);
  const createEdge = useCreateEdge(projectId, activeTabId);
  const confirm = useConfirm();

  // Edge creation helper. Centralized error handling (providers.tsx global mutationCache.onError):
  // duplicate silent, rules rejection shows suggestion toast, others toast. No local onError
  // → no double-toast.
  const linkEdgeQuiet = (targetNodeId: string) => {
    if (!linkAs) return;
    if (linkAs.sourceNodeId === targetNodeId) return; // prevent self-loop
    createEdge.mutate(
      { sourceNodeId: linkAs.sourceNodeId, targetNodeId, kind: linkAs.kind },
      { onSuccess: (edge) => { if (edge?.warning) toast.warning(edge.warning.message, { description: edge.warning.suggestion }); } },
    );
  };

  // Candidate list — name search, keep in list even if value is already used
  const candidates = useMemo(() => {
    return nodes
      .map((n) => ({ id: n.id, name: nameOf(n.properties), type: n.type }))
      .filter((n) => n.name !== "?")
      .sort((a, b) => a.name.localeCompare(b.name, "tr"));
  }, [nodes]);

  const q = query.trim();
  const filtered = useMemo(() => {
    if (!q) return candidates;
    const ql = q.toLocaleLowerCase("tr");
    return candidates.filter((c) => c.name.toLocaleLowerCase("tr").includes(ql));
  }, [candidates, q]);

  const exactMatch = candidates.some((c) => c.name === q);
  const canCreate = q.length > 0 && !exactMatch && /^[A-Za-zÇĞİÖŞÜçğıöşü][\w]*$/.test(q);

  const accent = colorOf(nodeType);

  const handleSelect = (name: string) => {
    onChange(name);
    setOpen(false);
    setQuery("");
    // Existing node selected → create edge (if not already present)
    const selected = nodes.find((n) => nameOf(n.properties) === name);
    if (selected) linkEdgeQuiet(selected.id);
  };

  const handleCreate = async () => {
    if (!canCreate) return;
    const ok = await confirm({
      title: `New ${nodeType}: ${q}`,
      description: `A new ${nodeType} node named '${q}' will be created and added to your project. Continue?`,
      confirmLabel: "Create",
      cancelLabel: "Cancel",
    });
    if (!ok) return;
    const props = defaultProperties(nodeType);
    const nameKey = guessNameKey(nodeType);
    (props as Record<string, unknown>)[nameKey] = q;
    const center = { x: 0, y: 0 };
    createNode.mutate(
      { type: nodeType, position: center, properties: props },
      {
        onSuccess: (created) => {
          onChange(q);
          setOpen(false);
          setQuery("");
          toast.success(`${nodeType} created`, { description: q });
          // New node + linkAs → create edge (Service THROWS Exception etc.)
          if (created?.id) linkEdgeQuiet(created.id);
        },
        // No onError — global mutationCache.onError (providers.tsx) is the single source (prevents double-toast).
      },
    );
  };

  // Focus input when popover opens
  useEffect(() => {
    if (!open) return;
    const id = window.setTimeout(() => inputRef.current?.focus(), 30);
    return () => clearTimeout(id);
  }, [open]);

  return (
    <PopoverPrimitive.Root open={open} onOpenChange={setOpen}>
      <PopoverPrimitive.Trigger asChild>
        <button
          type="button"
          aria-label={ariaLabel}
          className={cn(
            "inline-flex items-center gap-2 w-full text-left transition-colors",
            cell
              ? "h-8 px-2 rounded text-[13px] border border-transparent bg-transparent hover:bg-[var(--ins-overlay-hover)] focus:outline-none focus:ring-1 focus:ring-[color:var(--ins-family-accent,var(--accent))]/30 focus:border-[color:var(--ins-family-accent,var(--accent))]"
              : "h-10 px-3.5 rounded-md text-[15px] border border-[color:var(--hairline-strong)] bg-[color:var(--paper-raised)] hover:border-[color:var(--ink-faint)] focus:outline-none focus:ring-2 focus:ring-[color:var(--ins-family-accent,var(--accent))]/25 focus:border-[color:var(--ins-family-accent,var(--accent))]",
            className,
          )}
        >
          {value ? (
            <>
              <NodeIcon type={nodeType} size={cell ? 12 : 14} color={accent} />
              <span className={cn("flex-1 truncate font-mono", cell ? "text-[12.5px]" : "text-[14.5px]")}>{value}</span>
            </>
          ) : (
            <span className="flex-1 truncate text-[color:var(--ink-faint)]">{placeholder ?? `Select ${nodeType}…`}</span>
          )}
          <ChevronDown size={cell ? 12 : 14} className="shrink-0 text-[color:var(--ink-faint)]" />
        </button>
      </PopoverPrimitive.Trigger>

      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          align="start"
          sideOffset={6}
          className={cn(
            "w-[var(--radix-popover-trigger-width)] min-w-[260px]",
            "rounded-lg border border-border bg-[color:var(--paper-raised)] shadow-float overflow-hidden",
            "data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95",
            "data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95",
            "duration-150",
          )}
          style={{ zIndex: Z_LAYERS.POPOVER }}
        >
          <CommandPrimitive shouldFilter={false} className="flex flex-col">
            <CommandPrimitive.Input
              ref={inputRef}
              value={query}
              onValueChange={setQuery}
              placeholder={`Search ${nodeType}…`}
              className="h-10 px-3.5 text-[14.5px] border-0 border-b border-[color:var(--hairline)] bg-transparent outline-none placeholder:text-[color:var(--ink-faint)]"
            />
            <CommandPrimitive.List className="max-h-[280px] overflow-y-auto py-1.5">
              {filtered.length === 0 && !canCreate && (
                <div className="px-3 py-4 text-center text-[13.5px] text-[color:var(--ink-faint)] font-mono">
                  // no results
                </div>
              )}
              {filtered.length > 0 && (
                <CommandPrimitive.Group>
                  {filtered.map((c) => {
                    const isSelected = c.name === value;
                    return (
                      <CommandPrimitive.Item
                        key={c.id}
                        value={c.name}
                        onSelect={() => handleSelect(c.name)}
                        className={cn(
                          "px-3 py-2 mx-1.5 rounded-md flex items-center gap-2.5 text-[14.5px] cursor-pointer",
                          "data-[selected=true]:bg-[var(--ins-pill-bg)]",
                          "hover:bg-[var(--ins-track)]",
                        )}
                      >
                        <span
                          className="w-5 h-5 rounded flex items-center justify-center shrink-0 border"
                          style={{ background: `${accent}14`, borderColor: `${accent}33` }}
                        >
                          <NodeIcon type={nodeType} size={11} color={accent} />
                        </span>
                        <span className="flex-1 truncate text-[color:var(--ink)]">{c.name}</span>
                        {isSelected && <Check size={13} className="shrink-0 text-brand-500" />}
                      </CommandPrimitive.Item>
                    );
                  })}
                </CommandPrimitive.Group>
              )}
              {canCreate && (
                <>
                  {filtered.length > 0 && (
                    <div className="my-1.5 border-t border-[color:var(--hairline)]" />
                  )}
                  <CommandPrimitive.Item
                    value={`__create:${q}`}
                    onSelect={handleCreate}
                    disabled={createNode.isPending}
                    className={cn(
                      "px-3 py-2 mx-1.5 rounded-md flex items-center gap-2.5 text-[14.5px] cursor-pointer",
                      "text-brand-500 font-medium",
                      "data-[selected=true]:bg-brand-500/10",
                      "hover:bg-brand-500/10",
                      createNode.isPending && "opacity-60 cursor-wait",
                    )}
                  >
                    <span className="w-5 h-5 rounded flex items-center justify-center shrink-0 bg-brand-500/10 border border-brand-500/30">
                      <Plus size={12} />
                    </span>
                    <span className="flex-1">
                      Create new {nodeType}: <span className="font-mono">{q}</span>
                    </span>
                  </CommandPrimitive.Item>
                </>
              )}
            </CommandPrimitive.List>
          </CommandPrimitive>
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}

/** Node type → "Name" key within properties (Exception=ExceptionName etc.) */
function guessNameKey(type: string): string {
  const map: Record<string, string> = {
    Table: "TableName", DTO: "Name", Model: "ClassName", Enum: "Name", View: "ViewName",
    Service: "ServiceName", Worker: "WorkerName", EventHandler: "HandlerName",
    Controller: "ControllerName", MessageQueue: "QueueName",
    Repository: "RepositoryName", Cache: "CacheName", ExternalService: "Name",
    FrontendApp: "AppName", UIComponent: "ComponentName",
    Middleware: "MiddlewareName",
    EnvironmentVariable: "Key", Exception: "ExceptionName",
    Module: "ModuleName",
    APIGateway: "GatewayName", Orchestrator: "OrchestratorName",
  };
  return map[type] ?? "Name";
}
