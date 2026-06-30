/** Edge-direction hints for orphan nodes — must match whitelist (passive node = TARGET). */
export const ORPHAN_HINTS: Partial<Record<string, string>> = {
  DTO: "DTO is TARGET: create_edge(source=Controller or Service, target=DTO, kind=USES). DTO is source only for DTO→USES→Enum, DTO→HAS→DTO.",
  Middleware: "Middleware is SOURCE: create_edge(source=Middleware, target=Controller, kind=ROUTES_TO).",
  Enum: "Enum is TARGET (never source): create_edge(source=Model or DTO or Table, target=Enum, kind=USES).",
  Exception: "Exception is TARGET: create_edge(source=Service or Controller or Repository, target=Exception, kind=THROWS).",
  EnvironmentVariable: "EnvironmentVariable is TARGET: create_edge(source=Service, target=EnvironmentVariable, kind=READS_CONFIG).",
  Cache: "Cache is TARGET: create_edge(source=Service, target=Cache, kind=CACHES_IN).",
  Repository: "Repository is both target and source: create_edge(source=Service, target=Repository, kind=CALLS) + create_edge(source=Repository, target=Table, kind=QUERIES or WRITES).",
  UIComponent: "UIComponent is TARGET: create_edge(source=FrontendApp, target=UIComponent, kind=HAS).",
  Model: "Model: create_edge(source=Service, target=Model, kind=USES) (target) + Model→USES→Table, Model→USES→Enum (source).",
  View: "View is TARGET: create_edge(source=Repository, target=View, kind=QUERIES).",
};

export const DEFAULT_ORPHAN_HINT =
  "Create an edge to a logical peer (CALLS, USES, HAS, etc.).";

export function orphanHintFor(type: string): string {
  return ORPHAN_HINTS[type] ?? DEFAULT_ORPHAN_HINT;
}

export function buildOrphanContext(
  orphans: Array<{ id: string; type: string; name: string }>,
): string {
  return orphans
    .map((o) => `- **${o.type}** "${o.name}" (id: ${o.id}) → ${orphanHintFor(o.type)}`)
    .join("\n");
}

export function allNodesConnectedStatus(nodeCount: number, edgeCount: number): string {
  return `${nodeCount} nodes, ${edgeCount} edges — all nodes connected, good progress.`;
}

export function orphanWarningStatus(
  nodeCount: number,
  edgeCount: number,
  orphanCount: number,
): string {
  return `${nodeCount} nodes, ${edgeCount} edges — ${orphanCount} nodes still orphan. Add to your TODO list and connect when possible.`;
}
