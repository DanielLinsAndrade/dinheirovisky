const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
module.exports = async ({page,button,invoke,fileDialog,output}) => {
  for(const theme of ["light","dark","system"]) {
    await require("./theme.cjs")(page,theme);
    for(const name of ["Início","Cartões","Relatórios","Transações"]) {
      await button(name).click();
      await page.waitForFunction(() => !Array.from(document.querySelectorAll('[role="status"]')).some(el => /Carregando|Calculando|Avaliando|Consultando/.test(el.textContent || "")));
      assert.equal(await page.getByRole("alert").count(),0,`Loaded ${name} without error`);
      await page.evaluate(fs.readFileSync(require.resolve("axe-core/axe.min.js"),"utf8"));
      assert.deepEqual(await page.evaluate(async()=> (await axe.run(document,{runOnly:{type:"tag",values:["wcag2a","wcag2aa","wcag21aa"]}})).violations),[]);
      if(name === "Relatórios") {
        const region=page.getByRole("region",{name:"Rolagem dos totais mensais",exact:true});
        await region.focus();
        assert.equal(await region.evaluate(el=>document.activeElement===el),true);
        await page.keyboard.press("ArrowRight");
        await page.waitForFunction(()=>{const el=document.querySelector('[aria-label="Rolagem dos totais mensais"]'); return el.scrollLeft>0 || el.scrollWidth<=el.clientWidth;});
      }
    }
  }
  await button("Início").click();
  await page.getByRole("heading",{name:"Principais despesas",exact:true}).waitFor();
  await page.getByText("Carregando dashboard…",{exact:true}).waitFor({state:"hidden"});
  await page.getByText("Consultando alertas…",{exact:true}).waitFor({state:"hidden"});
  await page.getByText("Verificando vencimentos…",{exact:true}).waitFor({state:"hidden"});
  await page.setViewportSize({width:600,height:900});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await page.screenshot({path:path.join(output,"volume-dashboard-narrow.png"),fullPage:true});
  await page.setViewportSize({width:1440,height:1000});
  // The volume fixture must satisfy all restore-domain checks, not only SQLite FKs.
  await button("Backup e restauração").click();
  const backup=path.join(output,"volume.dvbackup");
  await button("Salvar backup").click(); await fileDialog(backup);
  await page.getByText(/Backup salvo em/).waitFor({timeout:60000});
  await button("Selecionar backup para restaurar").click(); await fileDialog(backup);
  await page.getByRole("dialog").waitFor({timeout:60000});
  assert.equal(await button("Restaurar e substituir dados").isDisabled(),true);
  await button("Fechar").click();
  const balance=await invoke("get_balances");
  assert.equal(balance.reduce((sum,a)=>sum+BigInt(a.cents),0n),975000n);
};
