/** MarkdownPreview — rendered preview of .md files (Raw ↔ Preview in the Editor).
 *  react-markdown (existing dependency). No @tailwindcss/typography → components are styled by hand,
 *  theme-aware via editor surface tokens (--ed-*). No GFM (tables/strikethrough) — basic CommonMark. */

import Markdown from "react-markdown";

export function MarkdownPreview({ content }: { content: string }) {
  return (
    <div className="h-full min-h-0 overflow-auto" style={{ background: "var(--ed-bg)", scrollbarWidth: "thin" }}>
      <div className="mx-auto max-w-[760px] px-6 py-6" style={{ color: "var(--ed-text)" }}>
        <Markdown
          components={{
            h1: ({ children }) => <h1 className="mb-3 mt-6 text-[22px] font-bold first:mt-0" style={{ color: "var(--ed-text)" }}>{children}</h1>,
            h2: ({ children }) => <h2 className="mb-2.5 mt-5 text-[18px] font-semibold first:mt-0" style={{ color: "var(--ed-text)" }}>{children}</h2>,
            h3: ({ children }) => <h3 className="mb-2 mt-4 text-[15px] font-semibold first:mt-0" style={{ color: "var(--ed-text)" }}>{children}</h3>,
            p: ({ children }) => <p className="my-2.5 text-[14px] leading-relaxed">{children}</p>,
            ul: ({ children }) => <ul className="my-2.5 list-disc space-y-1 pl-5 text-[14px]">{children}</ul>,
            ol: ({ children }) => <ol className="my-2.5 list-decimal space-y-1 pl-5 text-[14px]">{children}</ol>,
            li: ({ children }) => <li className="leading-relaxed">{children}</li>,
            strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
            em: ({ children }) => <em className="italic">{children}</em>,
            a: ({ href, children }) => <a href={href} target="_blank" rel="noreferrer" className="hover:underline" style={{ color: "var(--ed-accent)" }}>{children}</a>,
            hr: () => <hr className="my-5" style={{ borderColor: "var(--ed-border)" }} />,
            blockquote: ({ children }) => <blockquote className="my-3 border-l-2 pl-3" style={{ borderColor: "var(--ed-border)", color: "var(--ed-textMuted)" }}>{children}</blockquote>,
            code: ({ className, children }) => {
              const isBlock = /language-/.test(className ?? "");
              return isBlock ? (
                <code className="font-mono text-[12.5px]">{children}</code>
              ) : (
                <code className="rounded px-1 py-0.5 font-mono text-[12.5px]" style={{ background: "var(--ed-subtle)", color: "var(--ed-text)" }}>{children}</code>
              );
            },
            pre: ({ children }) => (
              <pre className="my-3 overflow-x-auto rounded-md p-3 font-mono text-[12.5px]" style={{ background: "var(--ed-subtle)", border: "1px solid var(--ed-border)", color: "var(--ed-text)" }}>
                {children}
              </pre>
            ),
          }}
        >
          {content}
        </Markdown>
      </div>
    </div>
  );
}
