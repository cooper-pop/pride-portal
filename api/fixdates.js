import { neon } from '@neondatabase/serverless';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  const { secret } = req.body || {};
  if (secret !== 'potp-seed-2026') return res.status(401).json({ error: 'Unauthorized' });
  try {
    const sql = neon(process.env.DATABASE_URL);
    // Add 1 day to all existing records (stored 1 day early due to UTC offset bug)
    // Safety: only fix records before 2026-04-01 (the bug was present before the normalizeRows fix)
    const y = await sql`UPDATE yield_records SET record_date = record_date + 1 WHERE record_date < '2026-04-06' RETURNING id`;
    const i = await sql`UPDATE injection_records SET record_date = record_date + 1 WHERE record_date < '2026-04-06' RETURNING id`;
    const t = await sql`UPDATE trimmer_reports SET report_date = report_date + 1 WHERE report_date < '2026-04-06' RETURNING id`;
    return res.json({
      success: true,
      updated: { yield: y.length, injection: i.length, trimmer: t.length }
    });
  } catch(e) {
    return res.status(500).json({ error: e.message, stack: e.stack?.substring(0,200) });
  }
}
