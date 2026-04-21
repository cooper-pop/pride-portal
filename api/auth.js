import { sql } from '@vercel/postgres';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const action = req.query.action;

  if (action === 'get_companies') {
    try {
      const { rows } = await sql`SELECT id, name, logo_url FROM companies ORDER BY name`;
      return res.json({ ok: true, companies: rows });
    } catch (e) {
      try {
        const { rows } = await sql`SELECT id, name FROM companies ORDER BY name`;
        return res.json({ ok: true, companies: rows });
      } catch (e2) { return res.status(500).json({ error: e2.message }); }
    }
  }

  if (action === 'get_company') {
    try {
      const { rows } = await sql`SELECT * FROM companies WHERE id = ${req.query.id} LIMIT 1`;
      return res.json({ ok: true, company: rows[0] || null });
    } catch (e) { return res.status(500).json({ error: e.message }); }
  }

  return res.status(400).json({ error: 'Unknown action' });
}
