import { useState } from "react";
import { X, Plus } from "lucide-react";
import {
  SubPageShell, Field, Input, Textarea, Select, SectionHeader,
  ValueSetSelect, ValueSetCombobox, NodeRefCombobox,
  EditGrid, Segmented, ToggleCell, type GridColumn, type SegOption,
} from "../primitives";

export type ServiceDrawerTab = "methods" | "deps";

const VISIBILITY = ["public", "private", "protected"] as const;
const DEP_KINDS = ["Repository", "Service", "Cache", "ExternalService"] as const;

type Visibility = typeof VISIBILITY[number];
type DepKind = typeof DEP_KINDS[number];

/** Visibility → segmented (open→closed order + traffic-light color: public/protected/private). */
const VIS_OPTIONS: readonly SegOption[] = [
  { value: "public", label: "public", colorVar: "--ok" },
  { value: "protected", label: "protected", colorVar: "--warn" },
  { value: "private", label: "private", colorVar: "--danger" },
];

/** Kind → nodeType + edgeKind mapping (whitelist-compatible).
 *  Service CALLS Repository/Service, CACHES_IN Cache, REQUESTS ExternalService. */
const DEP_MAPPING: Record<DepKind, { nodeType: string; edgeKind: string }> = {
  Repository:      { nodeType: "Repository",      edgeKind: "CALLS" },
  Service:         { nodeType: "Service",         edgeKind: "CALLS" },
  Cache:           { nodeType: "Cache",           edgeKind: "CACHES_IN" },
  ExternalService: { nodeType: "ExternalService", edgeKind: "REQUESTS" },
};

interface MethodParam {
  Name: string;
  Type: string;
  Optional: boolean;
  Default?: string;
  DtoRef?: string;
}
interface ServiceMethod {
  MethodName: string;
  Visibility: Visibility;
  Parameters: MethodParam[];
  ReturnType: string;
  ReturnDtoRef?: string;
  IsAsync: boolean;
  Throws: string[];
  Description?: string;
}
interface Dependency {
  Kind: DepKind;
  Ref: string;
}

const newParam = (): MethodParam => ({ Name: "", Type: "string", Optional: false });
const newMethod = (): ServiceMethod => ({
  MethodName: "",
  Visibility: "public",
  Parameters: [],
  ReturnType: "void",
  IsAsync: false,
  Throws: [],
});
const newDep = (): Dependency => ({ Kind: "Repository", Ref: "" });

const TAB_LABEL: Record<ServiceDrawerTab, string> = {
  methods: "Methods",
  deps: "Dependencies",
};

interface Props {
  tab: ServiceDrawerTab;
  serviceName: string;
  serviceNodeId: string;
  properties: Record<string, unknown>;
  onChange: (next: Record<string, unknown>) => void;
  saveStatus?: "idle" | "pending" | "success" | "error";
  /** ← Back button — parent inspector calls setActiveTab(null) */
  onBack: () => void;
}

export function ServiceDrawer({ tab, serviceName, serviceNodeId, properties, onChange, saveStatus = "idle", onBack }: Props) {
  const [active, setActive] = useState<ServiceDrawerTab>(tab);

  const methods = (Array.isArray(properties.Methods) ? properties.Methods : []) as ServiceMethod[];
  const deps = (Array.isArray(properties.Dependencies) ? properties.Dependencies : []) as Dependency[];

  const tabs = [
    { id: "methods", label: TAB_LABEL.methods, count: methods.length },
    { id: "deps", label: TAB_LABEL.deps, count: deps.length },
  ];

  const statusText = saveStatus === "pending" ? "saving…"
    : saveStatus === "success" ? "saved"
    : saveStatus === "error" ? "save failed"
    : undefined;

  return (
    <SubPageShell
      title={TAB_LABEL[active]}
      subtitle={serviceName || "(unnamed service)"}
      tabs={tabs}
      activeTab={active}
      onTabChange={(id) => setActive(id as ServiceDrawerTab)}
      onBack={onBack}
      onSave={onBack}
      saveDisabled={saveStatus === "pending"}
      saveStatusText={statusText}
      saveStatusTone={saveStatus}
    >
      {active === "methods" && <MethodsEditor properties={properties} onChange={onChange} serviceNodeId={serviceNodeId} />}
      {active === "deps" && <DependenciesEditor properties={properties} onChange={onChange} serviceNodeId={serviceNodeId} />}
    </SubPageShell>
  );
}

/* ── Methods ───────────────────────────────────────────────────────── */

const METHOD_COLS: readonly GridColumn[] = [
  { key: "name", label: "Method", width: "minmax(120px,1.3fr)" },
  { key: "return", label: "Returns", width: "minmax(120px,1.1fr)" },
  { key: "vis", label: "Visibility", width: "226px", align: "center" },
  { key: "async", label: "Async", width: "44px", align: "center" },
];

function MethodsEditor({
  properties, onChange, serviceNodeId,
}: { properties: Record<string, unknown>; onChange: (next: Record<string, unknown>) => void; serviceNodeId: string }) {
  const methods = (Array.isArray(properties.Methods) ? properties.Methods : []) as ServiceMethod[];
  const setMethods = (next: ServiceMethod[]) => onChange({ ...properties, Methods: next });

  const update = (i: number, patch: Partial<ServiceMethod>) =>
    setMethods(methods.map((m, idx) => (idx === i ? { ...m, ...patch } : m)));
  const remove = (i: number) => setMethods(methods.filter((_, idx) => idx !== i));
  const add = () => setMethods([...methods, newMethod()]);
  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= methods.length) return;
    const next = methods.slice();
    [next[i], next[j]] = [next[j], next[i]];
    setMethods(next);
  };

  return (
    <EditGrid
      columns={METHOD_COLS}
      rows={methods}
      rowKey={(_, i) => String(i)}
      addLabel="New method"
      emptyLabel="// no methods"
      onAdd={add}
      onMove={move}
      onDelete={remove}
      renderCell={(m, key, i) => {
        switch (key) {
          case "name":
            return (
              <Input
                density="cell"
                variant="mono"
                value={m.MethodName}
                onChange={(v) => update(i, { MethodName: v })}
                placeholder="createUser"
                spellCheck={false}
                aria-label="Method name"
              />
            );
          case "return":
            return (
              <ValueSetCombobox
                density="cell"
                valueSetId="parameter-types"
                value={m.ReturnType}
                onChange={(v) => update(i, { ReturnType: v })}
                placeholder="Promise<UserDto>"
                ariaLabel="Method return type"
              />
            );
          case "vis":
            return (
              <Segmented
                value={m.Visibility}
                onChange={(v) => update(i, { Visibility: v as Visibility })}
                options={VIS_OPTIONS}
                ariaLabel="Visibility"
              />
            );
          case "async":
            return <ToggleCell checked={m.IsAsync} onChange={(v) => update(i, { IsAsync: v })} ariaLabel="Async" />;
          default:
            return null;
        }
      }}
      renderDetail={(m, i) => <MethodDetail method={m} update={(patch) => update(i, patch)} serviceNodeId={serviceNodeId} />}
    />
  );
}

const PARAM_COLS: readonly GridColumn[] = [
  { key: "name", label: "Param", width: "minmax(100px,1fr)" },
  { key: "type", label: "Type", width: "minmax(120px,1.2fr)" },
  { key: "opt", label: "Opt", width: "38px", align: "center", title: "Optional" },
];

function MethodDetail({
  method: _m, update, serviceNodeId,
}: { method: ServiceMethod; update: (patch: Partial<ServiceMethod>) => void; serviceNodeId: string }) {
  const method: ServiceMethod = {
    ..._m,
    Parameters: _m.Parameters ?? [],
    Throws: _m.Throws ?? [],
  };

  const setParam = (i: number, patch: Partial<MethodParam>) =>
    update({ Parameters: method.Parameters.map((p, idx) => (idx === i ? { ...p, ...patch } : p)) });
  const addParam = () => update({ Parameters: [...method.Parameters, newParam()] });
  const delParam = (i: number) => update({ Parameters: method.Parameters.filter((_, idx) => idx !== i) });

  return (
    <>
      <Field label="Return DTO ref" helper="If ReturnType is a DTO, link to a DTO node in the project">
        <NodeRefCombobox
          nodeType="DTO"
          value={method.ReturnDtoRef ?? ""}
          onChange={(v) => update({ ReturnDtoRef: v || undefined })}
          placeholder="UserDto"
          ariaLabel="Return DTO ref"
          linkAs={serviceNodeId ? { sourceNodeId: serviceNodeId, kind: "RETURNS" } : undefined}
        />
      </Field>

      <div>
        <SectionHeader label="Parameters" count={method.Parameters.length} divider />
        <EditGrid
          columns={PARAM_COLS}
          rows={method.Parameters}
          rowKey={(_, i) => String(i)}
          addLabel="parameter"
          emptyLabel="// no parameters"
          onAdd={addParam}
          onDelete={delParam}
          renderCell={(p, key, i) => {
            switch (key) {
              case "name":
                return (
                  <Input
                    density="cell"
                    value={p.Name}
                    onChange={(v) => setParam(i, { Name: v })}
                    placeholder="name"
                    spellCheck={false}
                    aria-label="Parameter name"
                  />
                );
              case "type":
                return (
                  <ValueSetSelect
                    density="cell"
                    valueSetId="parameter-types"
                    value={p.Type}
                    onChange={(v) => setParam(i, { Type: v })}
                    ariaLabel="Parameter type"
                  />
                );
              case "opt":
                return <ToggleCell checked={p.Optional} onChange={(v) => setParam(i, { Optional: v })} ariaLabel="Optional" />;
              default:
                return null;
            }
          }}
          renderDetail={(p, i) => (
            <Field label="DTO ref" helper="If parameter is a custom DTO, select the reference">
              <NodeRefCombobox
                nodeType="DTO"
                value={p.DtoRef ?? ""}
                onChange={(v) => setParam(i, { DtoRef: v || undefined })}
                placeholder="UserDto"
                ariaLabel="Parameter DTO ref"
                linkAs={serviceNodeId ? { sourceNodeId: serviceNodeId, kind: "USES" } : undefined}
              />
            </Field>
          )}
        />
      </div>

      <Field label="Throws" helper="Select from Exception nodes in the project; create instantly if none exist.">
        <ThrowsList throws={method.Throws} onChange={(next) => update({ Throws: next })} serviceNodeId={serviceNodeId} />
      </Field>

      <Field label="Description">
        <Textarea value={method.Description ?? ""} rows={2} onChange={(v) => update({ Description: v || undefined })} />
      </Field>
    </>
  );
}

/** Throws list — autocomplete + multi-add from project Exception nodes.
 *  Each row is a NodeRefCombobox + delete button. After select/create,
 *  Service → THROWS → Exception edge is automatically created (linkAs). */
function ThrowsList({
  throws, onChange, serviceNodeId,
}: { throws: string[]; onChange: (next: string[]) => void; serviceNodeId: string }) {
  const setAt = (i: number, v: string) =>
    onChange(throws.map((t, idx) => (idx === i ? v : t)));
  const removeAt = (i: number) => onChange(throws.filter((_, idx) => idx !== i));
  const addEmpty = () => onChange([...throws, ""]);

  return (
    <div className="flex flex-col gap-1.5">
      {throws.map((t, i) => (
        <div key={i} className="flex items-center gap-1.5">
          <div className="flex-1 min-w-0">
            <NodeRefCombobox
              nodeType="Exception"
              value={t}
              onChange={(v) => setAt(i, v)}
              placeholder="Select Exception…"
              ariaLabel={`Exception ${i + 1}`}
              linkAs={{ sourceNodeId: serviceNodeId, kind: "THROWS" }}
            />
          </div>
          <button
            type="button"
            onClick={() => removeAt(i)}
            aria-label="Remove this Throws"
            className="h-8 w-8 inline-flex items-center justify-center rounded-md text-[color:var(--ink-faint)] hover:bg-[var(--ins-overlay-hover)] hover:text-[color:var(--danger)] transition-colors"
          >
            <X size={13} />
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={addEmpty}
        className="inline-flex items-center gap-1.5 h-8 px-3 self-start rounded-md text-[13.5px] font-medium text-[color:var(--ink-soft)] hover:text-[color:var(--ink)] hover:bg-[var(--ins-track)] transition-colors border border-dashed border-[color:var(--hairline-strong)]"
      >
        <Plus size={12} />
        Add Exception
      </button>
    </div>
  );
}

/* ── Dependencies ──────────────────────────────────────────────────── */

const DEP_COLS: readonly GridColumn[] = [
  { key: "ref", label: "Reference", width: "minmax(140px,1.4fr)" },
  { key: "kind", label: "Kind", width: "minmax(120px,0.9fr)" },
];

function DependenciesEditor({
  properties, onChange, serviceNodeId,
}: { properties: Record<string, unknown>; onChange: (next: Record<string, unknown>) => void; serviceNodeId: string }) {
  const deps = (Array.isArray(properties.Dependencies) ? properties.Dependencies : []) as Dependency[];
  const setDeps = (next: Dependency[]) => onChange({ ...properties, Dependencies: next });

  const update = (i: number, patch: Partial<Dependency>) =>
    setDeps(deps.map((d, idx) => (idx === i ? { ...d, ...patch } : d)));
  const remove = (i: number) => setDeps(deps.filter((_, idx) => idx !== i));
  const add = () => setDeps([...deps, newDep()]);

  return (
    <EditGrid
      columns={DEP_COLS}
      rows={deps}
      rowKey={(_, i) => String(i)}
      addLabel="New dependency"
      emptyLabel="// no dependencies"
      onAdd={add}
      onDelete={remove}
      renderCell={(d, key, i) => {
        if (key === "ref") {
          const mapping = DEP_MAPPING[d.Kind];
          return mapping ? (
            <NodeRefCombobox
              density="cell"
              nodeType={mapping.nodeType}
              value={d.Ref}
              onChange={(v) => update(i, { Ref: v })}
              placeholder={`Select ${mapping.nodeType}…`}
              ariaLabel={`${mapping.nodeType} reference`}
              linkAs={serviceNodeId ? { sourceNodeId: serviceNodeId, kind: mapping.edgeKind } : undefined}
            />
          ) : (
            <Input density="cell" value={d.Ref} onChange={() => {}} placeholder="Select Kind first" disabled />
          );
        }
        return (
          <Select
            density="cell"
            value={d.Kind}
            onChange={(v) => update(i, { Kind: v as DepKind })}
            options={DEP_KINDS.map((k) => ({ value: k }))}
            ariaLabel="Dependency type"
          />
        );
      }}
    />
  );
}
