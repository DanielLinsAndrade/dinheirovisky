const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
module.exports = async function metadataChecks({
  page,
  invoke,
  button,
  output,
}) {
  const balances = await invoke("get_balances");
  const txs = await invoke("list_transactions");
  const target = txs.find((m) => m.description === "Despesa real");
  assert.ok(target);
  await button("Transações").click();
  await page
    .getByRole("button", { name: "Editar Despesa real", exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  await dialog.getByText("Mais detalhes", { exact: true }).click();
  await dialog
    .getByLabel("Método de pagamento", { exact: true })
    .selectOption("2");
  await dialog
    .getByLabel("Estabelecimento", { exact: true })
    .fill("Mercado do bairro");
  await dialog
    .getByLabel("Intermediário / plataforma", { exact: true })
    .fill("Entrega local");
  await dialog.getByLabel("Modalidade", { exact: true }).selectOption("online");
  await page.screenshot({
    path: path.join(output, "metadata-details.png"),
    fullPage: true,
  });
  await page.evaluate(
    fs.readFileSync(require.resolve("axe-core/axe.min.js"), "utf8"),
  );
  const axe = await page.evaluate(() =>
    window.axe.run(document.querySelector("dialog[open]"), {
      runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa"] },
    }),
  );
  assert.deepEqual(axe.violations, []);
  await button("Salvar transação").click();
  await dialog.waitFor({ state: "hidden" });
  let saved = (await invoke("list_transactions")).find(
    (m) => m.id === target.id,
  );
  assert.equal(saved.details.merchant, "Mercado do bairro");
  assert.equal(saved.details.methodName, "PIX");
  const lookup = (kind) =>
    invoke("query_metadata", { kind, search: "", archived: true });
  const merchant = (await lookup("merchant"))[0],
    intermediary = (await lookup("intermediary"))[0];
  await invoke("save_transaction", {
    input: {
      ...saved,
      details: { ...saved.details, merchant: "  MERCADO   DO BAIRRO " },
    },
  });
  assert.equal((await lookup("merchant")).length, 1);
  await page
    .getByText("Filtros de pagamento e compra", { exact: true })
    .click();
  await page
    .getByLabel("Estabelecimento", { exact: true })
    .selectOption(String(merchant.id));
  await page
    .getByLabel("Método de pagamento", { exact: true })
    .selectOption("2");
  await page
    .getByLabel("Intermediário", { exact: true })
    .selectOption(String(intermediary.id));
  await page.getByLabel("Modalidade", { exact: true }).selectOption("online");
  await page
    .getByRole("button", { name: "Editar Despesa real", exact: true })
    .waitFor();
  assert.equal(
    (
      await invoke("query_transactions", {
        query: {
          merchantId: merchant.id,
          methodId: 2,
          intermediaryId: intermediary.id,
          channel: "online",
        },
      })
    ).total,
    1,
  );
  await page.getByText("1 transações · página 1", { exact: true }).waitFor();
  await page.screenshot({
    path: path.join(output, "metadata-filters.png"),
    fullPage: true,
  });
  await button("Gerenciar métodos e estabelecimentos").click();
  await dialog.getByLabel("Cadastro", { exact: true }).selectOption("merchant");
  await button("Editar Mercado do bairro").click();
  await dialog
    .getByLabel("Nome do cadastro", { exact: true })
    .fill("Mercado habitual");
  await button("Salvar cadastro").click();
  await page.getByText("Cadastro salvo.", { exact: true }).waitFor();
  await button("Arquivar Mercado habitual").click();
  await page
    .getByText("Mercado habitual · Arquivado", { exact: true })
    .waitFor();
  await page.screenshot({
    path: path.join(output, "metadata-management.png"),
    fullPage: true,
  });
  const managerAxe = await page.evaluate(() =>
    window.axe.run(document.querySelector("dialog[open]"), {
      runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa"] },
    }),
  );
  assert.deepEqual(managerAxe.violations, []);
  await button("Fechar").click();
  await dialog.waitFor({ state: "hidden" });
  saved = (await invoke("list_transactions")).find((m) => m.id === target.id);
  assert.equal(saved.details.merchant, "Mercado habitual");
  await invoke("save_transaction", { input: saved });
  await assert.rejects(() =>
    invoke("save_transaction", { input: { ...saved, id: null } }),
  );
  assert.equal((await invoke("list_transactions")).length, txs.length);
  assert.deepEqual(await invoke("get_balances"), balances);
  const clear = {
    ...saved,
    details: {
      methodId: null,
      merchant: null,
      channel: null,
      intermediary: null,
    },
  };
  await invoke("save_transaction", { input: clear });
  assert.equal(
    (await invoke("list_transactions")).find((m) => m.id === target.id).details
      .merchant,
    null,
  );
  await invoke("save_metadata", {
    input: { ...merchant, name: "Mercado habitual", active: true },
  });
  await invoke("save_transaction", { input: saved });
  await invoke("save_metadata", {
    input: { ...merchant, name: "Mercado habitual", active: false },
  });
  fs.writeFileSync(
    path.join(output, "metadata-result.json"),
    JSON.stringify(
      {
        status: "passed",
        transactionId: target.id,
        details: saved.details,
        balances,
        axe: [axe.violations, managerAxe.violations],
      },
      null,
      2,
    ),
  );
  return saved;
};
