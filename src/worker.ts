/**
 * Plugin worker — a read model, and nothing else.
 *
 * Every mutation this plugin performs goes over the host's own REST API from the
 * UI bundle (same origin, board session), never through the bridge. That is a
 * deliberate one-write-path design and it is forced by the SDK surface as much as
 * chosen: `ctx.goals` has no `delete`, and `ctx.projects` has no `update` at all,
 * so goal deletion and project linking could not be worker-side even if we wanted
 * them there. Splitting writes across two transports would leave two sources of
 * truth for the same row.
 *
 * What the worker is genuinely good for is the aggregate: the progress rollup
 * needs every goal, every project and every issue in the company joined together,
 * and doing that join here means the browser receives a few kilobytes of counts
 * instead of the company's entire issue table.
 */

import { definePlugin, runWorker, type PluginContext } from "@paperclipai/plugin-sdk";

import {
  computeRollups,
  projectGoalIds,
  type Agent,
  type Goal,
  type GoalRollup,
  type Issue,
  type Project,
} from "./model.js";

/** Hard ceiling on issues pulled for one rollup. Surfaced to the UI when hit. */
const ISSUE_FETCH_CAP = 5000;
const ISSUE_PAGE_SIZE = 500;
/** Result ceiling for the issue-link picker. */
const SEARCH_LIMIT = 50;

export interface WorkspacePayload {
  companyId: string;
  goals: Goal[];
  agents: Agent[];
  projects: Project[];
  /** One rollup per goal, keyed by goal id in a plain object for JSON transport. */
  rollups: Record<string, GoalRollup>;
  issueCount: number;
  /** True when the company has more issues than the rollup could read. */
  truncated: boolean;
  generatedAt: string;
}

export interface GoalIssuesPayload {
  goalId: string;
  /** Issues pointed straight at the goal. */
  direct: Issue[];
  /** Issues reaching it only through a linked project. */
  viaProjects: Issue[];
}

export interface IssueSearchPayload {
  issues: Issue[];
  truncated: boolean;
}

function compactGoal(goal: Record<string, unknown>): Goal {
  return {
    id: String(goal.id),
    companyId: String(goal.companyId),
    title: String(goal.title ?? ""),
    description: (goal.description as string | null) ?? null,
    level: String(goal.level ?? "task"),
    status: String(goal.status ?? "planned"),
    parentId: (goal.parentId as string | null) ?? null,
    ownerAgentId: (goal.ownerAgentId as string | null) ?? null,
    createdAt: goal.createdAt ? String(goal.createdAt) : undefined,
    updatedAt: goal.updatedAt ? String(goal.updatedAt) : undefined,
  };
}

function compactAgent(agent: Record<string, unknown>): Agent {
  return {
    id: String(agent.id),
    name: String(agent.name ?? ""),
    role: (agent.role as string | null) ?? null,
    status: (agent.status as string | null) ?? null,
    urlKey: (agent.urlKey as string | null) ?? null,
  };
}

function compactProject(project: Record<string, unknown>): Project {
  return {
    id: String(project.id),
    name: String(project.name ?? ""),
    status: String(project.status ?? "backlog"),
    description: (project.description as string | null) ?? null,
    urlKey: (project.urlKey as string | null) ?? null,
    archivedAt: (project.archivedAt as string | null) ?? null,
    goalId: (project.goalId as string | null) ?? null,
    goalIds: Array.isArray(project.goalIds) ? (project.goalIds as string[]) : [],
  };
}

function compactIssue(issue: Record<string, unknown>): Issue {
  return {
    id: String(issue.id),
    title: String(issue.title ?? ""),
    status: String(issue.status ?? "backlog"),
    goalId: (issue.goalId as string | null) ?? null,
    projectId: (issue.projectId as string | null) ?? null,
    identifier: (issue.identifier as string | null) ?? null,
    priority: (issue.priority as string | null) ?? null,
    assigneeAgentId: (issue.assigneeAgentId as string | null) ?? null,
    updatedAt: issue.updatedAt ? String(issue.updatedAt) : undefined,
  };
}

/**
 * Every issue in the company, up to the cap.
 *
 * `ctx.issues.list` has no `goalId` filter (neither does the REST route behind
 * it), so there is no way to ask the host for "issues belonging to this goal".
 * The rollup therefore reads the company's issues once and indexes them here.
 */
async function fetchIssues(ctx: PluginContext, companyId: string): Promise<{ issues: Issue[]; truncated: boolean }> {
  const issues: Issue[] = [];
  let offset = 0;
  while (issues.length < ISSUE_FETCH_CAP) {
    const page = await ctx.issues.list({
      companyId,
      limit: ISSUE_PAGE_SIZE,
      offset,
      excludeRoutineExecutions: true,
    } as Parameters<typeof ctx.issues.list>[0]);
    if (!Array.isArray(page) || page.length === 0) {
      return { issues, truncated: false };
    }
    for (const row of page) issues.push(compactIssue(row as unknown as Record<string, unknown>));
    if (page.length < ISSUE_PAGE_SIZE) return { issues, truncated: false };
    offset += page.length;
  }
  return { issues: issues.slice(0, ISSUE_FETCH_CAP), truncated: true };
}

function requireCompanyId(params: Record<string, unknown>): string {
  const companyId = params.companyId;
  if (typeof companyId !== "string" || companyId.length === 0) {
    throw new Error("companyId is required");
  }
  return companyId;
}

const plugin = definePlugin({
  async setup(ctx) {
    /** Channels already opened this process, so `open` runs once per company. */
    const openChannels = new Set<string>();

    const notifyChange = (companyId: string | null | undefined, kind: string) => {
      if (!companyId) return;
      const channel = `goals:${companyId}`;
      try {
        if (!openChannels.has(channel)) {
          ctx.streams.open(channel, companyId);
          openChannels.add(channel);
        }
        ctx.streams.emit(channel, { kind, at: new Date().toISOString() });
      } catch (error) {
        // A dead stream must never break goal editing — the UI refetches after
        // its own writes regardless, so this push is strictly additive.
        ctx.logger.warn("stream emit failed", { channel, error: String(error) });
      }
    };

    for (const event of ["goal.created", "goal.updated", "issue.updated", "project.updated"] as const) {
      ctx.events.on(event, async (payload) => {
        notifyChange((payload as { companyId?: string }).companyId, event);
      });
    }

    // -- The workspace aggregate -------------------------------------------
    ctx.data.register("workspace", async (params) => {
      const companyId = requireCompanyId(params as Record<string, unknown>);

      const [goalRows, agentRows, projectRows] = await Promise.all([
        ctx.goals.list({ companyId, limit: 1000 }),
        ctx.agents.list({ companyId, limit: 500 }),
        ctx.projects.list({ companyId, limit: 500 }),
      ]);
      const { issues, truncated } = await fetchIssues(ctx, companyId);

      const goals = goalRows.map((row) => compactGoal(row as unknown as Record<string, unknown>));
      const agents = agentRows.map((row) => compactAgent(row as unknown as Record<string, unknown>));
      const projects = projectRows.map((row) => compactProject(row as unknown as Record<string, unknown>));

      const rollupMap = computeRollups(goals, projects, issues);
      const rollups: Record<string, GoalRollup> = {};
      for (const [goalId, rollup] of rollupMap) rollups[goalId] = rollup;

      const payload: WorkspacePayload = {
        companyId,
        goals,
        agents,
        projects,
        rollups,
        issueCount: issues.length,
        truncated,
        generatedAt: new Date().toISOString(),
      };
      return payload as unknown as Record<string, unknown>;
    });

    // -- Issues attached to one goal ---------------------------------------
    ctx.data.register("goal-issues", async (params) => {
      const input = params as Record<string, unknown>;
      const companyId = requireCompanyId(input);
      const goalId = String(input.goalId ?? "");
      if (!goalId) throw new Error("goalId is required");

      const [projectRows, { issues }] = await Promise.all([
        ctx.projects.list({ companyId, limit: 500 }),
        fetchIssues(ctx, companyId),
      ]);
      const projects = projectRows.map((row) => compactProject(row as unknown as Record<string, unknown>));
      const projectIds = new Set(
        projects.filter((project) => projectGoalIds(project).includes(goalId)).map((project) => project.id),
      );

      const direct = issues.filter((issue) => issue.goalId === goalId);
      const directIds = new Set(direct.map((issue) => issue.id));
      const viaProjects = issues.filter(
        (issue) => !directIds.has(issue.id) && issue.projectId !== null && projectIds.has(issue.projectId),
      );

      const payload: GoalIssuesPayload = { goalId, direct, viaProjects };
      return payload as unknown as Record<string, unknown>;
    });

    // -- Picker search for linking loose tasks ------------------------------
    ctx.data.register("issue-search", async (params) => {
      const input = params as Record<string, unknown>;
      const companyId = requireCompanyId(input);
      const query = String(input.query ?? "").trim().toLowerCase();
      const excludeGoalId = input.excludeGoalId ? String(input.excludeGoalId) : null;
      const unlinkedOnly = input.unlinkedOnly === true;

      const { issues, truncated } = await fetchIssues(ctx, companyId);
      const matches = issues.filter((issue) => {
        if (excludeGoalId && issue.goalId === excludeGoalId) return false;
        if (unlinkedOnly && issue.goalId !== null) return false;
        if (!query) return true;
        return `${issue.identifier ?? ""} ${issue.title}`.toLowerCase().includes(query);
      });

      const payload: IssueSearchPayload = {
        issues: matches.slice(0, SEARCH_LIMIT),
        truncated: truncated || matches.length > SEARCH_LIMIT,
      };
      return payload as unknown as Record<string, unknown>;
    });

    ctx.logger.info("Goals Workspace worker ready");
  },

  async onHealth() {
    return { status: "ok" as const, message: "Read model online" };
  },
});

export default plugin;
runWorker(plugin, import.meta.url);
