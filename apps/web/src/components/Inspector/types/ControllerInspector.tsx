import { useState } from "react";
import { useInspectorUpdate } from "../../../hooks/useInspectorUpdate";
import { ControllerDrawer } from "./ControllerDrawer";
import { Field, Input, Textarea, SectionHeader, DrawerTrigger, SaveStatus } from "../primitives";

interface Props {
  projectId: string;
  nodeId: string;
  tabId: string;
  properties: Record<string, unknown>;
}

/** Controller node — sidebar summary + Endpoints inline subpage. */
export function ControllerInspector({ projectId, nodeId, properties }: Props) {
  const { draft, setField, setAll, update } = useInspectorUpdate(projectId, nodeId, properties);
  const [showEndpoints, setShowEndpoints] = useState(false);

  const endpoints = Array.isArray(draft.Endpoints) ? (draft.Endpoints as unknown[]) : [];
  const controllerName = typeof draft.ControllerName === "string" ? draft.ControllerName : "";

  const status: "idle" | "pending" | "success" | "error" =
    update.isPending ? "pending" :
    update.isError ? "error" :
    update.isSuccess ? "success" :
    "idle";

  if (showEndpoints) {
    return (
      <ControllerDrawer
        nodeId={nodeId}
        controllerName={controllerName}
        baseRoute={typeof draft.BaseRoute === "string" ? draft.BaseRoute : ""}
        properties={draft}
        onChange={setAll}
        saveStatus={status}
        onBack={() => setShowEndpoints(false)}
      />
    );
  }

  return (
    <form className="p-form" onSubmit={(e) => e.preventDefault()}>
      <div className="p-group-body">
        <Field label="Controller Name" required>
          <Input
            value={controllerName}
            onChange={(v) => setField("ControllerName", v)}
            spellCheck={false}
            placeholder="e.g. UserController"
          />
        </Field>
        <Field label="Base Route" badge="prefix">
          <Input
            variant="mono"
            value={typeof draft.BaseRoute === "string" ? draft.BaseRoute : ""}
            onChange={(v) => setField("BaseRoute", v)}
            placeholder="/api/v1/users"
            spellCheck={false}
          />
        </Field>
        <Field label="Version">
          <Input
            variant="mono"
            value={typeof draft.Version === "string" ? draft.Version : ""}
            onChange={(v) => setField("Version", v || undefined)}
            placeholder="v1"
            spellCheck={false}
          />
        </Field>
        <Field label="Description">
          <Textarea
            value={typeof draft.Description === "string" ? draft.Description : ""}
            rows={2}
            onChange={(v) => setField("Description", v)}
          />
        </Field>
      </div>

      <div className="p-group">
        <SectionHeader label="HTTP" divider />
        <div className="p-group-body">
          <DrawerTrigger label="Endpoints" fieldKey="Endpoints" count={endpoints.length} onClick={() => setShowEndpoints(true)} />
        </div>
      </div>

      <SaveStatus status={status} />
    </form>
  );
}
