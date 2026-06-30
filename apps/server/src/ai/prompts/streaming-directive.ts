/** Addendum for chatStream — shapes the agent-loop behavior (batch tools, refactor, orphans). */
export const STREAMING_DIRECTIVE = `

## STREAMING AGENT BEHAVIOR (REQUIRED)
In this mode architecture is produced in **batched turns**. Be efficient: do as much as possible each turn.
1. **CALL MULTIPLE TOOLS IN THE SAME TURN (batch — CRITICAL).** Create related nodes in one turn with parallel create_node calls (e.g. 8–12 nodes per turn). Store returned IDs. Do not call one-by-one — that is slow and burns the turn budget.
2. Once nodes exist with IDs, create edges **in bulk**: as many create_edge calls as fit in one turn. (Each edge needs both endpoints to exist already → edges come in turns **after** their nodes.)
3. If a tool returns { ok: false, code, message, suggestion }: read suggestion, fix the call, **retry the same tool**.
4. After all required nodes and edges exist, write a short summary for the user (1–2 sentences, respond in English) — this final message must NOT be a tool call, text only.
5. Do not set position; the backend defaults it and the frontend auto-layouts.

## REFACTORING THE EXISTING GRAPH
Nodes/edges listed under 'Current Canvas State' **already exist**. If the user asks for a CHANGE (rename, delete, edit a field/array, rewire a connection), do NOT recreate them — use:
- **update_node(nodeId, properties)** — patch an existing node (rename, description/flags, array edits). Send only changed top-level fields; they merge into existing properties. To edit an ARRAY field (Columns/Endpoints/Methods/Fields), first \`get_node\` for the full array, then send the **complete** array (arrays replace, not append).
- **get_node(nodeId)** — read full properties before editing.
- **delete_node(nodeId)** — remove a node (and its edges).
- **delete_edge(edgeId)** — remove a connection. To **rewire**: \`delete_edge(oldId)\` + \`create_edge(new endpoints)\`.
Use the IDs from 'Current Canvas State' — never invent IDs. When done, write a short summary without tool calls.

## NO ORPHAN NODES (CRITICAL)
**Every node must have at least one edge** to another node. Track created node IDs — do not say "done" until each has at least one create_edge.

### Correct edge direction by node type (passive node = edge **TARGET**, not source):
- **DTO** (target): \`create_edge(source=Controller|Service, target=DTO, kind=USES)\`. DTO is source only for \`DTO→HAS→DTO\` (nested) and \`DTO→USES→Enum\`.
- **Enum** (target): \`create_edge(source=Model|DTO|Table, target=Enum, kind=USES)\`. Enum is never a source.
- **Exception** (target): \`create_edge(source=Service|Controller|Repository, target=Exception, kind=THROWS)\`.
- **EnvironmentVariable** (target): \`create_edge(source=Service, target=EnvironmentVariable, kind=READS_CONFIG)\`.
- **Cache** (target): \`create_edge(source=Service, target=Cache, kind=CACHES_IN)\`.
- **View** (target): \`create_edge(source=Repository, target=View, kind=QUERIES)\`.
- **UIComponent** (target): \`create_edge(source=FrontendApp, target=UIComponent, kind=HAS)\`.
- **Middleware** (source): \`create_edge(source=Middleware, target=Controller, kind=ROUTES_TO)\`.
- **Repository**: target ← \`create_edge(source=Service, target=Repository, kind=CALLS)\`; source → \`(source=Repository, target=Table, kind=QUERIES|WRITES)\`, \`(source=Repository, target=Model, kind=USES|RETURNS)\`.
- **Model**: target ← \`create_edge(source=Service, target=Model, kind=USES)\`; source → \`Model→USES→Table\`, \`Model→USES→Enum\`, \`Model→HAS|EXTENDS→Model\`.

Wrong direction → edge rejected with \`ERR_NOT_WHITELISTED\`.

### FINAL CHECK (required)
Before your "done" message: for every node ID you created, did you call at least one create_edge? If not → create missing edges now.

## TOOL RESPONSE WARNINGS (TRACK CONTINUOUSLY)
create_node and create_edge results may include a \`warnings\` field:
\`\`\`json
{
  "ok": true, "id": "...", "type": "DTO",
  "warnings": {
    "status": "8 nodes, 5 edges — 3 nodes still orphan. Add to your TODO list and connect when possible.",
    "pendingOrphans": [
      { "id": "abc-123", "type": "Middleware", "name": "JwtAuth", "hint": "create_edge(source=Middleware, target=Controller, kind=ROUTES_TO)" },
      ...
    ]
  }
}
\`\`\`

**Read warnings after every tool call.** Put \`pendingOrphans\` at the top of your TODO list. Connect them at the next opportunity (when you create related nodes or directly). Do not forget older orphans while creating new nodes — they are **priority**.`;
