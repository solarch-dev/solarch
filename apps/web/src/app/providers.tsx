import {
  QueryClient,
  QueryClientProvider,
  MutationCache,
} from "@tanstack/react-query";
import type { ReactNode } from "react";
import { toast } from "sonner";
import { ApiError } from "../api/client";
import { ThemeController } from "./ThemeController";

const codeOf = (err: unknown): string | undefined =>
  err instanceof ApiError ? err.code : (err as { code?: string } | null)?.code;

function handleMutationError(err: unknown) {
  const code = codeOf(err);
  if (code === "ERR_VERSION_CONFLICT" || code === "ERR_EDGE_DUPLICATE") return;
  const message = err instanceof ApiError ? err.message : "An error occurred";
  const suggestion = err instanceof ApiError ? err.suggestion : undefined;
  const isRule = code === "ERR_RULES_DENIED" || code === "ERR_NOT_WHITELISTED" || /^ERR_(00[1-7]|COND_00[12])$/.test(code ?? "");
  if (isRule) toast.error(message, { description: suggestion });
  else toast.error("An error occurred", { description: message });
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 10_000,
      refetchOnWindowFocus: false,
      retry: (count, error) => {
        const c = codeOf(error);
        if (
          c === "ERR_NODE_NOT_FOUND" ||
          c === "ERR_PROJECT_NOT_FOUND" ||
          c === "ERR_PROJECT_FORBIDDEN"
        )
          return false;
        return count < 2;
      },
    },
  },
  mutationCache: new MutationCache({ onError: handleMutationError }),
});

export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeController />
      {children}
    </QueryClientProvider>
  );
}
