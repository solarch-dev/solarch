/** ValueSetCombobox — suggestions from backend value-set + free-form input.
 *  Unlike ValueSetSelect: custom values not in the catalog (e.g. DataType="UserDto")
 *  can be entered. cmdk + Radix Popover, same UI language as NodeRefCombobox. */

import { useState, useMemo, useRef, useEffect } from "react";
import * as PopoverPrimitive from "@radix-ui/react-popover";
import { ChevronDown, Check } from "lucide-react";
import { Command as CommandPrimitive } from "cmdk";
import { useValueSet } from "../../../api/value-sets";
import { Z_LAYERS } from "../../../lib/z-layers";
import { cn } from "@/lib/utils";

interface Props {
  valueSetId: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  ariaLabel?: string;
  className?: string;
  /** "cell" → dense grid cell: h-8, borderless/transparent, hover affordance. */
  density?: "default" | "cell";
}

export function ValueSetCombobox({
  valueSetId, value, onChange, placeholder, ariaLabel, className, density = "default",
}: Props) {
  const cell = density === "cell";
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const { data: set, isLoading } = useValueSet(valueSetId);

  const options = useMemo(() => set?.values ?? [], [set]);
  const q = query.trim();
  const filtered = useMemo(() => {
    if (!q) return options;
    const ql = q.toLocaleLowerCase("tr");
    return options.filter(
      (o) =>
        o.value.toLocaleLowerCase("tr").includes(ql) ||
        (o.label ?? "").toLocaleLowerCase("tr").includes(ql),
    );
  }, [options, q]);

  const exactMatch = options.some((o) => o.value === q);
  const canUseCustom = q.length > 0 && !exactMatch;

  const handleSelect = (v: string) => {
    onChange(v);
    setOpen(false);
    setQuery("");
  };

  useEffect(() => {
    if (!open) return;
    const id = window.setTimeout(() => inputRef.current?.focus(), 30);
    return () => clearTimeout(id);
  }, [open]);

  return (
    <PopoverPrimitive.Root open={open} onOpenChange={setOpen}>
      <PopoverPrimitive.Trigger asChild>
        <button
          type="button"
          aria-label={ariaLabel}
          className={cn(
            "inline-flex items-center gap-2 w-full text-left transition-colors",
            cell
              ? "h-8 px-2 rounded text-[13px] border border-transparent bg-transparent hover:bg-[var(--ins-overlay-hover)] focus:outline-none focus:ring-1 focus:ring-[color:var(--accent)]/30 focus:border-[color:var(--accent)]"
              : "h-10 px-3.5 rounded-md text-[15px] border border-[color:var(--hairline-strong)] bg-[color:var(--paper-raised)] hover:border-[color:var(--ink-faint)] focus:outline-none focus:ring-2 focus:ring-[color:var(--accent)]/25 focus:border-[color:var(--accent)]",
            className,
          )}
        >
          {value ? (
            <span className={cn("flex-1 truncate font-mono", cell ? "text-[12.5px]" : "text-[14.5px]")}>{value}</span>
          ) : (
            <span className="flex-1 truncate text-[color:var(--ink-faint)]">
              {placeholder ?? (isLoading ? "loading…" : `${set?.label ?? "select"}…`)}
            </span>
          )}
          <ChevronDown size={cell ? 12 : 14} className="shrink-0 text-[color:var(--ink-faint)]" />
        </button>
      </PopoverPrimitive.Trigger>

      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          align="start"
          sideOffset={6}
          className={cn(
            "w-[var(--radix-popover-trigger-width)] min-w-[260px]",
            "rounded-lg border border-border bg-[color:var(--paper-raised)] shadow-float overflow-hidden",
            "data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95",
            "data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95",
            "duration-150",
          )}
          style={{ zIndex: Z_LAYERS.POPOVER }}
        >
          <CommandPrimitive shouldFilter={false} className="flex flex-col">
            <CommandPrimitive.Input
              ref={inputRef}
              value={query}
              onValueChange={setQuery}
              placeholder={`${set?.label ?? "value"} search or type…`}
              className="h-10 px-3.5 text-[14.5px] border-0 border-b border-[color:var(--hairline)] bg-transparent outline-none placeholder:text-[color:var(--ink-faint)]"
            />
            <CommandPrimitive.List className="max-h-[280px] overflow-y-auto py-1.5">
              {filtered.length === 0 && !canUseCustom && (
                <div className="px-3 py-4 text-center text-[13.5px] text-[color:var(--ink-faint)] font-mono">
                  // no results
                </div>
              )}
              {filtered.length > 0 && (
                <CommandPrimitive.Group>
                  {filtered.map((o) => {
                    const isSelected = o.value === value;
                    return (
                      <CommandPrimitive.Item
                        key={o.value}
                        value={o.value}
                        onSelect={() => handleSelect(o.value)}
                        className={cn(
                          "px-3 py-2 mx-1.5 rounded-md flex items-center gap-2.5 text-[14.5px] cursor-pointer",
                          "data-[selected=true]:bg-[var(--ins-pill-bg)]",
                          "hover:bg-[var(--ins-track)]",
                        )}
                      >
                        <span className="flex-1 truncate font-mono text-[color:var(--ink)]">
                          {o.value}
                        </span>
                        {o.label && o.label !== o.value && (
                          <span className="text-[12.5px] text-[color:var(--ink-faint)] truncate">
                            {o.label}
                          </span>
                        )}
                        {isSelected && <Check size={13} className="shrink-0 text-brand-500" />}
                      </CommandPrimitive.Item>
                    );
                  })}
                </CommandPrimitive.Group>
              )}
              {canUseCustom && (
                <>
                  {filtered.length > 0 && (
                    <div className="my-1.5 border-t border-[color:var(--hairline)]" />
                  )}
                  <CommandPrimitive.Item
                    value={`__custom:${q}`}
                    onSelect={() => handleSelect(q)}
                    className={cn(
                      "px-3 py-2 mx-1.5 rounded-md flex items-center gap-2.5 text-[14.5px] cursor-pointer",
                      "text-brand-500 font-medium",
                      "data-[selected=true]:bg-brand-500/10",
                      "hover:bg-brand-500/10",
                    )}
                  >
                    <span className="flex-1">
                      Use this value: <span className="font-mono">{q}</span>
                    </span>
                  </CommandPrimitive.Item>
                </>
              )}
            </CommandPrimitive.List>
          </CommandPrimitive>
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}
