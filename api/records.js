// records.js v1776017595455 — bulk_fix_emp, seed_roster, validate_entry

// Helper: normalize record_date from timestamptz to YYYY-MM-DD string
function normalizeRows(rows) {
  return rows.map(r => {
    // Fix date: Neon returns DATE columns as JS Date objects (UTC midnight)
    // Use UTC components to avoid local timezone day-shift
    function fixDate(d) {
      if (!d) return d;
      if (d instanceof Date) {
        return d.getUTCFullYear() + '-' +
          String(d.getUTCMonth()+1).padStart(2,'0') + '-' +
          String(d.getUTCDate()).padStart(2,'0');
      }
      if (typeof d === 'string') return d.substring(0, 10);
      return d;
    }
    return {
      ...r,
      record_date: fixDate(r.record_date),
      report_date: r.report_date !== undefined ? fixDate(r.report_date) : r.report_date
    };
  });
}
const { neon } = require('@neondatabase/serverless');
const jwt = require('jsonwebtoken');

function verifyToken(req) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) throw new Error('No token');
  return jwt.verify(auth.slice(7), process.env.JWT_SECRET);
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  let user;
  try { user = verifyToken(req); } catch { return res.status(401).json({ error: 'Unauthorized' }); }

  const { type, action, id } = req.query;
  const sql = neon(process.env.DATABASE_URL);
  // Grade config endpoints
  if (action === 'get_grade_config') {
    await sql`CREATE TABLE IF NOT EXISTS app_config (key TEXT PRIMARY KEY, value TEXT NOT NULL)`;
    const cfgRows = await sql`SELECT value FROM app_config WHERE key = 'grade_config' LIMIT 1`;
    if (cfgRows.length) return res.json(JSON.parse(cfgRows[0].value));
    return res.json({});
  }
  if (req.method === 'POST' && action === 'save_grade_config') {
    const cfgData = req.body;
    await sql`CREATE TABLE IF NOT EXISTS app_config (key TEXT PRIMARY KEY, value TEXT NOT NULL)`;
    await sql`INSERT INTO app_config (key, value) VALUES ('grade_config', ${JSON.stringify(cfgData)}) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`;
    return res.json({ ok: true });
  }


  try {
    if (req.method === 'GET') {
      if (type === 'yield') {
        const records = await sql`SELECT yr.*, u.full_name as recorded_by FROM yield_records yr JOIN users u ON u.id = yr.user_id WHERE yr.company_id = ${user.company_id} ORDER BY yr.record_date DESC, yr.created_at DESC LIMIT 200`;
        return res.json(normalizeRows(records));
      }
      if (type === 'injection') {
        const records = await sql`SELECT ir.*, u.full_name as recorded_by FROM injection_records ir JOIN users u ON u.id = ir.user_id WHERE ir.company_id = ${user.company_id} ORDER BY ir.record_date DESC, ir.created_at DESC LIMIT 200`;
        return res.json(normalizeRows(records));
      }
      if (type === 'trimmer') {
        const reports = await sql`
          SELECT tr.id, tr.report_date, tr.shift, tr.notes, tr.created_at, tr.source, u.full_name as recorded_by,
            json_agg(json_build_object('id',te.id,'emp_number',te.emp_number,'full_name',te.full_name,'trim_number',te.trim_number,'minutes_worked',te.minutes_worked,'incoming_lbs',te.incoming_lbs,'fillet_lbs',te.fillet_lbs,'nugget_lbs',te.nugget_lbs,'misccut_lbs',te.misccut_lbs,'fillet_yield_pct',te.fillet_yield_pct,'nugget_yield_pct',te.nugget_yield_pct,'misccut_yield_pct',te.misccut_yield_pct,'total_yield_pct',te.total_yield_pct,'realtime_lbs_per_hour',te.realtime_lbs_per_hour,'eighthour_lbs_per_hour',te.eighthour_lbs_per_hour,'hours_worked',te.hours_worked,'lbs_per_hour',te.lbs_per_hour,'flagged',te.flagged,'total_lbs',CASE WHEN te.total_weight_lbs > 0 THEN te.total_weight_lbs ELSE (COALESCE(te.fillet_lbs,0)+COALESCE(te.nugget_lbs,0)+COALESCE(te.misccut_lbs,0)) END,'total_yield_pct',te.total_yield_pct) ORDER BY te.emp_number) FILTER(WHERE te.id IS NOT NULL) as entries
          FROM trimmer_reports tr JOIN users u ON u.id=tr.user_id LEFT JOIN trimmer_entries te ON te.report_id=tr.id
          WHERE tr.company_id=${user.company_id}
          GROUP BY tr.id,tr.report_date,tr.shift,tr.notes,tr.created_at,tr.source,u.full_name
          ORDER BY tr.report_date DESC,tr.created_at DESC LIMIT 100
        `;
        return res.json(normalizeRows(reports));
      }
      if (action === 'bulk_fix_emp') {
        let count = 0;
        try { await sql`UPDATE trimmer_entries SET emp_number = '6116' WHERE id = '1ac64d3a-6308-4fb1-8b79-af251cc09092'`; count++; } catch(e) {}
        try { await sql`UPDATE trimmer_entries SET emp_number = '6116' WHERE id = 'a42a407f-a85f-44c0-9b1b-fd44f6d59825'`; count++; } catch(e) {}
        try { await sql`UPDATE trimmer_entries SET emp_number = '6116' WHERE id = '22de5707-d513-4296-98bb-5cac88f1eaa4'`; count++; } catch(e) {}
        try { await sql`UPDATE trimmer_entries SET emp_number = '6116' WHERE id = '1dc52bf1-a90d-4c02-9cfe-ac7525e5d333'`; count++; } catch(e) {}
        try { await sql`UPDATE trimmer_entries SET emp_number = '6116' WHERE id = '51b7c385-70c1-4a21-9d6c-85d65feacbe4'`; count++; } catch(e) {}
        try { await sql`UPDATE trimmer_entries SET emp_number = '6116' WHERE id = '27d56dc8-87b2-4b4b-b3eb-a4734402821b'`; count++; } catch(e) {}
        try { await sql`UPDATE trimmer_entries SET emp_number = '6116' WHERE id = 'f1006a26-0080-49b9-90d8-6866b686f01e'`; count++; } catch(e) {}
        try { await sql`UPDATE trimmer_entries SET emp_number = '6116' WHERE id = '0a1e3d0f-f4a0-4897-a630-2e46853cf3ba'`; count++; } catch(e) {}
        try { await sql`UPDATE trimmer_entries SET emp_number = '6116' WHERE id = 'abb4c14a-f4d4-4aaa-9913-0367f579ba4b'`; count++; } catch(e) {}
        try { await sql`UPDATE trimmer_entries SET emp_number = '6116' WHERE id = '577c002a-18c1-4a8c-8a6c-2db6e60c69f0'`; count++; } catch(e) {}
        try { await sql`UPDATE trimmer_entries SET emp_number = '6116' WHERE id = 'cda26d6b-e474-4f42-afa7-dcd8c0e20c05'`; count++; } catch(e) {}
        try { await sql`UPDATE trimmer_entries SET emp_number = '6116' WHERE id = 'e87881ac-8d8a-4c7e-83cf-4ea546d3f397'`; count++; } catch(e) {}
        try { await sql`UPDATE trimmer_entries SET emp_number = '6116' WHERE id = '9980d61d-1400-43ae-9687-4fd09ddf9665'`; count++; } catch(e) {}
        try { await sql`UPDATE trimmer_entries SET emp_number = '6116' WHERE id = '704869b4-e291-467a-9960-434ac9cc5e77'`; count++; } catch(e) {}
        try { await sql`UPDATE trimmer_entries SET emp_number = '5912' WHERE id = '48d4cb94-8d69-4c3f-adaa-8cbf2f9844a7'`; count++; } catch(e) {}
        try { await sql`UPDATE trimmer_entries SET emp_number = '5912' WHERE id = '5093b5ae-c5bf-46cd-96c7-fdd54256bd59'`; count++; } catch(e) {}
        try { await sql`UPDATE trimmer_entries SET emp_number = '5912' WHERE id = '1964dd34-55e3-4b7f-ac6d-235ccc333a9f'`; count++; } catch(e) {}
        try { await sql`UPDATE trimmer_entries SET emp_number = '5912' WHERE id = 'f0fe672f-1665-4133-af2d-96d194104bee'`; count++; } catch(e) {}
        try { await sql`UPDATE trimmer_entries SET emp_number = '5912' WHERE id = 'd44361ee-d04a-4d8b-ad7e-aa8ed79c3cb9'`; count++; } catch(e) {}
        try { await sql`UPDATE trimmer_entries SET emp_number = '5912' WHERE id = '37a4180c-b6c9-4d99-b802-de961b8d1bc8'`; count++; } catch(e) {}
        try { await sql`UPDATE trimmer_entries SET emp_number = '6825' WHERE id = 'e3a248ab-fe28-4850-af9c-326a7f45d72c'`; count++; } catch(e) {}
        try { await sql`UPDATE trimmer_entries SET emp_number = '8451' WHERE id = '7574ac9a-8439-49cf-bf9d-ff68408b5d43'`; count++; } catch(e) {}
        try { await sql`UPDATE trimmer_entries SET emp_number = '8451' WHERE id = '43fab50e-47df-479a-8302-2fee0b02a6ac'`; count++; } catch(e) {}
        try { await sql`UPDATE trimmer_entries SET emp_number = '8451' WHERE id = '92f4ad9b-09ef-463b-8807-0f9f1417415a'`; count++; } catch(e) {}
        try { await sql`UPDATE trimmer_entries SET emp_number = '8451' WHERE id = 'cd307617-5abd-418d-b5a2-0fc38483d29f'`; count++; } catch(e) {}
        try { await sql`UPDATE trimmer_entries SET emp_number = '8451' WHERE id = '9b411179-0a72-4e32-81ee-08cb88233671'`; count++; } catch(e) {}
        try { await sql`UPDATE trimmer_entries SET emp_number = '8451' WHERE id = '20494520-d930-4146-b525-91611f3dc2b4'`; count++; } catch(e) {}
        try { await sql`UPDATE trimmer_entries SET emp_number = '1242' WHERE id = 'ec4b5524-135e-43d1-afdd-5e7465d18f41'`; count++; } catch(e) {}
        return res.json({ ok: true, updated: count });
      }
      if (action === 'get_roster') {
        await sql`CREATE TABLE IF NOT EXISTS trimmer_roster (id SERIAL PRIMARY KEY, full_name TEXT UNIQUE NOT NULL, emp_number TEXT NOT NULL, trim_number TEXT, company_id INTEGER DEFAULT 1, active BOOLEAN DEFAULT true, updated_at TIMESTAMPTZ DEFAULT NOW())`;
        const rows = await sql`SELECT full_name, emp_number, trim_number FROM trimmer_roster WHERE active = true ORDER BY full_name`;
        return res.json(rows);
      }
      if (action === 'save_roster') {
        const {full_name, emp_number, trim_number} = body;
        if (!full_name || !emp_number) return res.status(400).json({error:'full_name and emp_number required'});
        const rows = await sql`INSERT INTO trimmer_roster (full_name, emp_number, trim_number) VALUES (${full_name}, ${emp_number}, ${trim_number||''}) ON CONFLICT (full_name) DO UPDATE SET emp_number=EXCLUDED.emp_number, trim_number=EXCLUDED.trim_number, updated_at=NOW() RETURNING *`;
        return res.json({ ok: true, roster: rows[0] });
      }
      if (action === 'seed_roster') {
        await sql`CREATE TABLE IF NOT EXISTS trimmer_roster (id SERIAL PRIMARY KEY, full_name TEXT UNIQUE NOT NULL, emp_number TEXT NOT NULL, trim_number TEXT, company_id INTEGER DEFAULT 1, active BOOLEAN DEFAULT true, updated_at TIMESTAMPTZ DEFAULT NOW())`;
        const employees = [{"name":"Adriana Zuniga","emp":"5246","trim":"A Zuniga"},{"name":"Armida Miramontes","emp":"2013","trim":"A Miramor"},{"name":"Cedric Berry","emp":"1914","trim":"CBerry"},{"name":"Cielo Gonzalez","emp":"2534","trim":"C Gonzale"},{"name":"Dennise Elias","emp":"2632","trim":"D Elias"},{"name":"Dolores Hernandez","emp":"2416","trim":"D Hernand"},{"name":"Elsa Galdamez","emp":"2903","trim":"E Galdame"},{"name":"Erendira Ortega","emp":"6973","trim":"E Ortega"},{"name":"Fatima Granades","emp":"1982","trim":"Fatima Gr"},{"name":"Griselda Sanchez","emp":"1313","trim":"G Sanhez"},{"name":"Isabel Garcia","emp":"8531","trim":"I Garcia"},{"name":"Josefina Rosales","emp":"1242","trim":"J Rosales"},{"name":"Judith Rico","emp":"7854","trim":"J Rico"},{"name":"Judkrisha Carter","emp":"9935","trim":"J Carter"},{"name":"Karla Gonzales","emp":"8451","trim":"K Gonzale"},{"name":"Keesha Williams","emp":"5266","trim":"KWilliams"},{"name":"Lataska Craig","emp":"9805","trim":"L Craig"},{"name":"Lizeth Zarate","emp":"1307","trim":"L Zarate"},{"name":"Lolita Gober","emp":"1883","trim":"LGober"},{"name":"Lourdes Rodriguez","emp":"2857","trim":"L Rodrigue"},{"name":"Lucy Allen","emp":"7387","trim":"LAllen"},{"name":"Maria Alvarado","emp":"2008","trim":"M Alvarado"},{"name":"Maximina Rodriguez","emp":"3892","trim":"M Rodrigu"},{"name":"Nohemi Sanchez","emp":"7008","trim":"N Sanchez"},{"name":"Patrica Starks","emp":"7624","trim":"P Starks"},{"name":"Patrice Williams","emp":"4363","trim":"PWilliams"},{"name":"Patricia Redmon","emp":"5032","trim":"P Redmon"},{"name":"Phyllis Sturdivant","emp":"5912","trim":"P Sturdiva"},{"name":"Raquel Monroy","emp":"2560","trim":"R Monroy"},{"name":"Reyna Galdamez","emp":"7434","trim":"R Galdame"},{"name":"Rocio Hernandez","emp":"6116","trim":"R Hernand"},{"name":"Rosalia Robles","emp":"6825","trim":"R Robles"},{"name":"Roselyn Mateo","emp":"9067","trim":"R Mateo"},{"name":"Samanta Martinez","emp":"2523","trim":"S Martinez"},{"name":"Soledad Garcia","emp":"1318","trim":"S Garcia"},{"name":"Telma Galdamez","emp":"4789","trim":"T Galdam"},{"name":"Teresa Cruz","emp":"1457","trim":"TCruz"},{"name":"Yessica Hernandez","emp":"2007","trim":"Y Hernand"}]
NaN
        for (const emp of employees) {
          await sql`INSERT INTO trimmer_roster (full_name, emp_number, trim_number) VALUES (${emp.name}, ${emp.emp}, ${emp.trim}) ON CONFLICT (full_name) DO UPDATE SET emp_number=EXCLUDED.emp_number, trim_number=EXCLUDED.trim_number, updated_at=NOW()`;
        }
        const count = await sql`SELECT COUNT(*) FROM trimmer_roster`;
        return res.json({ ok: true, seeded: count[0].count });
      }
      if (action === 'validate_entry') {
        const {full_name, emp_number} = body;
        const rows = await sql`SELECT full_name, emp_number, trim_number FROM trimmer_roster WHERE full_name ILIKE ${full_name}`;
        if (!rows.length) return res.json({ known: false, message: 'Employee not in roster - will be added as new' });
        const canonical = rows[0];
        if (canonical.emp_number !== emp_number) {
          return res.json({ known: true, match: false, correct_emp_number: canonical.emp_number, message: 'Employee number mismatch - should be ' + canonical.emp_number });
        }
        return res.json({ known: true, match: true, message: 'OK' });
      }
      return res.status(400).json({error:'Unknown type'});
    }
    if (req.method === 'POST') {
      const body=req.body;
      if (type==='yield') {
        const {record_date,shift,line,live_weight_lbs,dressed_weight_lbs,fillet_weight_lbs,trim_weight_lbs,yield_pct,notes}=body;
        const [r] = await sql`INSERT INTO yield_records(company_id,user_id,record_date,shift,line,live_weight_lbs,dressed_weight_lbs,fillet_weight_lbs,trim_weight_lbs,yield_pct,notes) VALUES(${user.company_id},${user.user_id},${record_date},${shift||line},${line},${live_weight_lbs},${dressed_weight_lbs},${fillet_weight_lbs},${trim_weight_lbs},${yield_pct},${notes}) RETURNING *`;
        return res.json(normalizeRows([r]));
      }
      if (type==='injection') {
        const {record_date,shift,category,item,batch_num,pre_injection_lbs,post_injection_lbs,brine_pct,target_brine_pct,total_pct,total_lbs,batch_data,notes}=body;
        const [r] = await sql`INSERT INTO injection_records(company_id,user_id,record_date,shift,category,item,batch_num,pre_injection_lbs,post_injection_lbs,brine_pct,target_brine_pct,total_pct,total_lbs,batch_data,notes) VALUES(${user.company_id},${user.user_id},${record_date},${shift},${category},${item},${batch_num},${pre_injection_lbs},${post_injection_lbs},${brine_pct},${target_brine_pct},${total_pct},${total_lbs},${batch_data||{}},${notes}) RETURNING *`;
        return res.json(normalizeRows([r]));
      }
      if (type==='trimmer') {
        const {report_date,shift,notes,entries,source}=body;
        const [report] = await sql`INSERT INTO trimmer_reports(company_id,user_id,report_date,shift,notes,source) VALUES(${user.company_id},${user.user_id},${report_date},${shift},${notes||''},${source||'manual'}) RETURNING *`;
        if(entries&&entries.length){
          for(const e of entries){
            await sql`INSERT INTO trimmer_entries(report_id,emp_number,full_name,trim_number,minutes_worked,incoming_lbs,fillet_lbs,nugget_lbs,misccut_lbs,fillet_yield_pct,nugget_yield_pct,misccut_yield_pct,total_weight_lbs,total_yield_pct,realtime_lbs_per_hour,eighthour_lbs_per_hour,hours_worked,flagged,validation_flags) VALUES(${report.id},${e.emp_number||''},${e.full_name||''},${e.trim_number||''},${parseFloat(e.minutes_worked||e.total_minutes)||0},${parseFloat(e.incoming_lbs)||0},${parseFloat(e.fillet_lbs)||0},${parseFloat(e.nugget_lbs)||0},${parseFloat(e.misccut_lbs)||0},${parseFloat(e.fillet_yield_pct)||0},${parseFloat(e.nugget_yield_pct)||0},${parseFloat(e.misccut_yield_pct)||0},${parseFloat(e.total_lbs||e.total_weight_lbs)||0},${parseFloat(e.total_yield_pct)||0},${parseFloat(e.realtime_lbs_per_hour)||0},${parseFloat(e.eighthour_lbs_per_hour)||0},${parseFloat(e.hours_worked)||0},${e.flagged||false},${JSON.stringify(Array.isArray(e.validation_flags)?e.validation_flags:[])})`;
          }
        }
        return res.json({success:true,report_id:report.id});
      }
      return res.status(400).json({error:'Unknown type'});
    }
    if (action === 'get_grade_config') {
      await sql`CREATE TABLE IF NOT EXISTS app_config (key TEXT PRIMARY KEY, value TEXT NOT NULL)`;
      const cfgRows = await sql`SELECT value FROM app_config WHERE key = 'grade_config' LIMIT 1`;
      if (cfgRows.length) return res.json(JSON.parse(cfgRows[0].value));
      return res.json({});
    }
    if (req.method === 'POST' && action === 'save_grade_config') {
      const cfgData = req.body;
      await sql`CREATE TABLE IF NOT EXISTS app_config (key TEXT PRIMARY KEY, value TEXT NOT NULL)`;
      await sql`INSERT INTO app_config (key, value) VALUES ('grade_config', ${JSON.stringify(cfgData)}) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`;
      return res.json({ ok: true });
    }
    if (req.method === 'PATCH' && action === 'rename_employee') {
      const { emp_number, new_name } = req.body;
      if (!emp_number || !new_name) return res.status(400).json({ error: 'Missing fields' });
      const upd = await sql`UPDATE trimmer_entries SET full_name = ${new_name} WHERE emp_number = ${emp_number}`;
      return res.json({ updated: upd.rowCount || 0, emp_number, new_name });
    }
    if (req.method==='PATCH' && type==='trimmer') {
      if (!id) return res.status(400).json({error:'Missing id'});
      const { report_date } = req.body;
      if (!report_date) return res.status(400).json({error:'Missing report_date'});
      await sql`UPDATE trimmer_reports SET report_date=${report_date} WHERE id=${id} AND company_id=${user.company_id}`;
      return res.json({success:true});
    }
    if (req.method==='DELETE') {
      if(!id)return res.status(400).json({error:'Missing id'});
      if(type==='yield')await sql`DELETE FROM yield_records WHERE id=${id} AND company_id=${user.company_id}`;
      else if(type==='injection')await sql`DELETE FROM injection_records WHERE id=${id} AND company_id=${user.company_id}`;
      else if(type==='trimmer')await sql`DELETE FROM trimmer_reports WHERE id=${id} AND company_id=${user.company_id}`;
      else if(type==='trimmer-entry') {
      if (user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
      await sql`DELETE FROM trimmer_entries WHERE id=${id}`;
    }
    return res.json({success:true});
    }
      // PATCH individual trimmer entry fields (admin only)
  if (req.method === 'PATCH' && type==='trimmer-entry') {
    if (user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
    const { id, ...fields } = req.body;
    if (!id) return res.status(400).json({ error: 'Missing id' });
    const allowed = ['emp_number','full_name','trim_number','minutes_worked','incoming_lbs','fillet_lbs','nugget_lbs','misccut_lbs','total_lbs'];
    const updates = Object.keys(fields).filter(k => allowed.includes(k));
    if (!updates.length) return res.status(400).json({ error: 'No valid fields' });
    for (const k of updates) {
      const v = fields[k];
      if (k === 'emp_number' || k === 'full_name' || k === 'trim_number') {
        await sql`UPDATE trimmer_entries SET ${sql.unsafe(k)}=${String(v)} WHERE id=${id}`;
      } else {
        await sql`UPDATE trimmer_entries SET ${sql.unsafe(k)}=${parseFloat(v)||0} WHERE id=${id}`;
      }
    }
    // Recalculate yields after update
    const [e] = await sql`SELECT * FROM trimmer_entries WHERE id=${id}`;
    if (e) {
      const inc = parseFloat(e.incoming_lbs)||1;
      const fil_pct = ((parseFloat(e.fillet_lbs)||0)/inc*100);
      const nug_pct = ((parseFloat(e.nugget_lbs)||0)/inc*100);
      const mis_pct = ((parseFloat(e.misccut_lbs)||0)/inc*100);
      const tot = (parseFloat(e.fillet_lbs)||0)+(parseFloat(e.nugget_lbs)||0)+(parseFloat(e.misccut_lbs)||0);
      const tot_pct = (tot/inc*100);
      const mins = parseFloat(e.minutes_worked)||1;
      const lph = mins>0 ? (tot/(mins/60)) : 0;
      const lph8 = tot / 8; await sql`UPDATE trimmer_entries SET fillet_yield_pct=${fil_pct},nugget_yield_pct=${nug_pct},misccut_yield_pct=${mis_pct},total_yield_pct=${tot_pct},total_weight_lbs=${tot},realtime_lbs_per_hour=${lph},eighthour_lbs_per_hour=${lph8} WHERE id=${id}`;
    }
    return res.json({ success: true });
  }

  // DELETE individual trimmer entry (admin only)
    if (req.method === 'PUT') {
      const body = req.body;
      const recId = body.id;
      const recType = body.type;
      const field = body.field;
      const value = body.value;
      if (!recId || !recType || !field) return res.status(400).json({error:'Missing id, type, or field'});
      if (recType === 'yield') {
        const ok = ['record_date','shift','line','live_weight_lbs','dressed_weight_lbs','fillet_weight_lbs','trim_weight_lbs','yield_pct','notes'];
        if (!ok.includes(field)) return res.status(400).json({error:'Field not allowed'});
        if (field==='record_date') await sql`UPDATE yield_records SET record_date=${value} WHERE id=${recId} AND company_id=${user.company_id}`;
        else if (field==='shift') await sql`UPDATE yield_records SET shift=${value} WHERE id=${recId} AND company_id=${user.company_id}`;
        else if (field==='line') await sql`UPDATE yield_records SET line=${value} WHERE id=${recId} AND company_id=${user.company_id}`;
        else if (field==='live_weight_lbs') await sql`UPDATE yield_records SET live_weight_lbs=${value} WHERE id=${recId} AND company_id=${user.company_id}`;
        else if (field==='dressed_weight_lbs') await sql`UPDATE yield_records SET dressed_weight_lbs=${value} WHERE id=${recId} AND company_id=${user.company_id}`;
        else if (field==='fillet_weight_lbs') await sql`UPDATE yield_records SET fillet_weight_lbs=${value} WHERE id=${recId} AND company_id=${user.company_id}`;
        else if (field==='trim_weight_lbs') await sql`UPDATE yield_records SET trim_weight_lbs=${value} WHERE id=${recId} AND company_id=${user.company_id}`;
        else if (field==='yield_pct') await sql`UPDATE yield_records SET yield_pct=${value} WHERE id=${recId} AND company_id=${user.company_id}`;
        else if (field==='notes') await sql`UPDATE yield_records SET notes=${value} WHERE id=${recId} AND company_id=${user.company_id}`;
      } else if (recType === 'injection') {
        const ok = ['report_date','shift','category','item','batch_num','pre_injection_lbs','post_injection_lbs','brine_pct','target_brine_pct','notes'];
        if (!ok.includes(field)) return res.status(400).json({error:'Field not allowed'});
        if (field==='report_date') await sql`UPDATE injection_records SET report_date=${value} WHERE id=${recId} AND company_id=${user.company_id}`;
        else if (field==='shift') await sql`UPDATE injection_records SET shift=${value} WHERE id=${recId} AND company_id=${user.company_id}`;
        else if (field==='category') await sql`UPDATE injection_records SET category=${value} WHERE id=${recId} AND company_id=${user.company_id}`;
        else if (field==='item') await sql`UPDATE injection_records SET item=${value} WHERE id=${recId} AND company_id=${user.company_id}`;
        else if (field==='batch_num') await sql`UPDATE injection_records SET batch_num=${value} WHERE id=${recId} AND company_id=${user.company_id}`;
        else if (field==='pre_injection_lbs') await sql`UPDATE injection_records SET pre_injection_lbs=${value} WHERE id=${recId} AND company_id=${user.company_id}`;
        else if (field==='post_injection_lbs') await sql`UPDATE injection_records SET post_injection_lbs=${value} WHERE id=${recId} AND company_id=${user.company_id}`;
        else if (field==='brine_pct') await sql`UPDATE injection_records SET brine_pct=${value} WHERE id=${recId} AND company_id=${user.company_id}`;
        else if (field==='notes') await sql`UPDATE injection_records SET notes=${value} WHERE id=${recId} AND company_id=${user.company_id}`;
      } else {
        return res.status(400).json({error:'Unknown type'});
      }
      return res.json({ok:true});
    }

    if (req.method === 'DELETE' && type==='trimmer-entry') {
    if (user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
    const id = req.query.id;
    if (!id) return res.status(400).json({ error: 'Missing id' });
    await sql`DELETE FROM trimmer_entries WHERE id=${id}`;
    return res.json({ success: true });
  }

  return res.status(405).json({error:'Method not allowed'});
  }catch(err){
    console.error('Records error:',err);
    return res.status(500).json({error:'Server error: '+err.message});
  }
};
