const{neon}=require('@neondatabase/serverless');
const jwt=require('jsonwebtoken');
module.exports=async function handler(req,res){
  res.setHeader('Access-Control-Allow-Origin','*');
  if(req.method==='OPTIONS')return res.status(200).end();
  const auth=req.headers.authorization||'';
  if(!auth)return res.status(401).json({error:'Unauthorized'});
  let uid,cid;
  try{const p=jwt.verify(auth.replace('Bearer ',''),process.env.JWT_SECRET);uid=p.user_id;cid=p.company_id;}
  catch(e){return res.status(401).json({error:'Unauthorized'});}
  const sql=neon(process.env.DATABASE_URL);
  const act=req.query.action||'';
  const b=req.body||{};
  try{
  if(act==='init_parts_db'||act==='migrate_parts_db'){
    await sql`CREATE TABLE IF NOT EXISTS parts_inventory(id UUID PRIMARY KEY DEFAULT gen_random_uuid(),company_id INT,part_number TEXT DEFAULT '',description TEXT DEFAULT '',manufacturer TEXT DEFAULT '',category TEXT DEFAULT '',qty_on_hand INT DEFAULT 0,qty_minimum INT DEFAULT 1,min_quantity INT DEFAULT 1,unit_cost NUMERIC(10,2)DEFAULT 0,supplier TEXT DEFAULT '',location TEXT DEFAULT '',notes TEXT DEFAULT '',created_at TIMESTAMPTZ DEFAULT NOW(),updated_at TIMESTAMPTZ DEFAULT NOW())`;
    await sql`CREATE TABLE IF NOT EXISTS parts_invoices(id UUID PRIMARY KEY DEFAULT gen_random_uuid(),company_id INT,vendor TEXT DEFAULT '',invoice_number TEXT DEFAULT '',invoice_date DATE,total_amount NUMERIC(10,2)DEFAULT 0,notes TEXT DEFAULT '',items JSONB DEFAULT '[]',created_at TIMESTAMPTZ DEFAULT NOW(),updated_at TIMESTAMPTZ DEFAULT NOW())`;
    await sql`CREATE TABLE IF NOT EXISTS parts_cross_ref(id UUID PRIMARY KEY DEFAULT gen_random_uuid(),company_id INT,part_number_a TEXT DEFAULT '',manufacturer_a TEXT DEFAULT '',part_number_b TEXT DEFAULT '',manufacturer_b TEXT DEFAULT '',description TEXT DEFAULT '',price_a NUMERIC(10,2)DEFAULT 0,price_b NUMERIC(10,2)DEFAULT 0,notes TEXT DEFAULT '',created_at TIMESTAMPTZ DEFAULT NOW(),updated_at TIMESTAMPTZ DEFAULT NOW())`;
    await sql`CREATE TABLE IF NOT EXISTS parts_orders(id UUID PRIMARY KEY DEFAULT gen_random_uuid(),company_id INT,supplier TEXT DEFAULT '',part_number TEXT DEFAULT '',description TEXT DEFAULT '',qty_ordered INT DEFAULT 1,unit_cost NUMERIC(10,2)DEFAULT 0,total_cost NUMERIC(10,2)DEFAULT 0,status TEXT DEFAULT 'pending',tracking_number TEXT DEFAULT '',carrier TEXT DEFAULT '',task_id UUID,todo_item_id UUID,notes TEXT DEFAULT '',ordered_by UUID,order_date DATE DEFAULT CURRENT_DATE,received_at TIMESTAMPTZ,created_at TIMESTAMPTZ DEFAULT NOW(),updated_at TIMESTAMPTZ DEFAULT NOW())`;
    await sql`CREATE TABLE IF NOT EXISTS parts_manuals(id UUID PRIMARY KEY DEFAULT gen_random_uuid(),company_id INT,title TEXT DEFAULT '',manufacturer TEXT DEFAULT '',model TEXT DEFAULT '',file_url TEXT DEFAULT '',notes TEXT DEFAULT '',created_at TIMESTAMPTZ DEFAULT NOW(),updated_at TIMESTAMPTZ DEFAULT NOW())`;
    try{await sql`ALTER TABLE parts_inventory ADD COLUMN IF NOT EXISTS category TEXT DEFAULT ''`;}catch(e){}
    try{await sql`ALTER TABLE parts_inventory ADD COLUMN IF NOT EXISTS min_quantity INT DEFAULT 1`;}catch(e){}
    try{await sql`ALTER TABLE parts_orders ADD COLUMN IF NOT EXISTS carrier TEXT DEFAULT ''`;}catch(e){}
    try{await sql`ALTER TABLE parts_orders ADD COLUMN IF NOT EXISTS task_id UUID`;}catch(e){}
    try{await sql`ALTER TABLE parts_orders ADD COLUMN IF NOT EXISTS ordered_by UUID`;}catch(e){}
    try{await sql`ALTER TABLE parts_orders ADD COLUMN IF NOT EXISTS received_at TIMESTAMPTZ`;}catch(e){}
    return res.json({ok:true,message:'Parts DB ready'});
  }
  if(act==='debug_columns'){
    const cols=await sql`SELECT column_name FROM information_schema.columns WHERE table_name='parts_inventory' ORDER BY ordinal_position`;
    return res.json({inventory:cols.map(c=>c.column_name)});
  }
  if(act==='get_parts'){
    const rows=await sql`SELECT id,part_number,description,manufacturer,supplier,category,qty_on_hand as quantity,COALESCE(qty_minimum,min_quantity,1) as min_quantity,unit_cost,location,notes,created_at,updated_at FROM parts_inventory WHERE company_id=${cid} ORDER BY part_number`;
    return res.json(rows);
  }
  if(act==='get_invoices'){const rows=await sql`SELECT * FROM parts_invoices WHERE company_id=${cid} ORDER BY created_at DESC`;return res.json(rows);}
  if(act==='get_cross_ref'){const rows=await sql`SELECT * FROM parts_cross_ref WHERE company_id=${cid} ORDER BY part_number_a`;return res.json(rows);}
  if(act==='get_parts_orders'){
    const rows=await sql`SELECT id,supplier as vendor,part_number,description,qty_ordered as quantity,unit_cost,total_cost,status,tracking_number,carrier,task_id,todo_item_id,notes,order_date,received_at,created_at FROM parts_orders WHERE company_id=${cid} ORDER BY created_at DESC`;
    return res.json(rows);
  }
  if(act==='get_manuals'){const rows=await sql`SELECT * FROM parts_manuals WHERE company_id=${cid} ORDER BY title`;return res.json(rows);}
  if(act==='get_low_stock'){
    const rows=await sql`SELECT id,part_number,description,manufacturer,qty_on_hand as quantity,COALESCE(qty_minimum,min_quantity,1) as min_quantity,location FROM parts_inventory WHERE company_id=${cid} AND qty_on_hand<=COALESCE(qty_minimum,min_quantity,1) ORDER BY qty_on_hand ASC`;
    return res.json(rows);
  }
  if(act==='get_parts_todo_alerts'){
    const w=await sql`SELECT id,title FROM tasks WHERE status='waiting_parts' AND company_id=${cid} ORDER BY created_at DESC`;
    const l=await sql`SELECT id,part_number,description,qty_on_hand as quantity,COALESCE(qty_minimum,min_quantity,1) as min_quantity FROM parts_inventory WHERE company_id=${cid} AND qty_on_hand<=COALESCE(qty_minimum,min_quantity,1) ORDER BY qty_on_hand ASC`;
    return res.json({waiting_parts:w,low_stock:l});
  }
  if(act==='save_part'){
    const p=b;let rows;
    const pn=p.part_number||'',de=p.description||'',mf=p.manufacturer||p.supplier||'',ca=p.category||'',qt=parseInt(p.quantity||p.qty_on_hand)||0,mq=parseInt(p.min_quantity||p.qty_minimum)||1,co=parseFloat(p.unit_cost)||0,lo=p.location||'',no=p.notes||'';
    if(p.id){rows=await sql`UPDATE parts_inventory SET part_number=${pn},description=${de},manufacturer=${mf},supplier=${mf},category=${ca},qty_on_hand=${qt},qty_minimum=${mq},min_quantity=${mq},unit_cost=${co},location=${lo},notes=${no},updated_at=NOW() WHERE id=${p.id} RETURNING *`;}
    else{rows=await sql`INSERT INTO parts_inventory(part_number,description,manufacturer,supplier,category,qty_on_hand,qty_minimum,min_quantity,unit_cost,location,notes,company_id)VALUES(${pn},${de},${mf},${mf},${ca},${qt},${mq},${mq},${co},${lo},${no},${cid})RETURNING *`;}
    return res.json({ok:true,part:rows[0]});
  }
  if(act==='delete_part'){await sql`DELETE FROM parts_inventory WHERE id=${b.id}`;return res.json({ok:true});}
  if(act==='update_part'){
    const{id,quantity,field,value}=b;
    const qty=value!==undefined?parseInt(value):parseInt(quantity);
    if(!field||field==='quantity')await sql`UPDATE parts_inventory SET qty_on_hand=${qty},updated_at=NOW() WHERE id=${id}`;
    else if(field==='location')await sql`UPDATE parts_inventory SET location=${value},updated_at=NOW() WHERE id=${id}`;
    return res.json({ok:true});
  }
  if(act==='save_invoice'){
    const inv=b;let rows;
    const vn=inv.vendor||'',inm=inv.invoice_number||'',ind=inv.invoice_date||null,tot=parseFloat(inv.total_amount)||0,no=inv.notes||'',it=JSON.stringify(inv.items||[]);
    if(inv.id){rows=await sql`UPDATE parts_invoices SET vendor=${vn},invoice_number=${inm},invoice_date=${ind},total_amount=${tot},notes=${no},items=${it},updated_at=NOW() WHERE id=${inv.id} RETURNING *`;}
    else{rows=await sql`INSERT INTO parts_invoices(vendor,invoice_number,invoice_date,total_amount,notes,items,company_id)VALUES(${vn},${inm},${ind},${tot},${no},${it},${cid})RETURNING *`;}
    return res.json({ok:true,invoice:rows[0]});
  }
  if(act==='delete_invoice'){await sql`DELETE FROM parts_invoices WHERE id=${b.id}`;return res.json({ok:true});}
  if(act==='save_cross_ref'){
    const cr=b;let rows;
    const pa=cr.part_number_a||'',ma=cr.manufacturer_a||'',pb=cr.part_number_b||'',mb=cr.manufacturer_b||'',de=cr.description||'',pra=parseFloat(cr.price_a)||0,prb=parseFloat(cr.price_b)||0,no=cr.notes||'';
    if(cr.id){rows=await sql`UPDATE parts_cross_ref SET part_number_a=${pa},manufacturer_a=${ma},part_number_b=${pb},manufacturer_b=${mb},description=${de},price_a=${pra},price_b=${prb},notes=${no},updated_at=NOW() WHERE id=${cr.id} RETURNING *`;}
    else{rows=await sql`INSERT INTO parts_cross_ref(part_number_a,manufacturer_a,part_number_b,manufacturer_b,description,price_a,price_b,notes,company_id)VALUES(${pa},${ma},${pb},${mb},${de},${pra},${prb},${no},${cid})RETURNING *`;}
    return res.json({ok:true,ref:rows[0]});
  }
  if(act==='delete_cross_ref'){await sql`DELETE FROM parts_cross_ref WHERE id=${b.id}`;return res.json({ok:true});}
  if(act==='save_parts_order'){
    const o=b;let rows;
    const vn=o.vendor||o.supplier||'',pn=o.part_number||'',de=o.description||'',qt=parseInt(o.quantity||o.qty_ordered)||1,co=parseFloat(o.unit_cost)||0,tc=qt*co,st=o.status||'pending',ti=o.task_id||o.todo_item_id||null,no=o.notes||'';
    if(o.id){rows=await sql`UPDATE parts_orders SET supplier=${vn},part_number=${pn},description=${de},qty_ordered=${qt},unit_cost=${co},total_cost=${tc},status=${st},task_id=${ti},notes=${no},updated_at=NOW() WHERE id=${o.id} RETURNING *`;}
    else{rows=await sql`INSERT INTO parts_orders(supplier,part_number,description,qty_ordered,unit_cost,total_cost,status,task_id,todo_item_id,notes,company_id,ordered_by)VALUES(${vn},${pn},${de},${qt},${co},${tc},${st},${ti},${ti},${no},${cid},${uid})RETURNING *`;}
    return res.json({ok:true,order:rows[0]});
  }
  if(act==='update_tracking'||act==='add_tracking'){
    const{order_id,tracking_number,carrier,task_id}=b;
    await sql`UPDATE parts_orders SET tracking_number=${tracking_number||''},carrier=${carrier||''},status='ordered',updated_at=NOW() WHERE id=${order_id}`;
    if(task_id)await sql`UPDATE tasks SET status='parts_ordered',updated_at=NOW() WHERE id=${task_id}`;
    return res.json({ok:true});
  }
  if(act==='receive_part'){
    const{order_id,task_id,parts}=b;
    if(order_id)await sql`UPDATE parts_orders SET status='received',received_at=NOW(),updated_at=NOW() WHERE id=${order_id}`;
    for(const p of(parts||[])){
      const ex=await sql`SELECT id FROM parts_inventory WHERE part_number=${p.part_number} AND company_id=${cid} LIMIT 1`;
      if(ex.length>0)await sql`UPDATE parts_inventory SET qty_on_hand=qty_on_hand+${parseInt(p.quantity)||1},updated_at=NOW() WHERE id=${ex[0].id}`;
      else await sql`INSERT INTO parts_inventory(part_number,description,manufacturer,supplier,qty_on_hand,unit_cost,company_id)VALUES(${p.part_number},${p.description||''},${p.manufacturer||''},${p.manufacturer||''},${parseInt(p.quantity)||1},${parseFloat(p.unit_cost)||0},${cid})`;
    }
    if(task_id)await sql`UPDATE tasks SET status='in_progress',updated_at=NOW() WHERE id=${task_id}`;
    return res.json({ok:true});
  }
  if(act==='save_manual'){
    const m=b;let rows;
    const ti=m.title||'',mf=m.manufacturer||'',mo=m.model||'',ur=m.file_url||m.url||'',no=m.notes||'';
    if(m.id){rows=await sql`UPDATE parts_manuals SET title=${ti},manufacturer=${mf},model=${mo},file_url=${ur},notes=${no},updated_at=NOW() WHERE id=${m.id} RETURNING *`;}
    else{rows=await sql`INSERT INTO parts_manuals(title,manufacturer,model,file_url,notes,company_id)VALUES(${ti},${mf},${mo},${ur},${no},${cid})RETURNING *`;}
    return res.json({ok:true,manual:rows[0]});
  }
  if(act==='delete_manual'){await sql`DELETE FROM parts_manuals WHERE id=${b.id}`;return res.json({ok:true});}
  if(act==='search_manual'){
    const q='%'+(b.query||b.q||'')+'%';
    const rows=await sql`SELECT * FROM parts_manuals WHERE company_id=${cid} AND(title ILIKE ${q} OR manufacturer ILIKE ${q} OR model ILIKE ${q})ORDER BY title`;
    return res.json(rows);
  }
  if(act==='search_parts_web'){
    const q=((b.part_number||'')+(b.description?' '+b.description:'')).trim();
    return res.json({ok:true,query:q,search_url:'https://www.google.com/search?q='+encodeURIComponent(q+' buy price'),amazon_url:'https://www.amazon.com/s?k='+encodeURIComponent(q),ebay_url:'https://www.ebay.com/sch/i.html?_nkw='+encodeURIComponent(q),grainger_url:'https://www.grainger.com/search?searchQuery='+encodeURIComponent(q),motion_url:'https://www.motionindustries.com/search?q='+encodeURIComponent(q)});
  }
  return res.status(400).json({error:'Unknown action: '+act});
  }catch(e){return res.status(500).json({error:'Server error: '+e.message});}
};