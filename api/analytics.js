const { neon } = require('@neondatabase/serverless');
const jwt = require('jsonwebtoken');

function verifyToken(req) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) throw new Error('No token');
  return jwt.verify(auth.slice(7), process.env.JWT_SECRET);
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  let user;
  try { user = verifyToken(req); } catch { return res.status(401).json({ error: 'Unauthorized' }); }

  const sql = neon(process.env.DATABASE_URL);
  const { type, days = 30, trimmer_name } = req.query;
  const since = new Date();
  since.setDate(since.getDate() - parseInt(days));
  const sinceStr = since.toISOString().split('T')[0];

  try {
    if (type === 'rankings' || !type) {
      const rankings = await sql`
        SELECT te.emp_number, te.full_name,
          COUNT(DISTINCT tr.id) as days_worked,
          ROUND(AVG(te.realtime_lbs_per_hour)::NUMERIC, 2) as avg_lph,
          ROUND(AVG(te.eighthour_lbs_per_hour)::NUMERIC, 2) as avg_8hr_lph,
          ROUND(AVG(te.fillet_yield_pct)::NUMERIC, 2) as avg_fillet_pct,
          ROUND(AVG(te.nugget_yield_pct)::NUMERIC, 2) as avg_nugget_pct,
          ROUND(AVG(te.misccut_yield_pct)::NUMERIC, 2) as avg_misccut_pct,
          ROUND(AVG(te.total_yield_pct)::NUMERIC, 2) as avg_total_yield,
          ROUND(SUM(te.incoming_lbs)::NUMERIC, 0) as total_incoming_lbs
        FROM trimmer_entries te
        JOIN trimmer_reports tr ON tr.id = te.report_id
        WHERE tr.company_id = ${user.company_id}
          AND tr.report_date >= ${sinceStr}
          AND te.realtime_lbs_per_hour IS NOT NULL
        GROUP BY te.emp_number, te.full_name
        ORDER BY avg_lph DESC NULLS LAST
      `;
      const shiftAvgResult = await sql`
        SELECT ROUND(AVG(te.realtime_lbs_per_hour)::NUMERIC, 2) as avg_lph
        FROM trimmer_entries te JOIN trimmer_reports tr ON tr.id = te.report_id
        WHERE tr.company_id = ${user.company_id} AND tr.report_date >= ${sinceStr} AND te.realtime_lbs_per_hour IS NOT NULL
      `;
      const shiftAvgLph = parseFloat(shiftAvgResult[0]?.avg_lph || 0);
      const threshold = shiftAvgLph * 0.80;
      const withFlags = rankings.map(r => ({ ...r, underperformer: parseFloat(r.avg_lph) < threshold && parseFloat(r.avg_lph) > 0, underperformer_reason: parseFloat(r.avg_lph) < threshold ? `Avg ${r.avg_lph} lbs/hr is below 80% of team average (${threshold.toFixed(1)})` : null }));
      return res.json({ rankings: withFlags, shift_avg_lph: shiftAvgLph.toFixed(2), days: parseInt(days) });
    }
    if (type === 'trimmer_trends') {
      const trends = await sql`
        SELECT te.emp_number, te.full_name, tr.report_date,
          te.incoming_lbs, te.realtime_lbs_per_hour, te.eighthour_lbs_per_hour,
          te.fillet_lbs, te.fillet_yield_pct, te.nugget_lbs, te.nugget_yield_pct,
          te.misccut_lbs, te.misccut_yield_pct, te.total_yield_pct,
          te.minutes_worked, te.hours_worked, tr.shift
        FROM trimmer_entries te JOIN trimmer_reports tr ON tr.id = te.report_id
        WHERE tr.company_id = ${user.company_id} AND tr.report_date >= ${sinceStr}
          AND te.full_name ILIKE ${'%' + (trimmer_name || '') + '%'}
        ORDER BY tr.report_date ASC
      `;
      return res.json({ trends, trimmer_name, days: parseInt(days) });
    }
    if (type === 'daily_rankings') {
      const daily = await sql`
        SELECT te.emp_number, te.full_name, tr.report_date,
          te.realtime_lbs_per_hour, te.fillet_yield_pct, te.nugget_yield_pct,
          te.misccut_yield_pct, te.total_yield_pct,
          RANK() OVER (PARTITION BY tr.report_date ORDER BY te.realtime_lbs_per_hour DESC NULLS LAST) as lbshr_rank,
          RANK() OVER (PARTITION BY tr.report_date ORDER BY te.fillet_yield_pct DESC NULLS LAST) as fillet_rank,
          RANK() OVER (PARTITION BY tr.report_date ORDER BY te.nugget_yield_pct DESC NULLS LAST) as nugget_rank,
          RANK() OVER (PARTITION BY tr.report_date ORDER BY te.misccut_yield_pct ASCNULLS LAST) as misccut_rank
        FROM trimmer_entries te JOIN trimmer_reports tr ON tr.id = te.report_id
        WHERE tr.company_id = ${user.company_id} AND tr.report_date >= ${sinceStr}
        ORDER BY tr.report_date DESC, lbshr_rank ASC
      `;
      return res.json({ daily_rankings: daily, days: parseInt(days) });
    }
    return res.status(400).json({ error: 'Unknown analytics type' });
  } catch (err) {
    console.error('Analytics error:', err);
    return res.status(500).json({ error: 'Analytics failed: ' + err.message });
  }
};
