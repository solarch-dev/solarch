import { useState } from "react";
import { useInspectorUpdate } from "../../../hooks/useInspectorUpdate";
import { ServiceDrawer, type ServiceDrawerTab } from "./ServiceDrawer";
import { Field, Input, Textarea, Switch, SectionHeader, DrawerTrigger, SaveStatus } from "../primitives";

interface Props {
  projectId: string;
  nodeId: string;
  tabId: string;
  properties: Record<string, unknown>;
}

/** Service node — sidebar summary + inline subpage navigation.
 *  Sub-page state is local (state-based render switch) — no modal context, no stale snapshot bug. */
export function ServiceInspector({ projectId, nodeId, properties }: Props) {
  const { draft, setField, setAll, update } = useInspectorUpdate(projectId, nodeId, properties);
  const [activeTab, setActiveTab] = useState<ServiceDrawerTab | null>(null);

  const methods = Array.isArray(draft.Methods) ? (draft.Methods as unknown[]) : [];
  const deps = Array.isArray(draft.Dependencies) ? (draft.Dependencies as unknown[]) : [];
  const serviceName = typeof draft.ServiceName === "string" ? draft.ServiceName : "";
  const isTxn = !!draft.IsTransactionScoped;

  const status: "idle" | "pending" | "success" | "error" =
    update.isPending ? "pending" :
    update.isError ? "error" :
    update.isSuccess ? "success" :
    "idle";

  // When sub-page is open, render inline — fresh draft + onChange direct to parent state
  if (activeTab) {
    return (
      <ServiceDrawer
        tab={activeTab}
        serviceName={serviceName}
        serviceNodeId={nodeId}
        properties={draft}
        onChange={setAll}
        saveStatus={status}
        onBack={() => setActiveTab(null)}
      />
    );
  }

  return (
    <form className="p-form" onSubmit={(e) => e.preventDefault()}>
      <div className="p-group-body">
        <Field label="Service Name" required>
          <Input
            value={serviceName}
            onChange={(v) => setField("ServiceName", v)}
            spellCheck={false}
            placeholder="e.g. UserService"
          />
        </Field>
        <Field label="Description">
          <Textarea
            value={typeof draft.Description === "string" ? draft.Description : ""}
            rows={2}
            onChange={(v) => setField("Description", v)}
          />
        </Field>
        <Field label="Transaction Scoped" layout="row">
          <Switch
            checked={isTxn}
            onChange={(v) => setField("IsTransactionScoped", v)}
            ariaLabel="Transaction Scoped"
          />
        </Field>
      </div>

      <div className="p-group">
        <SectionHeader label="Behavior" divider />
        <div className="p-group-body">
          <DrawerTrigger label="Methods" fieldKey="Methods" count={methods.length} onClick={() => setActiveTab("methods")} />
          <DrawerTrigger label="Dependencies" fieldKey="Dependencies" count={deps.length} onClick={() => setActiveTab("deps")} />
        </div>
      </div>

      <SaveStatus status={status} />
    </form>
  );
}
