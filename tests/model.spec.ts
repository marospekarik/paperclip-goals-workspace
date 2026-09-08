import { describe, expect, test } from "bun:test";

import {
  ancestorChain,
  buildGoalIndex,
  computeDeleteImpact,
  computeRollups,
  defaultCompanyGoal,
  descendantIds,
  filterGoals,
  predictClearedIssueGoal,
  issueStatusGroups,
  planDetach,
  progressLabel,
  projectGoalIds,
  projectsForGoal,
  validParentOptions,
  wouldCreateCycle,
  type Goal,
  type Issue,
  type Project,
} from "../src/model.js";

const COMPANY = "company-1";

function goal(id: string, overrides: Partial<Goal> = {}): Goal {
  return {
    id,
    companyId: COMPANY,
    title: `Goal ${id}`,
    description: null,
    level: "team",
    status: "active",
    parentId: null,
    ownerAgentId: null,
    ...overrides,
  };
}

function issue(id: string, overrides: Partial<Issue> = {}): Issue {
  return { id, title: `Issue ${id}`, status: "todo", goalId: null, projectId: null, ...overrides };
}

function project(id: string, overrides: Partial<Project> = {}): Project {
  return { id, name: `Project ${id}`, status: "in_progress", goalId: null, goalIds: [], ...overrides };
}

/**
 *   root
 *   ├── mid
 *   │   └── leaf
 *   └── sibling
 */
const TREE: Goal[] = [
  goal("root"),
  goal("mid", { parentId: "root" }),
  goal("leaf", { parentId: "mid" }),
  goal("sibling", { parentId: "root" }),
];

describe("hierarchy", () => {
  test("indexes roots and children", () => {
    const index = buildGoalIndex(TREE);
    expect(index.roots.map((entry) => entry.id)).toEqual(["root"]);
    expect((index.childrenOf.get("root") ?? []).map((entry) => entry.id)).toEqual(["mid", "sibling"]);
  });

  test("a goal whose parent is missing from the set is treated as a root", () => {
    const index = buildGoalIndex([goal("orphan", { parentId: "not-loaded" })]);
    expect(index.roots.map((entry) => entry.id)).toEqual(["orphan"]);
  });

  test("descendants exclude self and cover the whole subtree", () => {
    const index = buildGoalIndex(TREE);
    expect(descendantIds("root", index).sort()).toEqual(["leaf", "mid", "sibling"]);
    expect(descendantIds("leaf", index)).toEqual([]);
  });

  test("a self-parenting row cannot hang the walk", () => {
    const cyclic = [goal("a", { parentId: "a" }), goal("b", { parentId: "a" })];
    const index = buildGoalIndex(cyclic);
    expect(descendantIds("a", index)).toEqual(["b"]);
  });

  test("ancestor chain runs outermost first", () => {
    const index = buildGoalIndex(TREE);
    expect(ancestorChain("leaf", index).map((entry) => entry.id)).toEqual(["root", "mid"]);
    expect(ancestorChain("root", index)).toEqual([]);
  });
});

describe("reparent safety (ISC-23)", () => {
  test("a goal cannot be reparented under itself or a descendant", () => {
    const options = validParentOptions("mid", TREE).map((entry) => entry.id);
    expect(options).not.toContain("mid");
    expect(options).not.toContain("leaf");
    expect(options).toContain("root");
    expect(options).toContain("sibling");
  });

  test("cycle predicate agrees with the option list", () => {
    expect(wouldCreateCycle("mid", "leaf", TREE)).toBe(true);
    expect(wouldCreateCycle("mid", "mid", TREE)).toBe(true);
    expect(wouldCreateCycle("mid", "sibling", TREE)).toBe(false);
    expect(wouldCreateCycle("mid", null, TREE)).toBe(false);
  });
});

describe("project linking", () => {
  test("goal ids merge the m2m array and the legacy column without duplicates", () => {
    expect(projectGoalIds(project("p", { goalId: "g1", goalIds: ["g1", "g2"] })).sort()).toEqual(["g1", "g2"]);
    expect(projectGoalIds(project("p", { goalId: "g1", goalIds: [] }))).toEqual(["g1"]);
    expect(projectGoalIds(project("p"))).toEqual([]);
  });

  test("projectsForGoal finds links through either column", () => {
    const projects = [
      project("legacy", { goalId: "g1" }),
      project("m2m", { goalIds: ["g1"] }),
      project("other", { goalIds: ["g2"] }),
    ];
    expect(projectsForGoal("g1", projects).map((entry) => entry.id).sort()).toEqual(["legacy", "m2m"]);
  });
});

describe("progress rollup", () => {
  test("subtree tasks roll up into the parent (ISC-13)", () => {
    const issues = [
      issue("i1", { goalId: "leaf", status: "done" }),
      issue("i2", { goalId: "leaf", status: "todo" }),
      issue("i3", { goalId: "mid", status: "done" }),
    ];
    const rollups = computeRollups(TREE, [], issues);

    expect(rollups.get("leaf")!.tasks.total).toBe(2);
    expect(rollups.get("mid")!.tasks.total).toBe(3);
    expect(rollups.get("root")!.tasks.total).toBe(3);
    expect(rollups.get("root")!.tasks.done).toBe(2);
    expect(rollups.get("root")!.percent).toBe(67);
  });

  test("cancelled issues leave the denominator (ISC-14)", () => {
    const issues = [
      issue("done", { goalId: "root", status: "done" }),
      issue("open", { goalId: "root", status: "todo" }),
      issue("dead", { goalId: "root", status: "cancelled" }),
    ];
    const rollup = computeRollups([goal("root")], [], issues).get("root")!;
    expect(rollup.tasks.total).toBe(3);
    expect(rollup.tasks.cancelled).toBe(1);
    expect(rollup.tasks.countable).toBe(2);
    expect(rollup.percent).toBe(50);
  });

  test("a goal with no tasks falls back to sub-goal completion (ISC-14)", () => {
    const goals = [
      goal("root"),
      goal("a", { parentId: "root", status: "achieved" }),
      goal("b", { parentId: "root", status: "active" }),
      goal("c", { parentId: "root", status: "cancelled" }),
    ];
    const rollup = computeRollups(goals, [], []).get("root")!;
    expect(rollup.progressBasis).toBe("subgoals");
    expect(rollup.subGoals.total).toBe(3);
    expect(rollup.subGoals.countable).toBe(2);
    expect(rollup.percent).toBe(50);
    expect(progressLabel(rollup)).toBe("1/2 sub-goals");
  });

  test("a goal with neither tasks nor sub-goals has no percentage", () => {
    const rollup = computeRollups([goal("lonely")], [], []).get("lonely")!;
    expect(rollup.percent).toBeNull();
    expect(rollup.progressBasis).toBeNull();
    expect(progressLabel(rollup)).toBeNull();
  });

  test("an issue linked both directly and through a project counts once (ISC-16)", () => {
    const projects = [project("p1", { goalIds: ["root"] })];
    const issues = [
      issue("shared", { goalId: "root", projectId: "p1", status: "done" }),
      issue("project-only", { projectId: "p1", status: "todo" }),
    ];
    const rollup = computeRollups([goal("root")], projects, issues).get("root")!;

    expect(rollup.tasks.total).toBe(2);
    expect(rollup.directIssueIds).toEqual(["shared"]);
    expect(rollup.projectIssueIds).toEqual(["project-only"]);
    expect(rollup.percent).toBe(50);
  });

  test("an issue under both a goal and its parent counts once at the parent", () => {
    const issues = [issue("i1", { goalId: "leaf", status: "done" })];
    const projects = [project("p", { goalIds: ["root"] })];
    // The same issue also sits in a project linked to root.
    issues[0]!.projectId = "p";
    const rollups = computeRollups(TREE, projects, issues);
    expect(rollups.get("root")!.tasks.total).toBe(1);
  });

  test("depth is reported for indentation", () => {
    const rollups = computeRollups(TREE, [], []);
    expect(rollups.get("root")!.depth).toBe(0);
    expect(rollups.get("mid")!.depth).toBe(1);
    expect(rollups.get("leaf")!.depth).toBe(2);
  });

  test("status counts split open work by kind", () => {
    const issues = [
      issue("a", { goalId: "root", status: "in_progress" }),
      issue("b", { goalId: "root", status: "in_review" }),
      issue("c", { goalId: "root", status: "blocked" }),
      issue("d", { goalId: "root", status: "backlog" }),
    ];
    const rollup = computeRollups([goal("root")], [], issues).get("root")!;
    expect(rollup.tasks.inProgress).toBe(2);
    expect(rollup.tasks.blocked).toBe(1);
    expect(rollup.tasks.open).toBe(4);
    expect(rollup.percent).toBe(0);
  });
});

describe("filtering (ISC-17, ISC-18)", () => {
  test("no filter means everything is visible and nothing is dimmed", () => {
    const result = filterGoals(TREE, {});
    expect(result.active).toBe(false);
    expect(result.visible.size).toBe(4);
    expect(result.matched.size).toBe(4);
  });

  test("a text match keeps its whole ancestor chain visible", () => {
    const goals = [goal("root", { title: "Company mission" }), goal("mid", { parentId: "root", title: "Team plan" }), goal("leaf", { parentId: "mid", title: "Ship the widget" })];
    const result = filterGoals(goals, { query: "widget" });
    expect([...result.matched]).toEqual(["leaf"]);
    expect([...result.visible].sort()).toEqual(["leaf", "mid", "root"]);
  });

  test("search covers the description too", () => {
    const goals = [goal("a", { title: "Nothing", description: "revenue target" })];
    expect([...filterGoals(goals, { query: "REVENUE" }).matched]).toEqual(["a"]);
  });

  test("status and level filters compose", () => {
    const goals = [
      goal("a", { status: "active", level: "company" }),
      goal("b", { status: "achieved", level: "company" }),
      goal("c", { status: "active", level: "task" }),
    ];
    expect([...filterGoals(goals, { statuses: ["active"], levels: ["company"] }).matched]).toEqual(["a"]);
  });

  test("owner filter matches an agent, and unownedOnly overrides it", () => {
    const goals = [goal("owned", { ownerAgentId: "agent-1" }), goal("free")];
    expect([...filterGoals(goals, { ownerAgentId: "agent-1" }).matched]).toEqual(["owned"]);
    expect([...filterGoals(goals, { unownedOnly: true }).matched]).toEqual(["free"]);
  });
});

describe("delete impact (ISC-6, ISC-7)", () => {
  const goals = [goal("root"), goal("target", { parentId: "root" }), goal("child", { parentId: "target" })];
  const projects = [
    project("legacy", { goalId: "target", goalIds: ["target"] }),
    project("m2m", { goalIds: ["target", "other"] }),
    project("unrelated", { goalIds: ["other"] }),
  ];
  const issues = [issue("i1", { goalId: "target" }), issue("i2", { goalId: "other" })];

  test("a goal with nothing attached is safe to delete outright", () => {
    const impact = computeDeleteImpact("lonely", [goal("lonely")], [], []);
    expect(impact.safe).toBe(true);
    expect(impact.blockingCount).toBe(0);
  });

  test("children, direct issues and legacy-column projects all block", () => {
    const impact = computeDeleteImpact("target", goals, projects, issues);
    expect(impact.childGoals.map((entry) => entry.id)).toEqual(["child"]);
    expect(impact.issues.map((entry) => entry.id)).toEqual(["i1"]);
    expect(impact.legacyProjects.map((entry) => entry.id)).toEqual(["legacy"]);
    // The join table cascades, so an m2m-only link is not a blocker.
    expect(impact.cascadingProjects.map((entry) => entry.id)).toEqual(["m2m"]);
    expect(impact.blockingCount).toBe(3);
    expect(impact.safe).toBe(false);
  });

  test("the detach plan lifts children to the deleted goal's own parent", () => {
    const impact = computeDeleteImpact("target", goals, projects, issues);
    const plan = planDetach(impact, goals, projects);
    expect(plan.reparent).toEqual([{ goalId: "child", parentId: "root" }]);
    expect(plan.blocked).toBeNull();
  });

  test("issues MOVE to a surviving goal, never to null (ISC-29)", () => {
    // A null goalId is re-derived by the host and can land back on the goal
    // being deleted, so the plan must name an explicit target.
    const impact = computeDeleteImpact("target", goals, projects, issues);
    const plan = planDetach(impact, goals, projects);
    expect(plan.issueTargetGoalId).toBe("root");
    expect(plan.moveIssues).toEqual([{ issueId: "i1", goalId: "root" }]);
    for (const move of plan.moveIssues) expect(move.goalId).not.toBeNull();
  });

  test("a top-level goal's issues fall to the surviving company default", () => {
    const flat = [
      goal("victim", { level: "company", status: "active", createdAt: "2026-01-01" }),
      goal("survivor", { level: "company", status: "active", createdAt: "2026-02-01" }),
    ];
    const linked = [issue("i", { goalId: "victim" })];
    const plan = planDetach(computeDeleteImpact("victim", flat, [], linked), flat, []);
    expect(plan.issueTargetGoalId).toBe("survivor");
    expect(plan.blocked).toBeNull();
  });

  test("deleting the only goal while tasks are attached is blocked, not attempted (ISC-7)", () => {
    const only = [goal("solo", { level: "company", status: "active" })];
    const linked = [issue("i", { goalId: "solo" })];
    const plan = planDetach(computeDeleteImpact("solo", only, [], linked), only, []);
    expect(plan.issueTargetGoalId).toBeNull();
    expect(plan.moveIssues).toEqual([]);
    expect(plan.blocked).toContain("only goal");
  });

  test("a goal with no issues is never blocked, even as the last goal", () => {
    const only = [goal("solo", { level: "company", status: "active" })];
    const plan = planDetach(computeDeleteImpact("solo", only, [], []), only, []);
    expect(plan.blocked).toBeNull();
    expect(plan.writeCount).toBe(0);
  });

  test("deleting a top-level goal lifts its children to top level", () => {
    const flat = [goal("top"), goal("kid", { parentId: "top" })];
    const impact = computeDeleteImpact("top", flat, [], []);
    expect(planDetach(impact, flat, []).reparent).toEqual([{ goalId: "kid", parentId: null }]);
  });

  test("project patches strip only this goal and clear the legacy column when it matched", () => {
    const impact = computeDeleteImpact("target", goals, projects, issues);
    const plan = planDetach(impact, goals, projects);

    const legacy = plan.projects.find((entry) => entry.projectId === "legacy")!;
    expect(legacy.goalIds).toEqual([]);
    expect(legacy.goalId).toBeNull();

    const m2m = plan.projects.find((entry) => entry.projectId === "m2m")!;
    expect(m2m.goalIds).toEqual(["other"]);
    expect("goalId" in m2m).toBe(false);

    expect(plan.projects.find((entry) => entry.projectId === "unrelated")).toBeUndefined();
    expect(plan.writeCount).toBe(4);
  });
});

describe("cleared-goal prediction — the host never leaves a task goalless (ISC-30)", () => {
  const goals = [
    goal("old-root", { level: "company", status: "active", parentId: null, createdAt: "2026-01-01" }),
    goal("new-root", { level: "company", status: "active", parentId: null, createdAt: "2026-05-01" }),
    goal("team", { level: "team", status: "active", parentId: "old-root" }),
  ];

  test("the company default is the OLDEST active company-level root", () => {
    expect(defaultCompanyGoal(goals)?.id).toBe("old-root");
  });

  test("it falls back to any company-level root, then any company-level goal", () => {
    const noneActive = [goal("planned-root", { level: "company", status: "planned", parentId: null })];
    expect(defaultCompanyGoal(noneActive)?.id).toBe("planned-root");
    const nested = [goal("nested", { level: "company", status: "planned", parentId: "x" })];
    expect(defaultCompanyGoal(nested)?.id).toBe("nested");
    expect(defaultCompanyGoal([goal("t", { level: "team" })])).toBeNull();
  });

  test("clearing a task in a goal-linked project lands on the project's goal", () => {
    const projects = [project("p", { goalId: "team" })];
    const result = predictClearedIssueGoal(issue("i", { projectId: "p", goalId: "team" }), goals, projects);
    expect(result).toEqual({ goalId: "team", reason: "project" });
  });

  test("clearing a projectless task lands on the company default", () => {
    expect(predictClearedIssueGoal(issue("i", { goalId: "team" }), goals, [])).toEqual({
      goalId: "old-root",
      reason: "company-default",
    });
  });

  test("with no company-level goal at all, a clear really does clear", () => {
    const teamOnly = [goal("team", { level: "team" })];
    expect(predictClearedIssueGoal(issue("i", { goalId: "team" }), teamOnly, [])).toEqual({
      goalId: null,
      reason: "none",
    });
  });
});

describe("presentation helpers", () => {
  test("issue groups come back in host status order, skipping empties", () => {
    const groups = issueStatusGroups([
      issue("a", { status: "done" }),
      issue("b", { status: "backlog" }),
      issue("c", { status: "done" }),
    ]);
    expect(groups.map((group) => group.status)).toEqual(["backlog", "done"]);
    expect(groups[1]!.issues).toHaveLength(2);
  });

  test("task label singularises", () => {
    const rollup = computeRollups([goal("g")], [], [issue("i", { goalId: "g", status: "todo" })]).get("g")!;
    expect(progressLabel(rollup)).toBe("0/1 task");
  });
});
