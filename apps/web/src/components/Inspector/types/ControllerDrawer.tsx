import {
  SubPageShell, Field, Input, Textarea, SectionHeader,
  NodeRefCombobox, NodeRefList, ValueSetCombobox,
  EditGrid, Segmented, ToggleCell, type GridColumn, type SegOption,
} from "../primitives";

const HTTP_METHODS = ["GET", "POST", "PUT", "DELETE", "PATCH"] as const;
type HttpMethod = typeof HTTP_METHODS[number];

/** HTTP verb → segmented, her biri kendi --http-* rengiyle (aktif segment renklenir). */
const HTTP_OPTIONS: readonly SegOption[] = [
  { value: "GET", label: "GET", colorVar: "--http-get" },
  { value: "POST", label: "POST", colorVar: "--http-post" },
  { value: "PUT", label: "PUT", colorVar: "--http-put" },
  { value: "DELETE", label: "DELETE", colorVar: "--http-delete" },
  { value: "PATCH", label: "PATCH", colorVar: "--http-patch" },
];

interface Param { Name: string; Type: string }
interface QueryParam extends Param { Required: boolean }
interface StatusCode { Code: number; Description?: string }
interface RateLimit { Requests: number; WindowSeconds: number }

interface Endpoint {
  HttpMethod: HttpMethod;
  Route: string;
  RequestDTORef?: string;
  ResponseDTORef?: string;
  RequiresAuth: boolean;
  RequiredRoles: string[];
  PathParams: Param[];
  QueryParams: QueryParam[];
  StatusCodes: StatusCode[];
  MiddlewareRefs: string[];
  RateLimit?: RateLimit;
  Description?: string;
}

const newEndpoint = (): Endpoint => ({
  HttpMethod: "GET",
  Route: "/",
  RequiresAuth: false,
  RequiredRoles: [],
  PathParams: [],
  QueryParams: [],
  StatusCodes: [{ Code: 200, Description: "OK" }],
  MiddlewareRefs: [],
});

interface Props {
  /** ID of the Controller node being edited — for NodeRefCombobox linkAs (USES/RETURNS edge). */
  nodeId: string;
  controllerName: string;
  baseRoute: string;
  properties: Record<string, unknown>;
  onChange: (next: Record<string, unknown>) => void;
  saveStatus?: "idle" | "pending" | "success" | "error";
  onBack: () => void;
}

const ENDPOINT_COLS: readonly GridColumn[] = [
  { key: "method", label: "Method", width: "262px" },
  { key: "route", label: "Route", width: "minmax(140px,1.6fr)" },
  { key: "auth", label: "Auth", width: "44px", align: "center" },
];

export function ControllerDrawer({ nodeId, controllerName, baseRoute, properties, onChange, saveStatus = "idle", onBack }: Props) {
  const endpoints = (Array.isArray(properties.Endpoints) ? properties.Endpoints : []) as Endpoint[];

  const setEndpoints = (next: Endpoint[]) => onChange({ ...properties, Endpoints: next });
  const update = (i: number, patch: Partial<Endpoint>) =>
    setEndpoints(endpoints.map((e, idx) => (idx === i ? { ...e, ...patch } : e)));
  const remove = (i: number) => setEndpoints(endpoints.filter((_, idx) => idx !== i));
  const add = () => setEndpoints([...endpoints, newEndpoint()]);
  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= endpoints.length) return;
    const next = endpoints.slice();
    [next[i], next[j]] = [next[j], next[i]];
    setEndpoints(next);
  };

  const statusText = saveStatus === "pending" ? "saving…"
    : saveStatus === "success" ? "saved"
    : saveStatus === "error" ? "save failed"
    : undefined;

  return (
    <SubPageShell
      title="Endpoints"
      subtitle={controllerName || "(unnamed controller)"}
      onBack={onBack}
      onSave={onBack}
      saveDisabled={saveStatus === "pending"}
      saveStatusText={statusText}
      saveStatusTone={saveStatus}
    >
      {baseRoute && (
        <div className="text-[13px] font-mono text-[color:var(--ink-soft)] -mt-1">
          <span className="text-[color:var(--ink-faint)] uppercase tracking-[0.08em] mr-2">base</span>
          {baseRoute}
        </div>
      )}
      <EditGrid
        columns={ENDPOINT_COLS}
        rows={endpoints}
        rowKey={(_, i) => String(i)}
        addLabel="New endpoint"
        emptyLabel="// no endpoints"
        onAdd={add}
        onMove={move}
        onDelete={remove}
        renderCell={(ep, key, i) => {
          switch (key) {
            case "method":
              return (
                <Segmented
                  value={ep.HttpMethod}
                  onChange={(v) => update(i, { HttpMethod: v as HttpMethod })}
                  options={HTTP_OPTIONS}
                  ariaLabel="HTTP method"
                />
              );
            case "route":
              return (
                <Input
                  density="cell"
                  variant="mono"
                  value={ep.Route}
                  onChange={(v) => update(i, { Route: v })}
                  placeholder="/:id"
                  spellCheck={false}
                  aria-label="Route"
                />
              );
            case "auth":
              return <ToggleCell tone="family" checked={ep.RequiresAuth} onChange={(v) => update(i, { RequiresAuth: v })} ariaLabel="Requires auth" />;
            default:
              return null;
          }
        }}
        renderDetail={(ep, i) => <EndpointDetail nodeId={nodeId} endpoint={ep} update={(patch) => update(i, patch)} />}
      />
    </SubPageShell>
  );
}

const PATH_COLS: readonly GridColumn[] = [
  { key: "name", label: "Name", width: "minmax(100px,1fr)" },
  { key: "type", label: "Type", width: "minmax(100px,1fr)" },
];
const QUERY_COLS: readonly GridColumn[] = [
  { key: "name", label: "Name", width: "minmax(100px,1fr)" },
  { key: "type", label: "Type", width: "minmax(100px,1fr)" },
  { key: "req", label: "Req", width: "38px", align: "center", title: "Required" },
];
const STATUS_COLS: readonly GridColumn[] = [
  { key: "code", label: "Code", width: "minmax(96px,0.7fr)" },
  { key: "desc", label: "Description", width: "minmax(120px,1.5fr)" },
];

function EndpointDetail({
  nodeId, endpoint: _ep, update,
}: { nodeId: string; endpoint: Endpoint; update: (patch: Partial<Endpoint>) => void }) {
  const endpoint: Endpoint = {
    ..._ep,
    RequiredRoles: _ep.RequiredRoles ?? [],
    MiddlewareRefs: _ep.MiddlewareRefs ?? [],
    PathParams: _ep.PathParams ?? [],
    QueryParams: _ep.QueryParams ?? [],
    StatusCodes: _ep.StatusCodes ?? [],
  };

  const setPathParam = (i: number, patch: Partial<Param>) =>
    update({ PathParams: endpoint.PathParams.map((p, idx) => (idx === i ? { ...p, ...patch } : p)) });
  const addPathParam = () => update({ PathParams: [...endpoint.PathParams, { Name: "", Type: "string" }] });
  const delPathParam = (i: number) => update({ PathParams: endpoint.PathParams.filter((_, idx) => idx !== i) });

  const setQueryParam = (i: number, patch: Partial<QueryParam>) =>
    update({ QueryParams: endpoint.QueryParams.map((p, idx) => (idx === i ? { ...p, ...patch } : p)) });
  const addQueryParam = () => update({ QueryParams: [...endpoint.QueryParams, { Name: "", Type: "string", Required: false }] });
  const delQueryParam = (i: number) => update({ QueryParams: endpoint.QueryParams.filter((_, idx) => idx !== i) });

  const setStatus = (i: number, patch: Partial<StatusCode>) =>
    update({ StatusCodes: endpoint.StatusCodes.map((s, idx) => (idx === i ? { ...s, ...patch } : s)) });
  const addStatus = () => update({ StatusCodes: [...endpoint.StatusCodes, { Code: 200 }] });
  const delStatus = (i: number) => update({ StatusCodes: endpoint.StatusCodes.filter((_, idx) => idx !== i) });

  const setListField = (key: "RequiredRoles" | "MiddlewareRefs", raw: string) => {
    const next = raw.split(",").map((s) => s.trim()).filter(Boolean);
    update({ [key]: next } as Partial<Endpoint>);
  };

  return (
    <>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Request DTO ref">
          <NodeRefCombobox
            nodeType="DTO"
            value={endpoint.RequestDTORef ?? ""}
            onChange={(v) => update({ RequestDTORef: v || undefined })}
            placeholder="CreateUserDto"
            ariaLabel="Request DTO reference"
            linkAs={nodeId ? { sourceNodeId: nodeId, kind: "USES" } : undefined}
          />
        </Field>
        <Field label="Response DTO ref">
          <NodeRefCombobox
            nodeType="DTO"
            value={endpoint.ResponseDTORef ?? ""}
            onChange={(v) => update({ ResponseDTORef: v || undefined })}
            placeholder="UserDto"
            ariaLabel="Response DTO reference"
            linkAs={nodeId ? { sourceNodeId: nodeId, kind: "RETURNS" } : undefined}
          />
        </Field>
      </div>

      <div>
        <SectionHeader label="Security" divider />
        {endpoint.RequiresAuth && (
          <Field label="Required roles" helper="separate with commas">
            <Input
              variant="mono"
              value={endpoint.RequiredRoles.join(", ")}
              onChange={(v) => setListField("RequiredRoles", v)}
              placeholder="admin, editor"
            />
          </Field>
        )}
        <Field label="Middleware refs">
          <NodeRefList
            items={endpoint.MiddlewareRefs}
            onChange={(next) => update({ MiddlewareRefs: next })}
            nodeType="Middleware"
            addLabel="Add Middleware"
          />
        </Field>
      </div>

      <div>
        <SectionHeader label="Path params" count={endpoint.PathParams.length} divider />
        <EditGrid
          columns={PATH_COLS}
          rows={endpoint.PathParams}
          rowKey={(_, i) => String(i)}
          addLabel="path param"
          emptyLabel="// no path params"
          onAdd={addPathParam}
          onDelete={delPathParam}
          renderCell={(p, key, i) =>
            key === "name" ? (
              <Input density="cell" value={p.Name} onChange={(v) => setPathParam(i, { Name: v })} placeholder="id" spellCheck={false} aria-label="Param name" />
            ) : (
              <Input density="cell" variant="mono" value={p.Type} onChange={(v) => setPathParam(i, { Type: v })} placeholder="number" spellCheck={false} aria-label="Param type" />
            )
          }
        />
      </div>

      <div>
        <SectionHeader label="Query params" count={endpoint.QueryParams.length} divider />
        <EditGrid
          columns={QUERY_COLS}
          rows={endpoint.QueryParams}
          rowKey={(_, i) => String(i)}
          addLabel="query param"
          emptyLabel="// no query params"
          onAdd={addQueryParam}
          onDelete={delQueryParam}
          renderCell={(p, key, i) => {
            switch (key) {
              case "name":
                return <Input density="cell" value={p.Name} onChange={(v) => setQueryParam(i, { Name: v })} placeholder="page" spellCheck={false} aria-label="Param name" />;
              case "type":
                return <Input density="cell" variant="mono" value={p.Type} onChange={(v) => setQueryParam(i, { Type: v })} placeholder="number" spellCheck={false} aria-label="Param type" />;
              case "req":
                return <ToggleCell checked={p.Required} onChange={(v) => setQueryParam(i, { Required: v })} ariaLabel="Required" />;
              default:
                return null;
            }
          }}
        />
      </div>

      <div>
        <SectionHeader label="Status codes" count={endpoint.StatusCodes.length} divider />
        <EditGrid
          columns={STATUS_COLS}
          rows={endpoint.StatusCodes}
          rowKey={(_, i) => String(i)}
          addLabel="status code"
          emptyLabel="// no status codes"
          onAdd={addStatus}
          onDelete={delStatus}
          renderCell={(s, key, i) =>
            key === "code" ? (
              <ValueSetCombobox
                density="cell"
                valueSetId="http-status"
                value={s.Code ? String(s.Code) : ""}
                onChange={(v) => {
                  const n = parseInt(v, 10);
                  if (!Number.isNaN(n)) setStatus(i, { Code: n });
                }}
                placeholder="200"
                ariaLabel="HTTP status code"
              />
            ) : (
              <Input density="cell" value={s.Description ?? ""} onChange={(v) => setStatus(i, { Description: v || undefined })} placeholder="description" aria-label="Status description" />
            )
          }
        />
      </div>

      <div>
        <SectionHeader label="Rate limit (optional)" divider />
        <div className="grid grid-cols-2 gap-3">
          <Field label="Requests">
            <Input
              variant="number"
              value={endpoint.RateLimit?.Requests ?? ""}
              onChange={(v) => {
                if (v === "") update({ RateLimit: undefined });
                else update({ RateLimit: { Requests: Number(v), WindowSeconds: endpoint.RateLimit?.WindowSeconds ?? 60 } });
              }}
              placeholder="100"
            />
          </Field>
          <Field label="Window (sec)">
            <Input
              variant="number"
              value={endpoint.RateLimit?.WindowSeconds ?? ""}
              onChange={(v) => {
                if (v === "") update({ RateLimit: undefined });
                else update({ RateLimit: { Requests: endpoint.RateLimit?.Requests ?? 100, WindowSeconds: Number(v) } });
              }}
              placeholder="60"
            />
          </Field>
        </div>
      </div>

      <Field label="Description">
        <Textarea value={endpoint.Description ?? ""} rows={2} onChange={(v) => update({ Description: v || undefined })} />
      </Field>
    </>
  );
}
