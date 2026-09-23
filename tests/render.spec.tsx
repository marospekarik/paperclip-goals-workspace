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
  usePluginData: (key: string, params?: Record<string, unknown>) => {
    if (key === "workspace") return { data: workspacePayload(emptyMode), loading: false, error: null, refresh: () => {} };
    if (key === "goal-issues") {
      return {
        data: { goalId: "team", direct: emptyMode ? [] : [issues[0]!, issues[1]!], viaProjects: [] },
        loading: false,
        error: null,
        refresh: () => {},
      };
    }
    if (key === "issue") return { data: { issue: issues.find((i) => i.id === (params as { issueId?: string })?.issueId) ?? null }, loading: false, error: null, refresh: () => {} };
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
  MarkdownEditor: ({ value, contentClassName }: { value: string; contentClassName?: string }) => (
    <div data-host-markdown-editor className={contentClassName}>{value}</div>
  ),
}));

const originalFetch = globalThis.fetch;
beforeAll(() => {
  globalThis.fetch = (async () => new Response("{}", { status: 200 })) as unknown as typeof fetch;
});
afterAll(() => {
  globalThis.fetch = originalFetch;
});

const surfaces = await import("../src/ui/index.js");
const parts = await import("../src/ui/parts.js");

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
    expect(html).toContain('role="separator"');
    expect(html).toContain('aria-label="Resize goal list"');
    expect(html).toContain("--gw-tree-width:340px");
  });

  test("the goal description uses the host's shared Markdown editor", () => {
    const html = renderToString(
      <parts.MarkdownDescriptionEditor value={"### Title\n\nBody"} onCommit={() => {}} />,
    );
    expect(html).toContain("gw-md-editor");
    expect(html).toContain("data-host-markdown-editor");
    expect(html).toContain("gw-md-content");
    expect(html).toContain("### Title");
    // The old overlay (a transparent textarea painted over a preview) is gone.
    expect(html).not.toContain("gw-md-preview");
    expect(html).not.toContain("<textarea");
  });

  test("the dynamic split preserves usable minimum widths", () => {
    expect(surfaces.clampTreeWidth(100, 1200)).toBe(surfaces.MIN_TREE_WIDTH);
    expect(surfaces.clampTreeWidth(620, 1200)).toBe(620);
    expect(surfaces.clampTreeWidth(1000, 900)).toBe(900 - surfaces.MIN_DETAIL_WIDTH);
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

  test("a task IN A PROJECT is told that clearing really clears", () => {
    // i1 belongs to p1, whose legacy `goalId` is null. The host branches on
    // project presence, so clearing this task's goal yields null — the company
    // default is unreachable for it. The label must not promise otherwise.
    const html = renderToString(<surfaces.IssueGoalTab {...slotProps()} />);
    expect(html).toContain("Goal");
    expect(html).toContain(">No goal<");
    expect(html).not.toContain("falls back to");
  });

  test("a PROJECTLESS task is told which goal clearing falls back to", () => {
    const previous = hostContext;
    hostContext = { companyId: COMPANY, entityId: "i3", entityType: "issue" };
    const html = renderToString(<surfaces.IssueGoalTab {...slotProps()} />);
    expect(html).toContain("falls back to");
    expect(html).toContain("Run the company without manual intervention");
    hostContext = previous;
  });

  test("the issue tab reports a LINKED task as linked", () => {
    // Regression guard for the audit's blocking finding: the tab used to resolve
    // the viewed issue out of a company-wide `issue-search` page capped at 50
    // results, so past that many issues the viewed one fell out of the page and
    // a linked task was reported as having no goal. It now fetches by id.
    const html = renderToString(<surfaces.IssueGoalTab {...slotProps()} />);
    expect(html).toContain("Fleet reliably picks up dropped tasks");
    expect(html).not.toContain("This task is not linked to a goal");
    expect(html).toContain("Open in Goals workspace");
  });

  test("the issue tab reports a genuinely unlinked task as unlinked", () => {
    const previous = hostContext;
    hostContext = { companyId: COMPANY, entityId: "no-such-issue", entityType: "issue" };
    const html = renderToString(<surfaces.IssueGoalTab {...slotProps()} />);
    expect(html).toContain("This task is not linked to a goal");
    hostContext = previous;
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
    expect(html).toContain(".gw-detail-main");
    expect(html).toContain("minmax(0, 2fr) minmax(230px, 1fr)");
    expect(html).toContain(".gw-md-editor");
    expect(html).toContain(".gw-detail-grid");
    expect(html).toContain("repeat(2, minmax(0, 1fr))");
    expect(html).toContain("@container gw-detail (max-width: 660px)");
    expect(html).not.toContain("prefers-color-scheme: dark");
  });
});
