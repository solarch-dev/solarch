import { useState } from "react";
import { SubPageShell } from "../primitives";
import { ColumnsEditor } from "./table/ColumnsEditor";
import { ForeignKeysEditor } from "./table/ForeignKeysEditor";
import { IndexesEditor } from "./table/IndexesEditor";
import { UniqueConstraintsEditor } from "./table/UniqueConstraintsEditor";
import { CheckConstraintsEditor } from "./table/CheckConstraintsEditor";

export type TableDrawerTab = "columns" | "fk" | "index" | "unique" | "check";

const TAB_LABEL: Record<TableDrawerTab, string> = {
  columns: "Columns",
  fk: "Foreign Keys",
  index: "Indexes",
  unique: "Unique Constraints",
  check: "Check Constraints",
};

interface Props {
  tab: TableDrawerTab;
  tableName: string;
  /** ID of the Table node being edited — for NodeRefCombobox linkAs (USES Enum edge). */
  nodeId: string;
  properties: Record<string, unknown>;
  onChange: (next: Record<string, unknown>) => void;
  saveStatus?: "idle" | "pending" | "success" | "error";
  onBack: () => void;
}

export function TableDrawer({ tab, tableName, nodeId, properties, onChange, saveStatus = "idle", onBack }: Props) {
  const [active, setActive] = useState<TableDrawerTab>(tab);
  const len = (key: string) => (Array.isArray(properties[key]) ? (properties[key] as unknown[]).length : 0);

  const tabs = (Object.keys(TAB_LABEL) as TableDrawerTab[]).map((t) => ({
    id: t,
    label: TAB_LABEL[t],
    count: t === "columns" ? len("Columns") :
           t === "fk" ? len("ForeignKeys") :
           t === "index" ? len("Indexes") :
           t === "unique" ? len("UniqueConstraints") :
           len("CheckConstraints"),
  }));

  const statusText = saveStatus === "pending" ? "saving…"
    : saveStatus === "success" ? "saved"
    : saveStatus === "error" ? "save failed"
    : undefined;

  return (
    <SubPageShell
      title={TAB_LABEL[active]}
      subtitle={tableName || "(unnamed table)"}
      tabs={tabs}
      activeTab={active}
      onTabChange={(id) => setActive(id as TableDrawerTab)}
      onBack={onBack}
      onSave={onBack}
      saveDisabled={saveStatus === "pending"}
      saveStatusText={statusText}
      saveStatusTone={saveStatus}
    >
      {active === "columns" && <ColumnsEditor properties={properties} onChange={onChange} nodeId={nodeId} />}
      {active === "fk" && <ForeignKeysEditor properties={properties} onChange={onChange} />}
      {active === "index" && <IndexesEditor properties={properties} onChange={onChange} />}
      {active === "unique" && <UniqueConstraintsEditor properties={properties} onChange={onChange} />}
      {active === "check" && <CheckConstraintsEditor properties={properties} onChange={onChange} />}
    </SubPageShell>
  );
}
