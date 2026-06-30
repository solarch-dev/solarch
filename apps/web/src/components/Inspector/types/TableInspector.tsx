import { useState } from "react";
import { useInspectorUpdate } from "../../../hooks/useInspectorUpdate";
import { TableDrawer, type TableDrawerTab } from "./TableDrawer";
import { Field, Input, Textarea, SectionHeader, DrawerTrigger, SaveStatus } from "../primitives";

interface Props {
  projectId: string;
  nodeId: string;
  tabId: string;
  properties: Record<string, unknown>;
}

/** Table node — sidebar summary + structural inline subpage. */
export function TableInspector({ projectId, nodeId, properties }: Props) {
  const { draft, setField, setAll, update } = useInspectorUpdate(projectId, nodeId, properties);
  const [activeTab, setActiveTab] = useState<TableDrawerTab | null>(null);

  const columns = Array.isArray(draft.Columns) ? (draft.Columns as unknown[]) : [];
  const foreignKeys = Array.isArray(draft.ForeignKeys) ? (draft.ForeignKeys as unknown[]) : [];
  const indexes = Array.isArray(draft.Indexes) ? (draft.Indexes as unknown[]) : [];
  const uniques = Array.isArray(draft.UniqueConstraints) ? (draft.UniqueConstraints as unknown[]) : [];
  const checks = Array.isArray(draft.CheckConstraints) ? (draft.CheckConstraints as unknown[]) : [];
  const tableName = typeof draft.TableName === "string" ? draft.TableName : "";

  const status: "idle" | "pending" | "success" | "error" =
    update.isPending ? "pending" :
    update.isError ? "error" :
    update.isSuccess ? "success" :
    "idle";

  if (activeTab) {
    return (
      <TableDrawer
        tab={activeTab}
        tableName={tableName}
        nodeId={nodeId}
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
        <Field label="Table Name" required>
          <Input
            value={tableName}
            onChange={(v) => setField("TableName", v)}
            spellCheck={false}
            placeholder="e.g. users"
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
        <SectionHeader label="Structure" divider />
        <div className="p-group-body">
          <DrawerTrigger label="Columns" fieldKey="Columns" count={columns.length} onClick={() => setActiveTab("columns")} />
          <DrawerTrigger label="Foreign Keys" fieldKey="ForeignKeys" count={foreignKeys.length} onClick={() => setActiveTab("fk")} />
          <DrawerTrigger label="Indexes" fieldKey="Indexes" count={indexes.length} onClick={() => setActiveTab("index")} />
          <DrawerTrigger label="Unique Constraints" fieldKey="UniqueConstraints" count={uniques.length} onClick={() => setActiveTab("unique")} />
          <DrawerTrigger label="Check Constraints" fieldKey="CheckConstraints" count={checks.length} onClick={() => setActiveTab("check")} />
        </div>
      </div>

      <SaveStatus status={status} />
    </form>
  );
}
