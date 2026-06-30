import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, unwrap } from "./client";

export interface ProjectSummary {
  id: string;
  name: string;
  description: string;
  status: "draft" | "active" | "archived";
  createdAt: string;
  updatedAt: string;
  counts: { nodes: number; edges: number };
}

export function useProjects() {
  return useQuery({
    queryKey: ["projects"],
    queryFn: async () => {
      // list endpoint returns { projects, total } → extract the projects array.
      const body = unwrap<{ projects: ProjectSummary[]; total: number }>(await api.GET("/api/v1/projects"));
      return body.projects;
    },
  });
}

export function useCreateProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (name: string) =>
      unwrap<ProjectSummary>(await api.POST("/api/v1/projects", { body: { name } as never })),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["projects"] }),
  });
}

export function useDeleteProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const res = await api.DELETE("/api/v1/projects/{projectId}", { params: { path: { projectId: id } } });
      if (res.error) throw new Error("Could not delete");
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["projects"] }),
  });
}
