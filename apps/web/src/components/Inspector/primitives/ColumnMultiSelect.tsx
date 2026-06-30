/** Multi-column selector — chip-based multi-select from a table's column names.
 *  Used for Columns/ReferencesColumns in FK/Index/Unique editors. */

import { X } from "lucide-react";
import { Pill } from "./Pill";
import { Select } from "./Select";

interface Props {
  /** Selected column names */
  value: string[];
  onChange: (next: string[]) => void;
  /** Available column names (columns of this table or the target table) */
  options: string[];
  placeholder?: string;
  ariaLabel?: string;
}

export function ColumnMultiSelect({ value, onChange, options, placeholder, ariaLabel }: Props) {
  const remove = (name: string) => onChange(value.filter((v) => v !== name));
  const add = (name: string) => {
    if (!name || value.includes(name)) return;
    onChange([...value, name]);
  };
  const available = options.filter((o) => !value.includes(o));

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {value.map((name) => {
        const stale = !options.includes(name);
        return (
          <Pill
            key={name}
            tone={stale ? "warn" : "accent"}
            interactive
            onClick={() => remove(name)}
            title={stale ? "column not found — click to remove" : "remove"}
          >
            <span className="font-mono">{name}</span>
            <X size={11} className="ml-1 -mr-0.5 inline-block align-middle" />
          </Pill>
        );
      })}
      {available.length > 0 && (
        <Select
          value=""
          onChange={add}
          options={available.map((o) => ({ value: o }))}
          placeholder={placeholder ?? "+ column"}
          ariaLabel={ariaLabel ?? "Add column"}
          className="p-input-tiny"
        />
      )}
      {value.length === 0 && available.length === 0 && (
        <span className="text-[13px] text-[color:var(--ink-faint)] font-mono">// no columns</span>
      )}
    </div>
  );
}
