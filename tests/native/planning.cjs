const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
module.exports = async ({ page, invoke, button, output }) => {
  const today = await page.evaluate(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  });
  const shift = (n) => {
    const d = new Date(`${today}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  };
  const accounts = await invoke("save_account", {
    input: {
      id: null,
      name: "Planejamento isolado",
      kind: "checking",
      initialBalance: 100000,
    },
  });
  const accountId = accounts.find((a) => a.name === "Planejamento isolado").id;
  const recurrences = await invoke("save_recurrence", {
    input: {
      id: null,
      description: "Sazonal nativa",
      kind: "expense",
      amount: 1234,
      accountId,
      frequency: "monthly",
      interval: 1,
      startDate: shift(1),
      planningClass: "seasonal",
    },
  });
  const recurrence = recurrences.find(
    (r) => r.description === "Sazonal nativa",
  );
  await invoke("save_transaction", {
    input: {
      id: null,
      description: "Vencida planejamento nativo",
      kind: "expense",
      amount: 777,
      date: shift(-1),
      accountId,
      status: "pending",
    },
  });
  const transaction = (await invoke("list_transactions")).find(
    (t) => t.description === "Vencida planejamento nativo",
  );
  const categories = await invoke("save_category", {
    input: {
      id: null,
      name: "Planejamento nativo",
      kind: "expense",
      icon: "tag",
    },
  });
  const categoryId = categories.find(
    (c) => c.name === "Planejamento nativo",
  ).id;
  await invoke("save_transaction", {
    input: {
      id: null,
      description: "Consumo planejamento nativo",
      kind: "expense",
      amount: 901,
      date: today,
      accountId,
      status: "posted",
      categoryId,
    },
  });
  const settings = await invoke("get_settings");
  const base = new Date(`${today}T12:00:00Z`);
  if (base.getUTCDate() < settings.financialMonthStart)
    base.setUTCMonth(base.getUTCMonth() - 1);
  const month = base.toISOString().slice(0, 7);
  await invoke("save_budget", { month, categoryId, limitAmount: 1000 });
  const cards = await invoke("save_card", {
    input: {
      id: null,
      name: "Planejamento cartão nativo",
      institution: "Teste",
      creditLimit: 10000,
      closingDay: 31,
      dueDay: Number(today.slice(8)),
      defaultAccountId: accountId,
    },
  });
  const cardId = cards.find((c) => c.name === "Planejamento cartão nativo").id;
  const purchaseDate = new Date(`${today.slice(0, 7)}-01T12:00:00Z`);
  purchaseDate.setUTCMonth(purchaseDate.getUTCMonth() - 1);
  await invoke("save_purchase", {
    input: {
      id: null,
      cardId,
      description: "Parcelas planejamento nativo",
      date: purchaseDate.toISOString().slice(0, 10),
      amount: 12001,
      installmentCount: 3,
    },
  });
  const invoices = await invoke("query_invoices", { cardId, today, page: 0 });
  const invoice = invoices.items.find((i) => i.dueDate === today);
  assert.ok(invoice, "Calendar must preserve due date today");
  await invoke("save_invoice_event", {
    input: {
      id: null,
      requestKey: "native-planning-partial",
      invoiceId: invoice.id,
      kind: "payment",
      accountId,
      amount: 100,
      date: today,
      description: "Parcial nativa",
    },
  });
  const before = await invoke("get_balances");
  const all = async (command, args) => {
    let items = [],
      r;
    for (let page = 0; page < 100; page++) {
      r = await invoke(command, { ...args, page });
      items.push(...r.items);
      if (items.length >= r.total) return items;
    }
    throw new Error("Unexpected pagination size in small synthetic fixture");
  };
  const week = await all("query_commitments", { today, horizon: "week" });
  assert.ok(
    week.some(
      (c) =>
        c.kind === "recurrence" &&
        c.id === recurrence.id &&
        c.planningClass === "seasonal",
    ),
  );
  assert.ok(
    week.some(
      (c) =>
        c.kind === "invoice" &&
        c.id === invoice.id &&
        c.amount === "3901" &&
        c.partial &&
        c.installments === 1,
    ),
  );
  assert.ok(
    !week.some((c) => c.id === transaction.id && c.kind === "transaction"),
  );
  for (const horizon of [
    "all",
    "overdue",
    "month",
    "next_month",
    "next_invoice",
  ]) {
    const r = await invoke("query_commitments", { today, horizon, page: 0 });
    assert.ok(r.items.length <= 5);
    if (horizon === "next_invoice")
      assert.ok(r.items.every((c) => c.kind === "invoice"));
  }
  const alerts = await all("query_financial_alerts", {
    today,
    comparisonMonth: null,
  });
  assert.ok(
    alerts.some(
      (a) =>
        a.origin.kind === "invoice" &&
        a.origin.id === invoice.id &&
        a.title.includes("parcial"),
    ),
  );
  assert.ok(
    alerts.some(
      (a) =>
        a.origin.kind === "budget" &&
        a.origin.id === categoryId &&
        a.amount === "901",
    ),
  );
  assert.deepEqual(
    await invoke("get_balances"),
    before,
    "Planning reads cannot mutate balances",
  );
  const rowCount = (await invoke("list_transactions")).length;
  await page.reload();
  const commitments = page.getByRole("region", {
    name: "Vencimentos e recorrências",
  });
  const alertsRegion = page.getByRole("region", {
    name: "Alertas financeiros",
  });
  async function findOrigin(region, name, next) {
    // Let the filter click commit and its effect replace the previous page.
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const target = region.getByRole("button", { name, exact: true });
    for (let n = 0; n < 30; n++) {
      await region
        .getByRole("status")
        .filter({ hasText: /página|Nenhum/ })
        .first()
        .waitFor();
      if (await target.count()) {
        await target.click();
        return;
      }
      const more = region.getByRole("button", { name: next, exact: true });
      assert.equal(await more.isDisabled(), false, `Origin absent: ${name}`);
      const previousPage = await region.getByRole("status").filter({hasText:/página/}).first().textContent();
      await more.click();
      await region
        .getByRole("status").filter({hasText:/página/}).filter({hasNotText:previousPage})
        .first().waitFor();
    }
    throw new Error(`Origin not found: ${name}`);
  }
  await commitments
    .getByRole("button", { name: "Próximos 7 dias", exact: true })
    .click();
  await findOrigin(
    commitments,
    "Abrir origem de Sazonal nativa",
    "Mais compromissos",
  );
  const recDialog = page.getByRole("dialog", { name: "Editar recorrência" });
  assert.equal(
    await recDialog.getByLabel("Classificação de planejamento").inputValue(),
    "seasonal",
  );
  await recDialog
    .getByLabel("Classificação de planejamento")
    .selectOption("fixed");
  await recDialog
    .getByRole("button", { name: "Salvar recorrência", exact: true })
    .click();
  await recDialog.waitFor({ state: "hidden" });
  assert.equal(
    (await invoke("list_recurrences")).find((r) => r.id === recurrence.id)
      .planningClass,
    "fixed",
  );
  await button("Início").click();
  await commitments
    .getByRole("button", { name: "Vencidos", exact: true })
    .click();
  await findOrigin(
    commitments,
    "Abrir origem de Vencida planejamento nativo",
    "Mais compromissos",
  );
  const detail = page.getByRole("dialog");
  await detail
    .getByRole("heading", { name: "Vencida planejamento nativo" })
    .waitFor();
  await detail.getByRole("button", { name: "Fechar", exact: true }).click();
  await button("Início").click();
  await commitments
    .getByRole("button", { name: "Próximas faturas", exact: true })
    .click();
  await findOrigin(
    commitments,
    "Abrir origem de Fatura Planejamento cartão nativo",
    "Mais compromissos",
  );
  const invoiceDialog = page.getByRole("dialog", {
    name: "Detalhes da fatura",
  });
  await invoiceDialog
    .getByText(/3\.901|39,01/)
    .first()
    .waitFor();
  await invoiceDialog
    .getByRole("button", { name: "Fechar", exact: true })
    .click();
  await button("Início").click();
  await findOrigin(
    alertsRegion,
    "Abrir origem de Orçamento próximo do limite",
    "Mais alertas",
  );
  const budgetDialog = page.getByRole("dialog", { name: "Editar limite" });
  await budgetDialog.waitFor();
  await budgetDialog
    .getByRole("button", { name: "Fechar", exact: true })
    .click();
  await button("Início").click();
  await page
    .getByLabel("Mês financeiro de comparação (opcional)")
    .fill("2000-01");
  await findOrigin(
    alertsRegion,
    "Abrir origem de Consumo acima do mês comparado",
    "Mais alertas",
  );
  const comparison = page.getByRole("dialog", {
    name: "Origem do alerta — comparação de consumo",
  });
  await comparison.getByText("Diferença", { exact: true }).waitFor();
  await comparison.getByRole("button", { name: "Fechar", exact: true }).click();
  assert.deepEqual(await invoke("get_balances"), before);
  assert.equal((await invoke("list_transactions")).length, rowCount);
  await page.evaluate(
    fs.readFileSync(require.resolve("axe-core/axe.min.js"), "utf8"),
  );
  assert.deepEqual(
    await page.evaluate(
      async () =>
        (
          await axe.run(document, {
            runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa"] },
          })
        ).violations,
    ),
    [],
  );
  await page.screenshot({ path: path.join(output, "planning-alerts.png") });
  const saved = (await invoke("list_recurrences")).find(
    (r) => r.id === recurrence.id,
  );
  fs.writeFileSync(
    path.join(output, "planning.json"),
    JSON.stringify({ today, week, alerts, saved }, null, 2),
  );
  return saved;
};
