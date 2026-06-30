import { useCallback, useEffect, useState } from "react";
import { ArrowDown } from "lucide-react";
import { useNavigate, useParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { useTabs, useTabGraph, useSaveLayout } from "../../api/tabs";
import { useCreateNode } from "../../api/nodes";
import { CanvasView } from "../../canvas/CanvasView";
import { NodeActionBar } from "../../canvas/NodeActionBar";
import { NodeHoverCard } from "../../canvas/NodeHoverCard";
import { NodeNameEditor } from "../../canvas/NodeNameEditor";
import { AddNodeMenu } from "./AddNodeMenu";
import { QuickConnectMenu } from "./QuickConnectMenu";
import { EdgePicker } from "./EdgePicker";
import { InlineAiPrompt } from "./InlineAiPrompt";
import { ProposalBar } from "./ProposalBar";
import { OnboardingTour } from "../onboarding/OnboardingTour";
import { defaultProperties } from "../../canvas/node-templates";
import { nameOf, colorOf } from "../../canvas/families";
import { useHistory } from "../../state/history";
import { usePendingProposal } from "../../state/pending-proposal";
import { useWorkspaceView } from "../../state/workspace-view";
import { useCanvasViewMode } from "../../state/canvas-view-mode";
import { SimpleView } from "../simple/SimpleView";
import { useSimpleView, useSimpleSketch, useSimpleSketchModel, useRegenerateSketchModel } from "../../api/codegen";
import { CodegenPanel } from "../codegen/CodegenPanel";
import { ApiDocsPanel } from "../api/ApiDocsPanel";
import { ApiClientPanel } from "../api/ApiClientPanel";
import { rawDeleteNode, rawCreateNode, rawDeleteEdge, rawCreateEdge } from "../../api/raw";
import { useRules, legalEdgeKinds } from "../../api/rules";
import { ApiError } from "../../api/client";
import { toast } from "sonner";

/** Show non-blocking warning (WARN_*) on edge-create success path (not error). */
const showEdgeWarning = (w?: { message: string; suggestion?: string }) => {
  if (w) toast.warning(w.message, { description: w.suggestion });
};

/** Error message: prefer suggestion on rules rejection, otherwise message. */
const errMsg = (e: unknown): string | undefined =>
  e instanceof ApiError ? (e.suggestion ?? e.message) : e instanceof Error ? e.message : undefined;

interface QuickConnect {
  nodeId: string;
  nodeType: string;
  side: "in" | "out";
  world: { x: number; y: number };
  screen: { x: number; y: number };
}

export function ProjectPage() {
  const navigate = useNavigate();
  const { projectId = "", tabId } = useParams<{ projectId: string; tabId?: string }>();
  const { data: tabs, isLoading, isError, error } = useTabs(projectId);
  const [menu, setMenu] = useState<{ screen: { x: number; y: number }; world: { x: number; y: number } } | null>(null);
  const [quickConnect, setQuickConnect] = useState<QuickConnect | null>(null);
  // Connect two EXISTING nodes — if multiple legal kinds / rules not loaded, EdgePicker.
  const [connectPicker, setConnectPicker] = useState<{ srcId: string; tgtId: string; srcType: string; tgtType: string } | null>(null);
  // Inline AI expansion prompt (opened from AddNodeMenu / QuickConnect entries).
  // `tab`: tab it was opened on — render condition drops on tab change (no setState in effect needed).
  const [aiPrompt, setAiPrompt] = useState<{
    screen: { x: number; y: number };
    initial: string;
    autoSend: boolean;
    prefix: string;
    tab: string | null;
    source: { name: string; color: string } | null;
  } | null>(null);

  // Canvas ↔ Code mode switch: code surface lives in the body (not a modal). CodegenPanel is ALWAYS
  // mounted (invisible shell; generation triggers ONLY on first active → no cost on page load),
  // toggle = instant morph + generation/fill state preserved. On project change, return to canvas (store reset
  // — not local setState, lint-clean); CodegenPanel is keyed by projectId → fresh remount.
  const view = useWorkspaceView((s) => s.view);
  // In-canvas presentation mode: Technical (node/edge graph) ↔ Simple (feature map +
  // capability list — non-dev). Simple is a pure projection of the graph; reset on project change.
  const canvasMode = useCanvasViewMode((s) => s.mode);
  useEffect(() => {
    useWorkspaceView.getState().reset();
    useCanvasViewMode.getState().reset();
  }, [projectId]);
  // Simple View projection — fetch only in Simple mode (deterministic, free).
  const simple = useSimpleView(canvasMode === "simple" ? projectId : undefined);
  // Hand-drawn sketch Mermaid (AI-refined, cached) — legacy fallback, only in Simple mode.
  const sketch = useSimpleSketch(canvasMode === "simple" ? projectId : undefined);
  // Structured Mermaid-free model (ELK-laid-out + rough-rendered) — the new primary path.
  // Two-phase: baseline (instant structure) renders first, then the AI-enriched model settles in.
  const sketchModel = useSimpleSketchModel(canvasMode === "simple" ? projectId : undefined);
  const sketchBase = useSimpleSketchModel(canvasMode === "simple" ? projectId : undefined, "baseline");
  // "Regenerate" — re-run the AI refine (bypass the server cache) even when the graph is unchanged.
  const regenSketch = useRegenerateSketchModel(projectId);

  const activeTab = tabId ?? tabs?.find((t) => t.isDefault)?.id ?? tabs?.[0]?.id ?? null;
  const { data: graph } = useTabGraph(projectId, activeTab);
  const { data: whitelist } = useRules();
  const saveLayout = useSaveLayout(projectId, activeTab);
  const createNode = useCreateNode(projectId, activeTab);
  const qc = useQueryClient();

  // One proposal at a time: no new inline generation opens until the current proposal is resolved.
  const openAiPrompt = useCallback(
    (opts: {
      screen: { x: number; y: number };
      initial?: string;
      autoSend?: boolean;
      prefix?: string;
      source?: { name: string; color: string } | null;
    }) => {
      if (usePendingProposal.getState().active) {
        toast("Resolve the pending AI proposal first", {
          description: "Approve or reject the highlighted changes.",
        });
        return;
      }
      setAiPrompt({
        screen: opts.screen,
        initial: opts.initial ?? "",
        autoSend: opts.autoSend ?? false,
        prefix: opts.prefix ?? "",
        tab: activeTab,
        source: opts.source ?? null,
      });
    },
    [activeTab],
  );

  // Connect two EXISTING nodes (when port-drag ends ON a node). RAW path → bypasses
  // global mutation toast; error/warning toast handled here manually. id-stable history.
  const connectExisting = useCallback((srcId: string, tgtId: string, kind: string) => {
    let liveEdgeId: string;
    void (async () => {
      try {
        const edge = await rawCreateEdge(projectId, { sourceNodeId: srcId, targetNodeId: tgtId, kind }, qc);
        liveEdgeId = edge.id;
        showEdgeWarning(edge.warning); // non-blocking warning (empty table etc.)
        if (useHistory.getState().isReplaying) return;
        useHistory.getState().record({
          undo: async () => { try { await rawDeleteEdge(projectId, liveEdgeId, qc); } catch (e) { toast.error("Could not undo", { description: errMsg(e) }); } },
          redo: async () => {
            try { const e2 = await rawCreateEdge(projectId, { sourceNodeId: srcId, targetNodeId: tgtId, kind }, qc); liveEdgeId = e2.id; showEdgeWarning(e2.warning); }
            catch (e) { toast.error("Could not redo", { description: errMsg(e) }); }
          },
        });
      } catch (e) {
        // Duplicate silent (consistent with providers global suppress); other rejections visible.
        if ((e as ApiError | null)?.code === "ERR_EDGE_DUPLICATE") return;
        toast.error("Could not create connection", { description: errMsg(e) });
      }
    })();
  }, [projectId, qc]);

  const onEdgeDrop = useCallback((nodeId: string, side: "in" | "out", world: { x: number; y: number }, screen: { x: number; y: number }, targetNodeId?: string) => {
    const node = graph?.nodes.find((n) => n.id === nodeId);
    if (!node) return;
    // Drop on empty space → new node flow (QuickConnectMenu) — existing behavior.
    if (!targetNodeId) {
      setQuickConnect({ nodeId, nodeType: node.type, side, world, screen });
      return;
    }
    // Drop ON an existing node → connect two nodes. Direction: out→drag source, in→reverse.
    const target = graph?.nodes.find((n) => n.id === targetNodeId);
    if (!target) return;
    const srcId = side === "out" ? nodeId : targetNodeId;
    const tgtId = side === "out" ? targetNodeId : nodeId;
    const srcType = graph!.nodes.find((n) => n.id === srcId)!.type;
    const tgtType = graph!.nodes.find((n) => n.id === tgtId)!.type;
    // Rules loaded + exactly 1 legal kind → connect immediately; otherwise (0/many/not loaded) EdgePicker.
    const kinds = whitelist ? legalEdgeKinds(whitelist, srcType, tgtType) : [];
    if (whitelist && kinds.length === 1) {
      connectExisting(srcId, tgtId, kinds[0].edge);
    } else {
      setConnectPicker({ srcId, tgtId, srcType, tgtType });
    }
  }, [graph, whitelist, connectExisting]);

  // Reset history on tab change — prevent old tab's moves from mixing
  useEffect(() => {
    useHistory.getState().clear();
    // Tab changed → pending AI proposal implicitly accepted (elements already in DB).
    usePendingProposal.getState().clear();
  }, [activeTab]);

  const onEdgeDelete = useCallback((edgeId: string) => {
    const edge = graph?.edges.find((e) => e.id === edgeId);
    if (!edge) return;
    const { sourceNodeId, targetNodeId, kind } = edge;
    // id-stable: undo creates new edge → liveEdgeId updates, redo deletes it
    // (instead of old deleted id) → redo doesn't leave orphans.
    let liveEdgeId = edgeId;
    rawDeleteEdge(projectId, liveEdgeId, qc)
      .then(() => {
        useHistory.getState().record({
          undo: async () => {
            try {
              const recreated = await rawCreateEdge(projectId, { sourceNodeId, targetNodeId, kind }, qc);
              liveEdgeId = recreated.id;
            } catch (e) { toast.error("Could not undo", { description: errMsg(e) }); }
          },
          redo: async () => {
            try { await rawDeleteEdge(projectId, liveEdgeId, qc); }
            catch (e) { toast.error("Could not redo", { description: errMsg(e) }); }
          },
        });
      })
      .catch((e) => toast.error("Could not delete connection", { description: errMsg(e) }));
  }, [projectId, graph, qc]);

  const handleQuickPick = useCallback(async (pickedType: string, edgeKind: string) => {
    if (!quickConnect) return;
    const { nodeId, side, world } = quickConnect;
    setQuickConnect(null);
    const props = defaultProperties(pickedType);
    // id-stable: liveNodeId/liveEdgeId update on redo, undo deletes them → no orphans.
    let liveNodeId: string;
    let liveEdgeId: string;
    try {
      const newNode = await rawCreateNode(projectId, {
        type: pickedType, homeTabId: activeTab ?? undefined, position: world, properties: props,
      }, qc);
      liveNodeId = newNode.id;
      // out → existing node source, new node target; in → new node source, existing node target
      const srcId = side === "out" ? nodeId : liveNodeId;
      const tgtId = side === "out" ? liveNodeId : nodeId;
      try {
        const newEdge = await rawCreateEdge(projectId, { sourceNodeId: srcId, targetNodeId: tgtId, kind: edgeKind }, qc);
        liveEdgeId = newEdge.id;
        showEdgeWarning(newEdge.warning); // non-blocking warning (empty table etc.)
      } catch (e) {
        // Edge rejected (e.g. rules) → clean up orphan node + notify user.
        await rawDeleteNode(projectId, liveNodeId, qc).catch(() => {});
        toast.error("Could not create connection", { description: errMsg(e) });
        return;
      }
    } catch (e) {
      toast.error("Could not create node", { description: errMsg(e) });
      return;
    }
    if (useHistory.getState().isReplaying) return;
    useHistory.getState().record({
      undo: async () => {
        try {
          await rawDeleteEdge(projectId, liveEdgeId, qc);
          await rawDeleteNode(projectId, liveNodeId, qc);
        } catch (e) { toast.error("Could not undo", { description: errMsg(e) }); }
      },
      redo: async () => {
        try {
          const n2 = await rawCreateNode(projectId, { type: pickedType, homeTabId: activeTab ?? undefined, position: world, properties: props }, qc);
          liveNodeId = n2.id;
          const s2 = side === "out" ? nodeId : liveNodeId;
          const t2 = side === "out" ? liveNodeId : nodeId;
          const e2 = await rawCreateEdge(projectId, { sourceNodeId: s2, targetNodeId: t2, kind: edgeKind }, qc);
          liveEdgeId = e2.id;
          showEdgeWarning(e2.warning); // non-blocking warning should surface consistently in redo too
        } catch (e) { toast.error("Could not redo", { description: errMsg(e) }); }
      },
    });
  }, [quickConnect, projectId, activeTab, qc]);

  // Invalid / deleted / inaccessible project deep-link → don't spin on "preparing
  // canvas" forever. ERR_PROJECT_NOT_FOUND / ERR_PROJECT_FORBIDDEN (and any other
  // load failure) land here with a recovery screen instead of an infinite loader.
  if (isError) {
    const code = error instanceof ApiError ? error.code : undefined;
    const message =
      code === "ERR_PROJECT_FORBIDDEN"
        ? "You don't have access to this project."
        : "Project not found or no access.";
    return (
      <div className="flex flex-col h-full">
        <div className="relative flex-1 overflow-hidden bg-[color:var(--paper)]">
          <div
            aria-hidden
            className="absolute inset-0"
            style={{
              backgroundImage: "radial-gradient(circle, var(--grid-dot) 1.1px, transparent 1.6px)",
              backgroundSize: "28px 28px",
            }}
          />
          <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 flex flex-col items-center gap-4 text-center animate-in fade-in duration-200">
            <div className="font-mono text-[14px] text-[color:var(--ink-faint)]">{message}</div>
            <button
              type="button"
              onClick={() => navigate("/start")}
              className="inline-flex items-center rounded-md bg-brand-500 px-3 py-1.5 font-mono text-[13px] font-medium text-black transition-colors hover:bg-brand-600"
            >
              Back to projects
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <div className="relative flex-1 overflow-hidden bg-[color:var(--paper)]" data-tour="canvas">
        {/* Simple View overlay — a pure projection of the technical graph. The Technical ⇄ Simple
            toggle now lives in the top ViewSwitch (hover the Canvas segment). */}
        {canvasMode === "simple" && <SimpleView data={simple.data} mermaid={sketch.data?.mermaid} model={sketchModel.data?.model ?? sketchBase.data?.model} organizing={(!sketchModel.data && !!sketchBase.data) || regenSketch.isPending} source={sketchModel.data?.source} aiConfigured={sketchModel.data?.aiConfigured} onRegenerate={() => regenSketch.mutate()} regenerating={regenSketch.isPending} loading={simple.isLoading} />}
        {graph ? (
          <div key={activeTab} className="absolute inset-0 animate-in fade-in duration-200">
            <CanvasView
              graph={graph}
              onNodeMoved={(nodeId, x, y) => saveLayout.mutate([{ nodeId, x, y }])}
              onContextMenu={(world, screen) => setMenu({ world, screen })}
              onEdgeDrop={onEdgeDrop}
              onArrange={(items) => saveLayout.mutate(items)}
              onApplyLayout={(items) => saveLayout.mutate(items)}
              onEdgeDelete={onEdgeDelete}
            />
            {/* Empty canvas — first-action hint. pointer-events-none → right-click passes to canvas;
                disappears on its own once the first node is added (nodes.length>0). Persistent
                affordance independent of the tour (so users who Esc / return don't get stuck). */}
            {graph.nodes.length === 0 && (
              <div className="pointer-events-none absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 animate-in fade-in duration-500">
                <div className="max-w-xs rounded-xl border border-[hsl(var(--border))] bg-[color:var(--paper-raised)]/85 px-5 py-4 text-center shadow-sm backdrop-blur-sm">
                  <p className="text-[14px] font-medium text-[color:var(--ink)]">Your canvas is empty</p>
                  <p className="mt-1 text-[13px] leading-relaxed text-[color:var(--ink-soft)]">
                    Right-click to add a node — or describe your system in the bar below and let the AI draw it.
                  </p>
                </div>
                <ArrowDown size={16} className="text-[color:var(--ink-faint)]" />
              </div>
            )}
          </div>
        ) : (
          <>
            <div
              aria-hidden
              className="absolute inset-0"
              style={{
                backgroundImage: "radial-gradient(circle, var(--grid-dot) 1.1px, transparent 1.6px)",
                backgroundSize: "28px 28px",
              }}
            />
            <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 font-mono text-[14px] text-[color:var(--ink-faint)] animate-in fade-in duration-200">
              {isLoading
                ? "loading graph…"
                : tabs && tabs.length === 0
                ? "// empty project — add tab from TopBar"
                : "preparing canvas…"}
            </div>
          </>
        )}

        {menu && (
          <AddNodeMenu
            screen={menu.screen}
            onClose={() => setMenu(null)}
            onPick={(type) => {
              const pos = menu.world;
              const props = defaultProperties(type);
              createNode.mutate({ type, position: pos, properties: props }, {
                onSuccess: (node) => {
                  if (!node || useHistory.getState().isReplaying) return;
                  // id-stable: redo creates new node → liveNodeId updates, undo deletes it.
                  let liveNodeId = node.id;
                  useHistory.getState().record({
                    undo: async () => {
                      try { await rawDeleteNode(projectId, liveNodeId, qc); }
                      catch (e) { toast.error("Could not undo", { description: errMsg(e) }); }
                    },
                    redo: async () => {
                      try {
                        const n2 = await rawCreateNode(projectId, { type, homeTabId: activeTab ?? undefined, position: pos, properties: props }, qc);
                        liveNodeId = n2.id;
                      } catch (e) { toast.error("Could not redo", { description: errMsg(e) }); }
                    },
                  });
                },
              });
              setMenu(null);
            }}
            onAskAi={(q) => {
              const screen = menu.screen;
              setMenu(null);
              // If query is non-empty, send directly; otherwise open an empty prompt.
              openAiPrompt({ screen, initial: q ?? "", autoSend: !!q?.trim() });
            }}
          />
        )}

        {quickConnect && (
          <QuickConnectMenu
            nodeType={quickConnect.nodeType}
            side={quickConnect.side}
            screen={quickConnect.screen}
            onPick={handleQuickPick}
            onClose={() => setQuickConnect(null)}
            onExtendAi={() => {
              const ctx = quickConnect;
              setQuickConnect(null);
              const srcNode = graph?.nodes.find((n) => n.id === ctx.nodeId);
              const name = srcNode ? nameOf(srcNode.properties) : ctx.nodeType;
              // Backend agent already sees the current graph — source context carried via message prefix.
              openAiPrompt({
                screen: ctx.screen,
                prefix: `Extend the architecture starting from the existing ${ctx.nodeType} "${name}" (id: ${ctx.nodeId}): `,
                source: { name, color: colorOf(ctx.nodeType) },
              });
            }}
          />
        )}

        {aiPrompt && aiPrompt.tab === activeTab && (
          <InlineAiPrompt
            projectId={projectId}
            tabId={activeTab}
            screen={aiPrompt.screen}
            initialPrompt={aiPrompt.initial}
            contextPrefix={aiPrompt.prefix}
            autoSend={aiPrompt.autoSend}
            source={aiPrompt.source}
            onClose={() => setAiPrompt(null)}
          />
        )}

        {connectPicker && (
          <EdgePicker
            sourceType={connectPicker.srcType}
            targetType={connectPicker.tgtType}
            onPick={(edge) => {
              const { srcId, tgtId } = connectPicker;
              setConnectPicker(null);
              connectExisting(srcId, tgtId, edge);
            }}
            onClose={() => setConnectPicker(null)}
          />
        )}

        {graph && <NodeActionBar />}
        {graph && <NodeHoverCard />}
        {graph && <NodeNameEditor />}
        {/* Inline AI proposal decision bar — visible while the pending set is non-empty. */}
        {graph && <ProposalBar projectId={projectId} />}
        {/* First-visit tour — once via localStorage flag; every step has skip. */}
        {graph && <OnboardingTour />}

        {/* CODE SURFACE — body layer that opens OVER the canvas via morph (not a modal).
            Always mounted (invisible shell; generation on first active) → instant toggle + state preserved.
            Keyed by projectId → fresh remount on project change. */}
        {projectId && <CodegenPanel key={`code-${projectId}`} projectId={projectId} active={view === "code"} />}

        {/* API SURFACE — Scalar-rendered OpenAPI docs + AI Documentize + manual localhost test.
            Body layer over the canvas (morph), keyed by projectId → fresh remount on project change. */}
        {projectId && <ApiClientPanel key={`api-${projectId}`} projectId={projectId} active={view === "api"} />}
        {projectId && <ApiDocsPanel key={`docs-${projectId}`} projectId={projectId} active={view === "docs"} />}
      </div>
    </div>
  );
}
