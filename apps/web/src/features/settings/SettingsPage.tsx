import { useState } from "react";
import { Check, Copy, KeyRound, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useApiKeys, useCreateApiKey, useDeleteApiKey } from "../../api/api-keys";
import { useIsGuest, openGuestSignupModal } from "../../lib/guest";

/** Settings — for now a single section: API Keys (for CLI / MCP clients).
 *  On creation the plaintext key is shown ONLY once; once the page reloads
 *  it cannot be recovered (the server stores only a hash). */
export function SettingsPage() {
  const isGuest = useIsGuest();
  const { data: keys, isLoading } = useApiKeys();
  const createKey = useCreateApiKey();
  const deleteKey = useDeleteApiKey();

  const [name, setName] = useState("");
  /** The just-generated key — shown once, copied, then dismissed. */
  const [freshKey, setFreshKey] = useState<{ key: string; name: string } | null>(null);
  const [copied, setCopied] = useState(false);

  const create = () => {
    if (isGuest) {
      openGuestSignupModal();
      return;
    }
    const trimmed = name.trim();
    if (!trimmed) return;
    createKey.mutate(trimmed, {
      onSuccess: (data) => {
        setFreshKey({ key: data.key, name: data.name });
        setCopied(false);
        setName("");
      },
      onError: (e) => toast.error(e.message),
    });
  };

  const copy = async () => {
    if (!freshKey) return;
    await navigator.clipboard.writeText(freshKey.key);
    setCopied(true);
    toast.success("API key copied");
  };

  return (
    <div className="mx-auto w-full max-w-[760px] px-6 py-10">
      <h1 className="font-sans text-[23px] font-semibold tracking-[-0.01em]">Settings</h1>

      <section className="mt-8">
        <div className="flex items-center gap-2">
          <KeyRound size={15} className="text-brand-500" />
          <h2 className="font-sans text-[16px] font-semibold">API Keys</h2>
        </div>
        <p className="mt-1.5 font-mono text-[13px] leading-relaxed text-muted-foreground">
          Personal access keys for the Solarch CLI and MCP server. Run{" "}
          <code className="rounded bg-muted px-1 py-0.5">solarch login</code> and paste a key —
          it authenticates as you. Keys are shown <strong>only once</strong> at creation.
        </p>

        {/* New key form */}
        <div className="mt-5 flex items-center gap-2">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") create();
            }}
            placeholder="Key name — e.g. 'laptop', 'CI pipeline'"
            maxLength={64}
            className="max-w-[320px]"
          />
          <Button
            onClick={create}
            disabled={!name.trim() || createKey.isPending}
            size="sm"
            className="gap-1.5"
          >
            <Plus size={13} />
            {createKey.isPending ? "Creating…" : "Create key"}
          </Button>
        </div>

        {/* Freshly created key, shown once */}
        {freshKey && (
          <div className="mt-4 rounded-md border border-emerald-500/40 bg-emerald-500/5 p-4">
            <p className="font-mono text-[12.5px] text-muted-foreground">
              Key <strong className="text-foreground">{freshKey.name}</strong> created. Copy it now —
              it will never be shown again.
            </p>
            <div className="mt-2 flex items-center gap-2">
              <code className="flex-1 truncate rounded bg-card border border-border px-2.5 py-1.5 font-mono text-[13px]">
                {freshKey.key}
              </code>
              <Button variant="outline" size="sm" onClick={copy} className="gap-1.5 shrink-0">
                {copied ? <Check size={13} className="text-emerald-600" /> : <Copy size={13} />}
                {copied ? "Copied" : "Copy"}
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setFreshKey(null)} className="shrink-0">
                Done
              </Button>
            </div>
          </div>
        )}

        {/* Existing keys */}
        <div className="mt-6 overflow-hidden rounded-md border border-border">
          {isLoading ? (
            <p className="p-4 font-mono text-[13px] text-muted-foreground">Loading…</p>
          ) : !keys || keys.length === 0 ? (
            <p className="p-4 font-mono text-[13px] text-muted-foreground">
              No API keys yet. Create one to use the CLI.
            </p>
          ) : (
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-border bg-muted/40 font-mono text-[11.5px] uppercase tracking-[0.06em] text-muted-foreground">
                  <th className="px-4 py-2 font-medium">Name</th>
                  <th className="px-4 py-2 font-medium">Key</th>
                  <th className="px-4 py-2 font-medium">Created</th>
                  <th className="px-4 py-2 font-medium">Last used</th>
                  <th className="px-2 py-2" />
                </tr>
              </thead>
              <tbody>
                {keys.map((k) => (
                  <tr key={k.id} className="border-b border-border last:border-0">
                    <td className="px-4 py-2.5 font-sans text-[14px]">{k.name}</td>
                    <td className="px-4 py-2.5 font-mono text-[13px] text-muted-foreground">{k.prefix}…</td>
                    <td className="px-4 py-2.5 font-mono text-[12.5px] text-muted-foreground">
                      {new Date(k.createdAt).toLocaleDateString()}
                    </td>
                    <td className="px-4 py-2.5 font-mono text-[12.5px] text-muted-foreground">
                      {k.lastUsedAt ? new Date(k.lastUsedAt).toLocaleString() : "never"}
                    </td>
                    <td className="px-2 py-2.5">
                      <Button
                        variant="ghost"
                        size="sm"
                        aria-label={`Revoke ${k.name}`}
                        onClick={() =>
                          deleteKey.mutate(k.id, {
                            onSuccess: () => toast.success(`Key "${k.name}" revoked`),
                            onError: (e) => toast.error(e.message),
                          })
                        }
                        className="text-muted-foreground hover:text-destructive"
                      >
                        <Trash2 size={13} />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>
    </div>
  );
}
