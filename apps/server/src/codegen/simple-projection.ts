/** simple-projection.ts — TEKNİK graf → "Basit Görünüm" projeksiyonu (non-dev).
 *
 *  Solarch'ın Mermaid/SQL export'unun kardeşi: kanonik CodeGraph'tan DETERMİNİSTİK,
 *  READ-ONLY bir SystemMap üretir. Frontend (src/features/simple) bunu render eder.
 *  Ayrı state yok → drift yok; graf değişince projeksiyon de değişir.
 *
 *  İKİ SEVİYE:
 *   A) Sistem Haritası: feature kutuları + "kullanır"(dependsOn)/"tetikler"(pub→sub)
 *      okları. TAMAMEN deterministik — codegen'in NestJS module wiring'i ürettiği
 *      AYNI Feature modeli (features()/dependsOn/forwardRefDeps).
 *   B) Capability listesi: her Controller endpoint'i → sade bir yetenek kartı +
 *      mantık şeması (flowchart). Teknik zincir (Controller→Service→Repo→Table)
 *      collapse edilir; DTO/Cache/Middleware gizlenir → "+N detay".
 *
 *  DÜRÜSTLÜK: yalnız graf-modellenmiş gerçekler çizilir. Karar düğümü SADECE gerçek
 *  bir koşuldan gelir (RequiresAuth → auth-guard). İş-mantığı koşulları (dolu metot
 *  gövdesinde) GRAF'ta olmadığı için UYDURULMAZ. Fiil etiketleri deterministik tablo
 *  (LLM yok); endpoint.Description varsa o tercih edilir. */

import type { CodeGraph, CodeNode, Feature } from "./ir";
import { propsOf } from "./ir";

/* ── DTO'lar (frontend src/features/simple/types.ts ile YAPISAL eşleşir) ──── */

export type DataAccess = "writes" | "reads";
export type FlowNodeKind = "terminal" | "process" | "decision" | "data" | "external" | "end" | "state";

export interface CapabilityDatumDTO { access: DataAccess; label: string }
export interface FlowNodeDTO { id: string; kind: FlowNodeKind; label: string; access?: DataAccess }
export interface FlowEdgeDTO { from: string; to: string; label?: string }
export interface CapabilityFlowDTO { nodes: FlowNodeDTO[]; edges: FlowEdgeDTO[] }
export interface CapabilityDTO {
  actor: string;
  action: string;
  data: CapabilityDatumDTO[];
  triggers?: string[];
  external?: string[];
  hidden: number;
}
export interface FeatureBoxDTO {
  slug: string;
  title: string;
  tier: number;
  capabilityCount: number;
  dataLabels: string[];
  external?: string[];
  capabilities: CapabilityDTO[];
  /** ONE consolidated flowchart for the whole feature: a single shared auth gate
   *  ("Signed in?") + each operation as a leaf. Operations sharing the auth check
   *  are NOT repeated; no Start/End ceremony. Undefined when the feature has no
   *  endpoints. */
  flowGraph?: CapabilityFlowDTO;
}
export interface FeatureArrowDTO { from: string; to: string; label: string; mutual?: boolean }
export interface SystemMapDTO {
  features: FeatureBoxDTO[];
  arrows: FeatureArrowDTO[];
  shared?: { items: string[] };
}

/* ── Sözlük + yardımcılar (deterministik) ──────────────────────────────── */

/** slug → Başlık Düzeni ("user-profile" → "User Profile"). */
function titleOf(slug: string): string {
  return slug
    .split(/[-_]/)
    .filter(Boolean)
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
    .join(" ");
}

/** Tek bir tanımlayıcıyı insan-okur tekil nesneye indirger ("messages" → "Message"). */
function objectOf(raw: string): string {
  let s = raw.replace(/[^A-Za-z0-9]+/g, " ").trim();
  if (!s) return "";
  // basit tekilleştirme (sade): "ies"→"y", sondaki "s" düş.
  if (/ies$/i.test(s)) s = s.replace(/ies$/i, "y");
  else if (/[^s]s$/i.test(s)) s = s.replace(/s$/i, "");
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Route'tan anlamlı nesne ("/messages/:id" → "Message"); yoksa controller adı. */
function routeObject(route: string, controllerName: string): string {
  const seg = route
    .split("/")
    .map((p) => p.trim())
    .filter((p) => p && !p.startsWith(":") && !p.startsWith("{"));
  const last = seg[seg.length - 1];
  if (last) return objectOf(last);
  return objectOf(controllerName.replace(/Controller$/i, ""));
}

type EndpointProps = { HttpMethod: string; Route: string; RequiresAuth: boolean; ReturnsCollection?: boolean; RequestDTORef?: string; ResponseDTORef?: string; MiddlewareRefs?: string[]; Description?: string };

/** Last non-param route segment, title-cased ("/complaints" → "Complaints"); the
 *  collection name as written (usually plural) — for "Lists …". */
function collectionOf(route: string, controllerName: string): string {
  const seg = route.split("/").map((p) => p.trim()).filter((p) => p && !p.startsWith(":") && !p.startsWith("{"));
  const last = seg[seg.length - 1];
  if (last) {
    const s = last.replace(/[^A-Za-z0-9]+/g, " ").trim();
    return s.charAt(0).toUpperCase() + s.slice(1);
  }
  return objectOf(controllerName.replace(/Controller$/i, ""));
}

/** Route carries a path parameter (/:id, /{id}) → single-item operation. */
function hasPathParam(route: string): boolean {
  return route.split("/").some((p) => p.startsWith(":") || p.startsWith("{"));
}

/** "a" / "an" by leading vowel (simple). */
function article(word: string): string {
  return /^[aeiou]/i.test(word) ? "an" : "a";
}

/** Endpoint → plain action phrase. Description wins; otherwise a deterministic verb table. */
function actionSentence(ep: EndpointProps, controllerName: string): string {
  if (ep.Description && ep.Description.trim()) return ep.Description.trim();
  const obj = routeObject(ep.Route, controllerName);
  const a = article(obj);
  // Capability voice — "things a person can do", not system narration. No "by ID" jargon.
  switch (ep.HttpMethod) {
    case "POST":
      return `Creates ${obj}`;
    case "PUT":
    case "PATCH":
      return `Updates ${obj}`;
    case "DELETE":
      return `Deletes ${obj}`;
    default: // GET
      return ep.ReturnsCollection ? `Lists ${obj}` : `Gets ${obj}`;
  }
}

const WRITE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/* ── A) Sistem Haritası ─────────────────────────────────────────────────── */

/** dependsOn (eager, forwardRef hariç) zincir derinliği = tier (temel sol). */
function computeTiers(features: Feature[]): Map<string, number> {
  const bySlug = new Map(features.map((f) => [f.slug, f]));
  const cache = new Map<string, number>();
  const visit = (slug: string, stack: Set<string>): number => {
    if (cache.has(slug)) return cache.get(slug)!;
    const f = bySlug.get(slug);
    if (!f) return 0;
    let t = 0;
    stack.add(slug);
    for (const d of f.dependsOn) {
      if (f.forwardRefDeps.includes(d) || !bySlug.has(d) || stack.has(d)) continue;
      t = Math.max(t, 1 + visit(d, stack));
    }
    stack.delete(slug);
    cache.set(slug, t);
    return t;
  };
  for (const f of features) visit(f.slug, new Set());
  return cache;
}

/** Bir feature'ın insan-okur veri etiketleri (entity + sentez tablo adları). */
function dataLabelsOf(f: Feature): string[] {
  const out = new Set<string>();
  for (const e of f.entities) out.add(objectOf(e.name));
  for (const t of f.syntheticEntityTables) out.add(objectOf(t.name));
  return [...out].sort();
}

/** Feature'ın kullandığı dış servis adları. */
function externalsOf(f: Feature): string[] {
  return f.infraProviders
    .filter((n) => n.kindOf() === "ExternalService")
    .map((n) => n.name)
    .sort();
}

/** pub→sub "tetikler" ilişkileri: bir feature'ın PUBLISHES ettiği kuyruğu başka bir
 *  feature'ın EventHandler'ı SUBSCRIBES ediyorsa kaynak→tüketici "tetikler". */
function triggerArrows(graph: CodeGraph): FeatureArrowDTO[] {
  const arrows = new Map<string, FeatureArrowDTO>();
  for (const handler of graph.allOf("EventHandler")) {
    const consumer = graph.featureOf(handler);
    // Bu handler'ın dinlediği kuyruklar (SUBSCRIBES).
    for (const sub of graph.outEdges(handler.id, "SUBSCRIBES")) {
      const queue = graph.byId(sub.targetNodeId);
      if (!queue) continue;
      // Bu kuyruğa PUBLISHES eden node'lar → kaynak feature.
      for (const pub of graph.inEdges(queue.id, "PUBLISHES")) {
        const src = graph.byId(pub.sourceNodeId);
        if (!src) continue;
        const producer = graph.featureOf(src);
        if (producer === consumer || producer === "common" || consumer === "common") continue;
        const key = `${producer}->${consumer}`;
        if (!arrows.has(key)) arrows.set(key, { from: producer, to: consumer, label: "triggers" });
      }
    }
  }
  return [...arrows.values()];
}

/* ── B) Capability'ler ──────────────────────────────────────────────────── */

/** Bir endpoint → CapabilityDTO (kart + mantık şeması). */
function capabilityOf(ep: EndpointProps, controller: CodeNode, feature: Feature): CapabilityDTO {
  const controllerName = controller.name;
  const isWrite = WRITE_METHODS.has(ep.HttpMethod);
  const actor = ep.RequiresAuth ? "Signed-in user" : "Any user";
  const action = actionSentence(ep, controllerName);

  // Veri: feature'ın birincil entity'si + HTTP metoduna göre yön (yazma/okuma).
  const labels = dataLabelsOf(feature);
  const primary = labels[0];
  const data: CapabilityDatumDTO[] = primary ? [{ access: isWrite ? "writes" : "reads", label: primary }] : [];

  // Tetikler (feature seviyesinde): bu feature'ın tetiklediği başka feature'lar (yalnız yazma).
  const external = externalsOf(feature);

  // Gizli teknik detay: request/response DTO + middleware + feature cache sayısı.
  let hidden = 0;
  if (ep.RequestDTORef) hidden++;
  if (ep.ResponseDTORef) hidden++;
  hidden += (ep.MiddlewareRefs ?? []).length;
  hidden += feature.infraProviders.filter((n) => n.kindOf() === "Cache").length;

  return {
    actor,
    action,
    data,
    external: external.length > 0 ? external : undefined,
    hidden,
  };
}

/** Feature → ONE consolidated DATA-FLOW diagram (the whole feature is one diagram).
 *
 *  Shaped like a small DFD so it reads as a real flow, not a bare star:
 *   - a SINGLE shared auth gate ("Signed in?") covers every operation that needs
 *     sign-in (shown once, never per-endpoint);
 *   - each operation is a process box hanging off the gate (or standalone if public);
 *   - the feature's primary data is a STORE (cylinder); every operation links to it
 *     with a LABELED data-flow ("Saves" for writes, "Reads" for reads) — this is what
 *     turns a sparse bush into a legible flow a person can follow;
 *   - outside services are external nodes the feature "Uses".
 *  Honesty: the gate exists only for a real RequiresAuth guard; stores/externals come
 *  straight from the graph (entities + ExternalService infra). Nothing is invented.
 *  Kept deliberately small (primary store only, no extra crossing arrows): research on
 *  flowchart comprehension shows length + arrow diversity HURT readability. */
function buildFeatureFlow(feature: Feature): CapabilityFlowDTO | undefined {
  const controllers = [...feature.controllers].sort((a, b) => (a.name < b.name ? -1 : 1));
  const ops: { label: string; auth: boolean; write: boolean }[] = [];
  const seen = new Set<string>();
  for (const c of controllers) {
    const eps = propsOf<"Controller">(c).Endpoints ?? [];
    for (const ep of eps) {
      const e = ep as EndpointProps;
      const label = actionSentence(e, c.name);
      if (seen.has(label)) continue; // no repetition
      seen.add(label);
      ops.push({ label, auth: !!e.RequiresAuth, write: WRITE_METHODS.has(e.HttpMethod) });
    }
  }
  const externals = externalsOf(feature);
  const stores = dataLabelsOf(feature).slice(0, 2); // primary store(s) — kept small on purpose
  if (ops.length === 0 && externals.length === 0) return undefined;

  const nodes: FlowNodeDTO[] = [];
  const edges: FlowEdgeDTO[] = [];
  const authed = ops.filter((o) => o.auth);
  const open = ops.filter((o) => !o.auth);
  // write = changes data, read = only views it.
  const access = (o: { write: boolean }): DataAccess => (o.write ? "writes" : "reads");

  // The data this part keeps (a store per primary entity) + a labeled flow into it.
  stores.forEach((label, i) => nodes.push({ id: `d${i}`, kind: "data", label }));
  const primaryStore = stores.length ? "d0" : undefined;
  const linkData = (opId: string, write: boolean) => {
    if (primaryStore) edges.push({ from: opId, to: primaryStore, label: write ? "Saves" : "Reads" });
  };

  // One shared auth gate (only if at least one operation requires sign-in).
  if (authed.length > 0) {
    nodes.push({ id: "gate", kind: "decision", label: "Signed in?" });
    authed.forEach((o, i) => {
      const id = `a${i}`;
      nodes.push({ id, kind: "process", label: o.label, access: access(o) });
      edges.push({ from: "gate", to: id });
      linkData(id, o.write);
    });
  }
  // Public operations: directly accessible, no gate.
  open.forEach((o, i) => {
    const id = `p${i}`;
    nodes.push({ id, kind: "process", label: o.label, access: access(o) });
    linkData(id, o.write);
  });
  // Outside services this part talks to (Stripe, SendGrid, …) — the feature "Uses" them.
  externals.forEach((name, i) => nodes.push({ id: `x${i}`, kind: "external", label: name }));

  return { nodes, edges };
}

/** "AccountStatus" / "ACCOUNT_STATUS" / "account-status" → "Account status" (plain). */
function humanize(raw: string): string {
  const s = raw
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2") // camelCase → spaced
    .replace(/[_-]+/g, " ") // snake / kebab → spaced
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** A feature with NO endpoints (pure data/logic) → a plain-language diagram instead
 *  of technical wiring. Priority:
 *   1) Enum STATE MACHINES → lifecycle flow (states + allowed transitions) — e.g. an
 *      account's status: Open → Frozen → Closed. This is the honest, deterministic
 *      counterpart of "is the account open?" (the check IS the status lifecycle).
 *   2) else Entities (Models) → "what data this part holds".
 *   3) else background infrastructure (queues/workers/cache/external).
 *  Returns undefined when the feature is genuinely empty. */
function buildDataFlow(feature: Feature, enums: CodeNode[]): CapabilityFlowDTO | undefined {
  const nodes: FlowNodeDTO[] = [];
  const edges: FlowEdgeDTO[] = [];
  const seen = new Set<string>();

  // 1) Enum state machines → lifecycle flow (states as steps, transitions as arrows).
  for (const en of enums) {
    const p = propsOf<"Enum">(en);
    const values = p.Values ?? [];
    if (values.length === 0) continue;
    const sid = (k: string) => `${en.name}::${k}`;
    for (const v of values) {
      const id = sid(v.Key);
      if (seen.has(id)) continue;
      seen.add(id);
      nodes.push({ id, kind: "state", label: humanize(v.Key) });
    }
    for (const t of p.Transitions ?? []) {
      for (const to of t.To) edges.push({ from: sid(t.From), to: sid(to) });
    }
  }

  // 2) Fallback — what data this part holds (entities as data nodes).
  if (nodes.length === 0) {
    for (const m of feature.entities) {
      const id = `M::${m.name}`;
      if (seen.has(id)) continue;
      seen.add(id);
      nodes.push({ id, kind: "data", label: objectOf(m.name) });
    }
  }

  // 3) Fallback — background infrastructure (queues/workers/cache/external).
  if (nodes.length === 0) {
    for (const n of feature.infraProviders) {
      nodes.push({ id: `I::${n.name}`, kind: "process", label: humanize(n.name) });
    }
  }

  return nodes.length > 0 ? { nodes, edges } : undefined;
}

/** Bir feature'ın tüm capability'leri (controller endpoint'lerinden, sıralı). */
function capabilitiesOf(feature: Feature): CapabilityDTO[] {
  const caps: CapabilityDTO[] = [];
  const controllers = [...feature.controllers].sort((a, b) => (a.name < b.name ? -1 : 1));
  for (const c of controllers) {
    const eps = propsOf<"Controller">(c).Endpoints ?? [];
    for (const ep of eps) caps.push(capabilityOf(ep as EndpointProps, c, feature));
  }
  return caps;
}

/* ── Üst seviye projeksiyon ─────────────────────────────────────────────── */

/** CodeGraph → deterministic Mermaid flowchart of the Simple View (subgraph per
 *  feature; node shapes encode kind; cross-feature arrows). This is the deterministic
 *  baseline the sketch renderer consumes; the AI path (codegen.service) produces a
 *  richer Mermaid but falls back to this when the LLM is unavailable. */
export function projectSimpleMermaid(graph: CodeGraph): string {
  const map = projectSimpleView(graph);
  const esc = (s: string) => s.replace(/["\n]/g, "'");
  const nid = (s: string) => s.replace(/[^a-zA-Z0-9]/g, "_");
  const shape = (kind: FlowNodeKind, id: string, label: string): string => {
    const l = `"${esc(label)}"`;
    switch (kind) {
      case "decision": return `${id}{${l}}`;
      case "state": return `${id}([${l}])`;
      case "data": return `${id}[(${l})]`;
      case "external": return `${id}[/${l}/]`;
      default: return `${id}[${l}]`;
    }
  };
  // NO subgraphs: mermaid-to-excalidraw cannot resolve edges that reference a subgraph id
  // ("SubGraph element not found"). Instead, each feature is a top-level node and its
  // operations hang off it; cross-feature arrows connect the feature NODES.
  const lines = ["flowchart TD"];
  for (const f of map.features) {
    const fid = nid(f.slug);
    lines.push(`  ${fid}["${esc(f.title)}"]`);
    const fg = f.flowGraph;
    if (fg && fg.nodes.length > 0) {
      for (const n of fg.nodes) lines.push(`  ${shape(n.kind, `${fid}__${nid(n.id)}`, n.label)}`);
      for (const e of fg.edges) {
        const lbl = e.label ? `|${esc(e.label)}|` : "";
        lines.push(`  ${fid}__${nid(e.from)} -->${lbl} ${fid}__${nid(e.to)}`);
      }
      // connect the feature node to its entry nodes (those with no incoming inner edge);
      // an outside service reads as the feature "Uses" it.
      const hasIncoming = new Set(fg.edges.map((e) => e.to));
      const entries = fg.nodes.filter((n) => !hasIncoming.has(n.id));
      for (const n of (entries.length ? entries : fg.nodes.slice(0, 1))) {
        const lbl = n.kind === "external" ? "|Uses|" : "";
        lines.push(`  ${fid} -->${lbl} ${fid}__${nid(n.id)}`);
      }
    } else {
      lines.push(`  ${fid}__x["${f.capabilityCount} things you can do"]`);
      lines.push(`  ${fid} --> ${fid}__x`);
    }
  }
  for (const a of map.arrows) {
    const lbl = a.label ? `|${esc(a.label)}|` : "";
    lines.push(`  ${nid(a.from)} -->${lbl} ${nid(a.to)}`);
  }
  return lines.join("\n");
}

/** CodeGraph → Basit Görünüm SystemMap (deterministik, saf). */
export function projectSimpleView(graph: CodeGraph): SystemMapDTO {
  const features = graph.features();
  const tiers = computeTiers(features);

  // Enums grouped by feature (Feature has no enums field — they live in the graph).
  const enumsByFeature = new Map<string, CodeNode[]>();
  for (const en of graph.allOf("Enum")) {
    const slug = graph.featureOf(en);
    if (!slug) continue;
    const arr = enumsByFeature.get(slug) ?? [];
    arr.push(en);
    enumsByFeature.set(slug, arr);
  }

  const featureBoxes: FeatureBoxDTO[] = features.map((f) => {
    const caps = capabilitiesOf(f);
    const external = externalsOf(f);
    return {
      slug: f.slug,
      title: titleOf(f.slug),
      tier: tiers.get(f.slug) ?? 0,
      capabilityCount: caps.length,
      dataLabels: dataLabelsOf(f),
      external: external.length > 0 ? external : undefined,
      capabilities: caps,
      // Endpoints → operations flow; otherwise (pure data/logic feature) → state/data flow.
      flowGraph: buildFeatureFlow(f) ?? buildDataFlow(f, enumsByFeature.get(f.slug) ?? []),
    };
  });

  // Oklar: dependsOn ("kullanır", forwardRef → mutual) + pub→sub ("tetikler").
  const arrows: FeatureArrowDTO[] = [];
  for (const f of features) {
    for (const dep of f.dependsOn) {
      arrows.push({ from: f.slug, to: dep, label: "uses", mutual: f.forwardRefDeps.includes(dep) });
    }
  }
  const known = new Set(features.map((f) => f.slug));
  for (const t of triggerArrows(graph)) {
    if (known.has(t.from) && known.has(t.to)) arrows.push(t);
  }

  // Ortak (common) altyapı.
  const common = graph.commonFeature();
  const shared = common
    ? { items: [...new Set([...common.infraProviders, ...common.services, ...common.repositories].map((n) => n.name))].sort() }
    : undefined;

  return {
    features: featureBoxes,
    arrows,
    ...(shared && shared.items.length > 0 ? { shared } : {}),
  };
}

/* ── C) Yapısal sketch modeli (tool-calling üretiminin + ELK layout'un girdisi) ──── */

/** A structured, Mermaid-FREE model of the Simple View. The deterministic projector below
 *  is the grounding + fallback; the AI tool-calling agent refines the PRESENTATION on top of
 *  it (friendly name, semantic color, flow grouping) — never the structure or kind, which
 *  stay graph-true. The frontend lays it out with ELK and renders it with rough.js. */
export type SketchNodeKind = "feature" | "action" | "data" | "decision" | "external" | "state";
export interface SketchNode { id: string; kind: SketchNodeKind; name: string; group?: string; color?: string }
export interface SketchEdge { from: string; to: string; label?: string }
export interface SketchGroup { id: string; name: string; color?: string }
export interface SimpleSketchModel { nodes: SketchNode[]; edges: SketchEdge[]; groups: SketchGroup[] }

/** FlowGraph (projection) kind → presentation kind. process→action; terminals collapse to action. */
const SKETCH_KIND: Record<FlowNodeKind, SketchNodeKind> = {
  terminal: "action", process: "action", end: "action",
  decision: "decision", data: "data", external: "external", state: "state",
};
/** Deterministic group colors (so the grouping is ALWAYS colored even with AI off; the tool agent
 *  may recolor). Each feature gets the next hue; the frontend maps the name → a token hue. */
const GROUP_PALETTE = ["blue", "green", "orange", "purple", "teal", "red", "gray"] as const;

/** CodeGraph → deterministic SimpleSketchModel. Same structure projectSimpleMermaid encodes,
 *  but as data: each feature is a GROUP holding a feature node + its op/data/external nodes,
 *  with labeled flows and cross-feature arrows. No Mermaid text, no subgraphs, no parse step. */
export function projectSimpleSketchModel(graph: CodeGraph): SimpleSketchModel {
  const map = projectSimpleView(graph);
  const nid = (s: string) => s.replace(/[^a-zA-Z0-9]/g, "_");
  const nodes: SketchNode[] = [];
  const edges: SketchEdge[] = [];
  const groups: SketchGroup[] = [];
  // No "feature node": the GROUP itself represents the feature (its region is the box). A feature's
  // ops/data/external are the group's members; the feature is drawn as the surrounding region.
  map.features.forEach((f, fi) => {
    const fid = nid(f.slug);
    groups.push({ id: fid, name: f.title, color: GROUP_PALETTE[fi % GROUP_PALETTE.length] });
    const fg = f.flowGraph;
    if (fg && fg.nodes.length > 0) {
      for (const n of fg.nodes) nodes.push({ id: `${fid}__${nid(n.id)}`, kind: SKETCH_KIND[n.kind], name: n.label, group: fid });
      for (const e of fg.edges) edges.push({ from: `${fid}__${nid(e.from)}`, to: `${fid}__${nid(e.to)}`, label: e.label });
    } else {
      nodes.push({ id: `${fid}__x`, kind: "action", name: `${f.capabilityCount} things you can do`, group: fid });
    }
  });
  // Cross-feature arrows connect the GROUPS (group ids) — they read as edges between the group
  // "boxes" (exiting the region, not an inner box), which keeps the groups cleanly aligned.
  for (const a of map.arrows) edges.push({ from: nid(a.from), to: nid(a.to), label: a.label });
  return { nodes, edges, groups };
}
