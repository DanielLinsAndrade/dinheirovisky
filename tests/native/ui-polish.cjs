const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

module.exports = async ({ page, button, invoke, output }) => {
  const evidence = { layouts: [], nativeThemes: [], navigationMs: [], scrollbars: [], utilization: [] };
  const ready = () => page.waitForFunction(() => !Array.from(document.querySelectorAll('[role="status"]')).some(el => /Carregando|Calculando|Consultando|Verificando/.test(el.textContent || "")));
  await page.locator('.skip-link').focus();
  const focusBounds=await page.locator('.skip-link').boundingBox();
  assert.ok(focusBounds.y>=36,'Skip link must not be covered by the titlebar');
  for (const theme of ["light", "dark", "system"]) {
    await require("./theme.cjs")(page, theme);
    const actual = await invoke("plugin:window|theme", { label: "main" });
    if (theme !== "system") assert.equal(actual, theme);
    evidence.nativeThemes.push({ selected: theme, native: actual });
    const scrollbar = await page.evaluate(() => {
      const root = document.documentElement;
      const thumb = getComputedStyle(root, '::-webkit-scrollbar-thumb');
      return { supported: CSS.supports('selector(::-webkit-scrollbar)'), width: getComputedStyle(root, '::-webkit-scrollbar').width, radius: thumb.borderRadius, color: thumb.backgroundColor, titlebar: getComputedStyle(document.querySelector('.window-titlebar')).backgroundColor };
    });
    assert.equal(scrollbar.supported,true);
    assert.equal(scrollbar.width,'12px');
    assert.equal(scrollbar.radius,'18px');
    evidence.scrollbars.push({theme,...scrollbar});
    for (const width of [1536, 1100, 800, 600]) {
      await page.setViewportSize({ width, height: 900 });
      for (const name of ["Início", "Transações", "Contas", "Cartões", "Categorias", "Orçamento", "Recorrências", "Metas", "Relatórios", "Importar", "Backup e restauração", "Configurações", "Sobre"]) {
        const start = Date.now();
        await button(name).click();
        await ready();
        evidence.navigationMs.push({ theme, width, name, ms: Date.now() - start });
        if (name === "Transações") await page.getByText("Filtros de pagamento e compra", { exact: true }).click();
        const layout = await page.evaluate(() => {
          const main = document.querySelector("main");
          const clipped = Array.from(main.querySelectorAll("button, input, select")).filter(el => {
            if (el.closest(".table-scroll") || !el.getClientRects().length) return false;
            const r = el.getBoundingClientRect();
            return r.right > innerWidth + 1 || r.left < -1;
          }).map(el => el.getAttribute("aria-label") || el.textContent?.trim() || el.id);
          return { width: innerWidth, scrollWidth: document.documentElement.scrollWidth, clipped };
        });
        assert.ok(layout.scrollWidth <= width, `${theme}/${width}/${name}: page overflow`);
        assert.deepEqual(layout.clipped, [], `${theme}/${width}/${name}: clipped controls`);
        evidence.layouts.push({ theme, width, name, ...layout });
        if (name === "Orçamento" && width >= 1100) {
          const blocks = await page.locator('.budget-utilization').evaluateAll(items=>items.map(el=>{
            const box=el.getBoundingClientRect(), track=el.querySelector('.chart-track').getBoundingClientRect();
            const percentage=el.querySelector('.budget-percentage').getBoundingClientRect(), badge=el.querySelector('.ui-badge').getBoundingClientRect();
            return {width:box.width,trackWidth:track.width,aligned:Math.abs(percentage.y+percentage.height/2-badge.y-badge.height/2)<1,gap:track.y-Math.max(percentage.bottom,badge.bottom)};
          }));
          assert.ok(blocks.length>0);
          for(const block of blocks){assert.equal(block.width,220);assert.equal(block.trackWidth,220);assert.ok(block.aligned);assert.equal(block.gap,8);}
          evidence.utilization.push({theme,width,blocks});
          const month = await page.getByLabel("Mês do orçamento", { exact: true }).boundingBox();
          const action = await button("Definir limite").boundingBox();
          assert.ok(Math.abs(month.y + month.height - action.y - action.height) <= 1, "Budget month and actions share the same baseline");
        }
        if (name === "Cartões" && width === 600) {
          const table = page.getByRole("region", { name: "Rolagem dos cartões cadastrados", exact: true });
          await table.focus();
          await page.keyboard.press("ArrowRight");
          await page.waitForFunction(() => document.querySelector('[aria-label="Rolagem dos cartões cadastrados"]').scrollLeft > 0);
        }
        if (width === 1100 || width === 600) {
          await page.locator("h1").focus();
          await page.screenshot({ path: path.join(output, `polish-${theme}-${width}-${name}.png`), fullPage: true });
        }
        if (name === "Relatórios") {
          await button("Consumo, caixa e parcelas").click();
          await ready();
          assert.ok(await page.locator(".report-filters").evaluate(el => el.scrollWidth <= el.clientWidth + 1));
          if (width === 600 || width === 1100) await page.screenshot({ path: path.join(output, `polish-${theme}-${width}-analysis.png`), fullPage: true });
        }
      }
    }
  }
  await page.setViewportSize({ width: 1100, height: 760 });
  await button("Início").click();
  await ready();
  await page.evaluate(() => scrollTo(0, 0));
  await page.mouse.move(900, 300);
  await page.mouse.wheel(300, 450);
  await page.waitForFunction(() => scrollY > 0);
  assert.equal(await page.evaluate(() => scrollX), 0, "Diagonal gesture must not pan the page horizontally");
  await page.evaluate(() => scrollTo(0, 0));
  const opener = page.getByRole("button", { name: /Ir para…/ });
  await opener.click();
  const dialog = page.getByRole("dialog", { name: "Busca e navegação" });
  await dialog.waitFor();
  assert.equal(await dialog.getByRole("searchbox").evaluate(el => el === document.activeElement), true);
  await dialog.locator("p.field-help").click();
  assert.equal(await dialog.isVisible(), true, "Inside click preserves search");
  const box = await dialog.boundingBox();
  await page.mouse.click(box.x - 12, box.y + 30);
  await dialog.waitFor({ state: "hidden" });
  assert.equal(await opener.evaluate(el => el === document.activeElement), true, "Outside click restores focus");
  await opener.click();
  await page.keyboard.press("Escape");
  await dialog.waitFor({ state: "hidden" });
  evidence.styledPicker = await page.evaluate(() => CSS.supports("appearance", "base-select"));
  await page.getByLabel("Aparência", { exact: true }).click();
  await page.screenshot({ path: path.join(output, "polish-theme-picker.png") });
  await page.keyboard.press("Escape");
  evidence.status = "passed";
  fs.writeFileSync(path.join(output, "ui-polish.json"), JSON.stringify(evidence, null, 2));
};
