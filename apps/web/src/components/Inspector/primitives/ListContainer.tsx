import type { ReactNode } from "react";
import { AddRowButton } from "./AddRowButton";
import { EmptyHint } from "./EmptyHint";

interface Props<T> {
  items: readonly T[];
  renderRow: (item: T, index: number) => ReactNode;
  onAdd: () => void;
  addLabel: string;
  emptyLabel?: string;
}

/** Empty hint + map + add button — array editor pattern in one place. */
export function ListContainer<T>({
  items, renderRow, onAdd, addLabel, emptyLabel = "No items yet",
}: Props<T>) {
  return (
    <div className="flex flex-col gap-[6px]">
      {items.length === 0 ? (
        <EmptyHint>{emptyLabel}</EmptyHint>
      ) : (
        <div className="flex flex-col gap-[5px]">
          {items.map((item, idx) => renderRow(item, idx))}
        </div>
      )}
      <AddRowButton label={addLabel} onClick={onAdd} />
    </div>
  );
}
