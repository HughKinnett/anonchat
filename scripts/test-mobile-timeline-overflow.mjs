import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const css = await readFile(new URL("../mobile-hotfix.css", import.meta.url), "utf8");

const mobileBlock = css.match(/@media \(max-width: 560px\) \{([\s\S]*?)\n\}/)?.[1] || "";
assert.match(mobileBlock, /\.content-grid[\s\S]*?width:\s*auto\s*;/,
  "mobile content grid must not combine width:100% with horizontal margins");
assert.match(mobileBlock, /\.feed-tabs[\s\S]*?width:\s*100%\s*;/,
  "mobile feed tabs should still fill the corrected grid width");

console.log("mobile timeline overflow regression passed");
