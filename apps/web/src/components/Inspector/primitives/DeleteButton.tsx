import { X } from "lucide-react";
import { IconButton } from "./IconButton";

interface Props {
  onClick: () => void;
  title?: string;
  size?: "sm" | "md";
}

/** Delete ghost button — red wash on hover. */
export function DeleteButton({ onClick, title = "Delete", size }: Props) {
  return (
    <IconButton onClick={onClick} title={title} tone="danger" size={size}>
      <X size={size === "sm" ? 11 : 13} />
    </IconButton>
  );
}
