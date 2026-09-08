/**
 * Shared presentation primitives for every surface this plugin mounts.
 *
 * Kept apart from the slot components so the workspace page, the issue tab and
 * the project tab render the same chips, bars and pickers rather than three
 * near-identical variants that drift.
 */

import React, { useEffect, useMemo, useRef, useState } from "react";

import {
  GOAL_LEVELS,
  GOAL_STATUSES,
  buildGoalIndex,
  descendantIds,
  progressLabel,
  type Agent,
  type FilterResult,
  type Goal,
  type GoalIndex,
  type GoalRollup,
} from "../model.js";
import { STYLE } from "./styles.js";

// ---------------------------------------------------------------------------
// Shell
// ---------------------------------------------------------------------------

/**
 * The stylesheet node.
 *
 * Rendered unconditionally by `Root`, never behind a condition: a `<style>` that
 * a branch can stop returning gets unmounted on the first state change, which
 * strips every rule at exactly the moment the user interacts. Duplicate identical
 * `<style>` tags (two slots on one page) are harmless.
 */
function StyleTag() {
  return <style dangerouslySetInnerHTML={{ __html: STYLE }} />;
}

export function Root({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={className ? `gw-root ${className}` : "gw-root"}>
      <StyleTag />
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Icons — inline so the plugin ships no icon dependency
// ---------------------------------------------------------------------------

const ICON_PROPS = {
  width: 14,
  height: 14,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
};

export const IconChevron = () => (
  <svg {...ICON_PROPS} width={12} height={12}>
    <path d="m9 18 6-6-6-6" />
  </svg>
);
export const IconTarget = () => (
  <svg {...ICON_PROPS}>
    <circle cx="12" cy="12" r="9" />
    <circle cx="12" cy="12" r="5" />
    <circle cx="12" cy="12" r="1.5" />
  </svg>
);
export const IconPlus = () => (
  <svg {...ICON_PROPS} width={13} height={13}>
    <path d="M12 5v14M5 12h14" />
  </svg>
);
export const IconTrash = () => (
  <svg {...ICON_PROPS} width={13} height={13}>
    <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" />
  </svg>
);
export const IconUnlink = () => (
  <svg {...ICON_PROPS} width={13} height={13}>
    <path d="M18 6 6 18M6 6l12 12" />
  </svg>
);
export const IconSearch = () => (
  <svg {...ICON_PROPS} width={13} height={13}>
    <circle cx="11" cy="11" r="7" />
    <path d="m20 20-3.5-3.5" />
  </svg>
);

// ---------------------------------------------------------------------------
// Chips and bars
// ---------------------------------------------------------------------------

export function StatusChip({ status }: { status: string }) {
  const known = (GOAL_STATUSES as readonly string[]).includes(status);
  return <span className={`gw-chip gw-chip--${known ? status : "planned"}`}>{status.replace(/_/g, " ")}</span>;
}

export function IssueStatusChip({ status }: { status: string }) {
  const tone =
    status === "done" ? "achieved" : status === "cancelled" ? "cancelled" : status === "blocked" ? "danger" : "planned";
  return <span className={`gw-chip gw-chip--${tone}`}>{status.replace(/_/g, " ")}</span>;
}

export function LevelChip({ level }: { level: string }) {
  return <span className="gw-chip gw-chip--level">{level}</span>;
}

export function ProgressBar({ percent, wide }: { percent: number | null; wide?: boolean }) {
  const value = percent ?? 0;
  return (
    <div
      className={wide ? "gw-bar gw-bar--wide" : "gw-bar gw-bar--node"}
      role="progressbar"
      aria-valuenow={percent ?? undefined}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label="Goal progress"
    >
      <div className={`gw-bar-fill${value >= 100 ? " gw-bar-fill--done" : ""}`} style={{ width: `${value}%` }} />
    </div>
  );
}

export function Spinner() {
  return <span className="gw-spin" aria-label="Loading" />;
}

// ---------------------------------------------------------------------------
// Layout atoms
// ---------------------------------------------------------------------------

export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="gw-field">
      <span className="gw-field-label">{label}</span>
      <div className="gw-row-wrap">{children}</div>
    </div>
  );
}

export function Section({
  title,
  count,
  action,
  flush,
  children,
}: {
  title: string;
  count?: number;
  action?: React.ReactNode;
  flush?: boolean;
  children: React.ReactNode;
}) {
  return (
    <section className="gw-section">
      <header className="gw-section-head">
        <h3 className="gw-h2">{title}</h3>
        {count !== undefined ? <span className="gw-chip gw-chip--count">{count}</span> : null}
        <span className="gw-spacer" />
        {action}
      </header>
      <div className={flush ? "gw-section-body gw-section-body--flush" : "gw-section-body"}>{children}</div>
    </section>
  );
}

export function Modal({
  title,
  description,
  children,
  onClose,
  actions,
  busy,
}: {
  title: string;
  description?: string;
  children?: React.ReactNode;
  onClose: () => void;
  actions: React.ReactNode;
  busy?: boolean;
}) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, busy]);

  return (
    <div className="gw-overlay" role="presentation" onClick={() => !busy && onClose()}>
      <div
        className="gw-modal"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(event) => event.stopPropagation()}
      >
        <h2 className="gw-modal-title">{title}</h2>
        {description ? <p className="gw-sub" style={{ marginBottom: 12 }}>{description}</p> : null}
        {children}
        <div className="gw-modal-actions">{actions}</div>
      </div>
    </div>
  );
}

export function ErrorNote({ error }: { error: string | null }) {
  if (!error) return null;
  return (
    <div className="gw-callout gw-callout--danger" role="alert">
      {error}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Pickers
// ---------------------------------------------------------------------------

export function AgentSelect({
  agents,
  value,
  onChange,
  disabled,
  emptyLabel = "Unassigned",
}: {
  agents: Agent[];
  value: string | null;
  onChange: (next: string | null) => void;
  disabled?: boolean;
  emptyLabel?: string;
}) {
  return (
    <select
      className="gw-select"
      value={value ?? ""}
      disabled={disabled}
      aria-label="Owner agent"
      onChange={(event) => onChange(event.target.value === "" ? null : event.target.value)}
    >
      <option value="">{emptyLabel}</option>
      {agents.map((agent) => (
        <option key={agent.id} value={agent.id}>
          {agent.name}
        </option>
      ))}
    </select>
  );
}

/**
 * Parent picker with the cycle guard baked in: the goal itself and everything
 * beneath it are absent from the options, so a subtree can never be reparented
 * into its own descendant.
 */
export function ParentSelect({
  goals,
  goalId,
  value,
  onChange,
  disabled,
}: {
  goals: Goal[];
  goalId?: string;
  value: string | null;
  onChange: (next: string | null) => void;
  disabled?: boolean;
}) {
  const options = useMemo(() => {
    if (!goalId) return goals;
    const index = buildGoalIndex(goals);
    const forbidden = new Set<string>([goalId, ...descendantIds(goalId, index)]);
    return goals.filter((goal) => !forbidden.has(goal.id));
  }, [goals, goalId]);

  return (
    <select
      className="gw-select"
      value={value ?? ""}
      disabled={disabled}
      aria-label="Parent goal"
      onChange={(event) => onChange(event.target.value === "" ? null : event.target.value)}
    >
      <option value="">No parent (top level)</option>
      {options.map((goal) => (
        <option key={goal.id} value={goal.id}>
          {goal.title}
        </option>
      ))}
    </select>
  );
}

export function EnumSelect({
  values,
  value,
  onChange,
  label,
  disabled,
}: {
  values: readonly string[];
  value: string;
  onChange: (next: string) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <select
      className="gw-select"
      value={value}
      aria-label={label}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value)}
    >
      {values.map((option) => (
        <option key={option} value={option}>
          {option}
        </option>
      ))}
    </select>
  );
}

export const LEVEL_VALUES = GOAL_LEVELS;
export const STATUS_VALUES = GOAL_STATUSES;

// ---------------------------------------------------------------------------
// Inline text editing
// ---------------------------------------------------------------------------

/**
 * A field that commits on blur, reverts on Escape, and stays quiet otherwise.
 *
 * Editing a goal title should not need a Save button, but it also should not
 * fire a PATCH on every keystroke — so local state holds the draft and the
 * commit happens once, and only when the text actually changed.
 */
export function InlineText({
  value,
  onCommit,
  multiline,
  placeholder,
  ariaLabel,
}: {
  value: string;
  onCommit: (next: string) => void;
  multiline?: boolean;
  placeholder?: string;
  ariaLabel: string;
}) {
  const [draft, setDraft] = useState(value);
  const committed = useRef(value);

  useEffect(() => {
    committed.current = value;
    setDraft(value);
  }, [value]);

  const commit = () => {
    const next = draft.trim();
    if (next === committed.current.trim()) return;
    committed.current = next;
    onCommit(next);
  };

  const shared = {
    value: draft,
    placeholder,
    "aria-label": ariaLabel,
    onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setDraft(event.target.value),
    onBlur: commit,
    onKeyDown: (event: React.KeyboardEvent) => {
      if (event.key === "Escape") {
        setDraft(committed.current);
        (event.target as HTMLElement).blur();
      }
      if (event.key === "Enter" && !multiline) (event.target as HTMLElement).blur();
    },
  };

  return multiline ? (
    <textarea className="gw-desc-input" {...shared} />
  ) : (
    <input className="gw-title-input" {...shared} />
  );
}

// ---------------------------------------------------------------------------
// Goal tree
// ---------------------------------------------------------------------------

export interface GoalTreeProps {
  goals: Goal[];
  rollups: Record<string, GoalRollup>;
  selectedId: string | null;
  onSelect: (goalId: string) => void;
  filter: FilterResult;
  expanded: Set<string>;
  onToggle: (goalId: string) => void;
}

export function GoalTree(props: GoalTreeProps) {
  const index = useMemo(() => buildGoalIndex(props.goals), [props.goals]);

  if (props.goals.length === 0) {
    return <p className="gw-empty">No goals yet.</p>;
  }

  const visibleRoots = index.roots.filter((goal) => props.filter.visible.has(goal.id));
  if (visibleRoots.length === 0) {
    return <p className="gw-empty">No goals match these filters.</p>;
  }

  return (
    <div role="tree" aria-label="Goal hierarchy">
      {visibleRoots.map((goal) => (
        <GoalNode key={goal.id} goal={goal} depth={0} index={index} {...props} />
      ))}
    </div>
  );
}

type GoalNodeProps = Omit<GoalTreeProps, "goals"> & {
  goal: Goal;
  depth: number;
  index: GoalIndex;
};

function GoalNode({
  goal,
  depth,
  index,
  rollups,
  selectedId,
  onSelect,
  filter,
  expanded,
  onToggle,
}: GoalNodeProps) {
  const children = (index.childrenOf.get(goal.id) ?? []).filter((child) => filter.visible.has(child.id));
  const hasChildren = children.length > 0;
  // A filtered tree opens itself: hunting for a match is the whole point of
  // typing in the search box, so matches must not hide behind collapsed parents.
  const isOpen = filter.active ? true : expanded.has(goal.id);
  const rollup = rollups[goal.id];
  const label = rollup ? progressLabel(rollup) : null;

  return (
    <div role="treeitem" aria-expanded={hasChildren ? isOpen : undefined} aria-selected={selectedId === goal.id}>
      <div
        className={[
          "gw-node",
          selectedId === goal.id ? "gw-node--selected" : "",
          filter.active && !filter.matched.has(goal.id) ? "gw-node--dimmed" : "",
        ]
          .filter(Boolean)
          .join(" ")}
        style={{ paddingLeft: `${depth * 14 + 8}px` }}
      >
        <button
          type="button"
          className={`gw-caret${hasChildren ? "" : " gw-caret--leaf"}${isOpen ? " gw-caret--open" : ""}`}
          aria-label={hasChildren ? `Toggle ${goal.title}` : undefined}
          tabIndex={hasChildren ? 0 : -1}
          onClick={(event) => {
            event.stopPropagation();
            if (hasChildren) onToggle(goal.id);
          }}
        >
          <IconChevron />
        </button>
        <button
          type="button"
          className="gw-node-title"
          style={{ border: "none", background: "transparent", padding: 0, cursor: "pointer", textAlign: "left" }}
          onClick={() => onSelect(goal.id)}
          title={goal.title}
        >
          {goal.title}
        </button>
        <span className="gw-node-meta">
          {label ? <span className="gw-pct">{rollup?.percent ?? 0}%</span> : null}
          {rollup && rollup.percent !== null ? <ProgressBar percent={rollup.percent} /> : null}
          <StatusChip status={goal.status} />
        </span>
      </div>
      {hasChildren && isOpen
        ? children.map((child) => (
            <GoalNode
              key={child.id}
              goal={child}
              depth={depth + 1}
              index={index}
              rollups={rollups}
              selectedId={selectedId}
              onSelect={onSelect}
              filter={filter}
              expanded={expanded}
              onToggle={onToggle}
            />
          ))
        : null}
    </div>
  );
}
