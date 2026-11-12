"use client";

import { useEffect, useMemo, useState } from "react";
import {
  supabase,
  displayName,
  isAdmin,
  type Project,
  type Task,
  type TaskActivity,
  type TaskComment,
  type TaskPriority,
  type TaskStatus,
  type TaskType,
} from "@/lib/supabase";
import { dayLabel, timeOf } from "@/lib/format";
import { Avatar, askText, CardSkeleton, Modal, Tabs, btn, btnGhost, input } from "../ui";
import { Icon, type IconName } from "../icons";
import { useChat } from "./store";
import { EmptyState, MobileBack, ViewShell } from "./Views";

// Jira-style projects and tasks; tables and rules in supabase/migrations/*_projects_tasks.sql

export const STATUSES: [TaskStatus, string][] = [
  ["todo", "To do"],
  ["in_progress", "In progress"],
  ["in_review", "In review"],
  ["done", "Done"],
];
const statusLabel = Object.fromEntries(STATUSES) as Record<TaskStatus, string>;
const statusStyle: Record<TaskStatus, string> = {
  todo: "bg-zinc-100 text-zinc-700",
  in_progress: "bg-tm-blue-light text-tm-blue-dark",
  in_review: "bg-amber-50 text-amber-700",
  done: "bg-tm-green-light text-green-700",
};

const PRIORITIES: { id: TaskPriority; label: string; icon: IconName; color: string }[] = [
  { id: "highest", label: "Highest", icon: "chevronsUp", color: "text-red-600" },
  { id: "high", label: "High", icon: "chevronUp", color: "text-orange-500" },
  { id: "medium", label: "Medium", icon: "equal", color: "text-amber-500" },
  { id: "low", label: "Low", icon: "chevronDown", color: "text-tm-blue" },
  { id: "lowest", label: "Lowest", icon: "chevronsDown", color: "text-sky-400" },
];
const priorityOf = (p: TaskPriority) => PRIORITIES.find((x) => x.id === p)!;
const priorityRank = Object.fromEntries(PRIORITIES.map((p, i) => [p.id, i])) as Record<TaskPriority, number>;

const TYPES: { id: TaskType; label: string; icon: IconName; bg: string }[] = [
  { id: "task", label: "Task", icon: "check", bg: "bg-tm-blue" },
  { id: "bug", label: "Bug", icon: "bug", bg: "bg-red-500" },
  { id: "story", label: "Story", icon: "bookmark", bg: "bg-tm-green" },
  { id: "epic", label: "Epic", icon: "zap", bg: "bg-purple-500" },
];
const typeOf = (t: TaskType) => TYPES.find((x) => x.id === t)!;

const pad = (n: number) => String(n).padStart(2, "0");
const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
const dueLabel = (d: string) => new Date(`${d}T00:00`).toLocaleDateString([], { month: "short", day: "numeric" });
const overdue = (t: Task) => !!t.due_date && t.status !== "done" && t.due_date < today();
const when = (iso: string) => (dayLabel(iso) === "Today" ? timeOf(iso) : `${dayLabel(iso)} ${timeOf(iso)}`);

// A suggested key from a project name: initials of several words, or the start of one
const suggestKey = (name: string) => {
  const words = name.toUpperCase().replace(/[^A-Z0-9 ]/g, " ").split(/\s+/).filter(Boolean);
  const k = words.length > 1 ? words.map((w) => w[0]).join("") : (words[0] ?? "");
  return k.replace(/^[0-9]+/, "").slice(0, words.length > 1 ? 5 : 4);
};

export const TypeIcon = ({ type, size = 16 }: { type: TaskType; size?: number }) => {
  const t = typeOf(type);
  return (
    <span title={t.label} className={`inline-flex shrink-0 items-center justify-center rounded text-white ${t.bg}`} style={{ width: size, height: size }}>
      <Icon name={t.icon} size={size * 0.7} />
    </span>
  );
};

const PriorityIcon = ({ priority, size = 16 }: { priority: TaskPriority; size?: number }) => {
  const p = priorityOf(priority);
  return (
    <span title={`${p.label} priority`} className={p.color}>
      <Icon name={p.icon} size={size} />
    </span>
  );
};

const KeyBadge = ({ project, size = 32 }: { project: Pick<Project, "key" | "name">; size?: number }) => (
  <span
    className="flex shrink-0 items-center justify-center rounded-lg bg-tm-blue font-bold text-white"
    style={{ width: size, height: size, fontSize: size * (project.key.length > 3 ? 0.28 : 0.34) }}
    title={project.name}
  >
    {project.key.slice(0, 4)}
  </span>
);

// Whether the user can change a project's settings and people
function useCanManage(project?: Project) {
  const { me } = useChat();
  return !!project && (isAdmin(me) || project.project_members.some((m) => m.user_id === me.id && m.role === "admin"));
}

// Chosen people as chips plus a name search over the company's active members
function PeoplePicker({ value, onChange, exclude = [] }: { value: string[]; onChange: (ids: string[]) => void; exclude?: string[] }) {
  const { profiles, members } = useChat();
  const [q, setQ] = useState("");
  const needle = q.trim().toLowerCase();
  const matches = needle
    ? Object.values(profiles)
        .filter((p) => members[p.id]?.status === "active" && !value.includes(p.id) && !exclude.includes(p.id))
        .filter((p) => `${displayName(p)} ${p.username}`.toLowerCase().includes(needle))
        .slice(0, 6)
    : [];
  return (
    <div>
      {value.length > 0 && (
        <div className="mb-1.5 flex flex-wrap gap-1.5">
          {value.map((id) => (
            <span key={id} className="flex items-center gap-1.5 rounded-full border border-tm-line bg-tm-surface py-0.5 pr-1 pl-0.5 text-sm">
              <Avatar profile={profiles[id]} size={20} />
              {displayName(profiles[id])}
              <button type="button" onClick={() => onChange(value.filter((x) => x !== id))} className="rounded-full p-0.5 text-zinc-400 hover:text-zinc-700" aria-label={`Remove ${displayName(profiles[id])}`}>
                <Icon name="x" size={12} />
              </button>
            </span>
          ))}
        </div>
      )}
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Add people by name" className={input} />
      {matches.length > 0 && (
        <div className="mt-1 space-y-0.5">
          {matches.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => {
                onChange([...value, p.id]);
                setQ("");
              }}
              className="flex w-full items-center gap-2.5 rounded-xl px-2 py-1.5 text-left text-sm transition hover:bg-tm-surface"
            >
              <Avatar profile={p} size={24} />
              <span className="flex-1 truncate">{displayName(p)}</span>
              <span className="text-xs text-zinc-400">@{p.username}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// Projects ------------------------------------------------------------------

export function CreateProject({ onClose }: { onClose: () => void }) {
  const { reloadProjects, openProject } = useChat();
  const [name, setName] = useState("");
  const [key, setKey] = useState("");
  const [keyEdited, setKeyEdited] = useState(false);
  const [description, setDescription] = useState("");
  const [people, setPeople] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const shownKey = keyEdited ? key : suggestKey(name);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const { data, error } = await supabase.rpc("create_project", { p_name: name.trim(), p_key: shownKey, p_description: description.trim(), p_members: people });
    if (error) {
      setError(error.message);
      return setBusy(false);
    }
    await reloadProjects();
    openProject(data);
    onClose();
  }

  return (
    <Modal title="Create a project" onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <div className="grid grid-cols-[1fr_7rem] gap-2">
          <label className="block text-sm font-medium">
            Name
            <input autoFocus required maxLength={80} value={name} onChange={(e) => setName(e.target.value)} placeholder="Website relaunch" className={`${input} mt-1.5`} />
          </label>
          <label className="block text-sm font-medium">
            Key
            <input
              required
              maxLength={10}
              value={shownKey}
              onChange={(e) => {
                setKeyEdited(true);
                setKey(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""));
              }}
              placeholder="WEB"
              className={`${input} mt-1.5 font-mono uppercase`}
            />
          </label>
        </div>
        <p className="-mt-2 text-xs text-zinc-500">Tasks are numbered with the key, like {shownKey || "WEB"}-1. It can&apos;t be changed later.</p>
        <textarea value={description} maxLength={2000} onChange={(e) => setDescription(e.target.value)} placeholder="What is this project about? (optional)" rows={3} className={`${input} resize-none`} />
        <div>
          <div className="mb-1.5 text-sm font-medium">People</div>
          <PeoplePicker value={people} onChange={setPeople} />
          <p className="mt-1.5 text-xs text-zinc-500">You&apos;ll be the project admin. Tasks can be assigned to anyone in the project.</p>
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" className={btnGhost} onClick={onClose}>
            Cancel
          </button>
          <button className={btn} disabled={busy || !name.trim() || shownKey.length < 2}>
            {busy ? "Creating…" : "Create project"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

export function ProjectsView() {
  const { projectId } = useChat();
  return projectId ? <ProjectBoard key={projectId} projectId={projectId} /> : <ProjectList />;
}

function ProjectList() {
  const { me, profiles, projects, openProject } = useChat();
  const [creating, setCreating] = useState(false);
  const [counts, setCounts] = useState<Record<string, { open: number; done: number; mine: number }>>({});
  const ids = projects.map((p) => p.id).join(",");

  useEffect(() => {
    if (!ids) return;
    supabase
      .from("tasks")
      .select("project_id,status,assignee_id")
      .in("project_id", ids.split(","))
      .then(({ data }) => {
        const next: Record<string, { open: number; done: number; mine: number }> = {};
        for (const t of data ?? []) {
          const c = (next[t.project_id] ??= { open: 0, done: 0, mine: 0 });
          if (t.status === "done") c.done++;
          else {
            c.open++;
            if (t.assignee_id === me.id) c.mine++;
          }
        }
        setCounts(next);
      });
  }, [ids, me.id]);

  const active = projects.filter((p) => !p.archived);
  const archived = projects.filter((p) => p.archived);

  const card = (p: Project) => {
    const c = counts[p.id] ?? { open: 0, done: 0, mine: 0 };
    const total = c.open + c.done;
    const inIt = p.project_members.some((m) => m.user_id === me.id);
    return (
      <button key={p.id} onClick={() => openProject(p.id)} className="tm-fade-up flex flex-col gap-3 rounded-2xl border border-tm-line bg-white p-4 text-left transition hover:-translate-y-px hover:border-tm-blue/30">
        <div className="flex items-center gap-3">
          <KeyBadge project={p} size={36} />
          <div className="min-w-0 flex-1">
            <div className="truncate text-[15px] font-semibold">{p.name}</div>
            <div className="truncate text-xs text-zinc-400">
              {p.key} · Lead: {p.lead_id ? displayName(profiles[p.lead_id]) : "none"}
              {!inIt && " · You're not in this project"}
            </div>
          </div>
        </div>
        {p.description && <p className="line-clamp-2 text-sm text-zinc-600">{p.description}</p>}
        <div>
          <div className="h-1.5 overflow-hidden rounded-full bg-tm-surface">
            <div className="h-full rounded-full bg-tm-green transition-all" style={{ width: `${total ? (c.done / total) * 100 : 0}%` }} />
          </div>
          <div className="mt-1.5 flex items-center gap-2 text-xs text-zinc-500">
            <span className="flex-1">
              {c.open} open · {c.done} done{c.mine ? ` · ${c.mine} assigned to you` : ""}
            </span>
            <span className="flex -space-x-1.5">
              {p.project_members.slice(0, 5).map((m) => (
                <span key={m.user_id} className="rounded-[30%] ring-2 ring-white">
                  <Avatar profile={profiles[m.user_id]} size={20} />
                </span>
              ))}
            </span>
            {p.project_members.length > 5 && <span>+{p.project_members.length - 5}</span>}
          </div>
        </div>
      </button>
    );
  };

  return (
    <ViewShell
      icon="folder"
      title="Projects"
      subtitle="Plan and track work with your team"
      action={
        me.role !== "guest" && (
          <button onClick={() => setCreating(true)} className={`${btn} flex items-center gap-1.5`}>
            <Icon name="plus" size={16} />
            <span className="hidden sm:inline">Create project</span>
          </button>
        )
      }
    >
      {projects.length === 0 && <EmptyState icon="folder" text="No projects yet. Create one, add your team and start assigning tasks." />}
      <div className="grid gap-2 lg:grid-cols-2">{active.map(card)}</div>
      {archived.length > 0 && <div className="pt-4 text-xs font-semibold tracking-wide text-zinc-400 uppercase">Archived</div>}
      <div className="grid gap-2 opacity-70 lg:grid-cols-2">{archived.map(card)}</div>
      {creating && <CreateProject onClose={() => setCreating(false)} />}
    </ViewShell>
  );
}

// Keeps a list of tasks in sync with the database: inserts and updates matching `filter`, deletes by id
function useLiveTasks(load: () => PromiseLike<{ data: unknown }>, filter: string | undefined, deps: unknown[]) {
  const [tasks, setTasks] = useState<Task[] | null>(null);
  useEffect(() => {
    let alive = true;
    const fetch = () =>
      load().then(({ data }) => {
        if (alive) setTasks((data as Task[]) ?? []);
      });
    fetch();
    const ch = supabase
      .channel(`tasks:${filter ?? "all"}:${crypto.randomUUID()}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "tasks", filter }, () => fetch())
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "tasks", filter }, () => fetch())
      .on("postgres_changes", { event: "DELETE", schema: "public", table: "tasks" }, ({ old }) =>
        setTasks((ts) => ts?.filter((t) => t.id !== (old as Task).id) ?? ts),
      )
      .subscribe();
    return () => {
      alive = false;
      supabase.removeChannel(ch);
    };
    // The caller lists what the query depends on
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return [tasks, setTasks] as const;
}

type Mode = "board" | "list";
// A task, with its project when shown outside that project's board
type TaskRow = Task & { projects?: Pick<Project, "key" | "name"> | null };

// Board or list, remembered per view in this browser
function useMode(storageKey: string, fallback: Mode) {
  const [mode, setModeState] = useState<Mode>(() => {
    try {
      const v = localStorage.getItem(storageKey);
      return v === "list" || v === "board" ? v : fallback;
    } catch {
      return fallback;
    }
  });
  const setMode = (m: Mode) => {
    setModeState(m);
    try {
      localStorage.setItem(storageKey, m);
    } catch {}
  };
  return [mode, setMode] as const;
}

function ModeToggle({ mode, onChange }: { mode: Mode; onChange: (m: Mode) => void }) {
  return (
    <span className="flex rounded-xl bg-tm-surface p-1">
      {(["board", "list"] as const).map((m) => (
        <button
          key={m}
          onClick={() => onChange(m)}
          title={m === "board" ? "Board" : "List"}
          aria-pressed={mode === m}
          className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-sm font-medium transition ${mode === m ? "tm-raised bg-white text-tm-blue" : "text-zinc-500 hover:text-zinc-800"}`}
        >
          <Icon name={m === "board" ? "kanban" : "list"} size={15} />
          <span className="hidden lg:inline">{m === "board" ? "Board" : "List"}</span>
        </button>
      ))}
    </span>
  );
}

function ProjectBoard({ projectId }: { projectId: string }) {
  const { me, profiles, projects, openProject, openTask } = useChat();
  const project = projects.find((p) => p.id === projectId)!;
  const canManage = useCanManage(project);
  const inProject = project.project_members.some((m) => m.user_id === me.id);
  const [tasks, setTasks] = useLiveTasks(() => supabase.from("tasks").select("*").eq("project_id", projectId).order("position"), `project_id=eq.${projectId}`, [projectId]);
  const [mode, setMode] = useMode("tm:board-mode", "board");
  const [q, setQ] = useState("");
  const [people, setPeople] = useState<string[]>([]);
  const [type, setType] = useState<TaskType | "">("");
  const [creating, setCreating] = useState<TaskStatus | null>(null);
  const [settings, setSettings] = useState(false);

  const needle = q.trim().toLowerCase();
  const shown = (tasks ?? []).filter(
    (t) =>
      (!needle || `${project.key}-${t.number} ${t.title} ${t.labels.join(" ")}`.toLowerCase().includes(needle)) &&
      (!people.length || people.includes(t.assignee_id ?? "none")) &&
      (!type || t.type === type),
  );
  const filtering = !!(needle || people.length || type);

  // Optimistic: the board moves the card at once and the database catches up
  const update = async (id: string, patch: Partial<Task>) => {
    setTasks((ts) => ts?.map((t) => (t.id === id ? { ...t, ...patch } : t)) ?? ts);
    const { error } = await supabase.from("tasks").update(patch).eq("id", id);
    if (error) alert(error.message);
  };
  const add = (t: Task) => setTasks((ts) => (ts?.some((x) => x.id === t.id) ? ts : [...(ts ?? []), t]));

  const toggle = (id: string) => setPeople(people.includes(id) ? people.filter((x) => x !== id) : [...people, id]);

  return (
    <>
      <header className="flex h-14 shrink-0 items-center gap-2 border-b border-tm-line px-3 md:px-6">
        <MobileBack onClick={() => openProject(null)} />
        <button onClick={() => openProject(null)} className="hidden text-sm text-zinc-500 transition hover:text-tm-blue md:inline">
          Projects
        </button>
        <span className="hidden text-zinc-300 md:inline">/</span>
        <KeyBadge project={project} size={24} />
        <span className="min-w-0 truncate text-lg font-semibold">{project.name}</span>
        {project.archived && <span className="shrink-0 rounded-md bg-zinc-100 px-1.5 py-0.5 text-xs text-zinc-500">Archived</span>}
        <span className="ml-auto flex shrink-0 items-center gap-1.5">
          <span className="hidden sm:flex">
            <ModeToggle mode={mode} onChange={setMode} />
          </span>
          <button onClick={() => setSettings(true)} title="Project settings and people" className="rounded-lg p-2 text-zinc-500 transition hover:bg-tm-surface hover:text-tm-blue">
            <Icon name={canManage ? "settings" : "users"} size={18} />
          </button>
          {(inProject || canManage) && !project.archived && (
            <button onClick={() => setCreating("todo")} className={`${btn} flex items-center gap-1.5`}>
              <Icon name="plus" size={16} />
              <span className="hidden sm:inline">Create</span>
            </button>
          )}
        </span>
      </header>

      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-tm-line px-3 py-2 md:px-6">
        <div className="flex w-full items-center gap-2 rounded-xl border border-tm-line bg-tm-surface px-3 py-1.5 sm:w-56">
          <Icon name="search" size={15} className="text-zinc-400" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search this board" className="min-w-0 flex-1 bg-transparent text-sm outline-none" />
        </div>
        <div className="flex items-center -space-x-1">
          {project.project_members.map((m) => (
            <button
              key={m.user_id}
              onClick={() => toggle(m.user_id)}
              title={displayName(profiles[m.user_id])}
              className={`rounded-[30%] ring-2 transition hover:z-10 hover:-translate-y-0.5 ${people.includes(m.user_id) ? "z-10 ring-tm-blue" : "ring-white"}`}
            >
              <Avatar profile={profiles[m.user_id]} size={28} />
            </button>
          ))}
          <button
            onClick={() => toggle("none")}
            title="Unassigned"
            className={`flex h-7 w-7 items-center justify-center rounded-[30%] bg-zinc-100 text-zinc-400 ring-2 transition hover:z-10 hover:-translate-y-0.5 ${people.includes("none") ? "z-10 ring-tm-blue" : "ring-white"}`}
          >
            <Icon name="users" size={14} />
          </button>
        </div>
        <button
          onClick={() => setPeople(people.length === 1 && people[0] === me.id ? [] : [me.id])}
          className={`rounded-lg px-2.5 py-1 text-sm transition ${people.length === 1 && people[0] === me.id ? "bg-tm-blue-light font-medium text-tm-blue" : "text-zinc-600 hover:bg-tm-surface"}`}
        >
          Only my tasks
        </button>
        <select value={type} onChange={(e) => setType(e.target.value as TaskType | "")} className="rounded-lg bg-transparent px-1.5 py-1 text-sm text-zinc-600 outline-none hover:bg-tm-surface">
          <option value="">All types</option>
          {TYPES.map((t) => (
            <option key={t.id} value={t.id}>
              {t.label}
            </option>
          ))}
        </select>
        {filtering && (
          <button
            onClick={() => {
              setQ("");
              setPeople([]);
              setType("");
            }}
            className="text-sm text-zinc-400 transition hover:text-zinc-700"
          >
            Clear filters
          </button>
        )}
      </div>

      {!tasks ? (
        <div className="p-3 md:p-6">
          <CardSkeleton />
        </div>
      ) : mode === "board" ? (
        <Board project={project} tasks={shown} all={tasks} canAdd={(inProject || canManage) && !project.archived} onMove={update} onAdded={add} />
      ) : (
        <TaskTable project={project} tasks={shown} onUpdate={update} onOpen={openTask} />
      )}

      {creating && <CreateTask projectId={projectId} status={creating} onClose={() => setCreating(null)} onCreated={add} />}
      {settings && <ProjectSettings project={project} onClose={() => setSettings(false)} />}
    </>
  );
}

// Without a project (My tasks) the board spans projects: dragging changes the status only, since
// positions order cards within one project's columns
function Board({
  project,
  tasks,
  all,
  canAdd,
  onMove,
  onAdded,
  className = "flex min-h-0 flex-1 gap-3 overflow-x-auto p-3 md:p-4",
}: {
  project?: Project;
  tasks: TaskRow[];
  all: TaskRow[];
  canAdd: boolean;
  onMove: (id: string, patch: Partial<Task>) => void;
  onAdded?: (t: Task) => void;
  className?: string;
}) {
  const [drag, setDrag] = useState<string | null>(null);
  // Where the dragged card would land: before a card, or at the end of a column (before = null)
  const [over, setOver] = useState<{ status: TaskStatus; before: string | null } | null>(null);

  // Across projects the cards keep the order they came in (most recently updated first)
  const column = (s: TaskStatus) => {
    const col = tasks.filter((t) => t.status === s);
    return project ? col.sort((a, b) => a.position - b.position) : col;
  };

  const drop = () => {
    const task = all.find((t) => t.id === drag);
    if (task && over && !project) {
      if (task.status !== over.status) onMove(task.id, { status: over.status });
    } else if (task && over) {
      // Position between the neighbours in the full column, so hidden (filtered) cards keep their order
      const col = all.filter((t) => t.status === over.status && t.id !== task.id).sort((a, b) => a.position - b.position);
      const i = over.before ? col.findIndex((t) => t.id === over.before) : col.length;
      const prev = col[i - 1];
      const next = col[i];
      const position = prev && next ? (prev.position + next.position) / 2 : next ? next.position - 1 : prev ? prev.position + 1 : Date.now() / 1000;
      if (task.status !== over.status || position !== task.position) onMove(task.id, { status: over.status, position });
    }
    setDrag(null);
    setOver(null);
  };

  return (
    <div className={className}>
      {STATUSES.map(([s, label]) => {
        const items = column(s);
        const target = drag && over?.status === s;
        return (
          <section
            key={s}
            onDragOver={(e) => {
              if (!drag) return;
              e.preventDefault();
              // Cards stop the event, so this is the empty space below them: the end of the column
              if (over?.status !== s || over.before !== null) setOver({ status: s, before: null });
            }}
            onDrop={(e) => {
              e.preventDefault();
              drop();
            }}
            className={`flex w-[17rem] shrink-0 flex-col rounded-2xl transition md:w-72 ${target ? "bg-tm-blue-light/70" : "bg-tm-surface"}`}
          >
            <div className="flex items-center gap-2 px-3 pt-3 pb-2">
              <span className="text-xs font-semibold tracking-wide text-zinc-500 uppercase">{label}</span>
              <span className="rounded-full bg-white px-1.5 text-xs font-semibold text-zinc-500">{items.length}</span>
              {s === "done" && <Icon name="check" size={14} className="text-tm-green" />}
            </div>
            <div className="flex-1 space-y-2 overflow-y-auto px-2 pb-2">
              {items.map((t) => (
                <div
                  key={t.id}
                  onDragOver={(e) => {
                    if (!drag) return;
                    e.preventDefault();
                    e.stopPropagation();
                    const r = e.currentTarget.getBoundingClientRect();
                    const before = e.clientY < r.top + r.height / 2 ? t.id : (items[items.indexOf(t) + 1]?.id ?? null);
                    if (over?.status !== s || over.before !== before) setOver({ status: s, before });
                  }}
                >
                  {project && target && over?.before === t.id && drag !== t.id && <div className="mb-2 h-0.5 rounded-full bg-tm-blue" />}
                  <TaskCard project={project} task={t} dragging={drag === t.id} onDragStart={() => setDrag(t.id)} onDragEnd={() => (setDrag(null), setOver(null))} />
                </div>
              ))}
              {project && target && over?.before === null && <div className="h-0.5 rounded-full bg-tm-blue" />}
              {items.length === 0 && !drag && <p className="px-2 py-6 text-center text-xs text-zinc-400">No tasks</p>}
            </div>
            {canAdd && project && onAdded && <QuickAdd project={project} status={s} after={all.filter((t) => t.status === s)} onAdded={onAdded} />}
          </section>
        );
      })}
    </div>
  );
}

function TaskCard({ project, task, dragging, onDragStart, onDragEnd }: { project?: Project; task: TaskRow; dragging: boolean; onDragStart: () => void; onDragEnd: () => void }) {
  const { profiles, openTask } = useChat();
  const late = overdue(task);
  const key = project?.key ?? task.projects?.key ?? "";
  return (
    <button
      draggable
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", task.id);
        onDragStart();
      }}
      onDragEnd={onDragEnd}
      onClick={() => openTask(task.id)}
      className={`tm-raised block w-full rounded-xl bg-white p-3 text-left transition hover:ring-2 hover:ring-tm-blue/20 ${dragging ? "opacity-40" : ""}`}
    >
      <div className={`line-clamp-3 text-sm ${task.status === "done" ? "text-zinc-500" : "text-zinc-900"}`}>{task.title}</div>
      {!project && task.projects && <div className="mt-0.5 truncate text-xs text-zinc-400">{task.projects.name}</div>}
      {task.labels.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {task.labels.slice(0, 3).map((l) => (
            <span key={l} className="rounded bg-tm-blue-light px-1.5 py-px text-[11px] font-medium text-tm-blue-dark">
              {l}
            </span>
          ))}
        </div>
      )}
      <div className="mt-2.5 flex items-center gap-1.5">
        <TypeIcon type={task.type} />
        <span className={`text-xs font-medium text-zinc-500 ${task.status === "done" ? "line-through" : ""}`}>
          {key}-{task.number}
        </span>
        {task.due_date && (
          <span className={`flex items-center gap-0.5 rounded px-1 text-[11px] ${late ? "bg-red-50 font-semibold text-red-600" : "text-zinc-500"}`} title={late ? "Overdue" : "Due date"}>
            <Icon name="calendar" size={11} />
            {dueLabel(task.due_date)}
          </span>
        )}
        <span className="ml-auto flex items-center gap-1.5">
          <PriorityIcon priority={task.priority} />
          {task.assignee_id ? (
            <span title={displayName(profiles[task.assignee_id])}>
              <Avatar profile={profiles[task.assignee_id]} size={22} />
            </span>
          ) : (
            <span title="Unassigned" className="flex h-[22px] w-[22px] items-center justify-center rounded-[30%] border border-dashed border-zinc-300 text-zinc-300">
              <Icon name="users" size={11} />
            </span>
          )}
        </span>
      </div>
    </button>
  );
}

// "+ Create" at the foot of a column: type a title, Enter adds it to the end of the column
function QuickAdd({ project, status, after, onAdded }: { project: Project; status: TaskStatus; after: Task[]; onAdded: (t: Task) => void }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!title.trim()) return setOpen(false);
    setBusy(true);
    const position = Math.max(Date.now() / 1000, ...after.map((t) => t.position + 1));
    const { data, error } = await supabase.from("tasks").insert({ project_id: project.id, title: title.trim(), status, position }).select().single();
    setBusy(false);
    if (error) return alert(error.message);
    onAdded(data as Task);
    setTitle("");
  }

  if (!open)
    return (
      <button onClick={() => setOpen(true)} className="m-2 mt-0 flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-left text-sm text-zinc-500 transition hover:bg-white hover:text-zinc-800">
        <Icon name="plus" size={15} />
        Create
      </button>
    );
  return (
    <div className="m-2 mt-0">
      <textarea
        autoFocus
        rows={2}
        value={title}
        disabled={busy}
        maxLength={300}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            submit();
          }
          if (e.key === "Escape") setOpen(false);
        }}
        onBlur={() => !title.trim() && setOpen(false)}
        placeholder="What needs to be done?"
        className="w-full resize-none rounded-xl border border-tm-blue/40 bg-white px-3 py-2 text-sm outline-none ring-4 ring-tm-blue/10"
      />
      <p className="px-1 text-[11px] text-zinc-400">Enter to create · Esc to cancel</p>
    </div>
  );
}

type SortKey = "key" | "title" | "status" | "priority" | "assignee" | "due_date" | "updated_at";

function TaskTable({
  project,
  tasks,
  onUpdate,
  onOpen,
  className = "min-h-0 flex-1 overflow-auto p-3 md:p-4",
}: {
  project?: Project;
  tasks: TaskRow[];
  onUpdate: (id: string, patch: Partial<Task>) => void;
  onOpen: (id: string) => void;
  className?: string;
}) {
  const { profiles } = useChat();
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: "key", desc: true });
  const statusRank = Object.fromEntries(STATUSES.map(([s], i) => [s, i]));
  const keyOf = (t: (typeof tasks)[number]) => `${project?.key ?? t.projects?.key ?? ""}-${t.number}`;
  const value = (t: Task): string | number => {
    switch (sort.key) {
      case "key":
        return t.number;
      case "status":
        return statusRank[t.status];
      case "priority":
        return -priorityRank[t.priority];
      case "assignee":
        return t.assignee_id ? displayName(profiles[t.assignee_id]).toLowerCase() : "~";
      case "due_date":
        return t.due_date ?? "9999";
      default:
        return (t[sort.key] as string).toLowerCase?.() ?? "";
    }
  };
  const rows = [...tasks].sort((a, b) => {
    const x = value(a);
    const y = value(b);
    return (x < y ? -1 : x > y ? 1 : 0) * (sort.desc ? -1 : 1);
  });
  const th = (key: SortKey, label: string, className = "") => (
    <th className={`px-2 py-2 text-left font-semibold ${className}`}>
      <button onClick={() => setSort({ key, desc: sort.key === key ? !sort.desc : key === "updated_at" })} className="flex items-center gap-1 hover:text-zinc-800">
        {label}
        {sort.key === key && <Icon name={sort.desc ? "chevronDown" : "chevronUp"} size={12} />}
      </button>
    </th>
  );

  if (!tasks.length) return <EmptyState icon="checkSquare" text="No tasks match." />;
  return (
    <div className={className}>
      <table className="w-full min-w-[46rem] text-sm">
        <thead className="text-xs text-zinc-500">
          <tr className="border-b border-tm-line">
            {th("key", "Key", "w-24")}
            {th("title", "Summary")}
            {th("status", "Status", "w-36")}
            {th("priority", "Priority", "w-24")}
            {th("assignee", "Assignee", "w-44")}
            {th("due_date", "Due", "w-24")}
            {th("updated_at", "Updated", "w-28")}
          </tr>
        </thead>
        <tbody>
          {rows.map((t) => (
            <tr key={t.id} className="group border-b border-tm-line/70 transition hover:bg-tm-surface">
              <td className="px-2 py-2">
                <span className="flex items-center gap-1.5">
                  <TypeIcon type={t.type} />
                  <span className={`text-xs font-medium whitespace-nowrap text-zinc-500 ${t.status === "done" ? "line-through" : ""}`}>{keyOf(t)}</span>
                </span>
              </td>
              <td className="px-2 py-2">
                <button onClick={() => onOpen(t.id)} className="line-clamp-1 text-left font-medium text-zinc-900 hover:text-tm-blue hover:underline">
                  {t.title}
                </button>
                {!project && t.projects && <span className="text-xs text-zinc-400">{t.projects.name}</span>}
              </td>
              <td className="px-2 py-2">
                <select value={t.status} onChange={(e) => onUpdate(t.id, { status: e.target.value as TaskStatus })} className={`rounded-md px-1.5 py-0.5 text-[11px] font-bold tracking-wide uppercase outline-none ${statusStyle[t.status]}`}>
                  {STATUSES.map(([s, l]) => (
                    <option key={s} value={s}>
                      {l}
                    </option>
                  ))}
                </select>
              </td>
              <td className="px-2 py-2">
                <span className="flex items-center gap-1 text-zinc-600">
                  <PriorityIcon priority={t.priority} />
                  {priorityOf(t.priority).label}
                </span>
              </td>
              <td className="px-2 py-2">
                {t.assignee_id ? (
                  <span className="flex items-center gap-1.5">
                    <Avatar profile={profiles[t.assignee_id]} size={20} />
                    <span className="truncate">{displayName(profiles[t.assignee_id])}</span>
                  </span>
                ) : (
                  <span className="text-zinc-400">Unassigned</span>
                )}
              </td>
              <td className={`px-2 py-2 whitespace-nowrap ${overdue(t) ? "font-semibold text-red-600" : "text-zinc-600"}`}>{t.due_date ? dueLabel(t.due_date) : ""}</td>
              <td className="px-2 py-2 whitespace-nowrap text-zinc-500">{dayLabel(t.updated_at)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// Tasks ---------------------------------------------------------------------

// Projects this user can add tasks to
function useWritableProjects() {
  const { me, projects } = useChat();
  return projects.filter((p) => !p.archived && (isAdmin(me) || p.project_members.some((m) => m.user_id === me.id)));
}

export function CreateTask({ projectId, status = "todo", onClose, onCreated }: { projectId?: string; status?: TaskStatus; onClose: () => void; onCreated?: (t: Task) => void }) {
  const { me, profiles, projects, openTask } = useChat();
  const writable = useWritableProjects();
  const [pid, setPid] = useState(projectId ?? writable[0]?.id ?? "");
  const project = projects.find((p) => p.id === pid);
  const [title, setTitle] = useState("");
  const [type, setType] = useState<TaskType>("task");
  const [priority, setPriority] = useState<TaskPriority>("medium");
  const [assignee, setAssignee] = useState("");
  const [due, setDue] = useState("");
  const [description, setDescription] = useState("");
  const [another, setAnother] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const inProject = (id: string) => !!project?.project_members.some((m) => m.user_id === id);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!project) return setError("Pick a project");
    setBusy(true);
    setError("");
    const { data, error } = await supabase
      .from("tasks")
      .insert({
        project_id: project.id,
        title: title.trim(),
        type,
        priority,
        status,
        assignee_id: assignee && inProject(assignee) ? assignee : null,
        due_date: due || null,
        description: description.trim(),
      })
      .select()
      .single();
    setBusy(false);
    if (error) return setError(error.message);
    onCreated?.(data as Task);
    if (another) {
      setTitle("");
      setDescription("");
      return;
    }
    onClose();
    if (!projectId) openTask((data as Task).id);
  }

  if (!writable.length)
    return (
      <Modal title="Create a task" onClose={onClose}>
        <p className="text-sm text-zinc-600">You&apos;re not in any projects yet. Create a project or ask a project admin to add you.</p>
      </Modal>
    );

  return (
    <Modal title="Create a task" onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <div className="grid grid-cols-2 gap-2">
          <label className="block text-sm font-medium">
            Project
            <select value={pid} disabled={!!projectId} onChange={(e) => setPid(e.target.value)} className={`${input} mt-1.5`}>
              {writable.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} ({p.key})
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm font-medium">
            Type
            <select value={type} onChange={(e) => setType(e.target.value as TaskType)} className={`${input} mt-1.5`}>
              {TYPES.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label className="block text-sm font-medium">
          Summary
          <input autoFocus required maxLength={300} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="What needs to be done?" className={`${input} mt-1.5`} />
        </label>
        <textarea value={description} maxLength={20000} onChange={(e) => setDescription(e.target.value)} placeholder="Description (optional)" rows={4} className={`${input} resize-y`} />
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          <label className="col-span-2 block text-sm font-medium sm:col-span-1">
            Assignee
            <select value={inProject(assignee) ? assignee : ""} onChange={(e) => setAssignee(e.target.value)} className={`${input} mt-1.5`}>
              <option value="">Unassigned</option>
              {project?.project_members.map((m) => (
                <option key={m.user_id} value={m.user_id}>
                  {displayName(profiles[m.user_id])}
                  {m.user_id === me.id ? " (you)" : ""}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm font-medium">
            Priority
            <select value={priority} onChange={(e) => setPriority(e.target.value as TaskPriority)} className={`${input} mt-1.5`}>
              {PRIORITIES.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm font-medium">
            Due date
            <input type="date" value={due} onChange={(e) => setDue(e.target.value)} className={`${input} mt-1.5`} />
          </label>
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <div className="flex items-center gap-2">
          <label className="flex flex-1 items-center gap-2 text-sm text-zinc-600">
            <input type="checkbox" checked={another} onChange={(e) => setAnother(e.target.checked)} />
            Create another
          </label>
          <button type="button" className={btnGhost} onClick={onClose}>
            Cancel
          </button>
          <button className={btn} disabled={busy || !title.trim() || !project}>
            {busy ? "Creating…" : "Create"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

type TaskWithProject = Task & { projects: Project | null };

// The task dialog: opened from a board, a list, My tasks, a toast or a ?task= link
export function TaskDialog() {
  const { me, profiles, taskId, openTask, openProject, notifications, markNotificationsRead } = useChat();
  const [task, setTask] = useState<TaskWithProject | null | undefined>(undefined);
  // Opening a task reads its notifications, however it was opened (Activity, toast, push or link)
  const unreadHere = notifications.filter((n) => n.task_id === taskId && !n.read_at).map((n) => n.id).join(",");
  useEffect(() => {
    if (unreadHere) markNotificationsRead(unreadHere.split(","));
  }, [unreadHere, markNotificationsRead]);
  const [comments, setComments] = useState<TaskComment[]>([]);
  const [activity, setActivity] = useState<TaskActivity[]>([]);
  const [tab, setTab] = useState<"comments" | "history">("comments");
  const [copied, setCopied] = useState(false);
  const id = taskId!;

  useEffect(() => {
    const loadTask = () =>
      supabase
        .from("tasks")
        .select("*, projects(*, project_members(*))")
        .eq("id", id)
        .maybeSingle()
        .then(({ data }) => setTask((data as TaskWithProject) ?? null));
    const loadComments = () =>
      supabase
        .from("task_comments")
        .select("*")
        .eq("task_id", id)
        .order("created_at")
        .then(({ data }) => setComments((data as TaskComment[]) ?? []));
    const loadActivity = () =>
      supabase
        .from("task_activity")
        .select("*")
        .eq("task_id", id)
        .order("created_at", { ascending: false })
        .then(({ data }) => setActivity((data as TaskActivity[]) ?? []));
    loadTask();
    loadComments();
    loadActivity();
    const ch = supabase
      .channel(`task:${id}`)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "tasks", filter: `id=eq.${id}` }, () => loadTask())
      .on("postgres_changes", { event: "DELETE", schema: "public", table: "tasks" }, ({ old }) => (old as Task).id === id && setTask(null))
      .on("postgres_changes", { event: "*", schema: "public", table: "task_comments", filter: `task_id=eq.${id}` }, () => loadComments())
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "task_activity", filter: `task_id=eq.${id}` }, () => loadActivity())
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [id]);

  const close = () => openTask(null);
  const project = task?.projects ?? undefined;
  const canManage = useCanManage(project);

  if (task === undefined)
    return (
      <Modal title="Loading…" onClose={close} wide="xl">
        <CardSkeleton count={2} />
      </Modal>
    );
  if (!task || !project)
    return (
      <Modal title="Task not found" onClose={close}>
        <p className="text-sm text-zinc-600">This task was deleted, or you&apos;re not in its project.</p>
      </Modal>
    );

  const key = `${project.key}-${task.number}`;
  const members = project.project_members;
  const canDelete = canManage || task.reporter_id === me.id;

  const save = async (patch: Partial<Task>) => {
    setTask((t) => (t ? { ...t, ...patch } : t));
    const { error } = await supabase.from("tasks").update(patch).eq("id", task.id);
    if (error) alert(error.message);
  };
  const remove = async () => {
    if (!confirm(`Delete ${key}? Its comments and history are deleted too.`)) return;
    const { error } = await supabase.from("tasks").delete().eq("id", task.id);
    if (error) alert(error.message);
    else close();
  };
  const copyLink = () => {
    navigator.clipboard.writeText(`${location.origin}/app?task=${task.id}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <Modal
      wide="xl"
      onClose={close}
      title={
        <span className="flex items-center gap-2 text-sm font-medium text-zinc-500">
          <button
            onClick={() => {
              openProject(project.id);
              close();
            }}
            className="hover:text-tm-blue hover:underline"
          >
            {project.name}
          </button>
          <span className="text-zinc-300">/</span>
          <TypeIcon type={task.type} />
          {key}
        </span>
      }
    >
      <div className="grid gap-6 md:grid-cols-[1fr_15rem]">
        <div className="min-w-0 space-y-4">
          <EditableTitle value={task.title} onSave={(title) => save({ title })} />
          <EditableDescription value={task.description} onSave={(description) => save({ description })} />
          <div>
            <Tabs
              tabs={[
                ["comments", `Comments${comments.length ? ` (${comments.length})` : ""}`],
                ["history", "History"],
              ]}
              value={tab}
              onChange={setTab}
            />
            {tab === "comments" ? <Comments taskId={task.id} comments={comments} canModerate={canManage} /> : <History activity={activity} />}
          </div>
        </div>

        <aside className="space-y-3 md:border-l md:border-tm-line md:pl-5">
          <select value={task.status} onChange={(e) => save({ status: e.target.value as TaskStatus })} className={`w-full rounded-xl px-3 py-2 text-sm font-bold tracking-wide uppercase outline-none ${statusStyle[task.status]}`}>
            {STATUSES.map(([s, l]) => (
              <option key={s} value={s}>
                {l}
              </option>
            ))}
          </select>
          <Field label="Assignee">
            <div className="flex items-center gap-2">
              <Avatar profile={task.assignee_id ? profiles[task.assignee_id] : undefined} size={24} />
              <select value={task.assignee_id ?? ""} onChange={(e) => save({ assignee_id: e.target.value || null })} className="min-w-0 flex-1 rounded-lg bg-transparent py-1 text-sm outline-none hover:bg-tm-surface">
                <option value="">Unassigned</option>
                {members.map((m) => (
                  <option key={m.user_id} value={m.user_id}>
                    {displayName(profiles[m.user_id])}
                  </option>
                ))}
              </select>
            </div>
            {task.assignee_id !== me.id && members.some((m) => m.user_id === me.id) && (
              <button onClick={() => save({ assignee_id: me.id })} className="mt-0.5 text-xs text-tm-blue hover:underline">
                Assign to me
              </button>
            )}
          </Field>
          <Field label="Reporter">
            <span className="flex items-center gap-2 text-sm">
              <Avatar profile={task.reporter_id ? profiles[task.reporter_id] : undefined} size={24} />
              {task.reporter_id ? displayName(profiles[task.reporter_id]) : "Unknown"}
            </span>
          </Field>
          <Field label="Priority">
            <div className="flex items-center gap-2">
              <PriorityIcon priority={task.priority} />
              <select value={task.priority} onChange={(e) => save({ priority: e.target.value as TaskPriority })} className="min-w-0 flex-1 rounded-lg bg-transparent py-1 text-sm outline-none hover:bg-tm-surface">
                {PRIORITIES.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </select>
            </div>
          </Field>
          <Field label="Type">
            <div className="flex items-center gap-2">
              <TypeIcon type={task.type} />
              <select value={task.type} onChange={(e) => save({ type: e.target.value as TaskType })} className="min-w-0 flex-1 rounded-lg bg-transparent py-1 text-sm outline-none hover:bg-tm-surface">
                {TYPES.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.label}
                  </option>
                ))}
              </select>
            </div>
          </Field>
          <Field label="Due date">
            <input
              type="date"
              value={task.due_date ?? ""}
              onChange={(e) => save({ due_date: e.target.value || null })}
              className={`w-full rounded-lg bg-transparent py-1 text-sm outline-none hover:bg-tm-surface ${overdue(task) ? "font-semibold text-red-600" : ""}`}
            />
          </Field>
          <Field label="Story points">
            <input
              type="number"
              min={0}
              step={0.5}
              defaultValue={task.estimate ?? ""}
              key={task.estimate ?? "none"}
              onBlur={(e) => {
                const v = e.target.value === "" ? null : Number(e.target.value);
                if (v !== task.estimate) save({ estimate: v });
              }}
              placeholder="None"
              className="w-full rounded-lg bg-transparent py-1 text-sm outline-none hover:bg-tm-surface"
            />
          </Field>
          <Field label="Labels">
            <Labels value={task.labels} onChange={(labels) => save({ labels })} />
          </Field>
          <div className="space-y-0.5 border-t border-tm-line pt-3 text-xs text-zinc-400">
            <div>Created {when(task.created_at)}</div>
            <div>Updated {when(task.updated_at)}</div>
            {task.completed_at && <div>Done {when(task.completed_at)}</div>}
          </div>
          <div className="flex flex-wrap gap-1.5">
            <button onClick={copyLink} className={`${btnGhost} flex items-center gap-1.5 !px-3 !py-1.5 text-xs`}>
              <Icon name={copied ? "check" : "link"} size={13} />
              {copied ? "Copied" : "Copy link"}
            </button>
            {canDelete && (
              <button onClick={remove} className={`${btnGhost} flex items-center gap-1.5 !px-3 !py-1.5 text-xs text-red-600 hover:!bg-red-50`}>
                <Icon name="trash" size={13} />
                Delete
              </button>
            )}
          </div>
        </aside>
      </div>
    </Modal>
  );
}

const Field = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div>
    <div className="mb-0.5 text-xs font-semibold text-zinc-500">{label}</div>
    {children}
  </div>
);

function EditableTitle({ value, onSave }: { value: string; onSave: (v: string) => void }) {
  const [draft, setDraft] = useState(value);
  const [prev, setPrev] = useState(value);
  // Follow changes others make while not editing
  if (value !== prev) {
    setPrev(value);
    setDraft(value);
  }
  const commit = () => {
    const v = draft.trim();
    if (!v) return setDraft(value);
    if (v !== value) onSave(v);
  };
  return (
    <textarea
      value={draft}
      rows={1}
      maxLength={300}
      onChange={(e) => setDraft(e.target.value.replace(/\n/g, ""))}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          (e.target as HTMLTextAreaElement).blur();
        }
        if (e.key === "Escape") {
          e.stopPropagation();
          setDraft(value);
        }
      }}
      className="field-sizing-content w-full resize-none rounded-lg px-1.5 py-1 -mx-1.5 text-xl font-semibold text-zinc-900 outline-none hover:bg-tm-surface focus:bg-tm-surface focus:ring-2 focus:ring-tm-blue/20"
    />
  );
}

function EditableDescription({ value, onSave }: { value: string; onSave: (v: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  return (
    <div>
      <div className="mb-1 text-sm font-semibold text-zinc-700">Description</div>
      {editing ? (
        <>
          <textarea
            autoFocus
            value={draft}
            maxLength={20000}
            rows={6}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => e.key === "Escape" && (e.stopPropagation(), setEditing(false))}
            className={`${input} resize-y`}
          />
          <div className="mt-2 flex gap-2">
            <button
              className={`${btn} !py-1.5`}
              onClick={() => {
                if (draft.trim() !== value) onSave(draft.trim());
                setEditing(false);
              }}
            >
              Save
            </button>
            <button className={`${btnGhost} !py-1.5`} onClick={() => setEditing(false)}>
              Cancel
            </button>
          </div>
        </>
      ) : (
        <button
          onClick={() => {
            setDraft(value);
            setEditing(true);
          }}
          className="block min-h-[3rem] w-full rounded-lg px-1.5 py-1 -mx-1.5 text-left text-sm whitespace-pre-wrap text-zinc-700 transition hover:bg-tm-surface"
        >
          {value || <span className="text-zinc-400">Add a description…</span>}
        </button>
      )}
    </div>
  );
}

function Labels({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  const [draft, setDraft] = useState("");
  const add = () => {
    const l = draft.trim().toLowerCase();
    if (l && !value.includes(l)) onChange([...value, l]);
    setDraft("");
  };
  return (
    <div className="flex flex-wrap items-center gap-1">
      {value.map((l) => (
        <span key={l} className="flex items-center gap-0.5 rounded bg-tm-blue-light py-px pr-0.5 pl-1.5 text-xs font-medium text-tm-blue-dark">
          {l}
          <button onClick={() => onChange(value.filter((x) => x !== l))} className="rounded p-0.5 hover:bg-white/60" aria-label={`Remove label ${l}`}>
            <Icon name="x" size={10} />
          </button>
        </span>
      ))}
      <input
        value={draft}
        maxLength={30}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === ",") {
            e.preventDefault();
            add();
          }
        }}
        onBlur={add}
        placeholder={value.length ? "+" : "Add a label"}
        className="min-w-16 flex-1 rounded-lg bg-transparent py-1 text-sm outline-none hover:bg-tm-surface"
      />
    </div>
  );
}

function Comments({ taskId, comments, canModerate }: { taskId: string; comments: TaskComment[]; canModerate: boolean }) {
  const { me, profiles } = useChat();
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<{ id: string; body: string } | null>(null);

  async function post() {
    if (!body.trim()) return;
    setBusy(true);
    const { error } = await supabase.from("task_comments").insert({ task_id: taskId, body: body.trim() });
    setBusy(false);
    if (error) return alert(error.message);
    setBody("");
  }
  const saveEdit = async () => {
    if (!editing?.body.trim()) return;
    const { error } = await supabase.from("task_comments").update({ body: editing.body.trim() }).eq("id", editing.id);
    if (error) alert(error.message);
    setEditing(null);
  };
  const remove = async (id: string) => {
    if (!confirm("Delete this comment?")) return;
    const { error } = await supabase.from("task_comments").delete().eq("id", id);
    if (error) alert(error.message);
  };

  return (
    <div className="space-y-4">
      <div className="flex gap-2.5">
        <Avatar profile={me} size={30} />
        <div className="flex-1">
          <textarea
            value={body}
            rows={2}
            maxLength={10000}
            onChange={(e) => setBody(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) post();
            }}
            placeholder="Add a comment…"
            className={`${input} resize-y`}
          />
          {body.trim() && (
            <div className="mt-1.5 flex items-center gap-2">
              <button onClick={post} disabled={busy} className={`${btn} !py-1.5`}>
                Comment
              </button>
              <span className="text-xs text-zinc-400">Ctrl + Enter</span>
            </div>
          )}
        </div>
      </div>
      {[...comments].reverse().map((c) => (
        <div key={c.id} className="group flex gap-2.5">
          <Avatar profile={profiles[c.user_id]} size={30} />
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline gap-2 text-sm">
              <span className="font-semibold">{displayName(profiles[c.user_id])}</span>
              <span className="text-xs text-zinc-400">
                {when(c.created_at)}
                {c.edited_at && " (edited)"}
              </span>
              <span className="ml-auto flex gap-2 text-xs text-zinc-400 opacity-0 transition group-hover:opacity-100 focus-within:opacity-100">
                {c.user_id === me.id && (
                  <button onClick={() => setEditing({ id: c.id, body: c.body })} className="hover:text-tm-blue">
                    Edit
                  </button>
                )}
                {(c.user_id === me.id || canModerate) && (
                  <button onClick={() => remove(c.id)} className="hover:text-red-600">
                    Delete
                  </button>
                )}
              </span>
            </div>
            {editing?.id === c.id ? (
              <div className="mt-1">
                <textarea autoFocus value={editing.body} onChange={(e) => setEditing({ ...editing, body: e.target.value })} rows={3} className={`${input} resize-y`} />
                <div className="mt-1.5 flex gap-2">
                  <button onClick={saveEdit} className={`${btn} !py-1.5`}>
                    Save
                  </button>
                  <button onClick={() => setEditing(null)} className={`${btnGhost} !py-1.5`}>
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <p className="mt-0.5 text-sm whitespace-pre-wrap text-zinc-700">{c.body}</p>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

function History({ activity }: { activity: TaskActivity[] }) {
  const { profiles } = useChat();
  const show = (field: string, v: string | null) => {
    if (v === null || v === "") return <i className="text-zinc-400">none</i>;
    if (field === "assignee") return displayName(profiles[v]);
    if (field === "status") return statusLabel[v as TaskStatus] ?? v;
    if (field === "priority") return priorityOf(v as TaskPriority)?.label ?? v;
    if (field === "type") return typeOf(v as TaskType)?.label ?? v;
    if (field === "due_date") return dueLabel(v);
    return v;
  };
  const names: Record<string, string> = { status: "status", priority: "priority", type: "type", assignee: "assignee", title: "summary", due_date: "due date" };
  if (!activity.length) return <p className="text-sm text-zinc-400">No changes yet.</p>;
  return (
    <ol className="space-y-3">
      {activity.map((a) => (
        <li key={a.id} className="flex gap-2.5 text-sm">
          <Avatar profile={a.user_id ? profiles[a.user_id] : undefined} size={24} />
          <div className="min-w-0 flex-1 text-zinc-600">
            <span className="font-semibold text-zinc-800">{a.user_id ? displayName(profiles[a.user_id]) : "Someone"}</span>{" "}
            {a.field === "created" ? (
              "created the task"
            ) : (
              <>
                changed the {names[a.field] ?? a.field} from <span className="font-medium text-zinc-800">{show(a.field, a.old_value)}</span> to{" "}
                <span className="font-medium text-zinc-800">{show(a.field, a.new_value)}</span>
              </>
            )}
            <div className="text-xs text-zinc-400">{when(a.created_at)}</div>
          </div>
        </li>
      ))}
    </ol>
  );
}

// Project settings: details for admins, and the project's people ---------------

function ProjectSettings({ project, onClose }: { project: Project; onClose: () => void }) {
  const { me, profiles, reloadProjects, openProject } = useChat();
  const canManage = useCanManage(project);
  const [tab, setTab] = useState<"people" | "details">("people");
  const [name, setName] = useState(project.name);
  const [description, setDescription] = useState(project.description);
  const [lead, setLead] = useState(project.lead_id ?? "");
  const [adding, setAdding] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const memberIds = project.project_members.map((m) => m.user_id);

  const run = async (fn: () => PromiseLike<{ error: { message: string } | null }>) => {
    setBusy(true);
    setError("");
    const { error } = await fn();
    setBusy(false);
    if (error) setError(error.message);
    await reloadProjects();
    return !error;
  };

  const saveDetails = (e: React.FormEvent) => {
    e.preventDefault();
    run(() => supabase.from("projects").update({ name: name.trim(), description: description.trim(), lead_id: lead || null }).eq("id", project.id));
  };
  const addPeople = async () => {
    if (await run(() => supabase.from("project_members").insert(adding.map((user_id) => ({ project_id: project.id, user_id }))))) setAdding([]);
  };
  const setRole = (user_id: string, role: "admin" | "member") =>
    run(() => supabase.from("project_members").update({ role }).match({ project_id: project.id, user_id }));
  const removePerson = async (user_id: string) => {
    const self = user_id === me.id;
    if (!confirm(self ? `Leave ${project.name}?` : `Remove ${displayName(profiles[user_id])} from ${project.name}? Their open tasks here become unassigned.`)) return;
    if ((await run(() => supabase.rpc("remove_project_member", { p_project: project.id, p_user: user_id }))) && self && !isAdmin(me)) {
      onClose();
      openProject(null);
    }
  };
  const archive = () => run(() => supabase.from("projects").update({ archived: !project.archived }).eq("id", project.id));
  const destroy = async () => {
    if ((await askText("Delete project", `This deletes ${project.name} and all its tasks for everyone. Type ${project.key} to confirm.`, project.key))?.trim().toUpperCase() !== project.key) return;
    if (await run(() => supabase.from("projects").delete().eq("id", project.id))) {
      onClose();
      openProject(null);
    }
  };

  return (
    <Modal title={`${project.name} settings`} onClose={onClose}>
      <Tabs
        tabs={[
          ["people", `People (${memberIds.length})`],
          ["details", "Details"],
        ]}
        value={tab}
        onChange={setTab}
      />
      {tab === "people" ? (
        <div className="space-y-4">
          {canManage && (
            <div>
              <PeoplePicker value={adding} onChange={setAdding} exclude={memberIds} />
              {adding.length > 0 && (
                <button onClick={addPeople} disabled={busy} className={`${btn} mt-2`}>
                  Add {adding.length} {adding.length === 1 ? "person" : "people"}
                </button>
              )}
            </div>
          )}
          <div className="space-y-1">
            {project.project_members.map((m) => (
              <div key={m.user_id} className="flex items-center gap-2.5 rounded-xl px-2 py-1.5 hover:bg-tm-surface">
                <Avatar profile={profiles[m.user_id]} size={30} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">
                    {displayName(profiles[m.user_id])}
                    {m.user_id === me.id && <span className="text-zinc-400"> (you)</span>}
                  </div>
                  <div className="text-xs text-zinc-400">{project.lead_id === m.user_id ? "Project lead" : `@${profiles[m.user_id]?.username ?? "unknown"}`}</div>
                </div>
                {canManage ? (
                  <select value={m.role} disabled={busy} onChange={(e) => setRole(m.user_id, e.target.value as "admin" | "member")} className="rounded-lg bg-transparent px-1 py-1 text-sm text-zinc-600 outline-none hover:bg-white">
                    <option value="admin">Admin</option>
                    <option value="member">Member</option>
                  </select>
                ) : (
                  <span className="text-xs text-zinc-500 capitalize">{m.role}</span>
                )}
                {(canManage || m.user_id === me.id) && (
                  <button onClick={() => removePerson(m.user_id)} disabled={busy} title={m.user_id === me.id ? "Leave project" : "Remove from project"} className="rounded-lg p-1.5 text-zinc-400 transition hover:bg-white hover:text-red-600">
                    <Icon name="x" size={14} />
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      ) : (
        <form onSubmit={saveDetails} className="space-y-4">
          <label className="block text-sm font-medium">
            Name
            <input required disabled={!canManage} maxLength={80} value={name} onChange={(e) => setName(e.target.value)} className={`${input} mt-1.5`} />
          </label>
          <label className="block text-sm font-medium">
            Description
            <textarea disabled={!canManage} value={description} maxLength={2000} onChange={(e) => setDescription(e.target.value)} rows={3} className={`${input} mt-1.5 resize-none`} />
          </label>
          <label className="block text-sm font-medium">
            Project lead
            <select disabled={!canManage} value={lead} onChange={(e) => setLead(e.target.value)} className={`${input} mt-1.5`}>
              <option value="">No lead</option>
              {project.project_members.map((m) => (
                <option key={m.user_id} value={m.user_id}>
                  {displayName(profiles[m.user_id])}
                </option>
              ))}
            </select>
          </label>
          <div className="text-xs text-zinc-500">
            Key <span className="font-mono font-semibold">{project.key}</span> · created {dayLabel(project.created_at)}
            {project.created_by && ` by ${displayName(profiles[project.created_by])}`}
          </div>
          {canManage && (
            <>
              <button className={btn} disabled={busy || !name.trim()}>
                Save changes
              </button>
              <div className="space-y-2 border-t border-tm-line pt-4">
                <button type="button" onClick={archive} disabled={busy} className={`${btnGhost} w-full`}>
                  {project.archived ? "Restore project" : "Archive project"}
                </button>
                <button type="button" onClick={destroy} disabled={busy} className={`${btnGhost} w-full text-red-600 hover:!bg-red-50`}>
                  Delete project
                </button>
              </div>
            </>
          )}
        </form>
      )}
      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
    </Modal>
  );
}

// My tasks: everything assigned to (or reported by) the user across the company's projects --------

type Scope = "assigned" | "reported";

export function MyTasksView() {
  const { me, company, projects, openTask } = useChat();
  const [scope, setScope] = useState<Scope>("assigned");
  const [creating, setCreating] = useState(false);
  const [showDone, setShowDone] = useState(false);
  const [mode, setMode] = useMode("tm:my-tasks-mode", "list");
  const ids = projects.map((p) => p.id);
  const idKey = ids.join(",");
  const column = scope === "assigned" ? "assignee_id" : "reporter_id";
  const [tasks, setTasks] = useLiveTasks(
    () =>
      supabase
        .from("tasks")
        .select("*")
        .eq(column, me.id)
        .in("project_id", idKey ? idKey.split(",") : [crypto.randomUUID()])
        .order("updated_at", { ascending: false })
        .limit(500),
    // Unfiltered: a task reassigned away from this user must drop out too
    undefined,
    [column, me.id, idKey, company?.id],
  );
  const byId = useMemo(() => Object.fromEntries(projects.map((p) => [p.id, p])), [projects]);
  const withProject = (tasks ?? []).map((t) => ({ ...t, projects: byId[t.project_id] ?? null }));
  const open = withProject.filter((t) => t.status !== "done");
  const done = withProject.filter((t) => t.status === "done");
  const late = open.filter(overdue);

  const update = async (id: string, patch: Partial<Task>) => {
    setTasks((ts) => ts?.map((t) => (t.id === id ? { ...t, ...patch } : t)) ?? ts);
    const { error } = await supabase.from("tasks").update(patch).eq("id", id);
    if (error) alert(error.message);
  };

  return (
    <ViewShell
      icon="checkSquare"
      title="My tasks"
      subtitle={late.length ? `${late.length} overdue` : undefined}
      action={
        <span className="flex items-center gap-1.5">
          <ModeToggle mode={mode} onChange={setMode} />
          <button onClick={() => setCreating(true)} className={`${btn} flex items-center gap-1.5`}>
            <Icon name="plus" size={16} />
            <span className="hidden sm:inline">Create task</span>
          </button>
        </span>
      }
    >
      <Tabs
        tabs={[
          ["assigned", "Assigned to me"],
          ["reported", "Reported by me"],
        ]}
        value={scope}
        onChange={setScope}
      />
      {!tasks ? (
        <CardSkeleton />
      ) : withProject.length === 0 ? (
        <EmptyState icon="checkSquare" text={scope === "assigned" ? "Nothing assigned to you. Enjoy the quiet." : "You haven't created any tasks yet."} />
      ) : mode === "board" ? (
        <Board tasks={withProject} all={withProject} canAdd={false} onMove={update} className="-mx-3 flex gap-3 overflow-x-auto px-3 pb-2 md:-mx-6 md:px-6" />
      ) : (
        <div>
          {open.length > 0 ? (
            <TaskTable tasks={open} onUpdate={update} onOpen={openTask} className="overflow-x-auto" />
          ) : (
            <p className="p-6 text-center text-sm text-zinc-400">All done.</p>
          )}
          {done.length > 0 && (
            <button onClick={() => setShowDone(!showDone)} className="mt-4 flex items-center gap-1.5 py-2 text-xs font-semibold tracking-wide text-zinc-400 uppercase transition hover:text-zinc-700">
              <Icon name={showDone ? "chevronDown" : "chevronLeft"} size={12} />
              Done ({done.length})
            </button>
          )}
          {showDone && done.length > 0 && <TaskTable tasks={done} onUpdate={update} onOpen={openTask} className="overflow-x-auto" />}
        </div>
      )}
      {creating && <CreateTask onClose={() => setCreating(false)} />}
    </ViewShell>
  );
}

// Sidebar entries: projects the user is in, as quick links to their boards
export function SidebarProjects({ renderSection }: { renderSection: (children: React.ReactNode, onAdd?: () => void) => React.ReactNode }) {
  const { me, projects, projectId, view, openProject } = useChat();
  const [creating, setCreating] = useState(false);
  const mine = projects.filter((p) => !p.archived && p.project_members.some((m) => m.user_id === me.id));
  return (
    <>
      {renderSection(
        <>
          {mine.map((p) => {
            const active = view === "projects" && projectId === p.id;
            return (
              <button
                key={p.id}
                onClick={() => openProject(p.id)}
                className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2.5 text-left text-[15px] transition md:py-1.5 ${active ? "tm-raised bg-white font-semibold text-tm-blue" : "text-zinc-600 hover:bg-white/70"}`}
              >
                <span className="flex w-5 justify-center">
                  <KeyBadge project={p} size={18} />
                </span>
                <span className="truncate">{p.name}</span>
              </button>
            );
          })}
          <button
            onClick={() => openProject(null)}
            className={`w-full rounded-lg px-2.5 py-1.5 text-left text-sm transition ${view === "projects" && !projectId ? "tm-raised bg-white font-semibold text-tm-blue" : "text-zinc-500 hover:bg-white"}`}
          >
            {mine.length ? "All projects" : "+ Browse projects"}
          </button>
        </>,
        me.role !== "guest" ? () => setCreating(true) : undefined,
      )}
      {creating && <CreateProject onClose={() => setCreating(false)} />}
    </>
  );
}
