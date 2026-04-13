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
    await sql`CREATE TABLE IF NOT EXISTS parts_inventory(id UUID PRIMARY KEY DEFAULT gen_random_uuid(),cid INT,pnum TEXT DEFAULT '',descr TEXT DEFAULT '',mfr TEXT DEFAULT '',cat TEXT DEFAULT '',qty INT DEFAULT 0,minqty INT DEFAULT 1,cost NUMERIC(10,2)DEFAULT 0,loc TEXT DEFAULT '',notes TEXT DEFAULT '',created_at TIMESTAMPTZ DEFAULT NOW(),updated_at TIMESTAMPTZ DEFAULT NOW())`;
    await sql`CREATE TABLE IF NOT EXISTS parts_invoices(id UUID PRIMARY KEY DEFAULT gen_random_uuid(),cid INT,vendor TEXT DEFAULT '',invnum TEXT DEFAULT '',invdate DATE,total NUMERIC(10,2)DEFAULT 0,notes TEXT DEFAULT '',items JSONB DEFAULT '[]',created_at TIMESTAMPTZ DEFAULT NOW(),updated_at TIMESTAMPTZ DEFAULT NOW())`;
    await sql`CREATE TABLE IF NOT EXISTS parts_cross_ref(id UUID PRIMARY KEY DEFAULT gen_random_uuid(),cid INT,pnum_a TEXT DEFAULT '',mfr_a TEXT DEFAULT '',pnum_b TEXT DEFAULT '',mfr_b TEXT DEFAULT '',descr TEXT DEFAULT '',price_a NUMERIC(10,2)DEFAULT 0,price_b NUMERIC(10,2)DEFAULT 0,notes TEXT DEFAULT '',created_at TIMESTAMPTZ DEFAULT NOW(),updated_at TIMESTAMPTZ DEFAULT NOW())`;
    await sql`CREATE TABLE IF NOT EXISTS parts_orders(id UUID PRIMARY KEY DEFAULT gen_random_uuid(),cid INT,vendor TEXT DEFAULT '',pnum TEXT DEFAULT '',descr TEXT DEFAULT '',qty INT DEFAULT 1,cost NUMERIC(10,2)DEFAULT 0,status TEXT DEFAULT 'pending',tracking TEXT DEFAULT '',carrier TEXT DEFAULT '',task_id UUID,notes TEXT DEFAULT '',ord_by UUID,received_at TIMESTAMPTZ,created_at TIMESTAMPTZ DEFAULT NOW(),updated_at TIMESTAMPTZ DEFAULT NOW())`;
    await sql`CREATE TABLE IF NOT EXISTS parts_manuals(id UUID PRIMARY KEY DEFAULT gen_random_uuid(),cid INT,title TEXT DEFAULT '',mfr TEXT DEFAULT '',model TEXT DEFAULT '',url TEXT DEFAULT '',notes TEXT DEFAULT '',created_at TIMESTAMPTZ DEFAULT NOW(),updated_at TIMESTAMPTZ DEFAULT NOW())`;
    try{await sql`ALTER TABLE parts_inventory ADD COLUMN IF NOT EXISTS company_id INT`;}catch(e){}
    try{await sql`ALTER TABLE parts_invoices ADD COLUMN IF NOT EXISTS company_id INT`;}catch(e){}
    try{await sql`ALTER TABLE parts_cross_ref ADD COLUMN IF NOT EXISTS company_id INT`;}catch(e){}
    try{await sql`ALTER TABLE parts_orders ADD COLUMN IF NOT EXISTS company_id INT`;}catch(e){}
    try{await sql`ALTER TABLE parts_manuals ADD COLUMN IF NOT EXISTS company_id INT`;}catch(e){}
    return res.json({ok:true,message:'Parts DB ready'});
  }
  if(act==='get_parts'){
    const rows=await sql`SELECT id,COALESCE(pnum,part_number,'') as part_number,COALESCE(descr,description,'') as description,COALESCE(mfr,manufacturer,'') as manufacturer,COALESCE(cat,category,'') as category,COALESCE(qty,quantity,0) as quantity,COALESCE(minqty,min_quantity,1) as min_quantity,COALESCE(cost,unit_cost,0) as unit_cost,COALESCE(loc,location,'') as location,notes,created_at FROM parts_inventory WHERE COALESCE(cid,company_id,0)=${cid} ORDER BY COALESCE(pnum,part_number,'')`;
    return res.json(rows);
  }
  if(act==='get_invoices'){const rows=await sql`SELECT * FROM parts_invoices WHERE COALESCE(cid,company_id,0)=${cid} ORDER BY created_at DESC`;return res.json(rows);}
  if(act==='get_cross_ref'){const rows=await sql`SELECT * FROM parts_cross_ref WHERE COALESCE(cid,company_id,0)=${cid} ORDER BY COALESCE(pnum_a,part_number_a,'')`;return res.json(rows);}
  if(act==='get_parts_orders'){const rows=await sql`SELECT * FROM parts_orders WHERE COALESCE(cid,company_id,0)=${cid} ORDER BY created_at DESC`;return res.json(rows);}
  if(act==='get_manuals'){const rows=await sql`SELECT * FROM parts_manuals WHERE COALESCE(cid,company_id,0)=${cid} ORDER BY title`;return res.json(rows);}
  if(act==='get_low_stock'){const rows=await sql`SELECT * FROM parts_inventory WHERE COALESCE(cid,company_id,0)=${cid} AND COALESCE(qty,quantity,0)<=COALESCE(minqty,min_quantity,1) ORDER BY COALESCE(qty,quantity,0) ASC`;return res.json(rows);}
  if(act==='get_parts_todo_alerts'){
    const w=await sql`SELECT id,title FROM tasks WHERE status='waiting_parts' AND company_id=${cid} ORDER BY created_at DESC`;
    const l=await sql`SELECT id,COALESCE(pnum,part_number,'') as part_number,COALESCE(descr,description,'') as description,COALESCE(qty,quantity,0) as quantity,COALESCE(minqty,min_quantity,1) as min_quantity FROM parts_inventory WHERE COALESCE(cid,company_id,0)=${cid} AND COALESCE(qty,quantity,0)<=COALESCE(minqty,min_quantity,1) ORDER BY COALESCE(qty,quantity,0) ASC`;
    return res.json({waiting_parts:w,low_stock:l});
  }
  if(act==='save_part'){
    const p=b;let rows;
    const pn=p.part_number||'',de=p.description||'',mf=p.manufacturer||'',ca=p.category||'',qt=p.quantity||0,mq=p.min_quantity||1,co=p.unit_cost||0,lo=p.location||'',no=p.notes||'';
    if(p.id){rows=await sql`UPDATE parts_inventory SET pnum=${pn},descr=${de},mfr=${mf},cat=${ca},qty=${qt},minqty=${mq},cost=${co},loc=${lo},notes=${no},updated_at=NOW() WHERE id=${p.id} RETURNING *`;}
    else{rows=await sql`INSERT INTO parts_inventory(pnum,descr,mfr,cat,qty,minqty,cost,loc,notes,cid)VALUES(${pn},${de},${mf},${ca},${qt},${mq},${co},${lo},${no},${cid})RETURNING *`;}
    return res.json({ok:true,part:rows[0]});
  }
  if(act==='delete_part'){await sql`DELETE FROM parts_inventory WHERE id=${b.id}`;return res.json({ok:true});}
  if(act==='update_part'){
    const{id,quantity,field,value}=b;
    if(!field||field==='quantity')await sql`UPDATE parts_inventory SET qty=${value!==undefined?value:quantity},updated_at=NOW() WHERE id=${id}`;
    else if(field==='location')await sql`UPDATE parts_inventory SET loc=${value},updated_at=NOW() WHERE id=${id}`;
    return res.json({ok:true});
  }
  if(act==='save_invoice'){
    const inv=b;let rows;
    const vn=inv.vendor||'',inm=inv.invoice_number||'',ind=inv.invoice_date||null,tot=inv.total_amount||0,no=inv.notes||'',it=JSON.stringify(inv.items||[]);
    if(inv.id){rows=await sql`UPDATE parts_invoices SET vendor=${vn},invnum=${inm},invdate=${ind},total=${tot},notes=${no},items=${it},updated_at=NOW() WHERE id=${inv.id} RETURNING *`;}
    else{rows=await sql`INSERT INTO parts_invoices(vendor,invnum,invdate,total,notes,items,cid)VALUES(${vn},${inm},${ind},${tot},${no},${it},${cid})RETURNING *`;}
    return res.json({ok:true,invoice:rows[0]});
  }
  if(act==='delete_invoice'){await sql`DELETE FROM parts_invoices WHERE id=${b.id}`;return res.json({ok:true});}
  if(act==='save_cross_ref'){
    const cr=b;let rows;
    const pa=cr.part_number_a||'',ma=cr.manufacturer_a||'',pb=cr.part_number_b||'',mb=cr.manufacturer_b||'',de=cr.description||'',pra=cr.price_a||0,prb=cr.price_b||0,no=cr.notes||'';
    if(cr.id){rows=await sql`UPDATE parts_cross_ref SET pnum_a=${pa},mfr_a=${ma},pnum_b=${pb},mfr_b=${mb},descr=${de},price_a=${pra},price_b=${prb},notes=${no},updated_at=NOW() WHERE id=${cr.id} RETURNING *`;}
    else{rows=await sql`INSERT INTO parts_cross_ref(pnum_a,mfr_a,pnum_b,mfr_b,descr,price_a,price_b,notes,cid)VALUES(${pa},${ma},${pb},${mb},${de},${pra},${prb},${no},${cid})RETURNING *`;}
    return res.json({ok:true,ref:rows[0]});
  }
  if(act==='delete_cross_ref'){await sql`DELETE FROM parts_cross_ref WHERE id=${b.id}`;return res.json({ok:true});}
  if(act==='save_parts_order'){
    const o=b;let rows;
    const vn=o.vendor||'',pn=o.part_number||'',de=o.description||'',qt=o.quantity||1,co=o.unit_cost||0,st=o.status||'pending',ti=o.task_id||null,no=o.notes||'';
    if(o.id){rows=await sql`UPDATE parts_orders SET vendor=${vn},pnum=${pn},descr=${de},qty=${qt},cost=${co},status=${st},task_id=${ti},notes=${no},updated_at=NOW() WHERE id=${o.id} RETURNING *`;}
    else{rows=await sql`INSERT INTO parts_orders(vendor,pnum,descr,qty,cost,status,task_id,notes,cid,ord_by)VALUES(${vn},${pn},${de},${qt},${co},${st},${ti},${no},${cid},${uid})RETURNING *`;}
    return res.json({ok:true,order:rows[0]});
  }
  if(act==='update_tracking'||act==='add_tracking'){
    const{order_id,tracking_number,carrier,task_id}=b;
    await sql`UPDATE parts_orders SET tracking=${tracking_number||''},carrier=${carrier||''},status='ordered',updated_at=NOW() WHERE id=${order_id}`;
    if(task_id)await sql`UPDATE tasks SET status='parts_ordered',updated_at=NOW() WHERE id=${task_id}`;
    return res.json({ok:true});
  }
  if(act==='receive_part'){
    const{order_id,task_id,parts}=b;
    if(order_id)await sql`UPDATE parts_orders SET status='received',received_at=NOW(),updated_at=NOW() WHERE id=${order_id}`;
    for(const p of(parts||[])){
      const ex=await sql`SELECT id FROM parts_inventory WHERE pnum=${p.part_number} AND cid=${cid} LIMIT 1`;
      if(ex.length>0)await sql`UPDATE parts_inventory SET qty=qty+${p.quantity||1},updated_at=NOW() WHERE id=${ex[0].id}`;
      else await sql`INSERT INTO parts_inventory(pnum,descr,mfr,qty,cost,cid)VALUES(${p.part_number},${p.description||''},${p.manufacturer||''},${p.quantity||1},${p.unit_cost||0},${cid})`;
    }
    if(task_id)await sql`UPDATE tasks SET status='in_progress',updated_at=NOW() WHERE id=${task_id}`;
    return res.json({ok:true});
  }
  if(act==='save_manual'){
    const m=b;let rows;
    const ti=m.title||'',mf=m.manufacturer||'',mo=m.model||'',ur=m.file_url||m.url||'',no=m.notes||'';
    if(m.id){rows=await sql`UPDATE parts_manuals SET title=${ti},mfr=${mf},model=${mo},url=${ur},notes=${no},updated_at=NOW() WHERE id=${m.id} RETURNING *`;}
    else{rows=await sql`INSERT INTO parts_manuals(title,mfr,model,url,notes,cid)VALUES(${ti},${mf},${mo},${ur},${no},${cid})RETURNING *`;}
    return res.json({ok:true,manual:rows[0]});
  }
  if(act==='delete_manual'){await sql`DELETE FROM parts_manuals WHERE id=${b.id}`;return res.json({ok:true});}
  if(act==='search_manual'){
    const q='%'+(b.query||b.q||'')+'%';
    const rows=await sql`SELECT * FROM parts_manuals WHERE cid=${cid} AND(title ILIKE ${q} OR mfr ILIKE ${q} OR model ILIKE ${q})ORDER BY title`;
    return res.json(rows);
  }
  if(act==='search_parts_web'){
    const q=((b.part_number||'')+(b.description?' '+b.description:'')).trim();
    const enc=encodeURIComponent(q+' buy price');
    return res.json({ok:true,query:q,search_url:'https://www.google.com/search?q='+enc,amazon_url:'https://www.amazon.com/s?k='+encodeURIComponent(q),ebay_url:'https://www.ebay.com/sch/i.html?_nkw='+encodeURIComponent(q),grainger_url:'https://www.grainger.com/search?searchQuery='+encodeURIComponent(q),motion_url:'https://www.motionindustries.com/search?q='+encodeURIComponent(q)});
  }
  return res.status(400).json({error:'Unknown action: '+act});
  }catch(e){return res.status(500).json({error:'Server error: '+e.message});}
};