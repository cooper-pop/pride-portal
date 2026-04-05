import { neon } from '@neondatabase/serverless';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  const { secret } = req.body || {};
  if (secret !== 'potp-seed-2026') return res.status(401).json({ error: 'Unauthorized' });

  try {
    const sql = neon(process.env.DATABASE_URL);
    const t = await sql`UPDATE trimmer_records SET record_date = record_date + INTERVAL '1 day' WHERE record_date::time = '00:00:00'`;
    const y = await sql`UPDATE yield_records SET record_date = record_date + INTERVAL '1 day' WHERE record_date::time = '00:00:00'`;
    const i = await sql`UPDATE injection_records SET record_date = record_date + INTERVAL '1 day' WHERE record_date::time = '00:00:00'`;
    return res.json({ success: true, trimmer: t.count, yield: y.count, injection: i.count });
  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
}
