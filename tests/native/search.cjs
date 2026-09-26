const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
module.exports=async({page,invoke,button,output})=>{
 const samples=[
  ['transaction',(await invoke('list_transactions')).find(r=>r.description==='Despesa real').id],
  ['account',1],['category',1],['card',(await invoke('list_cards'))[0].id],
  ['merchant',(await invoke('query_metadata',{kind:'merchant',search:'',archived:true}))[0].id],
 ];
 const labels={transaction:'Transação',account:'Conta',category:'Categoria',card:'Cartão',merchant:'Estabelecimento'};
 for(const [kind,id] of samples){
  const record=await invoke('get_search_record',{kind,id});
  await page.keyboard.press('Control+k');
  const palette=page.getByRole('dialog',{name:'Busca e navegação'});
  await palette.getByRole('searchbox').fill(record.title);
  const hit=palette.getByRole('button',{name:new RegExp(`${labels[kind]}: ${record.title}`)});
  await hit.waitFor();
  await hit.focus();
  await hit.press('Enter');
  const detail=page.getByRole('dialog',{name:`${labels[kind]} — registro ${id}`});
  await detail.getByRole('heading',{name:record.title,exact:true}).waitFor();
  assert.equal((await invoke('get_search_record',{kind,id})).title,record.title);
  await detail.getByRole('button',{name:'Fechar',exact:true}).click();
 }
 fs.writeFileSync(path.join(output,'search-result.json'),JSON.stringify({status:'passed',domains:samples.map(([kind])=>kind)}));
};
