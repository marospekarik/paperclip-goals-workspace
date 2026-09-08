import { describe, expect, test } from "bun:test";

import {
  GOAL_PARAM,
  PAGE_ROUTE,
  goalIdFromSearch,
  hostAgentHref,
  hostGoalHref,
  hostIssueHref,
  hostProjectHref,
  isPluginRoute,
  pageHref,
} from "../src/routes.js";

describe("page route (ISC-20)", () => {
  test("the page href is a top-level company route", () => {
    expect(pageHref()).toBe("/goals-workspace");
  });

  test("the page href is never prefixed with /plugins/", () => {
    // `plugins/:pluginId` resolves its segment as a plugin UUID. A routePath
    // never matches one, and the host's miss branch redirects into a plugin
    // detail query that 404s and retries, hanging on "Loading plugin details…".
    expect(pageHref()).not.toStartWith("/plugins/");
    expect(pageHref("abc")).not.toStartWith("/plugins/");
  });

  test("the route path does not shadow the host's own /goals nav item", () => {
    expect(PAGE_ROUTE).not.toBe("goals");
    expect(PAGE_ROUTE).toMatch(/^[a-z0-9][a-z0-9-]*$/);
  });

  test("a goal id round-trips through the query string", () => {
    const id = "8f0d2c11-4a1e-4f1b-9c8a-6d4f2b7e0a33";
    expect(goalIdFromSearch(new URL(`http://x${pageHref(id)}`).search)).toBe(id);
  });

  test("ids needing encoding survive the round trip", () => {
    const id = "a b/c&d";
    const href = pageHref(id);
    expect(href).toContain(encodeURIComponent(id));
    expect(goalIdFromSearch(new URL(`http://x${href}`).search)).toBe(id);
  });

  test("an unscoped page has no goal param", () => {
    expect(pageHref()).not.toContain("?");
    expect(pageHref("g1")).toContain(`?${GOAL_PARAM}=`);
    expect(goalIdFromSearch("")).toBeNull();
  });

  test("route detection tolerates the company prefix", () => {
    expect(isPluginRoute("/goals-workspace")).toBe(true);
    expect(isPluginRoute("/PAP/goals-workspace")).toBe(true);
    expect(isPluginRoute("/PAP/goals-workspace/anything")).toBe(true);
    expect(isPluginRoute("/goals")).toBe(false);
    expect(isPluginRoute("/PAP/agents/goals-workspace")).toBe(false);
  });
});

describe("host deep links", () => {
  test("goal links target the host's own goal page", () => {
    expect(hostGoalHref("g1")).toBe("/goals/g1");
  });

  test("issue, project and agent links prefer the human identifier", () => {
    expect(hostIssueHref("PAP-12", "uuid")).toBe("/issues/PAP-12");
    expect(hostIssueHref(null, "uuid")).toBe("/issues/uuid");
    expect(hostProjectHref("rumlyd", "uuid")).toBe("/projects/rumlyd");
    expect(hostProjectHref(null, "uuid")).toBe("/projects/uuid");
    expect(hostAgentHref("reflection-coach", "uuid")).toBe("/agents/reflection-coach");
    expect(hostAgentHref(null, "uuid")).toBe("/agents/uuid");
  });
});
