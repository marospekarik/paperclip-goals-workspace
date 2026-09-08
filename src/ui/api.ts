/**
 * Host REST client — the plugin's single write path.
 *
 * Plugin UI bundles are same-origin JavaScript inside the Paperclip app and carry
 * the board session, which the SDK documents as a supported way to call ordinary
 * Paperclip HTTP APIs. These are the exact five endpoints the `paperclipai goal`,
 * `project` and `issue` CLI commands hit, so anything the workspace does here is
 * something an operator could already have done from a terminal.
 */

import type { Goal, Issue, Project } from "../model.js";

const API_BASE = "/api";

export class HostApiError extends Error {
  readonly status: number;
  readonly body: string;

  constructor(status: number, message: string, body: string) {
    super(message);
    this.name = "HostApiError";
    this.status = status;
    this.body = body;
  }

  /**
   * Whether the failure looks like the non-cascading foreign key on `goals`.
   *
   * Every inbound FK on the goals table is `ON DELETE no action`, so a delete
   * that still has a child goal, a linked issue or a legacy-linked project comes
   * back as a raw Postgres constraint error rather than a friendly 409. The
   * workspace pre-flights the impact so this should be unreachable, but when a
   * row we cannot see (a cost or finance event) holds the reference, this is the
   * only signal available.
   */
  get looksLikeForeignKeyBlock(): boolean {
    const haystack = `${this.message} ${this.body}`.toLowerCase();
    return (
      haystack.includes("foreign key") ||
      haystack.includes("violates") ||
      haystack.includes("constraint")
    );
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    method,
    credentials: "same-origin",
    headers: body === undefined ? { Accept: "application/json" } : {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  const raw = await response.text();
  if (!response.ok) {
    let message = `${method} ${path} failed (${response.status})`;
    try {
      const parsed = JSON.parse(raw) as { error?: string; message?: string };
      if (parsed.error) message = parsed.error;
      else if (parsed.message) message = parsed.message;
    } catch {
      if (raw.trim().length > 0 && raw.length < 400) message = raw.trim();
    }
    throw new HostApiError(response.status, message, raw);
  }

  if (raw.length === 0) return undefined as T;
  return JSON.parse(raw) as T;
}

// ---------------------------------------------------------------------------
// Goals — mirrors `paperclipai goal create|update|delete`
// ---------------------------------------------------------------------------

export interface GoalCreateInput {
  title: string;
  description?: string | null;
  level?: string;
  status?: string;
  parentId?: string | null;
  ownerAgentId?: string | null;
}

export type GoalPatch = Partial<GoalCreateInput>;

export function createGoal(companyId: string, input: GoalCreateInput): Promise<Goal> {
  return request<Goal>("POST", `/companies/${companyId}/goals`, input);
}

export function updateGoal(goalId: string, patch: GoalPatch): Promise<Goal> {
  return request<Goal>("PATCH", `/goals/${goalId}`, patch);
}

export function deleteGoal(goalId: string): Promise<Goal> {
  return request<Goal>("DELETE", `/goals/${goalId}`);
}

// ---------------------------------------------------------------------------
// Linking — mirrors `project update --goal-ids` and `issue update --goal-id`
// ---------------------------------------------------------------------------

export interface ProjectGoalPatch {
  goalIds: string[];
  /** Only sent when the legacy single-goal column needs clearing or setting. */
  goalId?: string | null;
}

export function updateProjectGoals(projectId: string, patch: ProjectGoalPatch): Promise<Project> {
  return request<Project>("PATCH", `/projects/${projectId}`, patch);
}

export function updateIssueGoal(issueId: string, goalId: string | null): Promise<Issue> {
  return request<Issue>("PATCH", `/issues/${issueId}`, { goalId });
}

export function getIssue(issueId: string): Promise<Issue> {
  return request<Issue>("GET", `/issues/${issueId}`);
}
