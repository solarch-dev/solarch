import { useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useProjects, useCreateProject } from "../../api/projects";

/** /start — auto-open the first project or create one, then go to canvas. */
export function Welcome() {
  const navigate = useNavigate();
  const { data: projects, isLoading } = useProjects();
  const createProject = useCreateProject();
  const started = useRef(false);

  useEffect(() => {
    if (isLoading || !projects || started.current) return;
    started.current = true;
    if (projects.length > 0) {
      navigate(`/p/${projects[0].id}`, { replace: true });
      return;
    }
    void createProject
      .mutateAsync("My architecture")
      .then((p) => navigate(`/p/${p.id}`, { replace: true }))
      .catch(() => {
        started.current = false;
      });
  }, [isLoading, projects, navigate, createProject]);

  return null;
}
