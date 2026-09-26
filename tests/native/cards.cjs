const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
module.exports = async ({ page, invoke, button, output }) => {
  const balances = await invoke("get_balances"),
    movements = await invoke("list_transactions");
  await button("Cartões").click();
  await button("Novo cartão").click();
  const dialog = page.getByRole("dialog");
  await dialog
    .getByLabel("Nome do cartão", { exact: true })
    .fill("Cartão diário");
  await dialog
    .getByLabel("Instituição", { exact: true })
    .fill("Instituição teste");
  await dialog.getByLabel("Final (opcional)", { exact: true }).fill("0123");
  await dialog.getByLabel("Limite (R$)", { exact: true }).fill("5000,01");
  await dialog.getByLabel("Dia de fechamento", { exact: true }).fill("31");
  await dialog.getByLabel("Dia de vencimento", { exact: true }).fill("10");
  await dialog
    .getByLabel("Conta padrão de pagamento (opcional)", { exact: true })
    .selectOption("1");
  await page.evaluate(
    fs.readFileSync(require.resolve("axe-core/axe.min.js"), "utf8"),
  );
  let violations;
  await dialog.evaluate(async (el) => {
    await Promise.all(
      el.getAnimations({ subtree: true }).map((a) => a.finished),
    );
  });
  violations = await page.evaluate(
    async () =>
      (
        await axe.run(document.querySelector("dialog[open]"), {
          runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa"] },
        })
      ).violations,
  );
  assert.deepEqual(violations, []);
  await button("Salvar cartão").click();
  await dialog.waitFor({ state: "hidden" });
  let card = (await invoke("list_cards"))[0];
  assert.equal(card.creditLimit, 500001);
  assert.equal(card.lastFour, "0123");
  await button("Editar Cartão diário").click();
  await dialog.getByLabel("Limite (R$)", { exact: true }).fill("6000,02");
  await button("Salvar cartão").click();
  await dialog.waitFor({ state: "hidden" });
  assert.equal((await invoke("list_cards"))[0].creditLimit, 600002);
  await button("Calendário de Cartão diário").click();
  await dialog.getByLabel("Mês inicial", { exact: true }).fill("2024-02");
  await dialog.getByRole("cell", { name: "29/02/2024", exact: true }).waitFor();
  await dialog.evaluate(async (el) => {
    await Promise.all(
      el.getAnimations({ subtree: true }).map((a) => a.finished),
    );
  });
  violations = await page.evaluate(
    async () =>
      (
        await axe.run(document.querySelector("dialog[open]"), {
          runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa"] },
        })
      ).violations,
  );
  assert.deepEqual(violations, []);
  await page.screenshot({
    path: path.join(output, "cards-calendar.png"),
    fullPage: true,
  });
  await button("Fechar").click();
  await button("Arquivar Cartão diário").click();
  await page
    .getByLabel("Exibir cartões", { exact: true })
    .selectOption("archived");
  await button("Reativar Cartão diário").waitFor();
  card = (await invoke("list_cards"))[0];
  assert.equal(card.active, false);
  await button("Reativar Cartão diário").click();
  await page
    .getByLabel("Exibir cartões", { exact: true })
    .selectOption("active");
  await button("Arquivar Cartão diário").waitFor();
  await page.screenshot({
    path: path.join(output, "cards-list.png"),
    fullPage: true,
  });
  await button("Excluir Cartão diário").click();
  assert.equal((await invoke("list_cards")).length, 1);
  await button("Fechar").click();
  const disposable = await invoke("save_card", {
    input: {
      id: null,
      name: "Descartável",
      institution: "Teste",
      lastFour: null,
      brand: null,
      creditLimit: 0,
      closingDay: 5,
      dueDay: 10,
      defaultAccountId: null,
    },
  });
  const other = disposable.find((c) => c.name === "Descartável");
  await invoke("delete_card", { id: other.id });
  await invoke("set_card_active", { id: card.id, active: false });
  card = (await invoke("list_cards"))[0];
  assert.deepEqual(await invoke("get_balances"), balances);
  assert.deepEqual(await invoke("list_transactions"), movements);
  fs.writeFileSync(
    path.join(output, "cards-result.json"),
    JSON.stringify({ status: "passed", card, balances, axeChecks: 2 }, null, 2),
  );
  return card;
};
