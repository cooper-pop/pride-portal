import { neon } from '@neondatabase/serverless';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  const { secret } = req.body || {};
  if (secret !== 'potp-seed-2026') return res.status(401).json({ error: 'Unauthorized' });
  try {
    const sql = neon(process.env.DATABASE_URL);
    // Check column type first
    const cols = await sql`SELECT column_name, data_type FROM information_schema.columns WHERE table_name IN ('yield_records','injection_records','trimmer_reports') AND column_name IN ('record_date','report_date') ORDER BY table_name, column_name`;
    // Also get sample values
    const samples = await sql`SELECT 'yield' as tbl, record_date::text FROM yield_records LIMIT 2`;
    return res.json({ cols, samples });
  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
}
