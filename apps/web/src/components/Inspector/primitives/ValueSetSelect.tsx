/** ValueSetSelect — generates a Select widget from a fieldHint.valueSet id.
 *  Fetches options from backend /value-sets/:id, optional category by group. */

import { useMemo } from "react";
import { Select } from "./Select";
import { useValueSet } from "../../../api/value-sets";

interface Props {
  valueSetId: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  disabled?: boolean;
  ariaLabel?: string;
  className?: string;
  density?: "default" | "cell";
}

export function ValueSetSelect({
  valueSetId, value, onChange, placeholder, disabled, ariaLabel, className, density = "default",
}: Props) {
  const { data: set, isLoading } = useValueSet(valueSetId);

  const options = useMemo(
    () => (set?.values ?? []).map((v) => ({
      value: v.value,
      label: v.label ?? v.value,
    })),
    [set],
  );

  return (
    <Select
      value={value ?? ""}
      onChange={onChange}
      options={options}
      placeholder={placeholder ?? (isLoading ? "loading…" : `${set?.label ?? "select"}…`)}
      disabled={disabled || isLoading}
      ariaLabel={ariaLabel}
      className={className}
      density={density}
    />
  );
}
