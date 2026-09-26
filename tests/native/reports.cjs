const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
module.exports = async ({ page, invoke, button, output }) => {
  const before = await invoke("get_balances");
  const filter = {
    from: "2026-09",
    to: "2026-09",
    view: "consumption",
    groupBy: "method",
    page: 0,
  };
  const economic = await invoke("get_report_analysis", { filter });
  const dashboard = await invoke("get_dashboard", { month: filter.from });
  assert.equal(economic.totals.expense, dashboard.current.expense);
  assert.equal(economic.totals.income, dashboard.current.income);
  const cash = await invoke("get_report_analysis", {
    filter: { ...filter, view: "cash" },
  });
  const historic = await invoke("get_report", {
    from: filter.from,
    to: filter.to,
    accountId: null,
  });
  assert.equal(cash.totals.expense, historic.expense);
  assert.equal(cash.totals.payments, historic.invoicePayments);
  assert.equal(cash.totals.result, historic.savings);
  for (const groupBy of [
    "category",
    "method",
    "card",
    "merchant",
    "channel",
    "classification",
    "recurrence",
  ]) {
    const r = await invoke("get_report_analysis", {
      filter: { ...filter, groupBy },
    });
    assert.equal(
      r.groups.reduce((a, g) => a + BigInt(g.totals.expense), 0n).toString(),
      r.totals.expense,
    );
  }
  await button("Relatórios").click();
  await button("Consumo, caixa e parcelas").click();
  await page.getByLabel("Mês inicial da análise").fill(filter.from);
  await page.getByLabel("Mês final da análise").fill(filter.to);
  await page.getByLabel("Agrupar por", { exact: true }).selectOption("method");
  await button("Aplicar análise").click();
  await page
    .getByRole("table", { name: "Totais mensais exatos do recorte" })
    .waitFor();
  const screenshots = [];
  for (const theme of ["light", "dark", "system"]) {
    await require("./theme.cjs")(page,theme);
    for (const view of ["consumption", "cash", "installments"]) {
      await page.getByLabel("Visão financeira").selectOption(view);
      await button("Aplicar análise").click();
      await page
        .getByText("Calculando análise…", { exact: true })
        .waitFor({ state: "hidden" });
      const table = page.getByRole("table", {
        name: "Totais mensais exatos do recorte",
      });
      await table.waitFor();
      await table.getByRole("columnheader", {name:view === "cash" ? "Pagamentos de fatura" : view === "installments" ? "Parcelas contratuais" : "Consumo líquido",exact:true}).waitFor();
      const real = await invoke("get_report_analysis", {
        filter: { ...filter, view },
      });
      const amount =
        view === "installments"
          ? real.totals.installments
          : real.totals.expense;
      const display = new Intl.NumberFormat("pt-BR", {
        style: "currency",
        currency: "BRL",
      }).format(Number(amount) / 100);
      assert.ok(
        (await table.innerText())
          .replace(/\s/g, "")
          .includes(display.replace(/\s/g, "")),
      );
      await page.evaluate(
        fs.readFileSync(require.resolve("axe-core/axe.min.js"), "utf8"),
      );
      assert.deepEqual(
        await page.evaluate(
          async () =>
            (
              await axe.run(document, {
                runOnly: {
                  type: "tag",
                  values: ["wcag2a", "wcag2aa", "wcag21aa"],
                },
              })
            ).violations,
        ),
        [],
      );
      const file = `analysis-${view}-${theme}.png`;
      await page.screenshot({ path: path.join(output, file), fullPage: true });
      screenshots.push(file);
    }
  }
  await page.setViewportSize({ width: 600, height: 850 });
  assert.equal(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth <=
        document.documentElement.clientWidth,
    ),
    true,
  );
  await page.screenshot({
    path: path.join(output, "analysis-narrow.png"),
    fullPage: true,
  });
  await page.setViewportSize({ width: 1100, height: 760 });
  await button("Caixa histórico e saldos").click();
  await page.getByRole("region", { name: "Relatórios financeiros" }).waitFor();
  assert.deepEqual(await invoke("get_balances"), before);
  fs.writeFileSync(
    path.join(output, "analysis.json"),
    JSON.stringify({ economic, cash, screenshots }, null, 2),
  );
};
