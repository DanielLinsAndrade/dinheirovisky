const fs = require("node:fs"),
  assert = require("node:assert/strict");
const installed = fs.readFileSync(process.argv[2]);
const built = fs.readFileSync(process.argv[3]);
// Tauri patches UNK to NSS while bundling NSIS, then restores the build file.
const from = Buffer.from("__TAURI_BUNDLE_TYPE_VAR_NSS"),
  to = Buffer.from("__TAURI_BUNDLE_TYPE_VAR_UNK");
assert.equal(installed.indexOf(from), installed.lastIndexOf(from));
assert.ok(installed.indexOf(from) >= 0, "Expected NSIS bundle marker");
to.copy(installed, installed.indexOf(from));
assert.ok(
  installed.equals(built),
  "Installed code differs beyond the official bundle marker",
);
