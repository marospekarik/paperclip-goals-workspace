/**
 * Host route shapes for this plugin's `page` slot.
 *
 * Pure string logic, deliberately free of React and of the SDK, so the manifest
 * (which registers the route) and the UI (which links to it) share one source of
 * truth and a unit test can pin the shape without a DOM.
 */

/**
 * URL segment the `page` slot registers under. Host constraint: a lowercase
 * single-segment slug. Deliberately not `goals` — that is the host's own route
 * and a plugin routePath must not shadow a core nav path.
 */
export const PAGE_ROUTE = "goals-workspace";

/** Query param naming the goal currently open in the detail pane. */
export const GOAL_PARAM = "goal";

/**
 * Path to the plugin page, relative to the company prefix — pass it through
 * `useHostNavigation().linkProps()` so the host resolves `/:companyPrefix/...`.
 *
 * The page mounts on the host's `:pluginRoutePath/*` route, a top-level sibling
 * of /goals, /costs and /inbox. So the path is `/goals-workspace`.
 *
 * It is emphatically NOT `/plugins/goals-workspace`. That matches a *different*
 * host route, `plugins/:pluginId`, whose segment is resolved as a plugin UUID.
 * A routePath never equals one, and on the miss the host redirects to
 * `/company/settings/instance/plugins/goals-workspace`, whose plugin-detail
 * query 404s and retries forever, leaving the screen stuck on
 * "Loading plugin details…". The wrong URL produces a hang, not a 404.
 */
export function pageHref(goalId?: string | null): string {
  const base = `/${PAGE_ROUTE}`;
  return goalId ? `${base}?${GOAL_PARAM}=${encodeURIComponent(goalId)}` : base;
}

/**
 * Whether a host pathname is on this plugin's page route. Tolerates the company
 * prefix being present (`/PAP/goals-workspace`) or absent, and any trailing
 * splat the host appends.
 */
export function isPluginRoute(pathname: string): boolean {
  const segments = pathname.split("/").filter(Boolean);
  return segments[0] === PAGE_ROUTE || segments[1] === PAGE_ROUTE;
}

/** Goal id carried by a location's search string, or null when unscoped. */
export function goalIdFromSearch(search: string): string | null {
  return new URLSearchParams(search).get(GOAL_PARAM);
}

/** Host route for a goal on Paperclip's own goal page. */
export function hostGoalHref(goalId: string): string {
  return `/goals/${goalId}`;
}

/** Host route for an issue, by its human identifier when available. */
export function hostIssueHref(identifier: string | null, id: string): string {
  return `/issues/${identifier ?? id}`;
}

/** Host route for a project, by its url key when available. */
export function hostProjectHref(urlKey: string | null, id: string): string {
  return `/projects/${urlKey ?? id}`;
}

/** Host route for an agent, by its url key when available. */
export function hostAgentHref(urlKey: string | null, id: string): string {
  return `/agents/${urlKey ?? id}`;
}
