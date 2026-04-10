
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
