const { neon } = require('@neondatabase/serverless');
const jwt = require('jsonwebtoken');

function verifyToken(req) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) throw new Error('No token');
  return jwt.verify(auth.slice(7), process.env.JWT_SECRET);
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  let user;
  try { user = verifyToken(req); } catch { return res.status(401).json({ error: 'Unauthorized' }); }

  const { type, id } = req.query;
  const sql = neon(process.env.DATABASE_URL);

  try {
    if (req.method === 'GET') {
      if (type === 'yield') {
        const records = await sql`SELECT yr.*, u.full_name as recorded_by FROM yield_records yr JOIN users u ON u.id = yr.user_id WHERE yr.company_id = ${user.company_id} ORDER BY yr.record_date DESC, yr.created_at DESC LIMIT 200`;
        return res.json(records);
      }
      if (type === 'injection') {
        const records = await sql`SELECT ir.*, u.full_name as recorded_by FROM injection_records ir JOIN users u ON u.id = ir.user_id WHERE ir.company_id = ${user.company_id} ORDER BY ir.record_date DESC, ir.created_at DESC LIMIT 200`;
        return res.json(records);
      }
      if (type === 'trimmer') {
        const reports = await sql`
          SELECT tr.id, tr.report_date, tr.shift, tr.notes, tr.created_at, tr.source, u.full_name as recorded_by,
            json_agg(json_build_object('id',te.id,'emp_number',te.emp_number,'full_name',te.full_name,'trim_number',te.trim_number,'minutes_worked',te.minutes_worked,'incoming_lbs',te.incoming_lbs,'fillet_lbs',te.fillet_lbs,'nugget_lbs',te.nugget_lbs,'misccut_lbs',te.misccut_lbs,'fillet_yield_pct',te.fillet_yield_pct,'nugget_yield_pct',te.nugget_yield_pct,'misccut_yield_pct',te.misccut_yield_pct,'total_yield_pct',te.total_yield_pct,'realtime_lbs_per_hour',te.realtime_lbs_per_hour,'eighthour_lbs_per_hour',te.eighthour_lbs_per_hour,'hours_worked',te.hours_worked,'lbs_per_hour',te.lbs_per_hour,'flagged',te.flagged) ORDER BY te.emp_number) FILTER(WHERE te.id IS NOT NULL) as entries
          FROM trimmer_reports tr JOIN users u ON u.id=tr.user_id LEFT JOIN trimmer_entries te ON te.report_id=tr.id
          WHERE tr.company_id=${user.company_id}
          GROUP BY tr.id,tr.report_date,tr.shift,tr.notes,tr.created_at,tr.source,u.full_name
          ORDER BY tr.report_date DESC,tr.created_at DESC LIMIT 100
        `;
        return res.json(reports);
      }
      return res.status(400).json({error:'Unknown type'});
    }
    if (req.method === 'POST') {
      const body=req.body;
      if (type==='yield') {
        const {record_date,shift,line,live_weight_lbs,dressed_weight_lbs,fillet_weight_lbs,trim_weight_lbs,yield_pct,notes}=body;
        const [r] = await sql`INSERT INTO yield_records(company_id,user_id,record_date,shift,line,live_weight_lbs,dressed_weight_lbs,fillet_weight_lbs,trim_weight_lbs,yield_pct,notes) VALUES(${user.company_id},${user.user_id},${record_date},${shift||line},${line},${live_weight_lbs},${dressed_weight_lbs},${fillet_weight_lbs},${trim_weight_lbs},${yield_pct},${notes}) RETURNING *`;
        return res.json(r);
      }
      if (type==='injection') {
        const {record_date,shift,category,item,batch_num,pre_injection_lbs,post_injection_lbs,brine_pct,target_brine_pct,total_pct,total_lbs,batch_data,notes}=body;
        const [r] = await sql`INSERT INTO injection_records(company_id,user_id,record_date,shift,category,item,batch_num,pre_injection_lbs,post_injection_lbs,brine_pct,target_brine_pct,total_pct,total_lbs,batch_data,notes) VALUES(${user.company_id},${user.user_id},${record_date},${shift},${category},${item},${batch_num},${pre_injection_lbs},${post_injection_lbs},${brine_pct},${target_brine_pct},${total_pct},${total_lbs},${JSON.stringify(batch_data||{})},${notes}) RETURNING *`;
        return res.json(r);
      }
      if (type==='trimmer') {
        const {report_date,shift,notes,entries,source}=body;
        const [report] = await sql`INSERT INTO trimmer_reports(company_id,user_id,report_date,shift,notes,source) VALUES(${user.company_id},${user.user_id},${report_date},${shift},${notes||''},${source||'manual'}) RETURNING *`;
        if(entries&&entries.length){
          for(const e of entries){
            await sql`INSERT INTO trimmer_entries(report_id,emp_number,full_name,trim_number,minutes_worked,incoming_lbs,fillet_lbs,nugget_lbs,misccut_lbs,fillet_yield_pct,nugget_yield_pct,misccut_yield_pct,total_weight_lbs,total_yield_pct,realtime_lbs_per_hour,eighthour_lbs_per_hour,hours_worked,flagged,validation_flags) VALUES(${report.id},${e.emp_number||''},${e.full_name||''},${e.trim_number||''},${parseFloat(e.minutes_worked||e.total_minutes)||0},${parseFloat(e.incoming_lbs)||0},${parseFloat(e.fillet_lbs)||0},${parseFloat(e.nugget_lbs)||0},${parseFloat(e.misccut_lbs)||0},${parseFloat(e.fillet_yield_pct)||0},${parseFloat(e.nugget_yield_pct)||0},${parseFloat(e.misccut_yield_pct)||0},${parseFloat(e.total_lbs||e.total_weight_lbs)||0},${parseFloat(e.total_yield_pct)||0},${parseFloat(e.realtime_lbs_per_hour)||0},${parseFloat(e.eighthour_lbs_per_hour)||0},${parseFloat(e.hours_worked)||0},${e.flagged||false},${JSON.stringify(e.validation_flags||[])})`;
          }
        }
        return res.json({success:true,report_id:report.id});
      }
      return res.status(400).json({error:'Unknown type'});
    }
    if (req.method==='DELETE') {
      if(!id)return res.status(400).json({error:'Missing id'});
      if(type==='yield')await sql`DELETE FROM yield_records WHERE id=${id} AND company_id=${user.company_id}`;
      else if(type==='injection')await sql`DELETE FROM injection_records WHERE id=${id} AND company_id=${user.company_id}`;
      else if(type==='trimmer')await sql`DELETE FROM trimmer_reports WHERE id=${id} AND company_id=${user.company_id}`;
      return res.json({success:true});
    }
    return res.status(405).json({error:'Method not allowed'});
  }catch(err){
    console.error('Records error:',err);
    return res.status(500).json({error:'Server error: '+err.message});
  }
};
