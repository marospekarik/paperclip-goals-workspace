/**
 * The plugin's four mounted surfaces.
 *
 *   GoalsNavItem        → `sidebar`   — a Goals entry in the host's left nav
 *   GoalsWorkspacePage  → `page`      — the master-detail workspace
 *   IssueGoalTab        → `detailTab` — a Goal tab on an issue
 *   ProjectGoalsTab     → `detailTab` — a Goals tab on a project
 *
 * Reads come from the worker's aggregate over the bridge; every write goes over
 * the host REST API (see ./api.ts) and is followed by a refresh of whichever
 * aggregates it invalidated.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  useHostContext,
  useHostLocation,
  useHostNavigation,
  usePluginData,
  usePluginStream,
  usePluginToast,
  type PluginDetailTabProps,
  type PluginPageProps,
} from "@paperclipai/plugin-sdk/ui";

import {
  ancestorChain,
  buildGoalIndex,
  computeDeleteImpact,
  predictClearedIssueGoal,
  filterGoals,
  issueStatusGroups,
  planDetach,
  progressLabel,
  projectGoalIds,
  projectsForGoal,
  type DeleteImpact,
  type Goal,
  type GoalFilter,
  type Issue,
  type Project,
} from "../model.js";
import {
  GOAL_PARAM,
  hostAgentHref,
  hostGoalHref,
  hostIssueHref,
  hostProjectHref,
  pageHref,
} from "../routes.js";
import {
  HostApiError,
  createGoal,
  deleteGoal,
  updateGoal,
  updateIssueGoal,
  updateProjectGoals,
  type GoalCreateInput,
  type GoalPatch,
} from "./api.js";
import {
  AgentSelect,
  EnumSelect,
  ErrorNote,
  Field,
  GoalTree,
  IconExternalLink,
  IconPlus,
  IconSearch,
  IconTarget,
  IconTrash,
  IconUnlink,
  InlineText,
  IssueStatusChip,
  LEVEL_VALUES,
  LevelChip,
  Modal,
  ParentSelect,
  ProgressBar,
  Root,
  STATUS_VALUES,
  Section,
  Spinner,
  StatusChip,
} from "./parts.js";
import type {
  GoalIssuesPayload,
  IssueSearchPayload,
  SingleIssuePayload,
  WorkspacePayload,
} from "../worker.js";

// ---------------------------------------------------------------------------
// Shared data hook
// ---------------------------------------------------------------------------

function useWorkspace(companyId: string | null | undefined) {
  const result = usePluginData<WorkspacePayload>("workspace", companyId ? { companyId } : undefined);
  const stream = usePluginStream<{ kind: string }>(companyId ? `goals:${companyId}` : "goals:none", {
    companyId: companyId ?? undefined,
  });

  // Someone else — an agent run, another operator — changed a goal, issue or
  // project. Pull the aggregate again so the tree and its progress bars do not
  // sit on a stale read. Strictly additive: our own writes already refresh.
  const lastSeen = stream.lastEvent;
  const refresh = result.refresh;
  useEffect(() => {
    if (lastSeen) refresh();
  }, [lastSeen, refresh]);

  return result;
}

function errorText(error: unknown): string {
  if (error instanceof HostApiError) {
    if (error.looksLikeForeignKeyBlock) {
      return `${error.message} — something still references this goal. Cost or finance events cannot be detached through the API; clear them first.`;
    }
    return error.message;
  }
  if (error instanceof Error) return error.message;
  return String(error);
}

export const DEFAULT_TREE_WIDTH = 340;
export const MIN_TREE_WIDTH = 260;
export const MIN_DETAIL_WIDTH = 320;
const SPLIT_STEP = 24;
const SPLIT_STORAGE_KEY = "paperclip-goals-workspace:tree-width";

/** Keep both panes usable while allowing the goal tree to grow with the page. */
export function clampTreeWidth(proposed: number, shellWidth: number): number {
  const maximum = Math.max(MIN_TREE_WIDTH, shellWidth - MIN_DETAIL_WIDTH);
  return Math.min(Math.max(proposed, MIN_TREE_WIDTH), maximum);
}

function WorkspaceSplitHandle({
  shellRef,
  width,
  onWidthChange,
}: {
  shellRef: React.RefObject<HTMLDivElement | null>;
  width: number;
  onWidthChange: (width: number) => void;
}) {
  const widthRef = useRef(width);
  const [dragging, setDragging] = useState(false);
  const [shellWidth, setShellWidth] = useState(0);

  useEffect(() => {
    widthRef.current = width;
  }, [width]);

  useEffect(() => {
    const shell = shellRef.current;
    if (!shell) return;
    const update = () => {
      const nextShellWidth = shell.getBoundingClientRect().width;
      setShellWidth(nextShellWidth);
      onWidthChange(clampTreeWidth(widthRef.current, nextShellWidth));
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(shell);
    return () => observer.disconnect();
  }, [shellRef, onWidthChange]);

  const resizeAt = useCallback((clientX: number) => {
    const shell = shellRef.current;
    if (!shell) return;
    const bounds = shell.getBoundingClientRect();
    onWidthChange(clampTreeWidth(clientX - bounds.left, bounds.width));
  }, [shellRef, onWidthChange]);

  useEffect(() => {
    if (!dragging) return;
    const move = (event: PointerEvent) => {
      event.preventDefault();
      resizeAt(event.clientX);
    };
    const stop = () => setDragging(false);
    const previousCursor = document.body.style.cursor;
    const previousSelection = document.body.style.userSelect;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    window.addEventListener("pointermove", move, { passive: false });
    window.addEventListener("pointerup", stop);
    window.addEventListener("pointercancel", stop);
    window.addEventListener("blur", stop);
    return () => {
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousSelection;
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
      window.removeEventListener("pointercancel", stop);
      window.removeEventListener("blur", stop);
    };
  }, [dragging, resizeAt]);

  const maximum = Math.max(MIN_TREE_WIDTH, shellWidth - MIN_DETAIL_WIDTH);

  return (
    <div
      className={dragging ? "gw-splitter gw-splitter--active" : "gw-splitter"}
      role="separator"
      aria-label="Resize goal list"
      aria-orientation="vertical"
      aria-valuemin={MIN_TREE_WIDTH}
      aria-valuemax={Math.round(maximum)}
      aria-valuenow={Math.round(width)}
      tabIndex={0}
      title="Drag to resize · Double-click to reset"
      onDoubleClick={() => onWidthChange(clampTreeWidth(DEFAULT_TREE_WIDTH, shellWidth))}
      onPointerDown={(event) => {
        event.preventDefault();
        setDragging(true);
        resizeAt(event.clientX);
      }}
      onKeyDown={(event) => {
        let next = width;
        if (event.key === "ArrowLeft") next -= SPLIT_STEP;
        else if (event.key === "ArrowRight") next += SPLIT_STEP;
        else if (event.key === "Home") next = MIN_TREE_WIDTH;
        else if (event.key === "End") next = maximum;
        else return;
        event.preventDefault();
        onWidthChange(clampTreeWidth(next, shellWidth));
      }}
    >
      <span className="gw-splitter-grip" aria-hidden="true" />
    </div>
  );
}

// ---------------------------------------------------------------------------
// sidebar
// ---------------------------------------------------------------------------

export function GoalsNavItem() {
  const navigation = useHostNavigation();
  return (
    <Root>
      <a {...navigation.linkProps(pageHref())} className="gw-nav">
        <IconTarget size={16} />
        <span>Goals</span>
      </a>
    </Root>
  );
}

// ---------------------------------------------------------------------------
// page — the workspace
// ---------------------------------------------------------------------------

export function GoalsWorkspacePage(_props: PluginPageProps) {
  const context = useHostContext();
  const companyId = context.companyId ?? null;
  const location = useHostLocation();
  const navigation = useHostNavigation();
  const toast = usePluginToast();

  const workspace = useWorkspace(companyId);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // `null` means "nobody has touched the tree yet", which renders with the roots
  // open. Deriving that instead of seeding it from an effect matters: an effect
  // does not run on the first paint, so the tree would flash fully collapsed
  // before expanding.
  const [expandedOverride, setExpandedOverride] = useState<Set<string> | null>(null);
  const [filter, setFilter] = useState<GoalFilter>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<null | { kind: "create"; parentId: string | null } | { kind: "delete" } | { kind: "link-projects" } | { kind: "link-issues" }>(null);
  const shellRef = useRef<HTMLDivElement>(null);
  const [treeWidth, setTreeWidth] = useState(DEFAULT_TREE_WIDTH);
  const [splitReady, setSplitReady] = useState(false);

  useEffect(() => {
    try {
      const saved = Number(window.localStorage.getItem(SPLIT_STORAGE_KEY));
      if (Number.isFinite(saved) && saved > 0) setTreeWidth(saved);
    } catch {
      // Storage can be unavailable in privacy-restricted webviews. Resizing still works.
    }
    setSplitReady(true);
  }, []);

  useEffect(() => {
    if (!splitReady) return;
    try {
      window.localStorage.setItem(SPLIT_STORAGE_KEY, String(Math.round(treeWidth)));
    } catch {
      // Keep the in-memory split when storage is unavailable.
    }
  }, [splitReady, treeWidth]);

  const goals = workspace.data?.goals ?? [];
  const projects = workspace.data?.projects ?? [];
  const agents = workspace.data?.agents ?? [];
  const rollups = workspace.data?.rollups ?? {};

  // Deep link in: `?goal=<id>` selects on arrival so a workspace link is
  // shareable. Selecting later writes the same param back through the host
  // router, never through window.location, so the SPA is never reloaded.
  const searchGoalId = useMemo(() => new URLSearchParams(location.search).get(GOAL_PARAM), [location.search]);
  useEffect(() => {
    if (searchGoalId && searchGoalId !== selectedId) setSelectedId(searchGoalId);
  }, [searchGoalId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Roots open until the operator collapses something, so an untouched
  // workspace shows structure rather than a single line.
  const expanded = useMemo(
    () => expandedOverride ?? new Set(buildGoalIndex(goals).roots.map((goal) => goal.id)),
    [expandedOverride, goals],
  );

  const selected = selectedId ? goals.find((goal) => goal.id === selectedId) ?? null : null;
  const filterResult = useMemo(() => filterGoals(goals, filter), [goals, filter]);

  const select = useCallback(
    (goalId: string) => {
      setSelectedId(goalId);
      navigation.navigate(pageHref(goalId), { replace: true });
    },
    [navigation],
  );

  const toggle = useCallback(
    (goalId: string) => {
      setExpandedOverride(() => {
        const next = new Set(expanded);
        if (next.has(goalId)) next.delete(goalId);
        else next.add(goalId);
        return next;
      });
    },
    [expanded],
  );

  /** Run a write, surface its failure in one place, refresh on success. */
  const run = useCallback(
    async (label: string, work: () => Promise<unknown>) => {
      setBusy(true);
      setError(null);
      try {
        await work();
        workspace.refresh();
        toast({ title: label, tone: "success", ttlMs: 2200 });
        return true;
      } catch (failure) {
        setError(errorText(failure));
        return false;
      } finally {
        setBusy(false);
      }
    },
    [workspace, toast],
  );

  if (!companyId) {
    return (
      <Root>
        <div className="gw-pane-pad">
          <p className="gw-sub">Select a company to manage its goals.</p>
        </div>
      </Root>
    );
  }

  return (
    <Root>
      <div
        className="gw-shell"
        ref={shellRef}
        style={{ "--gw-tree-width": `${treeWidth}px` } as React.CSSProperties}
      >
        <div className="gw-tree-pane">
          <div className="gw-pane-pad gw-stack-sm">
            <div className="gw-row">
              <h1 className="gw-h1">Goals</h1>
              <span className="gw-spacer" />
              <button
                type="button"
                className="gw-btn gw-btn--primary"
                disabled={busy}
                onClick={() => setDialog({ kind: "create", parentId: null })}
              >
                <IconPlus />
                New goal
              </button>
            </div>
            <Toolbar filter={filter} onChange={setFilter} agents={agents} />
            {workspace.data?.truncated ? (
              <div className="gw-callout gw-callout--warn">
                This company has more than {workspace.data.issueCount} issues; progress is computed from the first
                page and may undercount.
              </div>
            ) : null}
          </div>
          <div className="gw-tree-scroll">
            {workspace.loading && goals.length === 0 ? (
              <p className="gw-empty">
                <Spinner /> Loading goals…
              </p>
            ) : (
              <GoalTree
                goals={goals}
                rollups={rollups}
                selectedId={selectedId}
                onSelect={select}
                filter={filterResult}
                expanded={expanded}
                onToggle={toggle}
              />
            )}
          </div>
        </div>

        <WorkspaceSplitHandle shellRef={shellRef} width={treeWidth} onWidthChange={setTreeWidth} />

        <div className="gw-detail-pane">
          <div className="gw-pane-pad gw-stack">
            {workspace.error ? <ErrorNote error={workspace.error.message} /> : null}
            <ErrorNote error={error} />
            {selected ? (
              <GoalDetail
                goal={selected}
                goals={goals}
                projects={projects}
                agents={agents}
                rollups={rollups}
                companyId={companyId}
                busy={busy}
                onSelect={select}
                onPatch={(patch) => run("Goal updated", () => updateGoal(selected.id, patch))}
                onCreateChild={() => setDialog({ kind: "create", parentId: selected.id })}
                onDelete={() => setDialog({ kind: "delete" })}
                onLinkProjects={() => setDialog({ kind: "link-projects" })}
                onLinkIssues={() => setDialog({ kind: "link-issues" })}
                onUnlinkProject={(project) =>
                  run("Project unlinked", () =>
                    updateProjectGoals(project.id, {
                      goalIds: projectGoalIds(project).filter((id) => id !== selected.id),
                      ...(project.goalId === selected.id ? { goalId: null } : {}),
                    }),
                  )
                }
                onUnlinkIssue={(issue) =>
                  run("Task goal cleared", async () => {
                    // The host never leaves a task without a goal: an explicit
                    // null is re-derived to the task's project goal, then to the
                    // company default. Read the result back and say where it
                    // actually went rather than claiming it was unlinked.
                    const updated = await updateIssueGoal(issue.id, null);
                    if (updated?.goalId && updated.goalId !== selected.id) {
                      const landed = goals.find((candidate) => candidate.id === updated.goalId);
                      toast({
                        title: `Task moved to “${landed?.title ?? "another goal"}”`,
                        body: "Paperclip derives a task's goal from its project or the company default — a task cannot have none.",
                        tone: "info",
                        ttlMs: 6000,
                      });
                    }
                  })
                }
              />
            ) : (
              <EmptyDetail hasGoals={goals.length > 0} />
            )}
          </div>
        </div>
      </div>

      {dialog?.kind === "create" ? (
        <CreateGoalDialog
          goals={goals}
          agents={agents}
          parentId={dialog.parentId}
          busy={busy}
          onClose={() => setDialog(null)}
          onSubmit={async (input) => {
            const ok = await run("Goal created", async () => {
              const created = await createGoal(companyId, input);
              if (created?.id) select(created.id);
            });
            if (ok) setDialog(null);
          }}
        />
      ) : null}

      {dialog?.kind === "delete" && selected ? (
        <DeleteGoalDialog
          goal={selected}
          companyId={companyId}
          goals={goals}
          projects={projects}
          busy={busy}
          onClose={() => setDialog(null)}
          onDone={() => {
            setDialog(null);
            setSelectedId(null);
            navigation.navigate(pageHref(), { replace: true });
            workspace.refresh();
          }}
          onError={setError}
          setBusy={setBusy}
          onRefresh={() => workspace.refresh()}
        />
      ) : null}

      {dialog?.kind === "link-projects" && selected ? (
        <LinkProjectsDialog
          goal={selected}
          projects={projects}
          busy={busy}
          onClose={() => setDialog(null)}
          onSubmit={async (projectIds) => {
            const ok = await run("Projects linked", async () => {
              for (const projectId of projectIds) {
                const project = projects.find((candidate) => candidate.id === projectId);
                if (!project) continue;
                const next = new Set(projectGoalIds(project));
                next.add(selected.id);
                await updateProjectGoals(projectId, { goalIds: [...next] });
              }
            });
            if (ok) setDialog(null);
          }}
        />
      ) : null}

      {dialog?.kind === "link-issues" && selected ? (
        <LinkIssuesDialog
          goal={selected}
          companyId={companyId}
          busy={busy}
          onClose={() => setDialog(null)}
          onSubmit={async (issueIds) => {
            const ok = await run("Tasks linked", async () => {
              for (const issueId of issueIds) await updateIssueGoal(issueId, selected.id);
            });
            if (ok) setDialog(null);
          }}
        />
      ) : null}
    </Root>
  );
}

// ---------------------------------------------------------------------------
// Toolbar
// ---------------------------------------------------------------------------

function Toolbar({
  filter,
  onChange,
  agents,
}: {
  filter: GoalFilter;
  onChange: (next: GoalFilter) => void;
  agents: WorkspacePayload["agents"];
}) {
  return (
    <div className="gw-stack-sm">
      <label className="gw-row" style={{ position: "relative" }}>
        <span style={{ position: "absolute", left: 8, display: "flex", color: "var(--gw-faint)" }}>
          <IconSearch />
        </span>
        <input
          className="gw-input"
          style={{ paddingLeft: 26 }}
          type="search"
          placeholder="Search goals…"
          aria-label="Search goals"
          value={filter.query ?? ""}
          onChange={(event) => onChange({ ...filter, query: event.target.value })}
        />
      </label>
      <div className="gw-row" style={{ gap: 6 }}>
        <select
          className="gw-select"
          aria-label="Filter by status"
          value={filter.statuses?.[0] ?? ""}
          onChange={(event) =>
            onChange({ ...filter, statuses: event.target.value ? [event.target.value] : [] })
          }
        >
          <option value="">Any status</option>
          {STATUS_VALUES.map((status) => (
            <option key={status} value={status}>
              {status}
            </option>
          ))}
        </select>
        <select
          className="gw-select"
          aria-label="Filter by level"
          value={filter.levels?.[0] ?? ""}
          onChange={(event) => onChange({ ...filter, levels: event.target.value ? [event.target.value] : [] })}
        >
          <option value="">Any level</option>
          {LEVEL_VALUES.map((level) => (
            <option key={level} value={level}>
              {level}
            </option>
          ))}
        </select>
        <select
          className="gw-select"
          aria-label="Filter by owner"
          value={filter.unownedOnly ? "__none__" : filter.ownerAgentId ?? ""}
          onChange={(event) => {
            const value = event.target.value;
            onChange({
              ...filter,
              unownedOnly: value === "__none__",
              ownerAgentId: value === "__none__" || value === "" ? null : value,
            });
          }}
        >
          <option value="">Any owner</option>
          <option value="__none__">Unowned</option>
          {agents.map((agent) => (
            <option key={agent.id} value={agent.id}>
              {agent.name}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}

function EmptyDetail({ hasGoals }: { hasGoals: boolean }) {
  return (
    <div className="gw-stack-sm" style={{ paddingTop: 40, textAlign: "center", color: "var(--gw-faint)" }}>
      <div style={{ display: "flex", justifyContent: "center" }}>
        <IconTarget />
      </div>
      <p className="gw-sub">
        {hasGoals ? "Select a goal to inspect and edit it." : "No goals yet — create the first one."}
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Detail pane
// ---------------------------------------------------------------------------

interface GoalDetailProps {
  goal: Goal;
  goals: Goal[];
  projects: Project[];
  agents: WorkspacePayload["agents"];
  rollups: WorkspacePayload["rollups"];
  companyId: string;
  busy: boolean;
  onSelect: (goalId: string) => void;
  onPatch: (patch: GoalPatch) => void;
  onCreateChild: () => void;
  onDelete: () => void;
  onLinkProjects: () => void;
  onLinkIssues: () => void;
  onUnlinkProject: (project: Project) => void;
  onUnlinkIssue: (issue: Issue) => void;
}

function GoalDetail(props: GoalDetailProps) {
  const { goal, goals, projects, agents, rollups, companyId, busy } = props;
  const navigation = useHostNavigation();
  const rollup = rollups[goal.id];
  const index = useMemo(() => buildGoalIndex(goals), [goals]);
  const ancestors = useMemo(() => ancestorChain(goal.id, index), [goal.id, index]);
  const children = index.childrenOf.get(goal.id) ?? [];
  const linkedProjects = useMemo(() => projectsForGoal(goal.id, projects), [goal.id, projects]);
  const owner = goal.ownerAgentId ? agents.find((agent) => agent.id === goal.ownerAgentId) ?? null : null;

  const issues = usePluginData<GoalIssuesPayload>("goal-issues", { companyId, goalId: goal.id });
  const directIssues = issues.data?.direct ?? [];
  const projectIssues = issues.data?.viaProjects ?? [];

  return (
    <>
      {ancestors.length > 0 ? (
        <nav className="gw-breadcrumb" aria-label="Parent goals">
          {ancestors.map((ancestor) => (
            <React.Fragment key={ancestor.id}>
              <button
                type="button"
                className="gw-btn gw-btn--ghost gw-btn--xs"
                onClick={() => props.onSelect(ancestor.id)}
              >
                {ancestor.title}
              </button>
              <span className="gw-breadcrumb-sep">/</span>
            </React.Fragment>
          ))}
        </nav>
      ) : null}

      <div className="gw-stack-sm">
        <InlineText value={goal.title} ariaLabel="Goal title" onCommit={(title) => props.onPatch({ title })} />
        <InlineText
          value={goal.description ?? ""}
          ariaLabel="Goal description"
          placeholder="Add a description…"
          multiline
          onCommit={(description) => props.onPatch({ description: description || null })}
        />
      </div>

      {rollup ? (
        <div className="gw-stack-sm">
          <div className="gw-row">
            <ProgressBar percent={rollup.percent} wide />
            <span className="gw-pct" style={{ minWidth: 38, fontSize: 12 }}>
              {rollup.percent === null ? "—" : `${rollup.percent}%`}
            </span>
          </div>
          <p className="gw-faint" style={{ margin: 0, fontSize: 11.5 }}>
            {progressLabel(rollup) ?? "Nothing linked yet — link projects or tasks to track progress."}
            {rollup.progressBasis === "subgoals" ? " · measured from sub-goals" : ""}
          </p>
          <div className="gw-metrics">
            <Metric value={rollup.tasks.done} label="Done" />
            <Metric value={rollup.tasks.inProgress} label="In flight" />
            <Metric value={rollup.tasks.blocked} label="Blocked" />
            <Metric value={rollup.tasks.open} label="Open" />
            <Metric value={rollup.subGoals.total} label="Sub-goals" />
            <Metric value={rollup.projectIds.length} label="Projects" />
          </div>
        </div>
      ) : null}

      <div className="gw-detail-grid">
        <Section title="Properties">
          <div>
            <Field label="Status">
              <EnumSelect
                values={STATUS_VALUES}
                value={goal.status}
                label="Goal status"
                disabled={busy}
                onChange={(status) => props.onPatch({ status })}
              />
            </Field>
            <Field label="Level">
              <EnumSelect
                values={LEVEL_VALUES}
                value={goal.level}
                label="Goal level"
                disabled={busy}
                onChange={(level) => props.onPatch({ level })}
              />
            </Field>
            <Field label="Owner">
              <AgentSelect
                agents={agents}
                value={goal.ownerAgentId}
                disabled={busy}
                onChange={(ownerAgentId) => props.onPatch({ ownerAgentId })}
              />
              {owner ? (
                <a
                  className="gw-btn gw-btn--xs gw-btn--ghost gw-owner-open"
                  aria-label={`Open ${owner.name}`}
                  {...navigation.linkProps(hostAgentHref(owner.urlKey ?? null, owner.id))}
                >
                  <IconExternalLink /> Open
                </a>
              ) : null}
            </Field>
            <Field label="Parent">
              <ParentSelect
                goals={goals}
                goalId={goal.id}
                value={goal.parentId}
                disabled={busy}
                onChange={(parentId) => props.onPatch({ parentId })}
              />
            </Field>
          </div>
        </Section>

        <Section
          title="Projects"
          count={linkedProjects.length}
          flush
          action={
            <button type="button" className="gw-btn gw-btn--xs" disabled={busy} onClick={props.onLinkProjects}>
              <IconPlus /> Link project
            </button>
          }
        >
          {linkedProjects.length === 0 ? (
            <p className="gw-empty">No linked projects.</p>
          ) : (
            linkedProjects.map((project) => (
              <div key={project.id} className="gw-list-row">
                <a
                  className="gw-link gw-truncate"
                  style={{ flex: 1 }}
                  {...navigation.linkProps(hostProjectHref(project.urlKey ?? null, project.id))}
                >
                  {project.name}
                </a>
                <span className="gw-chip gw-chip--count">{project.status.replace(/_/g, " ")}</span>
                <button
                  type="button"
                  className="gw-btn gw-btn--ghost gw-btn--xs gw-reveal"
                  disabled={busy}
                  title="Unlink project"
                  aria-label={`Unlink ${project.name}`}
                  onClick={() => props.onUnlinkProject(project)}
                >
                  <IconUnlink />
                </button>
              </div>
            ))
          )}
        </Section>
      </div>

      <Section
        title="Sub-goals"
        count={children.length}
        flush
        action={
          <button type="button" className="gw-btn gw-btn--xs" disabled={busy} onClick={props.onCreateChild}>
            <IconPlus /> Sub-goal
          </button>
        }
      >
        {children.length === 0 ? (
          <p className="gw-empty">No sub-goals.</p>
        ) : (
          children.map((child) => {
            const childRollup = rollups[child.id];
            return (
              <div key={child.id} className="gw-list-row">
                <button
                  type="button"
                  className="gw-node-title"
                  style={{ border: "none", background: "transparent", padding: 0, cursor: "pointer", textAlign: "left" }}
                  onClick={() => props.onSelect(child.id)}
                >
                  {child.title}
                </button>
                <LevelChip level={child.level} />
                {childRollup?.percent !== null && childRollup ? (
                  <>
                    <ProgressBar percent={childRollup.percent} />
                    <span className="gw-pct">{childRollup.percent}%</span>
                  </>
                ) : null}
                <StatusChip status={child.status} />
              </div>
            );
          })
        )}
      </Section>

      <Section
        title="Tasks"
        count={directIssues.length + projectIssues.length}
        flush
        action={
          <button type="button" className="gw-btn gw-btn--xs" disabled={busy} onClick={props.onLinkIssues}>
            <IconPlus /> Link task
          </button>
        }
      >
        {issues.loading && directIssues.length === 0 && projectIssues.length === 0 ? (
          <p className="gw-empty">
            <Spinner /> Loading tasks…
          </p>
        ) : directIssues.length === 0 && projectIssues.length === 0 ? (
          <p className="gw-empty">No tasks linked to this goal.</p>
        ) : (
          <>
            {issueStatusGroups(directIssues).map((group) => (
              <React.Fragment key={group.status}>
                {group.issues.map((issue) => (
                  <IssueRow
                    key={issue.id}
                    issue={issue}
                    busy={busy}
                    onUnlink={() => props.onUnlinkIssue(issue)}
                  />
                ))}
              </React.Fragment>
            ))}
            {projectIssues.length > 0 ? (
              <div className="gw-list-row" style={{ background: "var(--gw-surface)" }}>
                <span className="gw-faint" style={{ fontSize: 11 }}>
                  {projectIssues.length} more via linked projects
                </span>
              </div>
            ) : null}
            {projectIssues.slice(0, 25).map((issue) => (
              <IssueRow key={issue.id} issue={issue} busy={busy} viaProject />
            ))}
          </>
        )}
      </Section>

      <Section title="Danger zone">
        <div className="gw-row-wrap">
          <button type="button" className="gw-btn gw-btn--danger" disabled={busy} onClick={props.onDelete}>
            <IconTrash /> Delete goal
          </button>
          <span className="gw-faint" style={{ fontSize: 11.5 }}>
            Anything attached is listed before anything is removed.
          </span>
        </div>
      </Section>
    </>
  );
}

function Metric({ value, label }: { value: number; label: string }) {
  return (
    <div className="gw-metric">
      <span className="gw-metric-value">{value}</span>
      <span className="gw-metric-label">{label}</span>
    </div>
  );
}

function IssueRow({
  issue,
  busy,
  onUnlink,
  viaProject,
}: {
  issue: Issue;
  busy: boolean;
  onUnlink?: () => void;
  viaProject?: boolean;
}) {
  const navigation = useHostNavigation();
  return (
    <div className="gw-list-row">
      {issue.identifier ? <span className="gw-mono gw-faint">{issue.identifier}</span> : null}
      <a
        className="gw-link gw-truncate"
        style={{ flex: 1 }}
        {...navigation.linkProps(hostIssueHref(issue.identifier ?? null, issue.id))}
      >
        {issue.title}
      </a>
      <IssueStatusChip status={issue.status} />
      {viaProject ? (
        <span className="gw-chip gw-chip--count">via project</span>
      ) : onUnlink ? (
        <button
          type="button"
          className="gw-btn gw-btn--ghost gw-btn--xs gw-reveal"
          disabled={busy}
          title="Unlink task"
          aria-label={`Unlink ${issue.title}`}
          onClick={onUnlink}
        >
          <IconUnlink />
        </button>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Dialogs
// ---------------------------------------------------------------------------

function CreateGoalDialog({
  goals,
  agents,
  parentId,
  busy,
  onClose,
  onSubmit,
}: {
  goals: Goal[];
  agents: WorkspacePayload["agents"];
  parentId: string | null;
  busy: boolean;
  onClose: () => void;
  onSubmit: (input: GoalCreateInput) => void;
}) {
  const [draft, setDraft] = useState<GoalCreateInput>({
    title: "",
    description: "",
    level: parentId ? "team" : "company",
    status: "planned",
    parentId,
    ownerAgentId: null,
  });

  const submit = () => {
    if (!draft.title.trim()) return;
    onSubmit({
      ...draft,
      title: draft.title.trim(),
      description: draft.description?.trim() ? draft.description.trim() : null,
    });
  };

  return (
    <Modal
      title="New goal"
      busy={busy}
      onClose={onClose}
      actions={
        <>
          <button type="button" className="gw-btn" disabled={busy} onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="gw-btn gw-btn--primary"
            disabled={busy || draft.title.trim().length === 0}
            onClick={submit}
          >
            {busy ? "Creating…" : "Create goal"}
          </button>
        </>
      }
    >
      <div className="gw-stack-sm">
        <label className="gw-stack-sm">
          <span className="gw-label">Title</span>
          <input
            className="gw-input"
            autoFocus
            value={draft.title}
            onChange={(event) => setDraft({ ...draft, title: event.target.value })}
            onKeyDown={(event) => {
              if (event.key === "Enter") submit();
            }}
          />
        </label>
        <label className="gw-stack-sm">
          <span className="gw-label">Description</span>
          <textarea
            className="gw-textarea"
            value={draft.description ?? ""}
            onChange={(event) => setDraft({ ...draft, description: event.target.value })}
          />
        </label>
        <div className="gw-row" style={{ gap: 8 }}>
          <label className="gw-stack-sm" style={{ flex: 1 }}>
            <span className="gw-label">Level</span>
            <EnumSelect
              values={LEVEL_VALUES}
              value={draft.level ?? "task"}
              label="Level"
              onChange={(level) => setDraft({ ...draft, level })}
            />
          </label>
          <label className="gw-stack-sm" style={{ flex: 1 }}>
            <span className="gw-label">Status</span>
            <EnumSelect
              values={STATUS_VALUES}
              value={draft.status ?? "planned"}
              label="Status"
              onChange={(status) => setDraft({ ...draft, status })}
            />
          </label>
        </div>
        <label className="gw-stack-sm">
          <span className="gw-label">Parent goal</span>
          <ParentSelect
            goals={goals}
            value={draft.parentId ?? null}
            onChange={(next) => setDraft({ ...draft, parentId: next })}
          />
        </label>
        <label className="gw-stack-sm">
          <span className="gw-label">Owner</span>
          <AgentSelect
            agents={agents}
            value={draft.ownerAgentId ?? null}
            onChange={(next) => setDraft({ ...draft, ownerAgentId: next })}
          />
        </label>
      </div>
    </Modal>
  );
}

/**
 * Delete, with the blast radius shown first.
 *
 * The host's delete route is a bare `DELETE FROM goals`, and every inbound
 * foreign key is `ON DELETE no action`. So deleting a goal that still has a
 * child, a linked task, or a project holding the legacy column throws a raw
 * database error at the user. This dialog computes exactly what is attached,
 * offers to detach it, and only then deletes.
 */
function DeleteGoalDialog({
  goal,
  companyId,
  goals,
  projects,
  busy,
  onClose,
  onDone,
  onError,
  setBusy,
  onRefresh,
}: {
  goal: Goal;
  companyId: string;
  goals: Goal[];
  projects: Project[];
  busy: boolean;
  onClose: () => void;
  onDone: () => void;
  onError: (message: string) => void;
  setBusy: (value: boolean) => void;
  /** Re-pull the workspace aggregate after a partially-applied detach. */
  onRefresh: () => void;
}) {
  const issues = usePluginData<GoalIssuesPayload>("goal-issues", { companyId, goalId: goal.id });
  const directIssues = issues.data?.direct ?? [];
  const [confirmed, setConfirmed] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  const impact: DeleteImpact = useMemo(
    () => computeDeleteImpact(goal.id, goals, projects, directIssues),
    [goal.id, goals, projects, directIssues],
  );
  const plan = useMemo(() => planDetach(impact, goals, projects), [impact, goals, projects]);
  const inheritedParent = goal.parentId ? goals.find((candidate) => candidate.id === goal.parentId) : null;
  const issueTarget = plan.issueTargetGoalId
    ? goals.find((candidate) => candidate.id === plan.issueTargetGoalId) ?? null
    : null;

  const remove = async () => {
    if (plan.blocked) {
      setLocalError(plan.blocked);
      return;
    }
    setBusy(true);
    setLocalError(null);
    try {
      // Detach first: children lift to this goal's own parent, tasks move to a
      // surviving goal, projects lose the link. Only then is the row deletable.
      for (const move of plan.reparent) await updateGoal(move.goalId, { parentId: move.parentId });
      for (const move of plan.moveIssues) await updateIssueGoal(move.issueId, move.goalId);
      for (const patch of plan.projects) {
        await updateProjectGoals(patch.projectId, {
          goalIds: patch.goalIds,
          ...(patch.goalId === null ? { goalId: null } : {}),
        });
      }
      await deleteGoal(goal.id);
      onDone();
    } catch (failure) {
      // The detach writes are sequential and there is no rollback, so a
      // mid-loop failure leaves some of them applied. Nothing is orphaned — the
      // host logs `goal.updated` / `issue.updated` / `project.updated` for each
      // one — but the dialog would otherwise keep showing the impact and plan it
      // computed BEFORE the partial run, and a retry would re-issue writes that
      // already succeeded. Refetch so the next attempt is planned against what
      // is now true.
      onRefresh();
      issues.refresh();
      const message = errorText(failure);
      setLocalError(message);
      onError(message);
    } finally {
      setBusy(false);
    }
  };

  const loading = issues.loading && !issues.data;

  return (
    <Modal
      title={`Delete “${goal.title}”?`}
      busy={busy}
      onClose={onClose}
      actions={
        <>
          <button type="button" className="gw-btn" disabled={busy} onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="gw-btn gw-btn--danger-solid"
            disabled={busy || loading || plan.blocked !== null || (!impact.safe && !confirmed)}
            onClick={remove}
          >
            {busy ? "Deleting…" : impact.safe ? "Delete goal" : `Detach ${plan.writeCount} and delete`}
          </button>
        </>
      }
    >
      <div className="gw-stack-sm">
        {loading ? (
          <p className="gw-sub">
            <Spinner /> Checking what is attached…
          </p>
        ) : impact.safe ? (
          <div className="gw-callout gw-callout--info">
            Nothing is attached to this goal. Deleting it removes the goal only.
          </div>
        ) : (
          <>
            <div className="gw-callout gw-callout--danger">
              This goal cannot be deleted while things point at it. Paperclip's goal table uses non-cascading
              foreign keys, so the following will be detached first — {plan.writeCount} change
              {plan.writeCount === 1 ? "" : "s"}, then the delete.
            </div>
            <ul style={{ margin: 0, paddingLeft: 18 }}>
              {impact.childGoals.length > 0 ? (
                <li>
                  <strong>{impact.childGoals.length}</strong> sub-goal
                  {impact.childGoals.length === 1 ? "" : "s"} move to{" "}
                  {inheritedParent ? `“${inheritedParent.title}”` : "the top level"}
                </li>
              ) : null}
              {impact.issues.length > 0 ? (
                <li>
                  <strong>{impact.issues.length}</strong> task{impact.issues.length === 1 ? "" : "s"} move to{" "}
                  {issueTarget ? `“${issueTarget.title}”` : "another goal"} — Paperclip cannot leave a task without a
                  goal, so they are reassigned rather than cleared
                </li>
              ) : null}
              {impact.legacyProjects.length + impact.cascadingProjects.length > 0 ? (
                <li>
                  <strong>{impact.legacyProjects.length + impact.cascadingProjects.length}</strong> project
                  {impact.legacyProjects.length + impact.cascadingProjects.length === 1 ? "" : "s"} unlink from this
                  goal
                </li>
              ) : null}
            </ul>
            {plan.blocked ? (
              <div className="gw-callout gw-callout--warn">{plan.blocked}</div>
            ) : (
              <label className="gw-check">
                <input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />
                <span>I understand these links are removed permanently.</span>
              </label>
            )}
          </>
        )}
        <ErrorNote error={localError} />
      </div>
    </Modal>
  );
}

function LinkProjectsDialog({
  goal,
  projects,
  busy,
  onClose,
  onSubmit,
}: {
  goal: Goal;
  projects: Project[];
  busy: boolean;
  onClose: () => void;
  onSubmit: (projectIds: string[]) => void;
}) {
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState("");

  const available = projects
    .filter((project) => !projectGoalIds(project).includes(goal.id) && !project.archivedAt)
    .filter((project) => project.name.toLowerCase().includes(query.trim().toLowerCase()));

  return (
    <Modal
      title="Link projects"
      description={`Projects linked to “${goal.title}” contribute their tasks to its progress.`}
      busy={busy}
      onClose={onClose}
      actions={
        <>
          <button type="button" className="gw-btn" disabled={busy} onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="gw-btn gw-btn--primary"
            disabled={busy || picked.size === 0}
            onClick={() => onSubmit([...picked])}
          >
            {busy ? "Linking…" : `Link ${picked.size || ""}`.trim()}
          </button>
        </>
      }
    >
      <div className="gw-stack-sm">
        <input
          className="gw-input"
          type="search"
          placeholder="Filter projects…"
          aria-label="Filter projects"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <div style={{ maxHeight: 300, overflow: "auto", border: "1px solid var(--gw-border)" }}>
          {available.length === 0 ? (
            <p className="gw-empty">No unlinked projects match.</p>
          ) : (
            available.map((project) => (
              <label key={project.id} className="gw-check" style={{ padding: "7px 11px" }}>
                <input
                  type="checkbox"
                  checked={picked.has(project.id)}
                  onChange={(event) => {
                    const next = new Set(picked);
                    if (event.target.checked) next.add(project.id);
                    else next.delete(project.id);
                    setPicked(next);
                  }}
                />
                <span className="gw-stack-sm" style={{ gap: 1 }}>
                  <span>{project.name}</span>
                  <span className="gw-faint" style={{ fontSize: 11 }}>
                    {project.status.replace(/_/g, " ")}
                  </span>
                </span>
              </label>
            ))
          )}
        </div>
      </div>
    </Modal>
  );
}

function LinkIssuesDialog({
  goal,
  companyId,
  busy,
  onClose,
  onSubmit,
}: {
  goal: Goal;
  companyId: string;
  busy: boolean;
  onClose: () => void;
  onSubmit: (issueIds: string[]) => void;
}) {
  const [query, setQuery] = useState("");
  const [unlinkedOnly, setUnlinkedOnly] = useState(true);
  const [picked, setPicked] = useState<Set<string>>(new Set());

  const search = usePluginData<IssueSearchPayload>("issue-search", {
    companyId,
    query,
    excludeGoalId: goal.id,
    unlinkedOnly,
  });
  const results = search.data?.issues ?? [];

  return (
    <Modal
      title="Link tasks"
      description={`Tasks linked to “${goal.title}” count toward its progress.`}
      busy={busy}
      onClose={onClose}
      actions={
        <>
          <button type="button" className="gw-btn" disabled={busy} onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="gw-btn gw-btn--primary"
            disabled={busy || picked.size === 0}
            onClick={() => onSubmit([...picked])}
          >
            {busy ? "Linking…" : `Link ${picked.size || ""}`.trim()}
          </button>
        </>
      }
    >
      <div className="gw-stack-sm">
        <input
          className="gw-input"
          type="search"
          placeholder="Search tasks by title or identifier…"
          aria-label="Search tasks"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <label className="gw-check">
          <input
            type="checkbox"
            checked={unlinkedOnly}
            onChange={(event) => setUnlinkedOnly(event.target.checked)}
          />
          <span>Only tasks with no goal yet</span>
        </label>
        <div style={{ maxHeight: 290, overflow: "auto", border: "1px solid var(--gw-border)" }}>
          {search.loading && results.length === 0 ? (
            <p className="gw-empty">
              <Spinner /> Searching…
            </p>
          ) : results.length === 0 ? (
            <p className="gw-empty">No matching tasks.</p>
          ) : (
            results.map((issue) => (
              <label key={issue.id} className="gw-check" style={{ padding: "7px 11px" }}>
                <input
                  type="checkbox"
                  checked={picked.has(issue.id)}
                  onChange={(event) => {
                    const next = new Set(picked);
                    if (event.target.checked) next.add(issue.id);
                    else next.delete(issue.id);
                    setPicked(next);
                  }}
                />
                <span className="gw-row" style={{ gap: 6, minWidth: 0 }}>
                  {issue.identifier ? <span className="gw-mono gw-faint">{issue.identifier}</span> : null}
                  <span className="gw-truncate">{issue.title}</span>
                  <IssueStatusChip status={issue.status} />
                </span>
              </label>
            ))
          )}
        </div>
        {search.data?.truncated ? (
          <p className="gw-faint" style={{ fontSize: 11, margin: 0 }}>
            Showing the first {results.length} matches — refine the search to see more.
          </p>
        ) : null}
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// detailTab — issue
// ---------------------------------------------------------------------------

/**
 * The Goal tab on an issue.
 *
 * `issues.goalId` has existed in the schema all along — inherited from a parent
 * issue or a project's goal on create — but no host surface ever showed it, so a
 * task's goal could only be set from the CLI.
 */
export function IssueGoalTab({ context }: PluginDetailTabProps) {
  const companyId = context.companyId;
  const issueId = context.entityId;
  const navigation = useHostNavigation();
  const toast = usePluginToast();
  const workspace = useWorkspace(companyId);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The optimistic value from our own last write, carried until the refetch
  // lands. It is STAMPED WITH THE ISSUE IT BELONGS TO: the host may keep this
  // tab mounted while the operator moves from issue to issue, and an unstamped
  // override would then show issue A's goal on issue B. Stamping self-corrects
  // without an effect, which is what `InlineText` does for the same problem.
  const [override, setOverride] = useState<{ issueId: string; goalId: string | null } | null>(null);

  // Fetch THIS issue by id. Deriving it from the company-wide `issue-search`
  // page would silently break past its result cap: the viewed issue would fall
  // out of the page and the tab would claim it has no goal.
  const current = usePluginData<SingleIssuePayload>("issue", { companyId, issueId });
  const goals = workspace.data?.goals ?? [];
  const projects = workspace.data?.projects ?? [];
  const rollups = workspace.data?.rollups ?? {};
  const agents = workspace.data?.agents ?? [];

  const known = current.data?.issue ?? null;
  const currentGoalId = override?.issueId === issueId ? override.goalId : known?.goalId ?? null;
  const goal = currentGoalId ? goals.find((candidate) => candidate.id === currentGoalId) ?? null : null;
  const index = useMemo(() => buildGoalIndex(goals), [goals]);
  const ancestors = goal ? ancestorChain(goal.id, index) : [];
  const owner = goal?.ownerAgentId ? agents.find((agent) => agent.id === goal.ownerAgentId) ?? null : null;
  const rollup = goal ? rollups[goal.id] : undefined;

  const assign = async (nextGoalId: string | null) => {
    setPending(true);
    setError(null);
    try {
      // Trust the server's answer, not the request. Clearing a goal is
      // re-derived by the host to the task's project goal or the company
      // default, so the effective value can differ from what was sent.
      const updated = await updateIssueGoal(issueId, nextGoalId);
      const effective = updated?.goalId ?? null;
      setOverride({ issueId, goalId: effective });
      workspace.refresh();
      current.refresh();
      const landed = effective ? goals.find((candidate) => candidate.id === effective) : null;
      if (nextGoalId === null && effective !== null) {
        toast({
          title: `Task fell back to “${landed?.title ?? "another goal"}”`,
          body: "Paperclip re-derives a cleared goal from the task's project, or from the company default when it has no project.",
          tone: "info",
          ttlMs: 6000,
        });
      } else {
        toast({ title: effective ? "Task linked to goal" : "Goal cleared", tone: "success", ttlMs: 2200 });
      }
    } catch (failure) {
      setError(errorText(failure));
    } finally {
      setPending(false);
    }
  };

  // What clearing would actually do, for THIS issue. Not `defaultCompanyGoal`:
  // an issue that belongs to a project never reaches the company default, so
  // that label would promise a landing goal the host would not choose.
  const clearFallback = useMemo(() => {
    if (!known) return null;
    const predicted = predictClearedIssueGoal(known, goals, projects);
    return predicted.goalId ? goals.find((candidate) => candidate.id === predicted.goalId) ?? null : null;
  }, [known, goals, projects]);

  return (
    <Root>
      <div className="gw-pane-pad gw-stack" style={{ maxWidth: 620 }}>
        <ErrorNote error={error} />
        <Section title="Goal">
          <div className="gw-stack-sm">
            <select
              className="gw-select"
              aria-label="Goal for this task"
              value={currentGoalId ?? ""}
              disabled={pending || workspace.loading}
              onChange={(event) => assign(event.target.value === "" ? null : event.target.value)}
            >
              <option value="">
                {clearFallback ? `Clear (falls back to “${clearFallback.title}”)` : "No goal"}
              </option>
              {goals.map((candidate) => (
                <option key={candidate.id} value={candidate.id}>
                  {candidate.title}
                </option>
              ))}
            </select>
            {goal ? (
              <>
                {ancestors.length > 0 ? (
                  <nav className="gw-breadcrumb" aria-label="Parent goals">
                    {ancestors.map((ancestor) => (
                      <React.Fragment key={ancestor.id}>
                        <a className="gw-link" {...navigation.linkProps(hostGoalHref(ancestor.id))}>
                          {ancestor.title}
                        </a>
                        <span className="gw-breadcrumb-sep">/</span>
                      </React.Fragment>
                    ))}
                    <span>{goal.title}</span>
                  </nav>
                ) : null}
                <div className="gw-row-wrap">
                  <StatusChip status={goal.status} />
                  <LevelChip level={goal.level} />
                  {owner ? <span className="gw-chip gw-chip--count">owner: {owner.name}</span> : null}
                </div>
                {rollup && rollup.percent !== null ? (
                  <div className="gw-row">
                    <ProgressBar percent={rollup.percent} wide />
                    <span className="gw-pct">{rollup.percent}%</span>
                  </div>
                ) : null}
                {rollup ? <p className="gw-faint" style={{ margin: 0, fontSize: 11.5 }}>{progressLabel(rollup)}</p> : null}
                <div className="gw-row-wrap">
                  <a className="gw-btn gw-btn--xs" {...navigation.linkProps(pageHref(goal.id))}>
                    Open in Goals workspace
                  </a>
                  <button
                    type="button"
                    className="gw-btn gw-btn--xs gw-btn--danger"
                    disabled={pending}
                    onClick={() => assign(null)}
                  >
                    <IconUnlink /> Unlink
                  </button>
                </div>
              </>
            ) : (
              <p className="gw-faint" style={{ margin: 0 }}>
                This task is not linked to a goal. Pick one above to roll its progress up.
              </p>
            )}
          </div>
        </Section>
      </div>
    </Root>
  );
}

// ---------------------------------------------------------------------------
// detailTab — project
// ---------------------------------------------------------------------------

export function ProjectGoalsTab({ context }: PluginDetailTabProps) {
  const companyId = context.companyId;
  const projectId = context.entityId;
  const navigation = useHostNavigation();
  const toast = usePluginToast();
  const workspace = useWorkspace(companyId);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const goals = workspace.data?.goals ?? [];
  const rollups = workspace.data?.rollups ?? {};
  const project = workspace.data?.projects.find((candidate) => candidate.id === projectId) ?? null;
  const linkedIds = project ? projectGoalIds(project) : [];

  const setLinked = async (nextIds: string[], label: string) => {
    if (!project) return;
    setPending(true);
    setError(null);
    try {
      await updateProjectGoals(project.id, {
        goalIds: nextIds,
        // The legacy single-goal column carries a non-cascading FK. Clear it
        // whenever its goal is no longer among the links, or it silently keeps
        // a relationship the UI says is gone.
        ...(project.goalId && !nextIds.includes(project.goalId) ? { goalId: null } : {}),
      });
      workspace.refresh();
      toast({ title: label, tone: "success", ttlMs: 2200 });
    } catch (failure) {
      setError(errorText(failure));
    } finally {
      setPending(false);
    }
  };

  return (
    <Root>
      <div className="gw-pane-pad gw-stack" style={{ maxWidth: 680 }}>
        <ErrorNote error={error} />
        <Section title="Linked goals" count={linkedIds.length} flush>
          {linkedIds.length === 0 ? (
            <p className="gw-empty">This project is not linked to any goal.</p>
          ) : (
            linkedIds.map((goalId) => {
              const goal = goals.find((candidate) => candidate.id === goalId);
              const rollup = rollups[goalId];
              return (
                <div key={goalId} className="gw-list-row">
                  <a className="gw-link gw-truncate" style={{ flex: 1 }} {...navigation.linkProps(pageHref(goalId))}>
                    {goal?.title ?? goalId}
                  </a>
                  {rollup && rollup.percent !== null ? (
                    <>
                      <ProgressBar percent={rollup.percent} />
                      <span className="gw-pct">{rollup.percent}%</span>
                    </>
                  ) : null}
                  {goal ? <StatusChip status={goal.status} /> : null}
                  <button
                    type="button"
                    className="gw-btn gw-btn--ghost gw-btn--xs gw-reveal"
                    disabled={pending}
                    title="Unlink goal"
                    aria-label={`Unlink ${goal?.title ?? goalId}`}
                    onClick={() => setLinked(linkedIds.filter((id) => id !== goalId), "Goal unlinked")}
                  >
                    <IconUnlink />
                  </button>
                </div>
              );
            })
          )}
        </Section>

        <Section title="Add a goal">
          <select
            className="gw-select"
            aria-label="Link a goal to this project"
            value=""
            disabled={pending || workspace.loading || !project}
            onChange={(event) => {
              if (!event.target.value) return;
              setLinked([...linkedIds, event.target.value], "Goal linked");
            }}
          >
            <option value="">Choose a goal…</option>
            {goals
              .filter((goal) => !linkedIds.includes(goal.id))
              .map((goal) => (
                <option key={goal.id} value={goal.id}>
                  {goal.title}
                </option>
              ))}
          </select>
        </Section>
      </div>
    </Root>
  );
}
