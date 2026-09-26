// Synthetic-only extension of the existing 50,000 transaction fixture.
// The caller owns an isolated database and an open transaction with FKs enabled.
module.exports = (db) => {
  const card = db.prepare("INSERT INTO credit_cards(id,name,institution,credit_limit,closing_day,due_day) VALUES(?,?,'Banco sintético',1000000,20,28)");
  const invoice = db.prepare("INSERT INTO card_invoices(id,card_id,month,closing_day,due_day,closing_date,due_date) VALUES(?,?,?,20,28,?,?)");
  const merchant = db.prepare("INSERT INTO financial_metadata(kind,name,name_key) VALUES('merchant',?,?)");
  const purchase = db.prepare("INSERT INTO card_purchases(id,card_id,description,date,amount,installment_count,category_id,merchant_id,channel,notes) VALUES(?,?,?,?,1001,3,?,?,'online',?)");
  const installment = db.prepare("INSERT INTO card_installments(purchase_id,invoice_id,number,amount) VALUES(?,?,?,?)");
  const event = db.prepare("INSERT INTO invoice_events(request_key,invoice_id,kind,account_id,purchase_id,amount,date,description) VALUES(?,?,?,?,?,?,?,'Evento sintético de volume')");
  const category = db.prepare("SELECT id FROM categories WHERE type='expense' ORDER BY id LIMIT 1").get().id;
  const merchants = [];
  const month = index => `${2024 + Math.floor(index / 12)}-${String(index % 12 + 1).padStart(2,"0")}`;
  const invoiceId = (card,index) => (card - 1) * 38 + index + 1;
  for(let id=1;id<=100;id++) {
    card.run(id,`Cartão volume ${id}`);
    merchants.push(Number(merchant.run(`Loja volume ${id}`,`loja volume ${id}`).lastInsertRowid));
    for(let index=0;index<38;index++) invoice.run(invoiceId(id,index),id,month(index),`${month(index)}-20`,`${month(index)}-28`);
  }
  for(let i=0;i<5000;i++) {
    const id=i+1, cardId=i%100+1, index=Math.floor(i/100)%36;
    purchase.run(id,cardId,`Compra de volume ${id}`,`${month(index)}-15`,category,merchants[cardId-1],"Dados sintéticos. ".repeat(10));
    for(let part=0;part<3;part++) installment.run(id,invoiceId(cardId,index+part),part+1,part<2?334:333);
  }
  for(let cardId=1;cardId<=100;cardId++) {
    for(let index=0;index<5;index++) event.run(`volume-payment-${cardId}-${index}`,invoiceId(cardId,index),"payment",cardId,null,100,`${month(index)}-25`);
    event.run(`volume-refund-${cardId}`,invoiceId(cardId,0),"refund",null,cardId,50,"2024-01-16");
    event.run(`volume-charge-${cardId}`,invoiceId(cardId,1),"charge",null,null,30,"2024-02-21");
    event.run(`volume-credit-${cardId}`,invoiceId(cardId,1),"credit",null,null,10,"2024-02-22");
  }
  return Object.fromEntries(["transactions","accounts","credit_cards","card_purchases","card_installments","card_invoices","invoice_events"].map(table=>[table,db.prepare(`SELECT count(*) AS n FROM ${table}`).get().n]));
};
