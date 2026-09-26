// Upgrade a SPEC1-generated synthetic database through the installed binaries.
const { chromium } = require("playwright-core");
const { DatabaseSync } = require("node:sqlite");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const [mode, executableArg, outputArg] = process.argv.slice(2);
assert.ok(["before", "after"].includes(mode));
const output = path.resolve(outputArg),
  executable = path.resolve(executableArg);
assert.ok(output.startsWith(path.resolve(".validation/branding") + path.sep));
assert.ok(executable.startsWith(output + path.sep));
const data = path.join(
  process.env.LOCALAPPDATA,
  "com.dinheirovisk.validation.acceptance",
);
const database = path.join(data, "dinheirovisk.sqlite3");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const write = (name, value) =>
  fs.writeFileSync(path.join(output, name), JSON.stringify(value, null, 2));
function snapshot() {
  const db = new DatabaseSync(database, { readOnly: true });
  try {
    assert.equal(
      Object.values(db.prepare("PRAGMA integrity_check").get())[0],
      "ok",
    );
    assert.equal(db.prepare("PRAGMA foreign_key_check").all().length, 0);
    const schema = db
      .prepare(
        "SELECT type,name,tbl_name,sql FROM sqlite_schema ORDER BY type,name",
      )
      .all();
    const tables = {};
    for (const { name } of schema.filter((row) => row.type === "table")) {
      const stmt = db.prepare(
        'SELECT * FROM "' + name.replaceAll('"', '""') + '" ORDER BY rowid',
      );
      stmt.setReadBigInts(true);
      tables[name] = stmt.all();
    }
    assert.equal(tables.schema_migrations.length, 6);
    // Stringify BigInt without rounding any financial values.
    return JSON.parse(
      JSON.stringify({ schema, tables }, (_, v) =>
        typeof v === "bigint" ? v.toString() : v,
      ),
    );
  } finally {
    db.close();
  }
}
async function main() {
  if (mode === "before" && fs.existsSync(data)) {
    // Archive only this fixed test identity; never touch the normal app data.
    fs.renameSync(data, path.join(output, "previous-test-data"));
  }
  const child = spawn(executable, [], {
    windowsHide: true,
    env: {
      ...process.env,
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS:
        "--remote-debugging-address=127.0.0.1 --remote-debugging-port=9225",
    },
  });
  let browser;
  try {
    for (let i = 0; i < 150; i++) {
      try {
        browser = await chromium.connectOverCDP("http://127.0.0.1:9225");
        break;
      } catch {
        await sleep(100);
      }
    }
    assert.ok(browser, "Installed WebView2 must start");
    let page;
    for (let i = 0; i < 100; i++) {
      page = browser
        .contexts()[0]
        .pages()
        .find((p) => /tauri\.localhost|tauri:\/\//.test(p.url()));
      if (page) break;
      await sleep(100);
    }
    assert.ok(page);
    await page
      .getByRole("button", { name: mode === "before" ? "Dashboard" : "Início", exact: true })
      .waitFor();
    const invoke = (cmd, args = {}) =>
      page.evaluate(
        ({ cmd, args }) => window.__TAURI_INTERNALS__.invoke(cmd, args),
        { cmd, args },
      );
    const status = await invoke("get_app_status");
    assert.equal(path.resolve(status.databasePath), database);
    assert.equal(status.schemaVersion, 6);
    if (mode === "before") {
      assert.equal(await page.title(), "Dinheirovisk");
      for (const name of ["Conta anterior", "Reserva anterior"]) {
        await invoke("save_account", {
          input: { id: null, name, kind: "checking", initialBalance: 100000 },
        });
      }
      for (const kind of ["expense", "transfer"]) {
        await invoke("save_transaction", {
          input: {
            id: null,
            description: "Anterior " + kind,
            kind,
            amount: 12345,
            date: "2026-09-12",
            accountId: 1,
            destinationAccountId: kind === "transfer" ? 2 : null,
            categoryId: null,
            status: "posted",
            notes: "Preservar na troca de marca",
          },
        });
      }
      write("before.json", snapshot());
      write("balances-before.json", await invoke("get_balances"));
    } else {
      assert.equal(await page.title(), "Dinheirovisky");
      assert.deepEqual(
        snapshot(),
        JSON.parse(fs.readFileSync(path.join(output, "before.json"), "utf8")),
      );
      assert.deepEqual(
        await invoke("get_balances"),
        JSON.parse(
          fs.readFileSync(path.join(output, "balances-before.json"), "utf8"),
        ),
      );
      const settings = await invoke("get_settings");
      const checks = [];
      for (const theme of ["light", "dark", "system"]) {
        await invoke("save_settings", {
          input: { ...settings, theme },
          confirmCurrencyChange: false,
        });
        await page.reload();
        await page.getByRole("button", { name: "Sobre", exact: true }).click();
        await page
          .getByRole("heading", { name: "Sobre o Dinheirovisky" })
          .waitFor();
        await page.getByText("Seu bolso agradece.", { exact: true }).waitFor();
        assert.equal(
          await page.locator(".brand").innerText(),
          "Dinheirovisky.",
        );
        assert.equal(await page.locator(".brand-symbol:visible").count(), 1);
        assert.ok(
          await page
            .locator(".brand-symbol:visible")
            .evaluate((img) => img.complete && img.naturalWidth > 0),
        );
        await page.evaluate(
          fs.readFileSync(require.resolve("axe-core/axe.min.js"), "utf8"),
        );
        const result = await page.evaluate(() => window.axe.run(document));
        assert.deepEqual(result.violations, []);
        for (const width of [1100, 600]) {
          await page.setViewportSize({ width, height: 760 });
          assert.ok(
            await page.evaluate(
              () => document.documentElement.scrollWidth <= innerWidth,
            ),
          );
          await page.screenshot({
            path: path.join(output, `about-${theme}-${width}.png`),
            fullPage: true,
          });
        }
        checks.push({ theme, violations: result.violations });
      }
      await invoke("save_settings", {
        input: settings,
        confirmCurrencyChange: false,
      });
      write("result.json", {
        status: "passed",
        sameDatabase: database,
        allTablesPreserved: true,
        schemaUnchanged: true,
        balancesPreserved: true,
        checks,
      });
    }
  } finally {
    if (browser) await browser.close();
    if (child.exitCode === null) {
      const done = new Promise((r) => child.once("exit", r));
      child.kill();
      await done;
    }
  }
}
main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
