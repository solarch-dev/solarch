/**
 * Markdown — renders documentation prose (operation/schema/field descriptions + the API overview)
 * as GitHub-flavored Markdown, styled with Solarch tokens.
 *
 * Scalar renders all prose through its `ScalarMarkdown` block; we do the same with `react-markdown`
 * + `remark-gfm` (tables, task lists, strikethrough, autolinks) and a Solarch-token component map
 * (no `prose` plugin, no Scalar CSS). `size="sm"` is the compact variant for inline field/schema
 * descriptions; `size="md"` (default) is for operation descriptions and the overview landing.
 *
 * Portable (props-only): only `react-markdown` + `remark-gfm` (generic libs) — no app store / router /
 * query / `@/`-singletons, so Plan B can bundle it standalone for the generated app's `/docs`.
 */

import type { ComponentPropsWithoutRef, ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

export interface MarkdownProps {
  /** The Markdown source. Renders nothing when empty/whitespace. */
  children?: string;
  /** "md" (default) for operation/overview prose; "sm" for compact field/schema descriptions. */
  size?: "sm" | "md";
}

/** Solarch-token component map. `node` is destructured out so it never reaches the DOM element. */
function components(size: "sm" | "md") {
  const body = size === "sm" ? "text-[12.5px] leading-[1.5]" : "text-[13.5px] leading-[1.6]";
  return {
    p: ({ node, ...props }: ComponentPropsWithoutRef<"p"> & { node?: unknown }) => (
      <p className={`${body} my-2 first:mt-0 last:mb-0 text-[var(--ink-soft)]`} {...props} />
    ),
    h1: ({ node, ...props }: ComponentPropsWithoutRef<"h1"> & { node?: unknown }) => (
      <h2 className="mb-2 mt-4 font-sans text-[16px] font-semibold text-[var(--ink)] first:mt-0" {...props} />
    ),
    h2: ({ node, ...props }: ComponentPropsWithoutRef<"h2"> & { node?: unknown }) => (
      <h3 className="mb-2 mt-4 font-sans text-[14.5px] font-semibold text-[var(--ink)] first:mt-0" {...props} />
    ),
    h3: ({ node, ...props }: ComponentPropsWithoutRef<"h3"> & { node?: unknown }) => (
      <h4 className="mb-1.5 mt-3 font-sans text-[13px] font-semibold text-[var(--ink)] first:mt-0" {...props} />
    ),
    h4: ({ node, ...props }: ComponentPropsWithoutRef<"h4"> & { node?: unknown }) => (
      <h5 className="mb-1.5 mt-3 font-sans text-[12.5px] font-semibold text-[var(--ink-soft)] first:mt-0" {...props} />
    ),
    ul: ({ node, ...props }: ComponentPropsWithoutRef<"ul"> & { node?: unknown }) => (
      <ul className={`${body} my-2 list-disc pl-5 text-[var(--ink-soft)] marker:text-[var(--ink-faint)]`} {...props} />
    ),
    ol: ({ node, ...props }: ComponentPropsWithoutRef<"ol"> & { node?: unknown }) => (
      <ol className={`${body} my-2 list-decimal pl-5 text-[var(--ink-soft)] marker:text-[var(--ink-faint)]`} {...props} />
    ),
    li: ({ node, ...props }: ComponentPropsWithoutRef<"li"> & { node?: unknown }) => <li className="my-0.5" {...props} />,
    a: ({ node, ...props }: ComponentPropsWithoutRef<"a"> & { node?: unknown }) => (
      <a
        className="text-[var(--accent)] underline decoration-[var(--accent)]/40 underline-offset-2 hover:decoration-[var(--accent)]"
        target="_blank"
        rel="noreferrer noopener"
        {...props}
      />
    ),
    strong: ({ node, ...props }: ComponentPropsWithoutRef<"strong"> & { node?: unknown }) => (
      <strong className="font-semibold text-[var(--ink)]" {...props} />
    ),
    em: ({ node, ...props }: ComponentPropsWithoutRef<"em"> & { node?: unknown }) => <em className="italic" {...props} />,
    code: ({ node, ...props }: ComponentPropsWithoutRef<"code"> & { node?: unknown }) => (
      <code
        className="rounded-[4px] border border-[hsl(var(--border))] bg-[var(--paper-sunken)] px-1 py-0.5 font-mono text-[0.92em] text-[var(--ink)]"
        {...props}
      />
    ),
    pre: ({ node, ...props }: ComponentPropsWithoutRef<"pre"> & { node?: unknown }) => (
      <pre
        className="my-2.5 overflow-auto rounded-[8px] border border-[hsl(var(--border))] bg-[var(--paper-sunken)] p-3 font-mono text-[12px] leading-[1.6] text-[var(--ink)] [&_code]:border-0 [&_code]:bg-transparent [&_code]:p-0"
        {...props}
      />
    ),
    blockquote: ({ node, ...props }: ComponentPropsWithoutRef<"blockquote"> & { node?: unknown }) => (
      <blockquote
        className="my-2.5 border-l-2 border-[hsl(var(--border))] pl-3 text-[var(--ink-soft)] italic"
        {...props}
      />
    ),
    hr: ({ node, ...props }: ComponentPropsWithoutRef<"hr"> & { node?: unknown }) => (
      <hr className="my-4 border-0 border-t border-[hsl(var(--border))]" {...props} />
    ),
    table: ({ node, ...props }: ComponentPropsWithoutRef<"table"> & { node?: unknown }) => (
      <div className="my-2.5 overflow-x-auto rounded-[7px] border border-[hsl(var(--border))]">
        <table className="w-full border-collapse text-left" {...props} />
      </div>
    ),
    th: ({ node, ...props }: ComponentPropsWithoutRef<"th"> & { node?: unknown }) => (
      <th
        className="border-b border-[hsl(var(--border))] bg-[var(--paper-sunken)] px-3 py-1.5 font-sans text-[11.5px] font-medium text-[var(--ink)]"
        {...props}
      />
    ),
    td: ({ node, ...props }: ComponentPropsWithoutRef<"td"> & { node?: unknown }) => (
      <td className="border-b border-[hsl(var(--border))] px-3 py-1.5 font-sans text-[12.5px] text-[var(--ink-soft)]" {...props} />
    ),
  } as const;
}

export function Markdown({ children, size = "md" }: MarkdownProps): ReactNode {
  if (!children || !children.trim()) {
    return null;
  }
  return (
    <div className="solarch-md min-w-0 break-words">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components(size)}>
        {children}
      </ReactMarkdown>
    </div>
  );
}
