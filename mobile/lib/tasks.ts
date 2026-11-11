import { useEffect, useState } from "react";
import { randomUUID } from "expo-crypto";
import { supabase, isAdmin, type Profile, type Project, type Task, type TaskPriority, type TaskStatus, type TaskType } from "./supabase";
import { dayLabel, timeOf } from "./format";

// Same labels and rules as src/components/chat/Projects.tsx
export const STATUSES: [TaskStatus, string][] = [
  ["todo", "To do"],
  ["in_progress", "In progress"],
  ["in_review", "In review"],
  ["done", "Done"],
];
export const statusLabel = Object.fromEntries(STATUSES) as Record<TaskStatus, string>;
export const statusColor: Record<TaskStatus, [string, string]> = {
  todo: ["#f1f1f1", "#444"],
  in_progress: ["#e8f5fa", "#0b4c8c"],
  in_review: ["#fff7e6", "#a15c00"],
  done: ["#e6f6ee", "#1d7a4c"],
};
export const PRIORITIES: { id: TaskPriority; label: string; icon: string; color: string }[] = [
  { id: "highest", label: "Highest", icon: "⏫", color: "#dc2626" },
  { id: "high", label: "High", icon: "🔼", color: "#f97316" },
  { id: "medium", label: "Medium", icon: "🟰", color: "#f59e0b" },
  { id: "low", label: "Low", icon: "🔽", color: "#1264a3" },
  { id: "lowest", label: "Lowest", icon: "⏬", color: "#38bdf8" },
];
export const priorityOf = (p: TaskPriority) => PRIORITIES.find((x) => x.id === p)!;
export const TYPES: { id: TaskType; label: string; icon: string }[] = [
  { id: "task", label: "Task", icon: "☑️" },
  { id: "bug", label: "Bug", icon: "🐞" },
  { id: "story", label: "Story", icon: "🔖" },
  { id: "epic", label: "Epic", icon: "⚡" },
];
export const typeOf = (t: TaskType) => TYPES.find((x) => x.id === t)!;

const pad = (n: number) => String(n).padStart(2, "0");
export const dateValue = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const today = () => dateValue(new Date());
export const dueLabel = (d: string) => new Date(`${d}T00:00`).toLocaleDateString([], { month: "short", day: "numeric" });
export const overdue = (t: Task) => !!t.due_date && t.status !== "done" && t.due_date < today();
export const when = (iso: string) => (dayLabel(iso) === "Today" ? timeOf(iso) : `${dayLabel(iso)} ${timeOf(iso)}`);

// A suggested key from a project name: initials of several words, or the start of one
export const suggestKey = (name: string) => {
  const words = name.toUpperCase().replace(/[^A-Z0-9 ]/g, " ").split(/\s+/).filter(Boolean);
  const k = words.length > 1 ? words.map((w) => w[0]).join("") : (words[0] ?? "");
  return k.replace(/^[0-9]+/, "").slice(0, words.length > 1 ? 5 : 4);
};

export const canManage = (me: Profile, project?: Project) => !!project && (isAdmin(me) || project.project_members.some((m) => m.user_id === me.id && m.role === "admin"));
export const writableProjects = (me: Profile, projects: Project[]) => projects.filter((p) => !p.archived && (isAdmin(me) || p.project_members.some((m) => m.user_id === me.id)));

// Keeps a list of tasks in sync with the database: inserts and updates matching `filter`, deletes by id
export function useLiveTasks(load: () => PromiseLike<{ data: unknown }>, filter: string | undefined, deps: unknown[]) {
  const [tasks, setTasks] = useState<Task[] | null>(null);
  useEffect(() => {
    let alive = true;
    const fetch = () =>
      load().then(({ data }) => {
        if (alive) setTasks((data as Task[]) ?? []);
      });
    fetch();
    const ch = supabase
      .channel(`tasks:${filter ?? "all"}:${randomUUID()}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "tasks", filter }, () => fetch())
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "tasks", filter }, () => fetch())
      .on("postgres_changes", { event: "DELETE", schema: "public", table: "tasks" }, ({ old }) => setTasks((ts) => ts?.filter((t) => t.id !== (old as Task).id) ?? ts))
      .subscribe();
    return () => {
      alive = false;
      supabase.removeChannel(ch);
    };
  }, deps); // eslint-disable-line react-hooks/exhaustive-deps
  return [tasks, setTasks] as const;
}
