/** Value-sets API — Solarch's shared enum / lookup catalog.
 *  Fetched from fieldHint.valueSet references in Inspector forms. */

import { useQuery } from "@tanstack/react-query";
import { api, unwrap } from "./client";

// openapi-fetch type layer doesn't know about value-sets endpoints yet
// (will be resolved once schema.d.ts is regenerated). Using any cast for now.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const apiAny = api as any;

export interface ValueOption {
  value: string;
  label?: string;
  description?: string;
  group?: string;
}

export interface ValueSet {
  id: string;
  label: string;
  description: string;
  values: ValueOption[];
}

export interface ValueSetSummary {
  id: string;
  label: string;
  description: string;
  count: number;
}

/** List of all value-sets (summary). Static — staleTime Infinity. */
export function useValueSets() {
  return useQuery({
    queryKey: ["value-sets"],
    staleTime: Infinity,
    queryFn: async () => {
      const body = unwrap<{ sets: ValueSetSummary[]; total: number }>(
        await apiAny.GET("/api/v1/value-sets"),
      );
      return body.sets;
    },
  });
}

/** Single value-set with all its values. */
export function useValueSet(id: string | null) {
  return useQuery({
    queryKey: ["value-set", id],
    enabled: !!id,
    staleTime: Infinity,
    queryFn: async () =>
      unwrap<ValueSet>(
        await apiAny.GET("/api/v1/value-sets/{id}", {
          params: { path: { id: id! } },
        }),
      ),
  });
}
