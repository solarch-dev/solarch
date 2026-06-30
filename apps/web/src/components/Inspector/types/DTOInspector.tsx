import { useState } from "react";
import { useInspectorUpdate } from "../../../hooks/useInspectorUpdate";
import { DTODrawer } from "./DTODrawer";
import { Field, Input, Textarea, SectionHeader, DrawerTrigger, SaveStatus } from "../primitives";

interface Props {
  projectId: string;
  nodeId: string;
  tabId: string;
  properties: Record<string, unknown>;
}

/** DTO node — sidebar summary + Fields inline subpage. */
export function DTOInspector({ projectId, nodeId, properties }: Props) {
  const { draft, setField, setAll, update } = useInspectorUpdate(projectId, nodeId, properties);
  const [showFields, setShowFields] = useState(false);

  const fields = Array.isArray(draft.Fields) ? (draft.Fields as unknown[]) : [];
  const dtoName = typeof draft.Name === "string" ? draft.Name : "";

  const status: "idle" | "pending" | "success" | "error" =
    update.isPending ? "pending" :
    update.isError ? "error" :
    update.isSuccess ? "success" :
    "idle";

  if (showFields) {
    return (
      <DTODrawer
        nodeId={nodeId}
        dtoName={dtoName}
        properties={draft}
        onChange={setAll}
        saveStatus={status}
        onBack={() => setShowFields(false)}
      />
    );
  }

  return (
    <form className="p-form" onSubmit={(e) => e.preventDefault()}>
      <div className="p-group-body">
        <Field label="DTO Name" required>
          <Input
            value={dtoName}
            onChange={(v) => setField("Name", v)}
            spellCheck={false}
            placeholder="e.g. CreateUserDto"
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
        <SectionHeader label="Schema" divider />
        <div className="p-group-body">
          <DrawerTrigger label="Fields" fieldKey="Fields" count={fields.length} onClick={() => setShowFields(true)} />
        </div>
      </div>

      <SaveStatus status={status} />
    </form>
  );
}
