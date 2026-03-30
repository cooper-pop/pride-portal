const { neon } = require('@neondatabase/serverless');
const bcrypt = require('bcryptjs');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  const { company_slug, username, password, full_name, setup_key } = req.body;
  if (!setup_key || setup_key !== process.env.SETUP_KEY)
    return res.status(403).json({ error: 'Invalid setup key' });
  if (!username || !password || !full_name || !company_slug)
    return res.status(400).json({ error: 'All fields required' });

  const sql = neon(process.env.DATABASE_URL);
  try {
    const companies = await sql`SELECT id FROM companies WHERE slug = ${company_slug}`;
    if (!companies.length) return res.status(404).json({ error: 'Company not found' });
    const company_id = companies[0].id;
    const existing = await sql`SELECT id FROM users WHERE company_id = ${company_id} AND role = 'admin'`;
    if (existing.length)
      return res.status(400).json({ error: 'Admin already exists. Use the admin panel to manage users.' });
    const password_hash = await bcrypt.hash(password, 12);
    const [user] = await sql`
      INSERT INTO users (company_id, username, password_hash, role, full_name)
      VALUES (${company_id}, ${username.toLowerCase()}, ${password_hash}, 'admin', ${full_name})
      RETURNING id, username, role, full_name
    `;
    return res.json({ success: true, user });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
