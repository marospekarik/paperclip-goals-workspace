import { expect, test } from "bun:test";

import packageJson from "../package.json";
import manifest from "../src/manifest.js";

test("the Paperclip manifest reports the published package version", () => {
  expect(manifest.version).toBe(packageJson.version);
});
