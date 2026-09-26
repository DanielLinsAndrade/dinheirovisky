const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
module.exports = async ({ page, invoke, button, output }) => {
  const balances = await invoke("get_balances");
  const before = await invoke("get_dashboard", { month: "2024-02" });
  const cards = await invoke("save_card", {
    input: {
      id: null,
      name: "Validação compras",
      institution: "Banco teste",
      lastFour: null,
      brand: null,
      creditLimit: 50000,
      closingDay: 31,
      dueDay: 10,
      defaultAccountId: null,
    },
  });
  const card = cards.find((c) => c.name === "Validação compras");
  await button("Início").click();
  await button("Cartões").click();
  await button("Compras e faturas de Validação compras").click();
  await button("Nova compra no cartão").click();
  const dialog = page.getByRole("dialog");
  await dialog
    .getByLabel("Descrição da compra", { exact: true })
    .fill("Notebook teste");
  await dialog.getByLabel("Data da compra", { exact: true }).fill("2024-02-29");
  await dialog
    .getByLabel("Total da compra (R$)", { exact: true })
    .fill("100,00");
  await dialog.getByLabel("Número de parcelas", { exact: true }).fill("3");
  async function axeDialog() {
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
  await axeDialog();
  await page.screenshot({ path: path.join(output, "purchase-form.png") });
  await button("Salvar compra").click();
  await dialog.waitFor({ state: "hidden" });
  let purchases = await invoke("query_purchases", { cardId: card.id, page: 0 });
  assert.equal(purchases.items[0].amount, 10000);
  assert.equal(
    (await invoke("get_dashboard", { month: "2024-02" })).current.expense,
    (BigInt(before.current.expense) + 10000n).toString(),
  );
  assert.deepEqual(await invoke("get_balances"), balances);
  const invoices = await invoke("query_invoices", {
    cardId: card.id,
    today: "2024-02-29",
    page: 0,
  });
  assert.equal(invoices.total, 3);
  assert.equal(invoices.committed, "10000");
  const feb = invoices.items.find((i) => i.month === "2024-02");
  assert.equal(feb.charges, "3334");
  assert.equal(feb.dueDate, "2024-03-10");
  await button("Ver fatura 2024-02").click();
  await dialog.getByRole("cell", { name: "1/3", exact: true }).waitFor();
  await axeDialog();
  await page.screenshot({ path: path.join(output, "purchase-invoice.png") });
  await button("Fechar").click();
  await button("Editar compra Notebook teste").click();
  await dialog
    .getByLabel("Total da compra (R$)", { exact: true })
    .fill("100,01");
  await button("Salvar compra").click();
  await dialog.waitFor({ state: "hidden" });
  assert.equal(
    (
      await invoke("query_invoices", {
        cardId: card.id,
        today: "2024-02-29",
        page: 0,
      })
    ).committed,
    "10001",
  );
  await button("Cancelar compra Notebook teste").click();
  assert.equal(
    (await invoke("query_purchases", { cardId: card.id, page: 0 })).items[0]
      .status,
    "active",
  );
  await button("Confirmar cancelamento da compra").click();
  await dialog.waitFor({ state: "hidden" });
  assert.equal(
    (await invoke("get_dashboard", { month: "2024-02" })).current.expense,
    before.current.expense,
  );
  assert.equal(
    (
      await invoke("query_invoices", {
        cardId: card.id,
        today: "2024-02-29",
        page: 0,
      })
    ).committed,
    "0",
  );
  await invoke("save_purchase", {
    input: {
      id: null,
      cardId: card.id,
      description: "Histórico para backup",
      date: "2024-02-29",
      amount: 10001,
      installmentCount: 3,
      categoryId: null,
      merchant: null,
      intermediary: null,
      channel: null,
      notes: null,
    },
  });
  purchases = await invoke("query_purchases", { cardId: card.id, page: 0 });
  await button("Atualizar faturas").click();
  await button("Editar compra Histórico para backup").waitFor();
  await page.screenshot({ path: path.join(output, "purchases-list.png") });
  await button("Voltar aos cartões").click();
  await invoke("set_card_active", { id: card.id, active: false });
  assert.deepEqual(await invoke("get_balances"), balances);
  fs.writeFileSync(
    path.join(output, "purchases-result.json"),
    JSON.stringify(
      { status: "passed", cardId: card.id, purchases, axeChecks: 2 },
      null,
      2,
    ),
  );
  return { cardId: card.id, purchases };
};
