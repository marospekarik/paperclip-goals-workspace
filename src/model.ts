/**
 * Pure goal-graph model: hierarchy, progress rollup, filtering, reparent safety,
 * and delete impact.
 *
 * No React, no SDK, no I/O — every function here is a total function over plain
 * data, so the worker, the UI and the tests all share one implementation and the
 * arithmetic that drives the progress bars is unit-testable without a browser.
 */

// ---------------------------------------------------------------------------
// Host enums. Mirrored from @paperclipai/shared/dist/constants.js rather than
// imported: `shared` is not a plugin dependency, and these four lists are part
// of the host's public API surface (the CLI validates against the same values).
// ---------------------------------------------------------------------------

export const GOAL_LEVELS = ["company", "team", "agent", "task"] as const;
export const GOAL_STATUSES = ["planned", "active", "achieved", "cancelled"] as const;
export const ISSUE_STATUSES = [
  "backlog",
  "todo",
  "in_progress",
  "in_review",
  "done",
  "blocked",
  "cancelled",
] as const;

export type GoalLevel = (typeof GOAL_LEVELS)[number];
export type GoalStatus = (typeof GOAL_STATUSES)[number];
export type IssueStatus = (typeof ISSUE_STATUSES)[number];

/** Issue statuses that count as delivered for progress purposes. */
const DONE_ISSUE_STATUSES: ReadonlySet<string> = new Set(["done"]);
/** Issue statuses excluded from the progress denominator entirely. */
const DISCOUNTED_ISSUE_STATUSES: ReadonlySet<string> = new Set(["cancelled"]);
/** Goal statuses excluded from the sub-goal denominator. */
const DISCOUNTED_GOAL_STATUSES: ReadonlySet<string> = new Set(["cancelled"]);

// ---------------------------------------------------------------------------
// Shapes. Structural subsets of the host payloads — only the fields this plugin
// reads, so a host response gaining fields never breaks the model.
// ---------------------------------------------------------------------------

export interface Goal {
  id: string;
  companyId: string;
  title: string;
  description: string | null;
  level: string;
  status: string;
  parentId: string | null;
  ownerAgentId: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface Project {
  id: string;
  name: string;
  status: string;
  description?: string | null;
  urlKey?: string | null;
  archivedAt?: string | null;
  /** @deprecated single-goal column, still enforced by a non-cascading FK. */
  goalId: string | null;
  /** Many-to-many links via the `project_goals` join table. */
  goalIds?: string[];
}

export interface Issue {
  id: string;
  title: string;
  status: string;
  goalId: string | null;
  projectId: string | null;
  identifier?: string | null;
  priority?: string | null;
  assigneeAgentId?: string | null;
  updatedAt?: string;
}

export interface Agent {
  id: string;
  name: string;
  role?: string | null;
  status?: string | null;
  urlKey?: string | null;
}

// ---------------------------------------------------------------------------
// Hierarchy
// ---------------------------------------------------------------------------

export interface GoalIndex {
  byId: Map<string, Goal>;
  childrenOf: Map<string, Goal[]>;
  /** Goals whose parent is null, or whose parent is missing from the set. */
  roots: Goal[];
}

export function buildGoalIndex(goals: Goal[]): GoalIndex {
  const byId = new Map<string, Goal>();
  for (const goal of goals) byId.set(goal.id, goal);

  const childrenOf = new Map<string, Goal[]>();
  const roots: Goal[] = [];
  for (const goal of goals) {
    const parentId = goal.parentId;
    if (parentId && byId.has(parentId) && parentId !== goal.id) {
      const siblings = childrenOf.get(parentId);
      if (siblings) siblings.push(goal);
      else childrenOf.set(parentId, [goal]);
    } else {
      roots.push(goal);
    }
  }
  return { byId, childrenOf, roots };
}

/**
 * Every descendant id of `goalId`, excluding itself. Cycle-safe: a goal already
 * visited is never expanded twice, so malformed data cannot hang the UI.
 */
export function descendantIds(goalId: string, index: GoalIndex): string[] {
  const out: string[] = [];
  const seen = new Set<string>([goalId]);
  const stack = [...(index.childrenOf.get(goalId) ?? [])];
  while (stack.length > 0) {
    const next = stack.pop()!;
    if (seen.has(next.id)) continue;
    seen.add(next.id);
    out.push(next.id);
    for (const child of index.childrenOf.get(next.id) ?? []) stack.push(child);
  }
  return out;
}

/** The chain from the root down to (but excluding) `goalId`, outermost first. */
export function ancestorChain(goalId: string, index: GoalIndex): Goal[] {
  const chain: Goal[] = [];
  const seen = new Set<string>([goalId]);
  let current = index.byId.get(goalId)?.parentId ?? null;
  while (current && !seen.has(current)) {
    const parent = index.byId.get(current);
    if (!parent) break;
    seen.add(current);
    chain.unshift(parent);
    current = parent.parentId;
  }
  return chain;
}

/**
 * Goals a given goal may legally be reparented under: everything except itself
 * and its own descendants. Moving a goal under its own descendant would detach
 * the whole subtree into an orphan cycle that no tree view can render.
 */
export function validParentOptions(goalId: string, goals: Goal[]): Goal[] {
  const index = buildGoalIndex(goals);
  const forbidden = new Set<string>([goalId, ...descendantIds(goalId, index)]);
  return goals.filter((goal) => !forbidden.has(goal.id));
}

export function wouldCreateCycle(goalId: string, nextParentId: string | null, goals: Goal[]): boolean {
  if (!nextParentId) return false;
  if (nextParentId === goalId) return true;
  const index = buildGoalIndex(goals);
  return descendantIds(goalId, index).includes(nextParentId);
}

// ---------------------------------------------------------------------------
// Linking
// ---------------------------------------------------------------------------

/** Every goal id a project is linked to, across both the M2M and legacy columns. */
export function projectGoalIds(project: Project): string[] {
  const ids = new Set<string>(project.goalIds ?? []);
  if (project.goalId) ids.add(project.goalId);
  return [...ids];
}

export function projectsForGoal(goalId: string, projects: Project[]): Project[] {
  return projects.filter((project) => projectGoalIds(project).includes(goalId));
}

// ---------------------------------------------------------------------------
// Progress rollup
// ---------------------------------------------------------------------------

export interface TaskCounts {
  total: number;
  done: number;
  cancelled: number;
  blocked: number;
  inProgress: number;
  open: number;
  /** Denominator for the percentage: total minus cancelled. */
  countable: number;
}

export interface SubGoalCounts {
  direct: number;
  total: number;
  achieved: number;
  cancelled: number;
  countable: number;
}

export interface GoalRollup {
  goalId: string;
  depth: number;
  descendantIds: string[];
  /** Issues pointed straight at this goal via `issues.goalId`. */
  directIssueIds: string[];
  /** Issues reaching this goal only through one of its linked projects. */
  projectIssueIds: string[];
  /** Projects linked to this goal. */
  projectIds: string[];
  /** Direct + project issues for this goal alone, deduped. */
  ownIssueIds: string[];
  /** Own issues plus every descendant's own issues, deduped. */
  subtreeIssueIds: string[];
  tasks: TaskCounts;
  subGoals: SubGoalCounts;
  /** 0–100, or null when there is nothing to measure. */
  percent: number | null;
  progressBasis: "tasks" | "subgoals" | null;
}

function countIssues(ids: string[], issuesById: Map<string, Issue>): TaskCounts {
  let done = 0;
  let cancelled = 0;
  let blocked = 0;
  let inProgress = 0;
  for (const id of ids) {
    const status = issuesById.get(id)?.status ?? "";
    if (DONE_ISSUE_STATUSES.has(status)) done += 1;
    else if (DISCOUNTED_ISSUE_STATUSES.has(status)) cancelled += 1;
    else if (status === "blocked") blocked += 1;
    else if (status === "in_progress" || status === "in_review") inProgress += 1;
  }
  const total = ids.length;
  const countable = total - cancelled;
  return {
    total,
    done,
    cancelled,
    blocked,
    inProgress,
    open: total - done - cancelled,
    countable,
  };
}

function percentOf(done: number, countable: number): number | null {
  if (countable <= 0) return null;
  return Math.round((done / countable) * 100);
}

/**
 * Progress for every goal, rolled up through the subtree.
 *
 * A goal's tasks are the issues pointed straight at it plus the issues of every
 * project linked to it, unioned with the same set for each of its descendants.
 * The union is by issue id, so an issue that is both directly linked and sitting
 * in a linked project is counted once, and an issue under a goal *and* its
 * parent is counted once at the parent.
 *
 * The percentage prefers tasks. A goal with no tasks at all falls back to how
 * many of its sub-goals are achieved, so a purely strategic goal still reads as
 * making progress. Cancelled issues and cancelled sub-goals leave the
 * denominator — cancelling work should not make a goal look further behind.
 */
export function computeRollups(goals: Goal[], projects: Project[], issues: Issue[]): Map<string, GoalRollup> {
  const index = buildGoalIndex(goals);
  const issuesById = new Map<string, Issue>();
  for (const issue of issues) issuesById.set(issue.id, issue);

  const directByGoal = new Map<string, string[]>();
  for (const issue of issues) {
    if (!issue.goalId) continue;
    const bucket = directByGoal.get(issue.goalId);
    if (bucket) bucket.push(issue.id);
    else directByGoal.set(issue.goalId, [issue.id]);
  }

  const issuesByProject = new Map<string, string[]>();
  for (const issue of issues) {
    if (!issue.projectId) continue;
    const bucket = issuesByProject.get(issue.projectId);
    if (bucket) bucket.push(issue.id);
    else issuesByProject.set(issue.projectId, [issue.id]);
  }

  const projectsByGoal = new Map<string, string[]>();
  for (const project of projects) {
    for (const goalId of projectGoalIds(project)) {
      const bucket = projectsByGoal.get(goalId);
      if (bucket) bucket.push(project.id);
      else projectsByGoal.set(goalId, [project.id]);
    }
  }

  // Per-goal issue sets before rollup.
  const ownIssues = new Map<string, Set<string>>();
  for (const goal of goals) {
    const own = new Set<string>(directByGoal.get(goal.id) ?? []);
    for (const projectId of projectsByGoal.get(goal.id) ?? []) {
      for (const issueId of issuesByProject.get(projectId) ?? []) own.add(issueId);
    }
    ownIssues.set(goal.id, own);
  }

  const depths = computeDepths(goals, index);
  const rollups = new Map<string, GoalRollup>();

  for (const goal of goals) {
    const descendants = descendantIds(goal.id, index);
    const own = ownIssues.get(goal.id) ?? new Set<string>();

    const subtree = new Set<string>(own);
    for (const descendantId of descendants) {
      for (const issueId of ownIssues.get(descendantId) ?? []) subtree.add(issueId);
    }

    const directIssueIds = [...(directByGoal.get(goal.id) ?? [])];
    const directSet = new Set(directIssueIds);
    const projectIssueIds = [...own].filter((id) => !directSet.has(id));

    let achieved = 0;
    let cancelledGoals = 0;
    for (const descendantId of descendants) {
      const status = index.byId.get(descendantId)?.status ?? "";
      if (status === "achieved") achieved += 1;
      else if (DISCOUNTED_GOAL_STATUSES.has(status)) cancelledGoals += 1;
    }

    const tasks = countIssues([...subtree], issuesById);
    const subGoals: SubGoalCounts = {
      direct: (index.childrenOf.get(goal.id) ?? []).length,
      total: descendants.length,
      achieved,
      cancelled: cancelledGoals,
      countable: descendants.length - cancelledGoals,
    };

    let percent = percentOf(tasks.done, tasks.countable);
    let progressBasis: GoalRollup["progressBasis"] = percent === null ? null : "tasks";
    if (percent === null) {
      percent = percentOf(subGoals.achieved, subGoals.countable);
      progressBasis = percent === null ? null : "subgoals";
    }

    rollups.set(goal.id, {
      goalId: goal.id,
      depth: depths.get(goal.id) ?? 0,
      descendantIds: descendants,
      directIssueIds,
      projectIssueIds,
      projectIds: [...(projectsByGoal.get(goal.id) ?? [])],
      ownIssueIds: [...own],
      subtreeIssueIds: [...subtree],
      tasks,
      subGoals,
      percent,
      progressBasis,
    });
  }

  return rollups;
}

function computeDepths(goals: Goal[], index: GoalIndex): Map<string, number> {
  const depths = new Map<string, number>();
  const walk = (goal: Goal, depth: number, seen: Set<string>) => {
    if (seen.has(goal.id)) return;
    seen.add(goal.id);
    depths.set(goal.id, depth);
    for (const child of index.childrenOf.get(goal.id) ?? []) walk(child, depth + 1, seen);
  };
  const seen = new Set<string>();
  for (const root of index.roots) walk(root, 0, seen);
  for (const goal of goals) if (!depths.has(goal.id)) depths.set(goal.id, 0);
  return depths;
}

// ---------------------------------------------------------------------------
// Filtering
// ---------------------------------------------------------------------------

export interface GoalFilter {
  query?: string;
  statuses?: string[];
  levels?: string[];
  ownerAgentId?: string | null;
  /** When true, `ownerAgentId` is ignored and only unowned goals match. */
  unownedOnly?: boolean;
}

export interface FilterResult {
  /** Goals that matched the predicate themselves. */
  matched: Set<string>;
  /** Matches plus every ancestor needed to render them in the tree. */
  visible: Set<string>;
  active: boolean;
}

export function isFilterActive(filter: GoalFilter): boolean {
  return Boolean(
    (filter.query && filter.query.trim().length > 0) ||
      (filter.statuses && filter.statuses.length > 0) ||
      (filter.levels && filter.levels.length > 0) ||
      filter.ownerAgentId ||
      filter.unownedOnly,
  );
}

function matchesGoal(goal: Goal, filter: GoalFilter): boolean {
  const query = filter.query?.trim().toLowerCase();
  if (query) {
    const haystack = `${goal.title} ${goal.description ?? ""}`.toLowerCase();
    if (!haystack.includes(query)) return false;
  }
  if (filter.statuses && filter.statuses.length > 0 && !filter.statuses.includes(goal.status)) return false;
  if (filter.levels && filter.levels.length > 0 && !filter.levels.includes(goal.level)) return false;
  if (filter.unownedOnly) return goal.ownerAgentId === null;
  if (filter.ownerAgentId && goal.ownerAgentId !== filter.ownerAgentId) return false;
  return true;
}

/**
 * Which goals survive a filter, and which must stay on screen to reach them.
 *
 * A tree that hid non-matching ancestors would drop matched leaves out of the
 * hierarchy entirely, so ancestors of a match are always visible — rendered as
 * context rather than as results.
 */
export function filterGoals(goals: Goal[], filter: GoalFilter): FilterResult {
  const active = isFilterActive(filter);
  if (!active) {
    const all = new Set(goals.map((goal) => goal.id));
    return { matched: all, visible: all, active: false };
  }

  const index = buildGoalIndex(goals);
  const matched = new Set<string>();
  for (const goal of goals) if (matchesGoal(goal, filter)) matched.add(goal.id);

  const visible = new Set<string>(matched);
  for (const id of matched) {
    for (const ancestor of ancestorChain(id, index)) visible.add(ancestor.id);
  }
  return { matched, visible, active: true };
}

// ---------------------------------------------------------------------------
// Delete impact
// ---------------------------------------------------------------------------

/**
 * What a `DELETE /api/goals/:id` would collide with.
 *
 * Every inbound foreign key on `goals` is `ON DELETE no action`
 * (migration 0000: `goals.parent_id`, `issues.goal_id`, `projects.goal_id`,
 * `cost_events.goal_id`, `finance_events.goal_id`). Only `project_goals`
 * cascades. So the host's own delete route throws a raw FK error whenever a goal
 * has a child, a directly-linked issue, or a project holding the legacy column —
 * and the plugin has to clear those first or refuse.
 *
 * Cost and finance events are not detachable through any API. They are reported
 * as an unresolvable risk rather than silently attempted.
 */
export interface DeleteImpact {
  goalId: string;
  /** Child goals — blocking. Detached by reparenting. */
  childGoals: Goal[];
  /** Issues carrying `goalId` — blocking. Detached by clearing the column. */
  issues: Issue[];
  /** Projects holding the legacy `goalId` column — blocking. */
  legacyProjects: Project[];
  /** Projects linked only through `project_goals` — the FK cascades, safe. */
  cascadingProjects: Project[];
  blockingCount: number;
  /** True when a bare delete is safe to attempt. */
  safe: boolean;
}

export function computeDeleteImpact(
  goalId: string,
  goals: Goal[],
  projects: Project[],
  issues: Issue[],
): DeleteImpact {
  const childGoals = goals.filter((goal) => goal.parentId === goalId);
  const linkedIssues = issues.filter((issue) => issue.goalId === goalId);
  const legacyProjects = projects.filter((project) => project.goalId === goalId);
  const cascadingProjects = projects.filter(
    (project) => project.goalId !== goalId && (project.goalIds ?? []).includes(goalId),
  );
  const blockingCount = childGoals.length + linkedIssues.length + legacyProjects.length;
  return {
    goalId,
    childGoals,
    issues: linkedIssues,
    legacyProjects,
    cascadingProjects,
    blockingCount,
    safe: blockingCount === 0,
  };
}

/**
 * Where an issue's goal actually lands when you ask the host to clear it.
 *
 * `PATCH /api/issues/:id {goalId: null}` does NOT leave the column null. The
 * host runs `resolveNextIssueGoalId` on every update, and an explicitly-null
 * goal falls through to the issue's project's goal, then to the company's
 * default goal — the oldest `level: "company"`, `status: "active"`, top-level
 * goal (`getDefaultCompanyGoal`). Verified live 2026-09-08: clearing a task's
 * goal silently re-attached it to the company root goal.
 *
 * Two things follow, and both are load-bearing:
 *
 * 1. An "unlink" control that clears the column is a placebo. The write
 *    succeeds and the task reappears under another goal. The UI has to read the
 *    effective goal back and say where it went.
 * 2. Detaching issues before deleting a goal cannot use `null`, because the
 *    re-derived goal may be the very goal being deleted — the foreign key would
 *    still block, *after* the detach writes had already run. Issues must be
 *    reassigned to an explicit surviving goal instead.
 */
export function predictClearedIssueGoal(
  issue: Issue,
  goals: Goal[],
  projects: Project[],
): { goalId: string | null; reason: "project" | "company-default" | "none" } {
  if (issue.projectId) {
    const project = projects.find((candidate) => candidate.id === issue.projectId);
    // ONLY the legacy `projects.goal_id` column. The host's
    // `getProjectDefaultGoalId` selects that single column and never reads the
    // `project_goals` join table, so a project linked purely through the M2M
    // array contributes nothing to this fallback — and that is the normal case
    // here, because this plugin's own link dialog writes `goalIds` only.
    // Consulting the array would predict a goal the host never picks.
    const projectGoalId = project?.goalId ?? null;
    if (projectGoalId) return { goalId: projectGoalId, reason: "project" };
  }
  const fallback = defaultCompanyGoal(goals);
  if (fallback) return { goalId: fallback.id, reason: "company-default" };
  return { goalId: null, reason: "none" };
}

/** The host's `getDefaultCompanyGoal`: oldest active company-level root, then looser fallbacks. */
export function defaultCompanyGoal(goals: Goal[]): Goal | null {
  const byAge = (a: Goal, b: Goal) => String(a.createdAt ?? "").localeCompare(String(b.createdAt ?? ""));
  const companyLevel = goals.filter((goal) => goal.level === "company");
  const activeRoots = companyLevel.filter((goal) => goal.status === "active" && goal.parentId === null);
  if (activeRoots.length > 0) return [...activeRoots].sort(byAge)[0]!;
  const anyRoots = companyLevel.filter((goal) => goal.parentId === null);
  if (anyRoots.length > 0) return [...anyRoots].sort(byAge)[0]!;
  return companyLevel.length > 0 ? [...companyLevel].sort(byAge)[0]! : null;
}

export interface ProjectDetachPatch {
  projectId: string;
  /** Present only when the legacy column pointed at the goal. */
  goalId?: null;
  /** The project's remaining goal ids after the link is removed. */
  goalIds: string[];
}

export interface DetachPlan {
  /** Children to reparent, and where to. */
  reparent: { goalId: string; parentId: string | null }[];
  /**
   * Issues to move, and the goal they move to.
   *
   * Never `null`: an explicitly-null goal is re-derived by the host and can land
   * right back on the goal being deleted (see `predictClearedIssueGoal`), which
   * would leave the foreign key blocking after the other detach writes had
   * already run.
   */
  moveIssues: { issueId: string; goalId: string }[];
  /** Projects whose goal links are rewritten. */
  projects: ProjectDetachPatch[];
  /** The goal issues are moved to, resolved once for the whole plan. */
  issueTargetGoalId: string | null;
  /**
   * Why this goal cannot be deleted at all, or null when the plan is runnable.
   * Set when issues are attached and no surviving goal exists to move them to.
   */
  blocked: string | null;
  /** Total write calls the plan will make, before the delete itself. */
  writeCount: number;
}

/**
 * The detach writes needed before a goal can be deleted.
 *
 * Children are lifted to the deleted goal's own parent rather than orphaned to
 * top level, so removing a middle goal collapses the tree instead of scattering
 * it — the behaviour every file manager and issue tracker already teaches.
 * Attached issues follow the same rule for the same reason, and because they
 * *cannot* simply be cleared: the host re-derives a null goal, possibly back to
 * the goal under deletion.
 */
export function planDetach(impact: DeleteImpact, goals: Goal[], projects: Project[]): DetachPlan {
  const goal = goals.find((candidate) => candidate.id === impact.goalId);
  const inheritedParentId = goal?.parentId ?? null;

  const reparent = impact.childGoals.map((child) => ({
    goalId: child.id,
    parentId: inheritedParentId,
  }));

  // Prefer the deleted goal's parent; otherwise any surviving goal that is not
  // itself about to be re-parented out from under the issues.
  const survivors = goals.filter((candidate) => candidate.id !== impact.goalId);
  const issueTargetGoalId =
    (inheritedParentId && survivors.some((candidate) => candidate.id === inheritedParentId)
      ? inheritedParentId
      : null) ??
    defaultCompanyGoal(survivors)?.id ??
    survivors[0]?.id ??
    null;

  const moveIssues =
    issueTargetGoalId === null
      ? []
      : impact.issues.map((issue) => ({ issueId: issue.id, goalId: issueTargetGoalId }));

  const blocked =
    impact.issues.length > 0 && issueTargetGoalId === null
      ? "This is the only goal, and Paperclip cannot leave a task without one. Create another goal first, or move these tasks yourself."
      : null;

  const touchedProjects = new Map<string, ProjectDetachPatch>();
  for (const project of [...impact.legacyProjects, ...impact.cascadingProjects]) {
    const current = projects.find((candidate) => candidate.id === project.id) ?? project;
    const patch: ProjectDetachPatch = {
      projectId: project.id,
      goalIds: projectGoalIds(current).filter((id) => id !== impact.goalId),
    };
    if (current.goalId === impact.goalId) patch.goalId = null;
    touchedProjects.set(project.id, patch);
  }

  const projectPatches = [...touchedProjects.values()];
  return {
    reparent,
    moveIssues,
    projects: projectPatches,
    issueTargetGoalId,
    blocked,
    writeCount: reparent.length + moveIssues.length + projectPatches.length,
  };
}

// ---------------------------------------------------------------------------
// Presentation helpers
// ---------------------------------------------------------------------------

export function issueStatusGroups(issues: Issue[]): { status: string; issues: Issue[] }[] {
  const order = ISSUE_STATUSES as readonly string[];
  const byStatus = new Map<string, Issue[]>();
  for (const issue of issues) {
    const bucket = byStatus.get(issue.status);
    if (bucket) bucket.push(issue);
    else byStatus.set(issue.status, [issue]);
  }
  return order
    .filter((status) => byStatus.has(status))
    .map((status) => ({ status, issues: byStatus.get(status)! }));
}

/** Short label for a progress readout, e.g. `7/12 tasks` or `2/3 sub-goals`. */
export function progressLabel(rollup: GoalRollup): string | null {
  if (rollup.progressBasis === "tasks") {
    return `${rollup.tasks.done}/${rollup.tasks.countable} task${rollup.tasks.countable === 1 ? "" : "s"}`;
  }
  if (rollup.progressBasis === "subgoals") {
    return `${rollup.subGoals.achieved}/${rollup.subGoals.countable} sub-goal${
      rollup.subGoals.countable === 1 ? "" : "s"
    }`;
  }
  return null;
}
