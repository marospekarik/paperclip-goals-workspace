/**
 * Namespaced stylesheet for the workspace.
 *
 * Two rules govern everything here.
 *
 * 1. **Theme follows the host, not the OS.** Paperclip is a shadcn/Tailwind app
 *    that toggles themes with a `.dark` class on `<html>` and defines no
 *    `prefers-color-scheme` rules at all. Keying off the OS preference would make
 *    a light-OS/dark-host session render near-black text on a near-black
 *    background. Colours defer to the host's own `--foreground`, `--border`,
 *    `--card` and friends wherever those exist, with literal fallbacks so the
 *    panel still reads if a token is ever renamed.
 *
 * 2. **Space is measured against the container, not the viewport.** This is a
 *    panel inside a host layout: a narrow pane on a wide monitor needs the phone
 *    layout, and a wide pane on a small laptop does not. `.gw-root` declares
 *    `container-type: inline-size` and every breakpoint queries it.
 *
 * Class names are all `gw-` prefixed so nothing here can collide with the host's
 * utility classes, and no host class name is depended on in return — copying
 * minified host markup would make it our contract.
 */

export const STYLE = `
.gw-root {
  container-type: inline-size;
  container-name: gw;
  --gw-fg: var(--foreground, #0f1115);
  --gw-muted: #55606e;
  --gw-faint: #7a8390;
  --gw-border: rgba(0,0,0,0.11);
  --gw-border-strong: rgba(0,0,0,0.2);
  --gw-surface: rgba(0,0,0,0.028);
  --gw-surface-2: rgba(0,0,0,0.055);
  --gw-hover: rgba(0,0,0,0.045);
  --gw-selected: rgba(37,99,235,0.10);
  --gw-selected-border: rgba(37,99,235,0.55);
  --gw-accent: #2563eb;
  --gw-track: rgba(0,0,0,0.09);
  --gw-ok: #15803d;
  --gw-ok-soft: rgba(21,128,61,0.14);
  --gw-warn: #b45309;
  --gw-warn-soft: rgba(180,83,9,0.13);
  --gw-danger: #dc2626;
  --gw-danger-soft: rgba(220,38,38,0.09);
  --gw-danger-border: rgba(220,38,38,0.35);
  --gw-info: #2563eb;
  --gw-info-soft: rgba(37,99,235,0.12);
  --gw-neutral: #64748b;
  --gw-neutral-soft: rgba(100,116,139,0.13);
  color: var(--gw-fg);
  font-family: inherit;
  font-size: 13px;
  line-height: 1.5;
}
.dark .gw-root {
  --gw-fg: var(--foreground, #e8eaee);
  --gw-muted: #aab2bd;
  --gw-faint: #7f8896;
  --gw-border: rgba(255,255,255,0.12);
  --gw-border-strong: rgba(255,255,255,0.24);
  --gw-surface: rgba(255,255,255,0.035);
  --gw-surface-2: rgba(255,255,255,0.065);
  --gw-hover: rgba(255,255,255,0.055);
  --gw-selected: rgba(96,165,250,0.14);
  --gw-selected-border: rgba(96,165,250,0.6);
  --gw-accent: #60a5fa;
  --gw-track: rgba(255,255,255,0.12);
  --gw-ok: #4ade80;
  --gw-ok-soft: rgba(74,222,128,0.15);
  --gw-warn: #fbbf24;
  --gw-warn-soft: rgba(251,191,36,0.15);
  --gw-danger: #f87171;
  --gw-danger-soft: rgba(248,113,113,0.12);
  --gw-danger-border: rgba(248,113,113,0.4);
  --gw-info: #60a5fa;
  --gw-info-soft: rgba(96,165,250,0.16);
  --gw-neutral: #94a3b8;
  --gw-neutral-soft: rgba(148,163,184,0.14);
}
.gw-root *, .gw-root *::before, .gw-root *::after { box-sizing: border-box; }
.gw-root button { font: inherit; color: inherit; }

/* ---------------------------------------------------------------- layout -- */

.gw-shell { display: grid; grid-template-columns: minmax(260px, 340px) 1fr; min-height: 0; }
.gw-shell > * { min-width: 0; }
.gw-tree-pane {
  border-right: 1px solid var(--gw-border);
  display: flex; flex-direction: column; min-height: 0;
}
.gw-detail-pane { min-height: 0; overflow: auto; }
@container gw (max-width: 720px) {
  .gw-shell { grid-template-columns: 1fr; }
  .gw-tree-pane { border-right: none; border-bottom: 1px solid var(--gw-border); }
  .gw-tree-scroll { max-height: 320px; }
}

.gw-pane-pad { padding: 14px 16px; }
.gw-tree-scroll { overflow: auto; flex: 1; min-height: 0; padding-bottom: 12px; }

/* --------------------------------------------------------------- headings -- */

.gw-h1 { font-size: 17px; font-weight: 640; margin: 0; letter-spacing: -0.01em; }
.gw-h2 { font-size: 13px; font-weight: 640; margin: 0; letter-spacing: 0.01em; }
.gw-eyebrow {
  font-size: 10px; font-weight: 640; letter-spacing: 0.08em; text-transform: uppercase;
  color: var(--gw-faint); margin: 0;
}
.gw-sub { color: var(--gw-muted); margin: 0; }
.gw-muted { color: var(--gw-muted); }
.gw-faint { color: var(--gw-faint); }
.gw-mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 0.9em; }
.gw-row { display: flex; align-items: center; gap: 8px; }
.gw-row-wrap { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.gw-stack { display: flex; flex-direction: column; gap: 10px; }
.gw-stack-sm { display: flex; flex-direction: column; gap: 6px; }
.gw-spacer { flex: 1; }
.gw-truncate { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

/* --------------------------------------------------------------- controls -- */

.gw-btn {
  display: inline-flex; align-items: center; gap: 6px; justify-content: center;
  border: 1px solid var(--gw-border-strong); background: transparent;
  border-radius: 6px; padding: 5px 10px; font-size: 12px; font-weight: 520;
  cursor: pointer; transition: background-color .12s ease, border-color .12s ease;
  min-height: 30px;
}
.gw-btn:disabled { opacity: .5; cursor: not-allowed; }
.gw-btn--primary { background: var(--gw-accent); border-color: var(--gw-accent); color: #fff; }
.gw-btn--danger { color: var(--gw-danger); border-color: var(--gw-danger-border); }
.gw-btn--danger-solid { background: var(--gw-danger); border-color: var(--gw-danger); color: #fff; }
.gw-btn--ghost { border-color: transparent; padding: 4px 7px; }
.gw-btn--xs { min-height: 24px; padding: 2px 7px; font-size: 11px; }
@media (hover: hover) and (pointer: fine) {
  .gw-btn:not(:disabled):hover { background: var(--gw-hover); }
  .gw-btn--primary:not(:disabled):hover { filter: brightness(1.08); background: var(--gw-accent); }
  .gw-btn--danger-solid:not(:disabled):hover { filter: brightness(1.08); background: var(--gw-danger); }
  .gw-btn--danger:not(:disabled):hover { background: var(--gw-danger-soft); }
}
.gw-btn:focus-visible, .gw-input:focus-visible, .gw-select:focus-visible, .gw-check:focus-visible {
  outline: 2px solid var(--gw-accent); outline-offset: 1px;
}

.gw-input, .gw-select, .gw-textarea {
  width: 100%; border: 1px solid var(--gw-border-strong); background: transparent;
  border-radius: 6px; padding: 6px 8px; font-size: 12.5px; color: inherit; min-height: 30px;
}
.gw-textarea { min-height: 76px; resize: vertical; line-height: 1.55; }
.gw-select { cursor: pointer; }
.gw-label { font-size: 11px; font-weight: 600; color: var(--gw-muted); }

/* ------------------------------------------------------------------- tree -- */

.gw-node {
  display: flex; align-items: center; gap: 6px; width: 100%;
  padding: 5px 10px 5px 0; border: none; background: transparent; text-align: left;
  cursor: pointer; border-left: 2px solid transparent;
}
@media (hover: hover) and (pointer: fine) {
  .gw-node:hover { background: var(--gw-hover); }
}
.gw-node--selected { background: var(--gw-selected); border-left-color: var(--gw-selected-border); }
.gw-node--dimmed { opacity: .48; }
.gw-node--droptarget { background: var(--gw-info-soft); border-left-color: var(--gw-accent); }
.gw-node-title { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.gw-node-meta { display: flex; align-items: center; gap: 6px; flex-shrink: 0; }
.gw-caret {
  width: 16px; height: 16px; flex-shrink: 0; display: inline-flex;
  align-items: center; justify-content: center; border: none; background: transparent;
  cursor: pointer; color: var(--gw-faint); border-radius: 3px;
}
.gw-caret--leaf { cursor: default; visibility: hidden; }
.gw-caret svg { transition: transform .12s ease; }
.gw-caret--open svg { transform: rotate(90deg); }

/* ------------------------------------------------------------------ chips -- */

.gw-chip {
  display: inline-flex; align-items: center; gap: 4px; flex-shrink: 0;
  font-size: 10.5px; font-weight: 580; line-height: 1.4;
  padding: 1px 6px; border-radius: 4px; border: 1px solid transparent;
  white-space: nowrap;
}
.gw-chip--planned   { color: var(--gw-neutral); background: var(--gw-neutral-soft); }
.gw-chip--active    { color: var(--gw-info);    background: var(--gw-info-soft); }
.gw-chip--achieved  { color: var(--gw-ok);      background: var(--gw-ok-soft); }
.gw-chip--cancelled { color: var(--gw-faint);   background: var(--gw-surface-2); text-decoration: line-through; }
.gw-chip--level     { color: var(--gw-faint);   background: transparent; border-color: var(--gw-border); text-transform: capitalize; }
.gw-chip--count     { color: var(--gw-muted);   background: var(--gw-surface); }
.gw-chip--warn      { color: var(--gw-warn);    background: var(--gw-warn-soft); }
.gw-chip--danger    { color: var(--gw-danger);  background: var(--gw-danger-soft); }

/* --------------------------------------------------------------- progress -- */

.gw-bar { height: 4px; border-radius: 999px; background: var(--gw-track); overflow: hidden; width: 100%; }
.gw-bar-fill { height: 100%; border-radius: 999px; background: var(--gw-accent); transition: width .25s ease; }
.gw-bar-fill--done { background: var(--gw-ok); }
.gw-bar--node { width: 46px; flex-shrink: 0; }
.gw-bar--wide { height: 7px; }
.gw-pct { font-size: 10.5px; font-variant-numeric: tabular-nums; color: var(--gw-muted); flex-shrink: 0; min-width: 30px; text-align: right; }

.gw-metrics { display: grid; grid-template-columns: repeat(auto-fit, minmax(96px, 1fr)); gap: 1px; background: var(--gw-border); border: 1px solid var(--gw-border); }
.gw-metric { background: var(--background, #fff); padding: 9px 11px; display: flex; flex-direction: column; gap: 2px; }
.dark .gw-metric { background: var(--background, #0b0d10); }
.gw-metric-value { font-size: 17px; font-weight: 620; font-variant-numeric: tabular-nums; line-height: 1.2; }
.gw-metric-label { font-size: 10px; text-transform: uppercase; letter-spacing: .05em; color: var(--gw-faint); }

/* -------------------------------------------------------------- structure -- */

.gw-section { border: 1px solid var(--gw-border); }
.gw-section-head {
  display: flex; align-items: center; gap: 8px; padding: 8px 11px;
  background: var(--gw-surface); border-bottom: 1px solid var(--gw-border);
}
.gw-section-body { padding: 11px; }
.gw-section-body--flush { padding: 0; }
.gw-list-row {
  display: flex; align-items: center; gap: 8px; padding: 7px 11px;
  border-bottom: 1px solid var(--gw-border);
}
.gw-list-row:last-child { border-bottom: none; }
@media (hover: hover) and (pointer: fine) {
  .gw-list-row:hover { background: var(--gw-hover); }
  .gw-list-row:hover .gw-reveal { opacity: 1; }
}
.gw-reveal { opacity: 0; transition: opacity .12s ease; }
@media (hover: none), (pointer: coarse) { .gw-reveal { opacity: 1; } }
.gw-empty { padding: 14px 11px; color: var(--gw-faint); font-size: 12px; }

.gw-field { display: grid; grid-template-columns: 92px 1fr; gap: 8px; align-items: center; padding: 4px 0; }
@container gw (max-width: 520px) { .gw-field { grid-template-columns: 1fr; gap: 3px; } }
.gw-field-label { font-size: 11px; color: var(--gw-faint); text-transform: uppercase; letter-spacing: .04em; }

.gw-link { color: var(--gw-accent); text-decoration: none; }
@media (hover: hover) and (pointer: fine) { .gw-link:hover { text-decoration: underline; } }

.gw-breadcrumb { display: flex; align-items: center; gap: 5px; flex-wrap: wrap; font-size: 11.5px; color: var(--gw-muted); }
.gw-breadcrumb-sep { color: var(--gw-faint); }

.gw-title-input {
  width: 100%; border: 1px solid transparent; background: transparent; border-radius: 6px;
  font-size: 17px; font-weight: 640; letter-spacing: -0.01em; padding: 4px 6px; color: inherit;
}
.gw-title-input:hover, .gw-title-input:focus { border-color: var(--gw-border-strong); }
.gw-desc-input {
  width: 100%; border: 1px solid transparent; background: transparent; border-radius: 6px;
  font-size: 12.5px; padding: 5px 6px; color: var(--gw-muted); min-height: 54px;
  resize: vertical; line-height: 1.55; font-family: inherit;
}
.gw-desc-input:hover, .gw-desc-input:focus { border-color: var(--gw-border-strong); color: inherit; }

/* ------------------------------------------------------------------ modal -- */

.gw-overlay {
  position: fixed; inset: 0; z-index: 60; background: rgba(0,0,0,0.45);
  display: flex; align-items: center; justify-content: center; padding: 16px;
}
.gw-modal {
  width: 100%; max-width: 520px; max-height: 86vh; overflow: auto;
  background: var(--background, #fff); border: 1px solid var(--gw-border-strong);
  border-radius: 10px; box-shadow: 0 18px 48px rgba(0,0,0,0.28); padding: 16px;
}
.dark .gw-modal { background: var(--background, #0b0d10); }
.gw-modal-title { font-size: 14px; font-weight: 640; margin: 0 0 3px; }
.gw-modal-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 14px; }

.gw-callout { border: 1px solid var(--gw-border); border-left-width: 3px; padding: 9px 11px; font-size: 12px; }
.gw-callout--danger { border-left-color: var(--gw-danger); background: var(--gw-danger-soft); }
.gw-callout--warn { border-left-color: var(--gw-warn); background: var(--gw-warn-soft); }
.gw-callout--info { border-left-color: var(--gw-accent); background: var(--gw-info-soft); }

.gw-check { display: flex; align-items: flex-start; gap: 8px; padding: 6px 2px; cursor: pointer; }
.gw-check input { margin-top: 2px; flex-shrink: 0; }

.gw-nav {
  display: flex; align-items: center; gap: 10px; margin: 0 8px; padding: 6px 8px;
  border-radius: 6px; text-decoration: none; color: inherit; font-size: 13px;
}
@media (hover: hover) and (pointer: fine) { .gw-nav:hover { background: var(--gw-hover); } }

.gw-spin { display: inline-block; width: 12px; height: 12px; border: 2px solid var(--gw-track); border-top-color: var(--gw-accent); border-radius: 50%; animation: gw-spin .7s linear infinite; }
@keyframes gw-spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) {
  .gw-spin { animation-duration: 2.4s; }
  .gw-bar-fill, .gw-caret svg { transition: none; }
}
`;
