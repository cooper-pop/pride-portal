const { neon } = require('@neondatabase/serverless');
const jwt = require('jsonwebtoken');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin','*');
  if (req.method==='OPTIONS') return res.status(200).end();
  const auth = req.headers.authorization;
  if (!auth) return res.status(401).json({error:'Unauthorized'});
  let user_id, company_id;
  try { const p=jwt.verify(auth.replace('Bearer ',''),process.env.JWT_SECRET); user_id=p.user_id; company_id=p.company_id; }
  catch(e) { return res.status(401).json({error:'Unauthorized'}); }
  const sql=neon(process.env.DATABASE_URL);
  const action=req.query.action;
  const body=req.body||{};
  try {
    if(action==='init_parts_db'){
      await sql`CREATE TABLE IF NOT EXISTS parts_inventory(id UUID PRIMARY KEY DEFAULT gen_random_uuid(),company_id INT,part_number TEXT,description TEXT,manufacturer TEXT DEFAULT '',category TEXT DEFAULT '',quantity INT DEFAULT 0,min_quantity INT DEFAULT 1,unit_cost NUMERIC(10,2) DEFAULT 0,location TEXT DEFAULT '',notes TEXT DEFAULT '',created_at TIMESTAMPTZ DEFAULT NOW(),updated_at TIMESTAMPTZ DEFAULT NOW())`;
      await sql`CREATE TABLE IF NOT EXISTS parts_invoices(id UUID PRIMARY KEY DEFAULT gen_random_uuid(),company_id INT,vendor TEXT DEFAULT '',invoice_number TEXT DEFAULT '',invoice_date DATE,total_amount NUMERIC(10,2) DEFAULT 0,notes TEXT DEFAULT '',items JSONB DEFAULT '[]',created_at TIMESTAMPTZ DEFAULT NOW(),updated_at TIMESTAMPTZ DEFAULT NOW())`;
      await sql`CREATE TABLE IF NOT EXISTS parts_cross_ref(id UUID PRIMARY KEY DEFAULT gen_random_uuid(),company_id INT,part_number_a TEXT DEFAULT '',manufacturer_a TEXT DEFAULT '',part_number_b TEXT DEFAULT '',manufacturer_b TEXT DEFAULT '',description TEXT DEFAULT '',price_a NUMERIC(10,2) DEFAULT 0,price_b NUMERIC(10,2) DEFAULT 0,notes TEXT DEFAULT '',created_at TIMESTAMPTZ DEFAULT NOW(),updated_at TIMESTAMPTZ DEFAULT NOW())`;
      await sql`CREATE TABLE IF NOT EXISTS parts_orders(id UUID PRIMARY KEY DEFAULT gen_random_uuid(),company_id INT,vendor TEXT DEFAULT '',part_number TEXT DEFAULT '',description TEXT DEFAULT '',quantity INT DEFAULT 1,unit_cost NUMERIC(10,2) DEFAULT 0,status TEXT DEFAULT 'pending',tracking_number TEXT DEFAULT '',carrier TEXT DEFAULT '',task_id UUID,notes TEXT DEFAULT '',ordered_by UUID,received_at TIMESTAMPTZ,created_at TIMESTAMPTZ DEFAULT NOW(),updated_at TIMESTAMPTZ DEFAULT NOW())`;
      await sql`CREATE TABLE IF NOT EXISTS parts_manuals(id UUID PRIMARY KEY DEFAULT gen_random_uuid(),company_id INT,title TEXT DEFAULT '',manufacturer TEXT DEFAULT '',model TEXT DEFAULT '',file_url TEXT DEFAULT '',notes TEXT DEFAULT '',created_at TIMESTAMPTZ DEFAULT NOW(),updated_at TIMESTAMPTZ DEFAULT NOW())`;
      return res.json({ok:true,message:'Parts DB initialized'});
    }
    if(action==='get_parts'){const rows=await sql`SELECT * FROM parts_inventory WHERE company_id=${company_id} ORDER BY part_number`;return res.json(rows);}
    if(action==='get_invoices'){const rows=await sql`SELECT * FROM parts_invoices WHERE company_id=${company_id} ORDER BY created_at DESC`;return res.json(rows);}
    if(action==='get_cross_ref'){const rows=await sql`SELECT * FROM parts_cross_ref WHERE company_id=${company_id} ORDER BY part_number_a`;return res.json(rows);}
    if(action==='get_parts_orders'){const rows=await sql`SELECT * FROM parts_orders WHERE company_id=${company_id} ORDER BY created_at DESC`;return res.json(rows);}
    if(action==='get_manuals'){const rows=await sql`SELECT * FROM parts_manuals WHERE company_id=${company_id} ORDER BY title`;return res.json(rows);}
    if(action==='get_low_stock'){const rows=await sql`SELECT * FROM parts_inventory WHERE company_id=${company_id} AND quantity<=min_quantity ORDER BY quantity ASC`;return res.json(rows);}
    if(action==='get_parts_todo_alerts'){
      const waiting=await sql`SELECT id,title,notes FROM tasks WHERE status='waiting_parts' AND company_id=${company_id} ORDER BY created_at DESC`;
      const low=await sql`SELECT id,part_number,description,quantity,min_quantity FROM parts_inventory WHERE quantity<=min_quantity AND company_id=${company_id} ORDER BY quantity ASC`;
      return res.json({waiting_parts:waiting,low_stock:low});
    }
    if(action==='save_part'){
      const p=body; let rows;
      if(p.id){rows=await sql`UPDATE parts_inventory SET part_number=${p.part_number||''},description=${p.description||''},manufacturer=${p.manufacturer||''},category=${p.category||''},quantity=${p.quantity||0},min_quantity=${p.min_quantity||1},unit_cost=${p.unit_cost||0},location=${p.location||''},notes=${p.notes||''},updated_at=NOW() WHERE id=${p.id} AND company_id=${company_id} RETURNING *`;}
      else{rows=await sql`INSERT INTO parts_inventory(part_number,description,manufacturer,category,quantity,min_quantity,unit_cost,location,notes,company_id)VALUES(${p.part_number||''},${p.description||''},${p.manufacturer||''},${p.category||''},${p.quantity||0},${p.min_quantity||1},${p.unit_cost||0},${p.location||''},${p.notes||''},${company_id})RETURNING *`;}
      return res.json({ok:true,part:rows[0]});
    }
    if(action==='delete_part'){await sql`DELETE FROM parts_inventory WHERE id=${body.id} AND company_id=${company_id}`;return res.json({ok:true});}
    if(action==='update_part'){
      const{id,quantity,field,value}=body;
      if(field==='quantity'||!field)await sql`UPDATE parts_inventory SET quantity=${value!==undefined?value:quantity},updated_at=NOW() WHERE id=${id}`;
      else if(field==='location')await sql`UPDATE parts_inventory SET location=${value},updated_at=NOW() WHERE id=${id}`;
      return res.json({ok:true});
    }
    if(action==='save_invoice'){
      const inv=body; let rows;
      if(inv.id){rows=await sql`UPDATE parts_invoices SET vendor=${inv.vendor||''},invoice_number=${inv.invoice_number||''},invoice_date=${inv.invoice_date||null},total_amount=${inv.total_amount||0},notes=${inv.notes||''},items=${JSON.stringify(inv.items||[])},updated_at=NOW() WHERE id=${inv.id} RETURNING *`;}
      else{rows=await sql`INSERT INTO parts_invoices(vendor,invoice_number,invoice_date,total_amount,notes,items,company_id)VALUES(${inv.vendor||''},${inv.invoice_number||''},${inv.invoice_date||null},${inv.total_amount||0},${inv.notes||''},${JSON.stringify(inv.items||[])},${company_id})RETURNING *`;}
      return res.json({ok:true,invoice:rows[0]});
    }
    if(action==='delete_invoice'){await sql`DELETE FROM parts_invoices WHERE id=${body.id} AND company_id=${company_id}`;return res.json({ok:true});}
    if(action==='save_cross_ref'){
      const cr=body; let rows;
      if(cr.id){rows=await sql`UPDATE parts_cross_ref SET part_number_a=${cr.part_number_a||''},manufacturer_a=${cr.manufacturer_a||''},part_number_b=${cr.part_number_b||''},manufacturer_b=${cr.manufacturer_b||''},description=${cr.description||''},price_a=${cr.price_a||0},price_b=${cr.price_b||0},notes=${cr.notes||''},updated_at=NOW() WHERE id=${cr.id} RETURNING *`;}
      else{rows=await sql`INSERT INTO parts_cross_ref(part_number_a,manufacturer_a,part_number_b,manufacturer_b,description,price_a,price_b,notes,company_id)VALUES(${cr.part_number_a||''},${cr.manufacturer_a||''},${cr.part_number_b||''},${cr.manufacturer_b||''},${cr.description||''},${cr.price_a||0},${cr.price_b||0},${cr.notes||''},${company_id})RETURNING *`;}
      return res.json({ok:true,ref:rows[0]});
    }
    if(action==='delete_cross_ref'){await sql`DELETE FROM parts_cross_ref WHERE id=${body.id} AND company_id=${company_id}`;return res.json({ok:true});}
    if(action==='save_parts_order'){
      const o=body; let rows;
      if(o.id){rows=await sql`UPDATE parts_orders SET vendor=${o.vendor||''},part_number=${o.part_number||''},description=${o.description||''},quantity=${o.quantity||1},unit_cost=${o.unit_cost||0},status=${o.status||'pending'},task_id=${o.task_id||null},notes=${o.notes||''},updated_at=NOW() WHERE id=${o.id} RETURNING *`;}
      else{rows=await sql`INSERT INTO parts_orders(vendor,part_number,description,quantity,unit_cost,status,task_id,notes,company_id,ordered_by)VALUES(${o.vendor||''},${o.part_number||''},${o.description||''},${o.quantity||1},${o.unit_cost||0},${o.status||'pending'},${o.task_id||null},${o.notes||''},${company_id},${user_id})RETURNING *`;}
      return res.json({ok:true,order:rows[0]});
    }
    if(action==='update_tracking'||action==='add_tracking'){
      const{order_id,tracking_number,carrier,task_id}=body;
      await sql`UPDATE parts_orders SET tracking_number=${tracking_number||''},carrier=${carrier||''},status='ordered',updated_at=NOW() WHERE id=${order_id}`;
      if(task_id)await sql`UPDATE tasks SET status='parts_ordered',updated_at=NOW() WHERE id=${task_id}`;
      return res.json({ok:true});
    }
    if(action==='receive_part'){
      const{order_id,task_id,parts}=body;
      if(order_id)await sql`UPDATE parts_orders SET status='received',received_at=NOW(),updated_at=NOW() WHERE id=${order_id}`;
      for(const p of(parts||[])){
        const ex=await sql`SELECT id FROM parts_inventory WHERE part_number=${p.part_number} AND company_id=${company_id} LIMIT 1`;
        if(ex.length>0)await sql`UPDATE parts_inventory SET quantity=quantity+${p.quantity||1},updated_at=NOW() WHERE id=${ex[0].id}`;
        else await sql`INSERT INTO parts_inventory(part_number,description,manufacturer,quantity,unit_cost,company_id)VALUES(${p.part_number},${p.description||''},${p.manufacturer||''},${p.quantity||1},${p.unit_cost||0},${company_id})`;
      }
      if(task_id)await sql`UPDATE tasks SET status='in_progress',updated_at=NOW() WHERE id=${task_id}`;
      return res.json({ok:true});
    }
    if(action==='save_manual'){
      const m=body; let rows;
      if(m.id){rows=await sql`UPDATE parts_manuals SET title=${m.title||''},manufacturer=${m.manufacturer||''},model=${m.model||''},file_url=${m.file_url||''},notes=${m.notes||''},updated_at=NOW() WHERE id=${m.id} RETURNING *`;}
      else{rows=await sql`INSERT INTO parts_manuals(title,manufacturer,model,file_url,notes,company_id)VALUES(${m.title||''},${m.manufacturer||''},${m.model||''},${m.file_url||''},${m.notes||''},${company_id})RETURNING *`;}
      return res.json({ok:true,manual:rows[0]});
    }
    if(action==='delete_manual'){await sql`DELETE FROM parts_manuals WHERE id=${body.id} AND company_id=${company_id}`;return res.json({ok:true});}
    if(action==='search_manual'){
      const q='%'+(body.query||'')+'%';
      const rows=await sql`SELECT * FROM parts_manuals WHERE company_id=${company_id} AND (title ILIKE ${q} OR manufacturer ILIKE ${q} OR model ILIKE ${q}) ORDER BY title`;
      return res.json(rows);
    }
    if(action==='search_parts_web'){
      const q=((body.part_number||'')+(body.description?' '+body.description:'')).trim();
      return res.json({ok:true,search_url:'https://www.google.com/search?q='+encodeURIComponent(q+' buy price'),amazon_url:'https://www.amazon.com/s?k='+encodeURIComponent(q),ebay_url:'https://www.ebay.com/sch/i.html?_nkw='+encodeURIComponent(q),grainger_url:'https://www.grainger.com/search?searchQuery='+encodeURIComponent(q),query:q});
    }
    return res.status(400).json({error:'Unknown action: '+action});
  } catch(e) { return res.status(500).json({error:'Server error: '+e.message}); }
}    if(action==='migrate_parts_db'){
      // Drop and recreate tables with full schema
      await sql`DROP TABLE IF EXISTS parts_inventory CASCADE`;
      await sql`DROP TABLE IF EXISTS parts_invoices CASCADE`;
      await sql`DROP TABLE IF EXISTS parts_cross_ref CASCADE`;
      await sql`DROP TABLE IF EXISTS parts_orders CASCADE`;
      await sql`DROP TABLE IF EXISTS parts_manuals CASCADE`;
      await sql`CREATE TABLE parts_inventory(id UUID PRIMARY KEY DEFAULT gen_random_uuid(),company_id INT,part_number TEXT,description TEXT DEFAULT '',manufacturer TEXT DEFAULT '',category TEXT DEFAULT '',quantity INT DEFAULT 0,min_quantity INT DEFAULT 1,unit_cost NUMERIC(10,2) DEFAULT 0,location TEXT DEFAULT '',notes TEXT DEFAULT '',created_at TIMESTAMPTZ DEFAULT NOW(),updated_at TIMESTAMPTZ DEFAULT NOW())`;
      await sql`CREATE TABLE parts_invoices(id UUID PRIMARY KEY DEFAULT gen_random_uuid(),company_id INT,vendor TEXT DEFAULT '',invoice_number TEXT DEFAULT '',invoice_date DATE,total_amount NUMERIC(10,2) DEFAULT 0,notes TEXT DEFAULT '',items JSONB DEFAULT '[]',created_at TIMESTAMPTZ DEFAULT NOW(),updated_at TIMESTAMPTZ DEFAULT NOW())`;
      await sql`CREATE TABLE parts_cross_ref(id UUID PRIMARY KEY DEFAULT gen_random_uuid(),company_id INT,part_number_a TEXT DEFAULT '',manufacturer_a TEXT DEFAULT '',part_number_b TEXT DEFAULT '',manufacturer_b TEXT DEFAULT '',description TEXT DEFAULT '',price_a NUMERIC(10,2) DEFAULT 0,price_b NUMERIC(10,2) DEFAULT 0,notes TEXT DEFAULT '',created_at TIMESTAMPTZ DEFAULT NOW(),updated_at TIMESTAMPTZ DEFAULT NOW())`;
      await sql`CREATE TABLE parts_orders(id UUID PRIMARY KEY DEFAULT gen_random_uuid(),company_id INT,vendor TEXT DEFAULT '',part_number TEXT DEFAULT '',description TEXT DEFAULT '',quantity INT DEFAULT 1,unit_cost NUMERIC(10,2) DEFAULT 0,status TEXT DEFAULT 'pending',tracking_number TEXT DEFAULT '',carrier TEXT DEFAULT '',task_id UUID,notes TEXT DEFAULT '',ordered_by UUID,received_at TIMESTAMPTZ,created_at TIMESTAMPTZ DEFAULT NOW(),updated_at TIMESTAMPTZ DEFAULT NOW())`;
      await sql`CREATE TABLE parts_manuals(id UUID PRIMARY KEY DEFAULT gen_random_uuid(),company_id INT,title TEXT DEFAULT '',manufacturer TEXT DEFAULT '',model TEXT DEFAULT '',file_url TEXT DEFAULT '',notes TEXT DEFAULT '',created_at TIMESTAMPTZ DEFAULT NOW(),updated_at TIMESTAMPTZ DEFAULT NOW())`;
      return res.json({ok:true,message:'Tables rebuilt with full schema'});
    }
        if(action==='save_part'){
      const p=body; let rows;
      if(p.id){rows=await sql`UPDATE parts_inventory SET part_number=${p.part_number||''},description=${p.description||''},manufacturer=${p.manufacturer||''},category=${p.category||''},quantity=${p.quantity||0},min_quantity=${p.min_quantity||1},unit_cost=${p.unit_cost||0},location=${p.location||''},notes=${p.notes||''},updated_at=NOW() WHERE id=${p.id} AND company_id=${company_id} RETURNING *`;}
      else{rows=await sql`INSERT INTO parts_inventory(part_number,description,manufacturer,category,quantity,min_quantity,unit_cost,location,notes,company_id)VALUES(${p.part_number||''},${p.description||''},${p.manufacturer||''},${p.category||''},${p.quantity||0},${p.min_quantity||1},${p.unit_cost||0},${p.location||''},${p.notes||''},${company_id})RETURNING *`;}
      return res.json({ok:true,part:rows[0]});
    }
    if(action==='delete_part'){await sql`DELETE FROM parts_inventory WHERE id=${body.id} AND company_id=${company_id}`;return res.json({ok:true});}
    if(action==='update_part'){
      const{id,quantity,field,value}=body;
      if(field==='quantity'||!field)await sql`UPDATE parts_inventory SET quantity=${value!==undefined?value:quantity},updated_at=NOW() WHERE id=${id}`;
      else if(field==='location')await sql`UPDATE parts_inventory SET location=${value},updated_at=NOW() WHERE id=${id}`;
      return res.json({ok:true});
    }
    if(action==='save_invoice'){
      const inv=body; let rows;
      if(inv.id){rows=await sql`UPDATE parts_invoices SET vendor=${inv.vendor||''},invoice_number=${inv.invoice_number||''},invoice_date=${inv.invoice_date||null},total_amount=${inv.total_amount||0},notes=${inv.notes||''},items=${JSON.stringify(inv.items||[])},updated_at=NOW() WHERE id=${inv.id} RETURNING *`;}
      else{rows=await sql`INSERT INTO parts_invoices(vendor,invoice_number,invoice_date,total_amount,notes,items,company_id)VALUES(${inv.vendor||''},${inv.invoice_number||''},${inv.invoice_date||null},${inv.total_amount||0},${inv.notes||''},${JSON.stringify(inv.items||[])},${company_id})RETURNING *`;}
      return res.json({ok:true,invoice:rows[0]});
    }
    if(action==='delete_invoice'){await sql`DELETE FROM parts_invoices WHERE id=${body.id} AND company_id=${company_id}`;return res.json({ok:true});}
    if(action==='save_cross_ref'){
      const cr=body; let rows;
      if(cr.id){rows=await sql`UPDATE parts_cross_ref SET part_number_a=${cr.part_number_a||''},manufacturer_a=${cr.manufacturer_a||''},part_number_b=${cr.part_number_b||''},manufacturer_b=${cr.manufacturer_b||''},description=${cr.description||''},price_a=${cr.price_a||0},price_b=${cr.price_b||0},notes=${cr.notes||''},updated_at=NOW() WHERE id=${cr.id} RETURNING *`;}
      else{rows=await sql`INSERT INTO parts_cross_ref(part_number_a,manufacturer_a,part_number_b,manufacturer_b,description,price_a,price_b,notes,company_id)VALUES(${cr.part_number_a||''},${cr.manufacturer_a||''},${cr.part_number_b||''},${cr.manufacturer_b||''},${cr.description||''},${cr.price_a||0},${cr.price_b||0},${cr.notes||''},${company_id})RETURNING *`;}
      return res.json({ok:true,ref:rows[0]});
    }
    if(action==='delete_cross_ref'){await sql`DELETE FROM parts_cross_ref WHERE id=${body.id} AND company_id=${company_id}`;return res.json({ok:true});}
    if(action==='save_parts_order'){
      const o=body; let rows;
      if(o.id){rows=await sql`UPDATE parts_orders SET vendor=${o.vendor||''},part_number=${o.part_number||''},description=${o.description||''},quantity=${o.quantity||1},unit_cost=${o.unit_cost||0},status=${o.status||'pending'},task_id=${o.task_id||null},notes=${o.notes||''},updated_at=NOW() WHERE id=${o.id} RETURNING *`;}
      else{rows=await sql`INSERT INTO parts_orders(vendor,part_number,description,quantity,unit_cost,status,task_id,notes,company_id,ordered_by)VALUES(${o.vendor||''},${o.part_number||''},${o.description||''},${o.quantity||1},${o.unit_cost||0},${o.status||'pending'},${o.task_id||null},${o.notes||''},${company_id},${user_id})RETURNING *`;}
      return res.json({ok:true,order:rows[0]});
    }
    if(action==='update_tracking'||action==='add_tracking'){
      const{order_id,tracking_number,carrier,task_id}=body;
      await sql`UPDATE parts_orders SET tracking_number=${tracking_number||''},carrier=${carrier||''},status='ordered',updated_at=NOW() WHERE id=${order_id}`;
      if(task_id)await sql`UPDATE tasks SET status='parts_ordered',updated_at=NOW() WHERE id=${task_id}`;
      return res.json({ok:true});
    }
    if(action==='receive_part'){
      const{order_id,task_id,parts}=body;
      if(order_id)await sql`UPDATE parts_orders SET status='received',received_at=NOW(),updated_at=NOW() WHERE id=${order_id}`;
      for(const p of(parts||[])){
        const ex=await sql`SELECT id FROM parts_inventory WHERE part_number=${p.part_number} AND company_id=${company_id} LIMIT 1`;
        if(ex.length>0)await sql`UPDATE parts_inventory SET quantity=quantity+${p.quantity||1},updated_at=NOW() WHERE id=${ex[0].id}`;
        else await sql`INSERT INTO parts_inventory(part_number,description,manufacturer,quantity,unit_cost,company_id)VALUES(${p.part_number},${p.description||''},${p.manufacturer||''},${p.quantity||1},${p.unit_cost||0},${company_id})`;
      }
      if(task_id)await sql`UPDATE tasks SET status='in_progress',updated_at=NOW() WHERE id=${task_id}`;
      return res.json({ok:true});
    }
    if(action==='save_manual'){
      const m=body; let rows;
      if(m.id){rows=await sql`UPDATE parts_manuals SET title=${m.title||''},manufacturer=${m.manufacturer||''},model=${m.model||''},file_url=${m.file_url||''},notes=${m.notes||''},updated_at=NOW() WHERE id=${m.id} RETURNING *`;}
      else{rows=await sql`INSERT INTO parts_manuals(title,manufacturer,model,file_url,notes,company_id)VALUES(${m.title||''},${m.manufacturer||''},${m.model||''},${m.file_url||''},${m.notes||''},${company_id})RETURNING *`;}
      return res.json({ok:true,manual:rows[0]});
    }
    if(action==='delete_manual'){await sql`DELETE FROM parts_manuals WHERE id=${body.id} AND company_id=${company_id}`;return res.json({ok:true});}
    if(action==='search_manual'){
      const q='%'+(body.query||'')+'%';
      const rows=await sql`SELECT * FROM parts_manuals WHERE company_id=${company_id} AND (title ILIKE ${q} OR manufacturer ILIKE ${q} OR model ILIKE ${q}) ORDER BY title`;
      return res.json(rows);
    }
    if(action==='search_parts_web'){
      const q=((body.part_number||'')+(body.description?' '+body.description:'')).trim();
      return res.json({ok:true,search_url:'https://www.google.com/search?q='+encodeURIComponent(q+' buy price'),amazon_url:'https://www.amazon.com/s?k='+encodeURIComponent(q),ebay_url:'https://www.ebay.com/sch/i.html?_nkw='+encodeURIComponent(q),grainger_url:'https://www.grainger.com/search?searchQuery='+encodeURIComponent(q),query:q});
    }
    return res.status(400).json({error:'Unknown action: '+action});
  } catch(e) { return res.status(500).json({error:'Server error: '+e.message}); }
};