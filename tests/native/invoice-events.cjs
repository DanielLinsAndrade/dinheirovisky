const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
module.exports = async ({ page, invoke, button, output }) => {
  const before = await invoke("get_balances");
  const consumption = await invoke("get_dashboard", { month: "2024-03" });
  const cards = await invoke("save_card", {
    input: {
      id: null,
      name: "Z teste pagamentos",
      institution: "Banco",
      lastFour: null,
      brand: null,
      creditLimit: 50000,
      closingDay: 31,
      dueDay: 10,
      defaultAccountId: 1,
    },
  });
  const card = cards.find((c) => c.name === "Z teste pagamentos");
  await invoke("save_purchase", {
    input: {
      id: null,
      cardId: card.id,
      description: "Compra para estorno",
      date: "2024-02-29",
      amount: 10000,
      installmentCount: 1,
      categoryId: null,
      merchant: null,
      intermediary: null,
      channel: null,
      notes: null,
    },
  });
  const i = (
    await invoke("query_invoices", {
      cardId: card.id,
      today: "2024-03-01",
      page: 0,
    })
  ).items[0].id;
  await button("Início").click();
  await button("Cartões").click();
  await button("Compras e faturas de Z teste pagamentos").click();
  await button("Ver fatura 2024-02").click();
  const dialog = page.getByRole("dialog");
  async function form(kind, amount) {
    await button("Registrar pagamento ou ajuste").click();
    await dialog
      .getByLabel("Tipo de evento", { exact: true })
      .selectOption(kind);
    await dialog
      .getByLabel("Valor do evento (R$)", { exact: true })
      .fill(amount);
    await dialog
      .getByLabel("Data do evento", { exact: true })
      .fill("2024-03-01");
  }
  async function save() {
    await button("Salvar evento").click();
    await button("Registrar pagamento ou ajuste").waitFor();
  }
  async function axe() {
    await dialog.evaluate(async (el) => {
      await Promise.all(
        el.getAnimations({ subtree: true }).map((a) => a.finished),
      );
    });
    await page.evaluate(
      fs.readFileSync(require.resolve("axe-core/axe.min.js"), "utf8"),
    );
    assert.deepEqual(
      await page.evaluate(
        async () =>
          (
            await axe.run(document.querySelector("dialog[open]"), {
              runOnly: {
                type: "tag",
                values: ["wcag2a", "wcag2aa", "wcag21aa"],
              },
            })
          ).violations,
      ),
      [],
    );
  }
  await form("payment", "40,00");
  await axe();
  await page.screenshot({
    path: path.join(output, "invoice-payment-form.png"),
  });
  await save();
  let d = await invoke("invoice_detail", { id: i, today: "2024-03-01" });
  assert.equal(d.invoice.state, "partial");
  assert.equal(d.invoice.remaining, "6000");
  assert.equal(
    (await invoke("get_balances"))[0].cents,
    (BigInt(before[0].cents) - 4000n).toString(),
  );
  await button(`Editar evento ${d.events[0].id}`).click();
  await dialog
    .getByLabel("Valor do evento (R$)", { exact: true })
    .fill("30,00");
  await save();
  assert.equal(
    (await invoke("invoice_detail", { id: i, today: "2024-03-01" })).invoice
      .remaining,
    "7000",
  );
  await form("payment", "70,00");
  await save();
  d = await invoke("invoice_detail", { id: i, today: "2024-03-01" });
  assert.equal(d.invoice.state, "paid");
  assert.equal(d.invoice.remaining, "0");
  assert.equal(
    (await invoke("get_dashboard", { month: "2024-03" })).current.expense,
    consumption.current.expense,
  );
  await form("refund", "20,00");
  await axe();
  await save();
  d = await invoke("invoice_detail", { id: i, today: "2024-03-01" });
  assert.equal(d.invoice.creditBalance, "2000");
  assert.equal(
    (await invoke("get_dashboard", { month: "2024-03" })).current.expense,
    (BigInt(consumption.current.expense) - 2000n).toString(),
  );
  await page.screenshot({
    path: path.join(output, "invoice-refund-credit.png"),
  });
  for (const e of d.events.filter((e) => e.kind === "payment")) {
    await button(`Desfazer evento ${e.id}`).click();
    assert.equal(
      (
        await invoke("invoice_detail", { id: i, today: "2024-03-01" })
      ).events.find((x) => x.id === e.id).voided,
      false,
    );
    await button("Confirmar desfazer evento").click();
    await button("Registrar pagamento ou ajuste").waitFor();
    await page.waitForFunction(
      () => !document.body.innerText.includes("Confirmar desfazer evento"),
    );
  }
  assert.deepEqual(await invoke("get_balances"), before);
  d = await invoke("invoice_detail", { id: i, today: "2024-03-01" });
  assert.equal(d.invoice.remaining, "8000");
  await button("Fechar").click();
  await button("Voltar aos cartões").click();
  await invoke("set_card_active", { id: card.id, active: false });
  const saved = { id: i, detail: d };
  fs.writeFileSync(
    path.join(output, "invoice-events-result.json"),
    JSON.stringify({ status: "passed", ...saved, axeChecks: 2 }, null, 2),
  );
  return saved;
};
