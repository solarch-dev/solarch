/** CodeEditor — EDITABLE code editor (Editor sub-view, the editable sibling of the read-only CodeViewer).
 *  No new dependency: the react-simple-code-editor technique — a transparent <textarea> OVER a
 *  syntax-highlighted <pre> (prism); the caret is visible, the text is transparent → the colored highlight
 *  reads from behind, typed over the top.
 *
 *  Edits flow upward via `onEdit` (CodegenPanel override layer → also reflected in Download .zip).
 *  Alignment is critical: pre + textarea share the SAME font/padding/line-height/whiteSpace/tabSize. */

import { useRef } from "react";
import { Highlight } from "prism-react-renderer";
import type { CSSProperties, KeyboardEvent } from "react";
import type { GeneratedFile } from "../../api/codegen";
import { prismLanguageFor } from "./lib";
import { solarchPrismTheme } from "./theme";

const FONT: CSSProperties = { fontFamily: "var(--font-mono)", fontSize: "13.5px", lineHeight: "1.6", tabSize: 2 };
const PAD = "12px 16px";

export function CodeEditor({ file, onEdit }: { file: GeneratedFile; onEdit: (content: string) => void }) {
  const language = prismLanguageFor(file.language);
  const taRef = useRef<HTMLTextAreaElement>(null);

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key !== "Tab") return;
    e.preventDefault();
    const ta = e.currentTarget;
    const { selectionStart: s, selectionEnd: en, value } = ta;
    onEdit(value.slice(0, s) + "  " + value.slice(en));
    requestAnimationFrame(() => {
      if (taRef.current) taRef.current.selectionStart = taRef.current.selectionEnd = s + 2;
    });
  };

  return (
    <div className="h-full min-h-0 overflow-auto" style={{ background: "var(--ed-bg)", scrollbarWidth: "thin" }}>
      <div className="relative" style={{ width: "max-content", minWidth: "100%", minHeight: "100%" }}>
        {/* Back layer — syntax-colored (does not receive pointer events). */}
        <Highlight theme={solarchPrismTheme} code={file.content} language={language}>
          {({ tokens, getTokenProps }) => (
            <pre aria-hidden className="m-0" style={{ ...FONT, padding: PAD, whiteSpace: "pre", pointerEvents: "none" }}>
              {tokens.map((line, i) => (
                <span key={i}>
                  {line.map((token, k) => <span key={k} {...getTokenProps({ token })} />)}
                  {i < tokens.length - 1 ? "\n" : null}
                </span>
              ))}
            </pre>
          )}
        </Highlight>
        {/* Front layer — transparent text, visible caret; the real editing happens here. */}
        <textarea
          ref={taRef}
          value={file.content}
          onChange={(e) => onEdit(e.target.value)}
          onKeyDown={onKeyDown}
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          wrap="off"
          aria-label={`Edit ${file.path}`}
          className="absolute inset-0 resize-none border-0 bg-transparent outline-none"
          style={{ ...FONT, padding: PAD, whiteSpace: "pre", color: "transparent", caretColor: "var(--ed-text)", overflow: "hidden" }}
        />
      </div>
    </div>
  );
}
