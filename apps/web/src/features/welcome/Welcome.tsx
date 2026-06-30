import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@clerk/clerk-react";
import { ArrowRight, FolderOpen, LayoutTemplate, Plus, Sparkles, Trash2 } from "lucide-react";
import { useProjects, useCreateProject, useDeleteProject, type ProjectSummary } from "../../api/projects";
import { usePatterns, useCreateFromPattern, type PatternSummary } from "../../api/patterns";
import { PatternGallerySheet } from "./PatternGallerySheet";
import { useSubscription } from "../../api/billing";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** Compact relative time, "2h ago" style. */
function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const min = Math.floor(ms / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  return new Date(iso).toLocaleDateString();
}

/** /start — project hub: project list + new-project creation in the center of the page.
 *  Guest (login-less trial): auto-creates a project and goes to the canvas without waiting. */
export function Welcome() {
  const { isLoaded, isSignedIn } = useAuth();
  const isGuest = isLoaded && !isSignedIn;
  const navigate = useNavigate();
  const { data: projects, isLoading } = useProjects();
  const { data: subscription } = useSubscription();
  const createProject = useCreateProject();
  const deleteProject = useDeleteProject();
  const { data: patterns } = usePatterns();
  const createFromPattern = useCreateFromPattern();
  const confirm = useConfirm();
  const [name, setName] = useState("");
  const [galleryOpen, setGalleryOpen] = useState(false);
  // Prevent duplicate project creation in StrictMode/refetch (one-shot).
  const started = useRef(false);

  // Guest flow: 0 projects → auto-create, 1 project → go straight into it.
  useEffect(() => {
    if (!isGuest || isLoading || !projects || started.current) return;
    started.current = true;
    if (projects.length > 0) {
      navigate(`/p/${projects[0].id}`, { replace: true });
      return;
    }
    void createProject
      .mutateAsync("My architecture")
      .then((p) => navigate(`/p/${p.id}`, { replace: true }))
      .catch(() => {
        started.current = false; // allow retry
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isGuest, isLoading, projects, navigate]);

  const projectCap = subscription?.entitlements.projectCap;
  const atCap =
    !!subscription && projectCap !== undefined && projectCap !== -1 && (projects?.length ?? 0) >= projectCap;

  const onCreate = async () => {
    const trimmed = name.trim();
    if (!trimmed || createProject.isPending) return;
    const created = await createProject.mutateAsync(trimmed);
    setName("");
    navigate(`/p/${created.id}`);
  };

  const onPattern = async (p: PatternSummary) => {
    if (createFromPattern.isPending) return;
    const created = await createFromPattern.mutateAsync({ name: p.name, patternId: p.id });
    navigate(`/p/${created.id}`);
  };

  const onDelete = async (e: React.MouseEvent, p: ProjectSummary) => {
    e.stopPropagation();
    const ok = await confirm({
      title: `Delete project '${p.name}'`,
      description: "This permanently deletes the project and all its diagrams. This action cannot be undone.",
      variant: "danger",
      confirmLabel: "Delete project",
      cancelLabel: "Cancel",
    });
    if (ok) await deleteProject.mutateAsync(p.id);
  };

  return (
    <div className="relative w-full h-full flex items-center justify-center bg-[color:var(--paper)] overflow-hidden">
      <div
        aria-hidden
        className="absolute inset-0 opacity-60"
        style={{
          backgroundImage: "radial-gradient(circle, var(--grid-dot) 1.1px, transparent 1.6px)",
          backgroundSize: "28px 28px",
        }}
      />

      {isGuest ? (
        // Guest: setup state instead of panel (auto-redirect within seconds)
        <div className="relative flex flex-col items-center gap-4 px-8 py-10 text-center animate-in fade-in slide-in-from-bottom-2 duration-300">
          <span className="font-mono text-[13px] uppercase tracking-[0.18em] text-brand-500 font-bold">SOLARCH</span>
          <p className="font-mono text-[14px] text-[color:var(--ink-soft)] animate-pulse">// setting up your canvas…</p>
        </div>
      ) : (
        <div className="relative w-full max-w-[520px] px-6 animate-in fade-in slide-in-from-bottom-2 duration-300">
          <div className="mb-5 text-center">
            <span className="font-mono text-[12px] uppercase tracking-[0.18em] text-brand-500 font-bold">SOLARCH</span>
            <h1 className="mt-1.5 font-sans text-[23px] font-semibold tracking-[-0.02em] text-[color:var(--ink)]">
              Your projects
            </h1>
          </div>

          <div className="overflow-hidden rounded-[12px] border border-border bg-card/95 shadow-[var(--shadow-card,0_1px_3px_rgba(11,16,32,0.08))] backdrop-blur-xl">
            {/* Project list */}
            <div className="max-h-[44vh] overflow-y-auto">
              {isLoading && (
                <div className="px-5 py-8 text-center font-mono text-[13px] text-muted-foreground">// loading projects…</div>
              )}
              {!isLoading && (projects?.length ?? 0) === 0 && (
                <div className="flex flex-col items-center gap-2 px-5 py-10 text-center">
                  <FolderOpen size={20} className="text-muted-foreground/60" />
                  <p className="font-mono text-[13px] text-muted-foreground">// no projects yet — create your first one below</p>
                </div>
              )}
              {projects?.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => navigate(`/p/${p.id}`)}
                  className="group flex w-full items-center gap-3 border-b border-border/60 px-5 py-3.5 text-left transition-colors last:border-b-0 hover:bg-muted/40"
                >
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-brand-500/10 text-brand-500">
                    <FolderOpen size={14} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-sans text-[14.5px] font-medium text-[color:var(--ink)]">
                      {p.name}
                    </span>
                    <span className="block font-mono text-[11.5px] text-muted-foreground">
                      {p.counts.nodes} nodes · {p.counts.edges} edges · updated {timeAgo(p.updatedAt)}
                    </span>
                  </span>
                  <span
                    role="button"
                    tabIndex={0}
                    onClick={(e) => void onDelete(e, p)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.stopPropagation();
                        void onDelete(e as unknown as React.MouseEvent, p);
                      }
                    }}
                    title={`Delete project ${p.name}`}
                    aria-label={`Delete project ${p.name}`}
                    className="shrink-0 rounded p-1 text-muted-foreground opacity-0 transition-opacity hover:text-[color:var(--danger,#c2371f)] focus:opacity-100 group-hover:opacity-100"
                  >
                    <Trash2 size={13} />
                  </span>
                  <ArrowRight
                    size={13}
                    className="shrink-0 text-muted-foreground/50 transition-transform group-hover:translate-x-0.5 group-hover:text-brand-500"
                  />
                </button>
              ))}
            </div>

            {/* New project — upgrade CTA when at cap */}
            <div className="border-t border-border bg-muted/20 px-4 py-3">
              {atCap ? (
                <button
                  type="button"
                  onClick={() => navigate("/billing")}
                  className="inline-flex w-full items-center justify-center gap-1.5 rounded-md bg-[#ff6b1a] px-3 py-2 font-mono text-[13px] font-medium text-black transition-colors hover:bg-[#d94d00]"
                >
                  <Sparkles size={12} />
                  Upgrade for more projects
                </button>
              ) : (
                <div className="flex gap-1.5">
                  <Input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="New project name"
                    autoFocus
                    className="h-9 text-[13.5px]"
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        void onCreate();
                      }
                    }}
                  />
                  <Button
                    onClick={() => void onCreate()}
                    disabled={!name.trim() || createProject.isPending}
                    className={cn("h-9 gap-1.5 px-3 text-[13.5px]")}
                  >
                    <Plus size={13} />
                    Create
                  </Button>
                </div>
              )}
            </div>
          </div>

          {/* Start from a template — opens the slide-in gallery */}
          {!atCap && (patterns?.length ?? 0) > 0 && (
            <button
              type="button"
              onClick={() => setGalleryOpen(true)}
              className="group mt-3 flex w-full items-center justify-center gap-1.5 rounded-[10px] border border-border bg-card/95 px-3 py-2.5 font-mono text-[13px] text-[color:var(--ink-soft)] transition-colors hover:border-brand-500/40 hover:text-[color:var(--ink)]"
            >
              <LayoutTemplate size={13} className="text-brand-500" />
              Start from a template
              <ArrowRight
                size={13}
                className="text-muted-foreground/60 transition-transform group-hover:translate-x-0.5 group-hover:text-brand-500"
              />
            </button>
          )}

          <p className="mt-4 text-center font-mono text-[11.5px] tracking-[0.05em] text-[color:var(--ink-faint)]">
            // architecture builder
          </p>

          <PatternGallerySheet
            open={galleryOpen}
            onOpenChange={setGalleryOpen}
            patterns={patterns ?? []}
            onUse={onPattern}
            pending={createFromPattern.isPending}
          />
        </div>
      )}
    </div>
  );
}
