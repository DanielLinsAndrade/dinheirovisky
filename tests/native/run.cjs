const { chromium } = require("playwright-core");
const { DatabaseSync } = require("node:sqlite");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawn, execFileSync, execFile } = require("node:child_process");
const { createHash } = require("node:crypto");
const net = require("node:net");
let debugPort;
const executable = path.resolve(process.argv[2]),
  output = path.resolve(process.argv[3]);
const allowed = path.resolve(".validation/acceptance") + path.sep;
assert.ok(
  output.startsWith(allowed) && executable.startsWith(output + path.sep),
);
const data = path.join(
  process.env.LOCALAPPDATA,
  "com.dinheirovisk.validation.acceptance",
);
const dbPath = path.join(data, "dinheirovisk.sqlite3");
const powershell = path.join(
  process.env.SystemRoot,
  "System32/WindowsPowerShell/v1.0/powershell.exe",
);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const write = (name, value) =>
  fs.writeFileSync(path.join(output, name), JSON.stringify(value, null, 2));
const evidence = {
  environment: {
    node: process.version,
    platform: process.platform,
    arch: process.arch,
  },
  checks: [],
};
let processHandle, browser, page, invoke;
const button = (name) => page.getByRole("button", { name, exact: true });
const rows = () => invoke("list_transactions");
const movement = (description, kind = "expense", amount = 101, extra = {}) => ({
  id: null,
  description,
  kind,
  amount,
  date: "2026-09-12",
  accountId: 1,
  destinationAccountId: null,
  categoryId: null,
  status: "posted",
  notes: null,
  ...extra,
});
async function start(recovery = false) {
  debugPort = await new Promise((resolve,reject)=>{const server=net.createServer();server.on("error",reject);server.listen(0,"127.0.0.1",()=>{const port=server.address().port;server.close(()=>resolve(port));});});
  const started = Date.now();
  const milestones = { startedAt: new Date(started).toISOString() };
  processHandle = spawn(executable, [], {
    windowsHide: true,
    env: {
      ...process.env,
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS:
        `--remote-debugging-address=127.0.0.1 --remote-debugging-port=${debugPort}`,
    },
  });
  let diagnostic = "";
  const capture = chunk => { diagnostic = (diagnostic + String(chunk)).slice(-8000); };
  processHandle.stdout.on("data",capture);
  processHandle.stderr.on("data",capture);
  processHandle.on("error",capture);
  while (Date.now() - started < 20000) {
    if (processHandle.exitCode !== null) break;
    try {
      browser = await chromium.connectOverCDP(`http://127.0.0.1:${debugPort}`, {timeout:1000});
      break;
    } catch {
      await sleep(50);
    }
  }
  if (!browser) write("startup-failure.json",{exitCode:processHandle.exitCode,pid:processHandle.pid,debugPort,diagnostic});
  assert.ok(browser, "WebView2 CDP must start");
  milestones.cdpMs = Date.now() - started;
  for (let i = 0; i < 150; i++) {
    page = browser
      .contexts()[0]
      .pages()
      .find((p) => /tauri\.localhost|tauri:\/\//.test(p.url()));
    if (page) break;
    await sleep(50);
  }
  assert.ok(page, "Bundled frontend must load, without Vite");
  milestones.pageMs = Date.now() - started;
  page.setDefaultTimeout(20000);
  invoke = (cmd, args = {}) =>
    page.evaluate(
      ({ cmd, args }) => window.__TAURI_INTERNALS__.invoke(cmd, args),
      { cmd, args },
    );
  await (
    recovery
      ? page.getByRole("heading", { name: "Armazenamento do Dinheirovisky" })
      : button("Início")
  ).waitFor();
  milestones.shellMs = Date.now() - started;
  if (!recovery) {
    await page.getByRole("heading", {name:"Principais despesas",exact:true}).waitFor();
    await page.getByText("Carregando dashboard…",{exact:true}).waitFor({state:"hidden"});
  }
  const startupMs = Date.now() - started;
  milestones.readyMs = startupMs;
  evidence.startups ??= [];
  evidence.startups.push({...milestones,recovery});
  if (!recovery) {
    const status = await invoke("get_app_status");
    assert.equal(path.resolve(status.databasePath), dbPath);
    assert.equal(status.schemaVersion, 14);
  }
  return startupMs;
}
async function stop() {
  if (browser) {
    await browser.close();
    browser = undefined;
  }
  if (processHandle && processHandle.exitCode === null) {
    const done = new Promise((r) => processHandle.once("exit", r));
    execFileSync("taskkill.exe", ["/PID", String(processHandle.pid), "/T", "/F"], {windowsHide:true,stdio:"ignore"});
    await done;
  }
  processHandle = undefined;
  await sleep(300);
}
async function moveTestData(name) {
  const target = path.resolve(output, name);
  assert.ok(target.startsWith(output + path.sep));
  // Only the disposable acceptance profile is moved; wait for Windows handles.
  for (let attempt = 0; ; attempt++) {
    try { fs.renameSync(data, target); return; }
    catch (error) {
      if (!["EPERM", "EBUSY"].includes(error.code) || attempt >= 20) throw error;
      await sleep(250);
    }
  }
}
function resources() {
  const result = execFileSync(
    powershell,
    [
      "-NoProfile",
      "-File",
      path.join(__dirname, "resources.ps1"),
      "-TargetPid",
      String(processHandle.pid),
    ],
    { encoding: "utf8", windowsHide: true },
  );
  const tree = JSON.parse(result),
    list = Array.isArray(tree) ? tree : [tree];
  return {
    tree: list,
    ramMiB: list.reduce((s, p) => s + p.WorkingSet64, 0) / 1048576,
    cpuSeconds: list.reduce((s, p) => s + (p.CPU || 0), 0),
  };
}
function fileDialog(file, cancel = false) {
  return new Promise((resolve, reject) =>
    execFile(
      powershell,
      [
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        path.join(__dirname, "file-dialog.ps1"),
        "-TargetPid",
        String(processHandle.pid),
        "-AllowedRoot",
        output,
        ...(cancel ? ["-Cancel"] : ["-FilePath", file]),
      ],
      { encoding: "utf8", windowsHide: true, timeout: 25000 },
      (e, out) => (e ? reject(e) : resolve(out)),
    ),
  );
}
function snapshotPath(file) {
  const bytes = fs.readFileSync(file);
  if (bytes.subarray(0, 10).toString() !== "DVBACKUP2\n") return file;
  const length = Number(bytes.readBigUInt64LE(10));
  const manifest = JSON.parse(bytes.subarray(18, 18 + length));
  const snapshot = bytes.subarray(18 + length);
  assert.equal(manifest.formatVersion, 2);
  assert.equal(manifest.snapshotName, "snapshot.sqlite3");
  assert.equal(manifest.snapshotSize, snapshot.length);
  assert.equal(manifest.snapshotSha256, createHash("sha256").update(snapshot).digest("hex"));
  const destination = path.join(output, "verified-backup-snapshot.sqlite3");
  fs.writeFileSync(destination, snapshot);
  return destination;
}
function inspectDatabase(file) {
  const db = new DatabaseSync(snapshotPath(file), { readOnly: true });
  try {
    assert.equal(
      Object.values(db.prepare("PRAGMA integrity_check").get())[0],
      "ok",
    );
    assert.equal(db.prepare("PRAGMA foreign_key_check").all().length, 0);
    const migrations = db
      .prepare("SELECT version,source FROM schema_migrations ORDER BY version")
      .all();
    const sources = fs
      .readdirSync("src-tauri/migrations")
      .filter((n) => n.endsWith(".sql"))
      .sort();
    assert.equal(migrations.length, sources.length);
    migrations.forEach((m, i) =>
      assert.equal(
        m.source,
        fs.readFileSync(path.join("src-tauri/migrations", sources[i]), "utf8"),
      ),
    );
    return {
      file,
      migrations: migrations.length,
      integrity: "ok",
      foreignKeys: "ok",
    };
  } finally {
    db.close();
  }
}
async function functional() {
  await start();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  assert.equal((await rows()).length, 0);
  assert.equal((await invoke("list_accounts")).length, 0);
  assert.equal(await button("Nova transação").isDisabled(), true);
  await button("Contas").click();
  await button("Nova conta").click();
  await page
    .getByLabel("Nome da conta", { exact: true })
    .fill("Principal teste");
  await page.getByLabel("Saldo inicial (R$)", { exact: true }).fill("100,00");
  await button("Salvar conta").click();
  await page.getByText("Conta salva.", { exact: true }).waitFor();
  await invoke("save_account", {
    input: {
      id: null,
      name: "Reserva teste",
      kind: "savings",
      initialBalance: 20000,
    },
  });
  await button("Transações").click();
  await button("Nova transação").click();
  await page
    .getByLabel("Descrição", { exact: true })
    .fill("Transferência exata");
  await page.getByLabel("Valor (R$)", { exact: true }).fill("10,01");
  await page
    .getByRole("dialog")
    .getByLabel("Tipo", { exact: true })
    .selectOption("transfer");
  await page.getByLabel("Conta de destino", { exact: true }).selectOption("2");
  await button("Salvar transação").click();
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  assert.deepEqual(
    (await invoke("get_balances")).map((b) => b.cents),
    ["8999", "21001"],
  );
  await invoke("save_transaction", {
    input: movement("Receita real", "income", 50000),
  });
  const category = (await invoke("list_categories")).find(
    (c) => c.kind === "expense",
  );
  await invoke("save_transaction", {
    input: movement("Despesa real", "expense", 1234, {
      categoryId: category.id,
    }),
  });
  const dashboard = await invoke("get_dashboard", { month: "2026-09" });
  assert.equal(dashboard.current.income, "50000");
  assert.equal(dashboard.current.expense, "1234");
  assert.equal(dashboard.balance, "78766");
  let budgets = await invoke("save_budget", {
    month: "2026-09",
    categoryId: category.id,
    limitAmount: 2000,
  });
  assert.equal(budgets[0].spent, "1234");
  assert.equal(budgets[0].remaining, "766");
  await invoke("save_goal", {
    input: {
      id: null,
      name: "Reserva objetivo",
      targetAmount: 101,
      targetDate: null,
    },
  });
  let goals = await invoke("add_contribution", {
    goalId: 1,
    amount: 101,
    date: "2026-09-12",
  });
  assert.equal(goals[0].completed, true);
  goals = await invoke("remove_contribution", {
    id: goals[0].contributions[0].id,
  });
  assert.equal(goals[0].currentAmount, 0);
  await invoke("save_recurrence", {
    input: {
      id: null,
      description: "Assinatura teste",
      amount: 101,
      kind: "expense",
      accountId: 1,
      categoryId: null,
      notes: null,
      frequency: "monthly",
      interval: 1,
      startDate: "2026-09-12",
      endDate: "2026-10-12",
    },
  });
  await invoke("materialize_recurrences", { today: "2026-09-12" });
  const count = (await rows()).length;
  await invoke("materialize_recurrences", { today: "2026-09-12" });
  assert.equal((await rows()).length, count);
  await invoke("save_transaction", {
    input: movement("Avulsa vencida", "expense", 202, {
      status: "pending",
      date: "2026-09-01",
    }),
  });
  assert.ok(
    (await invoke("get_due_payments", { today: "2026-09-12" })).some(
      (m) => m.description === "Avulsa vencida",
    ),
  );
  const report = await invoke("get_report", {
    from: "2026-09",
    to: "2026-09",
    accountId: null,
  });
  assert.equal(report.savings, "48766");
  // Native file input and review, before any financial write.
  await button("Importar").click();
  const csv = path.join(output, "input.csv");
  fs.writeFileSync(csv, "data;descricao;valor\n12/09/2026;CSV revisado;1,01\n");
  await page.getByLabel("Arquivo", { exact: true }).setInputFiles(csv);
  await button("Ler colunas").click();
  await button("Pré-visualizar").click();
  await page.getByText("CSV revisado", { exact: true }).waitFor();
  const beforeImport = (await rows()).length;
  await button("Revisar confirmação").click();
  assert.equal((await rows()).length, beforeImport);
  await button("Confirmar e importar").click();
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  assert.equal((await rows()).length, beforeImport + 1);
  const content = fs.readFileSync(csv, "utf8");
  const preview = await invoke("prepare_import", {
    content,
    format: "csv",
    accountId: 1,
    options: {
      delimiter: ";",
      decimal: ",",
      dateFormat: "dd/MM/yyyy",
      dateColumn: 0,
      descriptionColumn: 1,
      amountColumn: 2,
      typeColumn: null,
    },
  });
  assert.equal(preview.rows[0].duplicate, true);
  evidence.checks.push(
    "fresh install, account form, transfer form, exact balances, dashboard, budget, goals, recurrence idempotency, due payments, report, CSV UI confirmation/duplicates",
  );
  const metadataSaved = await require("./metadata.cjs")({page,invoke,button,output});
  evidence.checks.push("metadata optional edit, reuse, backend filters, archive, financial invariance and axe");
  const cardSaved=await require("./cards.cjs")({page,invoke,button,output});
  evidence.checks.push("credit cards CRUD/archive/calendar, exact limits independent of accounts, two axe checks");
  const purchaseSaved=await require("./purchases.cjs")({page,invoke,button,output});
  evidence.checks.push("card purchase/installment/invoice lifecycle, consumption once, no bank balance effect, two axe checks");
  const eventsSaved=await require("./invoice-events.cjs")({page,invoke,button,output});
  await require("./search.cjs")({page,invoke,button,output});
  const attachmentsSaved = await require("./attachments.cjs")({page,invoke,button,output,fileDialog});
  const planningSaved = await require("./planning.cjs")({page,invoke,button,output});
  await require("./reports.cjs")({page,invoke,button,output});
  const importedCard = await require("./imports-expanded.cjs")({page,invoke,button,output});
  evidence.checks.push("card CSV metadata mapping, explicit full-purchase review, OFX FITID/idempotence, duplicate confirmation, readonly preview, axe themes and narrow layout");
  evidence.checks.push("expanded reports reconcile economic and cash totals, metadata groups, three views/themes, exact tables, read-only and narrow layout");
  evidence.checks.push("planning horizons, exact invoice remaining, forecast classification, read-only queries, five origin destinations and axe");
  evidence.checks.push("invoice partial/full payments, edit, refund after settlement, credit balance, void and no duplicate expense; two axe checks");
  // Backup uses the real native picker and the installed command layer.
  await button("Backup e restauração").click();
  await button("Salvar backup").click();
  await fileDialog("", true);
  await page.getByText("Operação cancelada.").waitFor();
  const backup = path.join(output, "backup.dvbackup");
  await button("Salvar backup").click();
  await fileDialog(backup);
  await page.getByText(/Backup salvo em/).waitFor();
  const original = await rows();
  const balances = await invoke("get_balances");
  for (const a of attachmentsSaved) await invoke("remove_attachment", {id:a.attachment.id});
  await invoke("save_transaction", { input: movement("Após backup") });
  const invalid = path.join(output, "invalid.sqlite3");
  fs.writeFileSync(invalid, "invalid SQLite");
  await button("Selecionar backup para restaurar").click();
  await fileDialog(invalid);
  await page.getByRole("alert").waitFor();
  assert.equal((await rows()).length, original.length + 1);
  await button("Selecionar backup para restaurar").click();
  await fileDialog(backup);
  await page.getByRole("dialog").waitFor();
  assert.equal(await button("Restaurar e substituir dados").isDisabled(), true);
  await button("Fechar").click();
  assert.equal((await rows()).length, original.length + 1);
  await button("Selecionar backup para restaurar").click();
  await fileDialog(backup);
  await page
    .getByLabel("Entendo que os dados atuais serão substituídos.")
    .check();
  await button("Restaurar e substituir dados").click();
  await page.getByRole("heading", { name: "Restauração concluída" }).waitFor();
  assert.deepEqual(await rows(), original);
  for (const a of attachmentsSaved) assert.deepEqual(await invoke("read_attachment", {id:a.attachment.id}),a);
  assert.deepEqual((await invoke("list_recurrences")).find(r=>r.id===planningSaved.id),planningSaved);
  assert.deepEqual((await invoke("query_purchases", {cardId:importedCard.cardId,page:0})).items.find(p=>p.id===importedCard.saved.id),importedCard.saved);
  assert.deepEqual(await invoke("get_balances"), balances);
  await button("Recarregar aplicação").click();
  await button("Início").waitFor();
  evidence.checks.push(
    "native backup cancel/export/invalid rejection/preview/cancel/restore/recovery copy",
  );
  // Offline renderer and reload; IPC fallback and bundled assets must remain functional.
  await browser.contexts()[0].setOffline(true);
  await page.reload();
  await button("Início").waitFor();
  assert.equal(await page.evaluate(() => navigator.onLine), false);
  assert.deepEqual(await invoke("get_balances"), balances);
  await invoke("save_transaction", { input: movement("Operação offline") });
  const offline = (await rows()).find(
    (m) => m.description === "Operação offline",
  );
  assert.ok(offline);
  await invoke("delete_transaction", { id: offline.id });
  assert.deepEqual(await invoke("get_balances"), balances);
  await browser.contexts()[0].setOffline(false);
  evidence.checks.push(
    "offline reload/read/write/delete without Vite or external service",
  );
  const accessibility = [];
  for (const theme of ["light", "dark", "system"]) {
    const settings = await invoke("get_settings");
    await invoke("save_settings", {
      input: { ...settings, theme },
      confirmCurrencyChange: false,
    });
    await page.emulateMedia({
      colorScheme: theme === "light" ? "light" : "dark",
      reducedMotion: "reduce",
    });
    await page.reload();
    await button("Início").waitFor();
    for (const name of [
      "Início",
      "Contas",
      "Cartões",
      "Categorias",
      "Transações",
      "Orçamento",
      "Recorrências",
      "Metas",
      "Relatórios",
      "Configurações",
      "Importar",
      "Backup e restauração",
      "Sobre",
    ]) {
      await button(name).click();
      await page.waitForFunction(
        () => !document.body.innerText.includes("Carregando"),
      );
      if (name === "Início") {
        const commitments = page.getByRole("region", { name: "Vencimentos e recorrências" });
        await commitments.getByRole("button", { name: "Todos", exact: true }).waitFor();
        const today = await page.evaluate(() => {
          const d = new Date();
          return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
        });
        for (const [horizon, label] of [["overdue", "Vencidos"], ["week", "Próximos 7 dias"], ["month", "Próximos 30 dias"], ["next_month", "Próximo mês financeiro"], ["next_invoice", "Próximas faturas"], ["all", "Todos"]]) {
          const filter = commitments.getByRole("button", { name: label, exact: true });
          await filter.focus();
          await page.keyboard.press("Space");
          await page.waitForFunction(() => !document.body.innerText.includes("Carregando compromissos"));
          assert.equal(await filter.getAttribute("aria-pressed"), "true");
          const actual = await invoke("query_commitments", { today, horizon, page: 0 });
          assert.equal(await commitments.locator(".due-list li").count(), actual.items.length);
          for (const item of actual.items) assert.ok((await commitments.innerText()).includes(item.description));
        }
        await page.setViewportSize({width:1536,height:1024});
        assert.ok(await page.locator('.dashboard-context').evaluate(el=>el.getBoundingClientRect().width>=el.parentElement.getBoundingClientRect().width*0.9),'Dashboard context must span the grid');
        await page.screenshot({ path: path.join(output, `dashboard-${theme}-wide.png`), fullPage: true });
        const point = page.getByRole("button", {name:/Ver valores de/}).last();
        await point.focus();
        assert.equal(await page.locator(".chart-tooltip").isVisible(), true);
        await page.keyboard.press("Escape");
        assert.equal(await page.locator(".chart-tooltip").count(), 0);
        await page.setViewportSize({width:1100,height:760});
        await page.getByText("Ver valores mensais", { exact: true }).click();
        assert.equal(await page.getByRole("table", { name: "Evolução mensal de receitas e despesas efetivadas" }).isVisible(), true);
        await page.getByText("Estado das séries recorrentes", { exact: true }).click();
        await page.getByRole("link", { name: "Abrir compromissos" }).click();
        assert.equal(await page.evaluate(() => document.activeElement.id), "commitments");
      }
      await page.getByRole("link", { name: "Ir para o conteúdo" }).focus();
      await page.evaluate(
        fs.readFileSync(require.resolve("axe-core/axe.min.js"), "utf8"),
      );
      const violations = await page.evaluate(async () =>
        (
          await axe.run(document, {
            runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa"] },
          })
        ).violations.map((v) => ({
          id: v.id,
          impact: v.impact,
          nodes: v.nodes.map((n) => n.target),
        })),
      );
      await page.screenshot({ path: path.join(output, `screen-${theme}-${name}.png`), fullPage: true });
      accessibility.push({ theme, page: name, violations });
      assert.deepEqual(violations, [], JSON.stringify(accessibility.at(-1)));
    }
    await page.screenshot({ path: path.join(output, `shell-${theme}.png`), fullPage: true });
    const opener = page.getByRole("button", { name: /Ir para…/ });
    await opener.focus();
    await page.keyboard.press("Control+k");
    const palette = page.getByRole("dialog", { name: "Busca e navegação" });
    await palette.waitFor();
    const search = palette.getByRole("searchbox", { name: "Buscar registros e páginas" });
    assert.equal(await search.evaluate((element) => element === document.activeElement), true);
    await search.fill("Despesa real");
    await palette.getByRole("button", {name:/Transação: Despesa real/}).waitFor();
    const paletteViolations = await page.evaluate(async () => (await axe.run(document, {
      runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa"] },
    })).violations.map((v) => ({ id: v.id, nodes: v.nodes.map((n) => n.target) })));
    accessibility.push({ theme, page: "Paleta", violations: paletteViolations });
    assert.deepEqual(paletteViolations, []);
    await page.screenshot({ path: path.join(output, `palette-${theme}.png`) });
    await search.fill("sem correspondência");
    await palette.getByText("Nenhum registro encontrado.", {exact:true}).waitFor();
    await page.keyboard.press("Escape");
    await palette.waitFor({ state: "hidden" });
    assert.equal(await opener.evaluate((element) => element === document.activeElement), true);
    await page.keyboard.press("Control+k");
    await search.fill("orcamento");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
    await palette.waitFor({ state: "hidden" });
    assert.equal(await button("Orçamento").getAttribute("aria-current"), "page");
    assert.equal(await page.evaluate(() => document.activeElement.tagName), "H1");
  }
  write("accessibility.json", accessibility);
  await button("Início").click();
  await button("Nova transação").click();
  await page.getByRole("dialog").waitFor();
  assert.equal(
    await page.getByRole("dialog").getAttribute("aria-modal"),
    "false",
  );
  assert.equal(
    await page.evaluate(() => document.activeElement.id),
    "movement-description",
  );
  await page.keyboard.press("Control+k");
  assert.equal(await page.getByRole("dialog").count(), 1);
  assert.equal(await page.evaluate(() => document.activeElement.id), "movement-description");
  await page.keyboard.press("Escape");
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  await page.keyboard.press("Control+n");
  await page.getByRole("dialog").waitFor();
  await page.keyboard.press("Escape");
  await page.setViewportSize({ width: 600, height: 850 });
  await button("Expandir navegação").click();
  assert.equal(await button("Recolher navegação").getAttribute("aria-expanded"), "true");
  await button("Início").click();
  assert.equal(await button("Expandir navegação").getAttribute("aria-expanded"), "false");
  assert.equal(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth <=
        document.documentElement.clientWidth,
    ),
    true,
  );
  await page.screenshot({
    path: path.join(output, "dashboard-dark.png"),
    fullPage: true,
  });
  assert.deepEqual(errors, []);
  evidence.checks.push(
    "42 axe checks; shell/palette in three themes; keyboard focus, Escape, filtering, protected editors, reduced motion and collapsed 600px layout",
  );
  assert.deepEqual((await rows()).find(m=>m.id===metadataSaved.id).details,metadataSaved.details);
  assert.deepEqual((await invoke("list_cards")).find(c=>c.id===cardSaved.id),cardSaved);
  assert.deepEqual(await invoke("query_purchases",{cardId:purchaseSaved.cardId,page:0}),purchaseSaved.purchases);
  assert.deepEqual(await invoke("invoice_detail",{id:eventsSaved.id,today:"2024-03-01"}),eventsSaved.detail);
  await require("./ui-polish.cjs")({ page, button, invoke, output });
  await stop();
  evidence.sqlite = [inspectDatabase(dbPath), inspectDatabase(backup)];
  // Corruption is injected only in this disposable app id after clean shutdown.
  await moveTestData("before-corruption-data");
  fs.mkdirSync(data, { recursive: true });
  fs.writeFileSync(dbPath, "corrupt test database");
  const invalidHash = createHash("sha256")
    .update(fs.readFileSync(dbPath))
    .digest("hex");
  await start(true);
  await page.getByRole("alert").waitFor();
  await button("Tentar abrir novamente").click();
  await page.getByRole("alert").waitFor();
  await button("Selecionar backup para recuperação").click();
  await fileDialog(backup);
  await page
    .getByLabel(
      "Usar os dados deste backup como banco ativo, preservando o banco anterior.",
    )
    .check();
  await button("Confirmar recuperação").click();
  await button("Início").waitFor();
  assert.equal(
    createHash("sha256").update(fs.readFileSync(dbPath)).digest("hex"),
    invalidHash,
  );
  assert.deepEqual(await invoke("get_balances"), balances);
  evidence.checks.push(
    "corrupt startup recovery preserves original bytes and restores balances",
  );
  await stop();
}
async function seedPerformance() {
  await moveTestData("functional-data");
  fs.mkdirSync(data, { recursive: true });
  // Reuse the official schema verified during native backup, never synthesize migration history.
  fs.copyFileSync(snapshotPath(path.join(output, "backup.dvbackup")), dbPath);
  const db = new DatabaseSync(dbPath);
  db.exec("PRAGMA foreign_keys=ON; BEGIN");
  // Separate fixture: clear in referential order, only in this disposable database.
  for (const table of [
    "attachments",
    "card_import_entries",
    "import_entries",
    "import_batches",
    "recurrence_occurrences",
    "transactions",
    "recurrence_templates",
    "recurrences",
    "goal_contributions",
    "goals",
    "budgets",
    "invoice_events",
    "card_installments",
    "card_purchases",
    "card_invoices",
    "credit_cards",
    "accounts",
  ])
    db.exec(`DELETE FROM ${table}`);
  const account = db.prepare(
    "INSERT INTO accounts(id,name,type,initial_balance) VALUES(?,?,'checking',10000)",
  );
  for (let i = 1; i <= 100; i++) account.run(i, `Conta ${i}`);
  const insert = db.prepare(
    "INSERT INTO transactions(description,amount,type,date,account_id,status,notes) VALUES(?,?,?,?,?,'posted',?)",
  );
  for (let i = 0; i < 50000; i++)
    insert.run(
      `Movimento ${i}`,
      9007199254740991n - BigInt(i),
      i % 2 ? "expense" : "income",
      `${2020 + (i % 7)}-${String(1 + (i % 12)).padStart(2, "0")}-15`,
      1 + (i % 100),
      "observações ".repeat(30),
    );
  const counts = require("./volume.cjs")(db);
  assert.equal(counts.transactions,50000);
  assert.equal(counts.card_purchases,5000);
  assert.equal(counts.card_installments,15000);
  write("volume-dataset.json",counts);
  evidence.dataset = counts;
  db.exec("COMMIT; PRAGMA wal_checkpoint(TRUNCATE)");
  db.close();
}
async function performance() {
  await seedPerformance();
  const startupMs = await start();
  const operations = {};
  for (const [command, args, label = command] of [
    ["search_global", {query:"Movimento",page:0}],
    ["query_transactions", { query: { page: 0 } }],
    ["get_balances", {}],
    ["get_dashboard", { month: "2026-09" }],
    ["query_due_payments", { today: "2026-09-12", horizon: "all", page: 0 }],
    ["query_commitments", { today: "2026-09-12", horizon: "all", page: 0 }],
    ["query_financial_alerts", { today: "2026-09-12", comparisonMonth: null, page: 0 }],
    ["list_budgets", { month: "2026-09" }],
    ["get_report", { from: "2026-01", to: "2026-09", accountId: null }],
    ["get_report_analysis", {filter:{from:"2026-01",to:"2026-09",view:"consumption",groupBy:"method",page:0}}],
    ["query_purchases", {cardId:1,page:0}],
    ["query_invoices", {cardId:1,today:"2026-09-12",page:0}],
    ["invoice_detail", {id:1,today:"2026-09-12"}],
    ["get_report_analysis", {filter:{from:"2024-01",to:"2026-12",view:"cash",groupBy:"card",page:0}}, "analysis_cash"],
    ["get_report_analysis", {filter:{from:"2024-01",to:"2026-12",view:"installments",groupBy:"invoice",page:0}}, "analysis_installments"],
    ["query_commitments", {today:"2026-09-12",horizon:"next_invoice",page:0}, "next_invoices"],
  ]) {
    operations[label] = [];
    for (let i = 0; i < 10; i++) {
      const start = performanceNow();
      const result = await invoke(command, args);
      operations[label].push(performanceNow() - start);
      if (command === "get_dashboard") assert.equal(result.balance, "975000");
      if (command === "query_transactions")
        assert.equal(result.items.length, 50);
    }
  }
  const batch = Array.from({ length: 2000 }, (_, i) => ({
    line: i + 1,
    sourceAccountId: 1,
    externalId: null,
    rawAmount: "1.01",
    movement: movement(`Lote ${i}`),
  }));
  const startImport = performanceNow();
  await invoke("review_import", { rows: batch, currency: "BRL" });
  const importMs = performanceNow() - startImport;
  const cardBatch = Array.from({length:2000},(_,i)=>({line:i+1,purchase:{id:null,cardId:1,description:`Importação volume ${i}`,date:"2026-09-15",amount:1001,installmentCount:3,categoryId:null,merchant:null,intermediary:null,channel:null,notes:null},externalId:null,rawAmount:"-10.01",sourceCard:null,firstInvoice:"2026-09",confirmedPurchase:true,sourceKind:"expense"}));
  const startCardImport=performanceNow();
  const reviewedCards=await invoke("review_card_import",{rows:cardBatch,currency:"BRL"});
  const cardImportMs=performanceNow()-startCardImport;
  assert.equal(reviewedCards.length,2000);
  assert.ok(reviewedCards.every(r=>!r.error&&!r.duplicate&&!r.alreadyImported));
  await sleep(1000);
  const before = resources();
  const idleStart = performanceNow();
  await sleep(30000);
  const after = resources();
  const idleSeconds = (performanceNow() - idleStart) / 1000;
  const idleCpuPercent =
    ((after.cpuSeconds - before.cpuSeconds) / idleSeconds) * 100;
  const result = {
    startupMs,
    operations,
    importMs,
    cardImportMs,
    dataset: evidence.dataset,
    startupMilestones: evidence.startups.at(-1),
    ramMiB: after.ramMiB,
    idleCpuPercent,
    idleSeconds,
    treeBeforeIdle: before.tree,
    tree: after.tree,
  };
  write("performance.json", result);
  assert.ok(startupMs <= 5000, `startup ${startupMs}`);
  assert.ok(importMs <= 2000, `import ${importMs}`);
  assert.ok(cardImportMs <= 2000, `card import ${cardImportMs}`);
  assert.ok(after.ramMiB <= 512, `RAM ${after.ramMiB}`);
  assert.ok(idleCpuPercent <= 1, `idle CPU ${idleCpuPercent}`);
  for (const [command, times] of Object.entries(operations))
    assert.ok(Math.max(...times) <= 500, `${command}: ${Math.max(...times)}ms`);
  await require("./volume-ui.cjs")({page,button,invoke,fileDialog,output});
  await stop();
  evidence.sqlite.push(inspectDatabase(dbPath));
  evidence.checks.push(
    "release performance envelope: 50000 transactions/100 accounts plus 100 cards/5000 purchases/15000 installments/3800 invoices/800 events, full process tree and 30s idle",
  );
}
const performanceNow = () => Number(process.hrtime.bigint()) / 1e6;
async function validateWindowFrame() {
  await require("./window-frame.cjs")({ page, invoke, output, pid: processHandle.pid });
  const currentProcess=processHandle;
  const closed = new Promise(resolve => currentProcess.once("exit", resolve));
  await button("Fechar janela").click();
  await Promise.race([closed, sleep(5000).then(() => { if(currentProcess.exitCode === null) throw new Error("Custom close did not exit"); })]);
  evidence.checks.push("Custom titlebar: native decoration disabled; minimize/maximize/restore/double-click/resize/modal controls/close passed");
}
(async () => {
  assert.equal(process.platform, "win32");
  if (fs.existsSync(data))
    await moveTestData("previous-test-data");
  try {
    if(process.env.DINHEIROVISKY_WINDOW_FRAME_ONLY === "1") {
      await start();
      await validateWindowFrame();
      write("result.json", {...evidence,status:"passed",scope:"window-frame-only"});
      return;
    }
    // Native window sizing must precede viewport emulation used by layout tests.
    await start();
    await validateWindowFrame();
    await stop();
    await functional();
    await performance();
    write("result.json", { ...evidence, status: "passed" });
    console.log("Native acceptance passed:", output);
  } catch (error) {
    write("result.json", {
      ...evidence,
      status: "failed",
      error: String(error),
      stack: error.stack,
    });
    if (page)
      await page
        .screenshot({ path: path.join(output, "failure.png") })
        .catch(() => {});
    throw error;
  } finally {
    await stop();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
