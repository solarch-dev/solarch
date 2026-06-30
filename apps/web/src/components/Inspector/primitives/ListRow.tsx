import type { ReactNode } from "react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { MoveButtons } from "./MoveButtons";
import { DeleteButton } from "./DeleteButton";

interface Props {
  stateIcon?: ReactNode;
  primary: ReactNode;
  meta?: ReactNode;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
  isFirst?: boolean;
  isLast?: boolean;
  onDelete?: () => void;
  /** Varsa expandable Collapsible body. */
  details?: ReactNode;
}

/** Ortak list item layout — `[icon?] [primary] [meta] [↑↓] [×]` + opsiyonel collapsible body.
 *  Radix Collapsible animation + a11y (Space/Enter expand). */
export function ListRow({
  stateIcon, primary, meta, onMoveUp, onMoveDown, isFirst, isLast, onDelete, details,
}: Props) {
  const hasMove = onMoveUp && onMoveDown;

  const headContent = (
    <>
      {details && (
        <ChevronRight
          size={12}
          className="shrink-0 text-[color:var(--ink-faint)] transition-transform group-data-[state=open]/lr:rotate-90"
        />
      )}
      {stateIcon && (
        <div className="w-[18px] h-[18px] flex items-center justify-center text-[color:var(--ins-family-accent,var(--accent))] shrink-0">
          {stateIcon}
        </div>
      )}
      <div className="flex-1 min-w-0 flex items-center">{primary}</div>
      {meta && <div className="flex items-center gap-1 shrink-0">{meta}</div>}
      {hasMove && (
        <MoveButtons isFirst={isFirst} isLast={isLast} onUp={onMoveUp!} onDown={onMoveDown!} />
      )}
      {onDelete && <DeleteButton onClick={onDelete} />}
    </>
  );

  const rowClass = cn(
    "group/lr border border-[color:var(--hairline)] rounded-lg bg-[color:var(--ins-card)] overflow-hidden transition-colors",
    "hover:border-[color:var(--hairline-strong)] data-[state=open]:border-[color:var(--hairline-strong)]"
  );
  const headRowClass = "flex items-center gap-2.5 px-3 py-2 min-h-10";

  if (details) {
    return (
      <Collapsible className={rowClass}>
        <CollapsibleTrigger asChild>
          <div className={cn(headRowClass, "cursor-pointer select-none")}>{headContent}</div>
        </CollapsibleTrigger>
        <CollapsibleContent className="overflow-hidden data-[state=closed]:animate-accordion-up data-[state=open]:animate-accordion-down">
          <div className="px-4 pt-3.5 pb-4 border-t border-[color:var(--hairline)] flex flex-col gap-[18px] bg-[color:var(--ins-card-sunken)]">
            {details}
          </div>
        </CollapsibleContent>
      </Collapsible>
    );
  }

  return <div className={rowClass}><div className={headRowClass}>{headContent}</div></div>;
}
