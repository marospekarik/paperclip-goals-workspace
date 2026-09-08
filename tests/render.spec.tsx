/**
 * Render smoke test for all four mounted surfaces.
 *
 * The plugin's real proving ground is a signed-in browser, and that check is
 * still outstanding. This is the part that does NOT need one: every exported
 * slot component is rendered to a string with the SDK's UI bridge stubbed, so a
 * broken import, an undefined component reference, a bad hook call or a
 * render-time crash cannot reach a published package unnoticed.
 *
 * It deliberately does not claim to verify behaviour — effects do not run in a
 * string render. It verifies that the bundle mounts and paints its first frame
 * for a realistic payload, an empty payload, and a null company.
 */

import { afterAll, beforeAll, describe, expect, mock, test } from "bun:test";
import { renderToString } from "react-dom/server";
import React from "react";

import type { Goal, Issue, Project } from "../src/model.js";
import { computeRollups } from "../src/model.js";

// --- SDK bridge stub --------------------------------------------------------
// The host provides these at runtime. Outside it, they are replaced with inert
// implementations so the components' own logic is what is under test.

const COMPANY = "company-1";

const goals: Goal[] = [
  {
    id: "root",
    companyId: COMPANY,
    title: "Run the company without manual intervention",
    description: "Drop a task, the right agent finishes it.",
    level: "company",
    status: "active",
    parentId: null,
    ownerAgentId: "agent-1",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  },
  {
    id: "team",
    companyId: COMPANY,
    title: "Fleet reliably picks up dropped tasks",
    description: null,
    level: "team",
    status: "active",
    parentId: "root",
    ownerAgentId: null,
  },
  {
    id: "leaf",
    companyId: COMPANY,
    title: "Recovery actions clear themselves",
    description: null,
    level: "task",
    status: "planned",
    parentId: "team",
    ownerAgentId: null,
  },
];

const projects: Project[] = [
  { id: "p1", name: "Control Plane", status: "in_progress", goalId: null, goalIds: ["team"], urlKey: "control-plane" },
  { id: "p2", name: "Unlinked", status: "backlog", goalId: null, goalIds: [] },
];

const issues: Issue[] = [
  { id: "i1", title: "Atomic checkout", status: "done", goalId: "team", projectId: "p1", identifier: "E-1" },
  { id: "i2", title: "Budget auto-pause", status: "todo", goalId: "team", projectId: "p1", identifier: "E-2" },
  { id: "i3", title: "Wire the watchdog", status: "blocked", goalId: "leaf", projectId: null, identifier: "E-3" },
];

const agents = [{ id: "agent-1", name: "Reflection Coach", role: "general", status: "idle", urlKey: "reflection-coach" }];

function workspacePayload(empty: boolean) {
  const source = empty ? { goals: [], projects: [], issues: [] } : { goals, projects, issues };
  const rollupMap = computeRollups(source.goals, source.projects, source.issues);
  const rollups: Record<string, unknown> = {};
  for (const [id, rollup] of rollupMap) rollups[id] = rollup;
  return {
    companyId: COMPANY,
    goals: source.goals,
    projects: source.projects,
    agents: empty ? [] : agents,
    rollups,
    issueCount: source.issues.length,
    truncated: false,
    generatedAt: new Date().toISOString(),
  };
}

let emptyMode = false;
let hostContext: { companyId: string | null; entityId: string; entityType: string } = {
  companyId: COMPANY,
  entityId: "i1",
  entityType: "issue",
};

mock.module("@paperclipai/plugin-sdk/ui", () => ({
  usePluginData: (key: string) => {
    if (key === "workspace") return { data: workspacePayload(emptyMode), loading: false, error: null, refresh: () => {} };
    if (key === "goal-issues") {
      return {
        data: { goalId: "team", direct: emptyMode ? [] : [issues[0]!, issues[1]!], viaProjects: [] },
        loading: false,
        error: null,
        refresh: () => {},
      };
    }
    if (key === "issue-search") {
      return { data: { issues: emptyMode ? [] : issues, truncated: false }, loading: false, error: null, refresh: () => {} };
    }
    return { data: null, loading: false, error: null, refresh: () => {} };
  },
  usePluginAction: () => async () => ({}),
  usePluginStream: () => ({ events: [], lastEvent: null, connecting: false, connected: false, error: null, close: () => {} }),
  useHostContext: () => hostContext,
  useHostNavigation: () => ({
    resolveHref: (to: string) => to,
    navigate: () => {},
    linkProps: (to: string) => ({ href: to }),
  }),
  useHostLocation: () => ({ pathname: "/goals-workspace", search: "", hash: "" }),
  usePluginToast: () => () => null,
}));

const originalFetch = globalThis.fetch;
beforeAll(() => {
  globalThis.fetch = (async () => new Response("{}", { status: 200 })) as unknown as typeof fetch;
});
afterAll(() => {
  globalThis.fetch = originalFetch;
});

const surfaces = await import("../src/ui/index.js");

type SlotProps = Parameters<typeof surfaces.IssueGoalTab>[0];
const slotProps = () => ({ context: hostContext }) as unknown as SlotProps;

describe("every mounted surface renders (ISC-31)", () => {
  test("the sidebar item renders a link to the workspace route", () => {
    const html = renderToString(<surfaces.GoalsNavItem />);
    expect(html).toContain("Goals");
    expect(html).toContain("/goals-workspace");
    expect(html).not.toContain("/plugins/");
  });

  test("the workspace page paints the tree, progress and the detail pane", () => {
    emptyMode = false;
    const html = renderToString(<surfaces.GoalsWorkspacePage {...slotProps()} />);
    expect(html).toContain("Run the company without manual intervention");
    expect(html).toContain("Fleet reliably picks up dropped tasks");
    // Progress is rendered, not just computed: bar + percent readout.
    expect(html).toContain("gw-bar-fill");
    expect(html).toContain("progressbar");
    expect(html).toContain("New goal");
    expect(html).toContain("Search goals");
  });

  test("the workspace page survives a company with no goals at all", () => {
    emptyMode = true;
    const html = renderToString(<surfaces.GoalsWorkspacePage {...slotProps()} />);
    expect(html).toContain("No goals yet");
    emptyMode = false;
  });

  test("the workspace page tells you to pick a company when there is none", () => {
    const previous = hostContext;
    hostContext = { ...previous, companyId: null };
    const html = renderToString(<surfaces.GoalsWorkspacePage {...slotProps()} />);
    expect(html).toContain("Select a company");
    hostContext = previous;
  });

  test("the issue tab offers every goal plus an honest fallback label", () => {
    const html = renderToString(<surfaces.IssueGoalTab {...slotProps()} />);
    expect(html).toContain("Goal");
    // The empty option must name where the task actually lands, never "No goal",
    // because the host re-derives a cleared goal.
    expect(html).toContain("falls back to");
    expect(html).toContain("Run the company without manual intervention");
  });

  test("the project tab renders linked goals and an add control", () => {
    const previous = hostContext;
    hostContext = { companyId: COMPANY, entityId: "p1", entityType: "project" };
    const html = renderToString(<surfaces.ProjectGoalsTab {...slotProps()} />);
    expect(html).toContain("Linked goals");
    expect(html).toContain("Fleet reliably picks up dropped tasks");
    expect(html).toContain("Choose a goal");
    hostContext = previous;
  });

  test("the stylesheet ships with the components and tracks the host theme", () => {
    const html = renderToString(<surfaces.GoalsNavItem />);
    expect(html).toContain(".gw-root");
    expect(html).toContain(".dark .gw-root");
    expect(html).not.toContain("prefers-color-scheme: dark");
  });
});
