// Builds the three plugin bundles per the @paperclipai/plugin-sdk bundler
// contract (createPluginBundlerPresets): worker and manifest are ESM for node,
// the UI is ESM for the browser with react and the SDK UI package left external
// (the host provides both at runtime).

export {};

const uiExternal = [
  "@paperclipai/plugin-sdk/ui",
  "@paperclipai/plugin-sdk/ui/hooks",
  "react",
  "react-dom",
  "react/jsx-runtime",
  "react/jsx-dev-runtime",
];

const builds = [
  {
    entrypoints: ["src/worker.ts"],
    outdir: "dist",
    target: "node" as const,
    external: ["react", "react-dom"],
  },
  {
    entrypoints: ["src/manifest.ts"],
    outdir: "dist",
    target: "node" as const,
    external: ["@paperclipai/plugin-sdk"],
  },
  {
    entrypoints: ["src/ui/index.tsx"],
    outdir: "dist/ui",
    target: "browser" as const,
    external: uiExternal,
  },
];

let failed = false;
for (const config of builds) {
  const result = await Bun.build({
    ...config,
    format: "esm",
    sourcemap: "external",
    minify: false,
  });
  if (!result.success) {
    failed = true;
    for (const log of result.logs) console.error(log);
  }
}

if (failed) process.exit(1);
console.log("Built dist/worker.js, dist/manifest.js, dist/ui/index.js");
