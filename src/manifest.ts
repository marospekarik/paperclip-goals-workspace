import type { PaperclipPluginManifestV1 } from "@paperclipai/plugin-sdk";

import { PAGE_ROUTE } from "./routes.js";

/**
 * Slot legality was checked against the installed host before anything was
 * declared here. `@paperclipai/server` 2026.824.1 queries `detailTab` slots for
 * exactly four entity types — `execution_workspace`, `issue`, `project`,
 * `project_workspace` (grep `slotTypes:["detailTab"]` in its UI bundle). The SDK
 * README also lists `goal`, `agent` and `run`, but the host never mounts those,
 * so a goal detail tab would be accepted, stored, and silently never rendered.
 * This manifest declares only mounted slots.
 *
 * The capability list is frozen at first publish on purpose. The host's
 * plugin-loader diffs capabilities on upgrade and *throws* on any addition —
 * after it has already unloaded the running worker — which leaves the plugin
 * installed with no worker at all. Adding a capability later is an
 * uninstall-then-install operation, documented in the README.
 */
const manifest: PaperclipPluginManifestV1 = {
  id: "ordillect.goals-workspace",
  apiVersion: 1,
  version: "1.0.1",
  displayName: "Goals Workspace",
  description:
    "A complete goal-management workspace: reassign owners and parents, link projects and " +
    "tasks, see progress rolled up through the tree, and delete goals safely by detaching " +
    "what is attached to them first.",
  author: "Ordillect",
  categories: ["ui"],
  capabilities: [
    // Worker read model — the aggregate the workspace renders from.
    "goals.read",
    "projects.read",
    "issues.read",
    "agents.read",
    // Live refresh when an agent or another operator changes a goal.
    "events.subscribe",
    // Mount points.
    "ui.sidebar.register",
    "ui.page.register",
    "ui.detailTab.register",
  ],
  entrypoints: {
    worker: "./dist/worker.js",
    ui: "./dist/ui",
  },
  ui: {
    slots: [
      {
        type: "sidebar",
        id: "goals-workspace-nav",
        displayName: "Goals",
        exportName: "GoalsNavItem",
      },
      {
        type: "page",
        id: "goals-workspace-page",
        displayName: "Goals",
        routePath: PAGE_ROUTE,
        exportName: "GoalsWorkspacePage",
      },
      {
        type: "detailTab",
        id: "issue-goal",
        displayName: "Goal",
        entityTypes: ["issue"],
        exportName: "IssueGoalTab",
      },
      {
        type: "detailTab",
        id: "project-goals",
        displayName: "Goals",
        entityTypes: ["project"],
        exportName: "ProjectGoalsTab",
      },
    ],
  },
};

export default manifest;
