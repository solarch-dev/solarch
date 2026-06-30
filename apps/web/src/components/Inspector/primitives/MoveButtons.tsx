import { ArrowUp, ArrowDown } from "lucide-react";
import { IconButton } from "./IconButton";

interface Props {
  isFirst?: boolean;
  isLast?: boolean;
  onUp: () => void;
  onDown: () => void;
}

/** Reorder pair — up disabled on first row, down disabled on last row. */
export function MoveButtons({ isFirst, isLast, onUp, onDown }: Props) {
  return (
    <div className="inline-flex items-center gap-px">
      <IconButton onClick={onUp} title="Move up" disabled={isFirst} size="sm">
        <ArrowUp size={11} />
      </IconButton>
      <IconButton onClick={onDown} title="Move down" disabled={isLast} size="sm">
        <ArrowDown size={11} />
      </IconButton>
    </div>
  );
}
