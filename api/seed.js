const { neon } = require('@neondatabase/serverless');
const bcrypt = require('bcryptjs');

// One-time seed endpoint - secured with a secret key
module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();
  if (req.body.secret !== 'potp-seed-2026') return res.status(403).json({ error: 'Forbidden' });

  const sql = neon(process.env.DATABASE_URL);

  // Run migrations first
  try {
    await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS email TEXT`;
    await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS active BOOLEAN DEFAULT true`;
    await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS force_password_change BOOLEAN DEFAULT false`;
    await sql`CREATE TABLE IF NOT EXISTS passkeys (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID REFERENCES users(id) ON DELETE CASCADE,
      credential_id TEXT UNIQUE NOT NULL,
      public_key TEXT NOT NULL,
      counter BIGINT DEFAULT 0,
      device_name TEXT,
      created_at TIMESTAMPTZ DEFAULT now()
    )`;
  } catch(e) {}

  // Get company
  const [company] = await sql`SELECT id FROM companies WHERE slug='pride-of-the-pond'`;
  if (!company) return res.status(404).json({ error: 'Company not found' });
  const company_id = company.id;

  const results = [];

  // Reactivate and update existing admin account
  await sql`UPDATE users SET email='cooper@prideofthepond.com', active=true, force_password_change=false WHERE username='admin' AND company_id=${company_id}`;

  // Delete old hbattle account
  await sql`DELETE FROM users WHERE username='hbattle' AND company_id=${company_id}`;

  const newUsers = [
    { username:'Cooper', full_name:'Cooper Battle', email:'cooper@prideofthepond.com', role:'admin', password:'Cooper210%' },
    { username:'Houston', full_name:'Houston Battle', email:'houston@prideofthepond.com', role:'manager', password:'Houston689@' },
    { username:'Tonya', full_name:'Tonya Murphree', email:'tonya@prideofthepond.com', role:'manager', password:'Tonya345@' },
    { username:'Mary', full_name:'Mary Gomez', email:'mary@prideofthepond.com', role:'manager', password:'Mary787!' },
    { username:'Lawrence', full_name:'Lawrence Escamilla', email:'lawrence@prideofthepond.com', role:'supervisor', password:'Lawrence253#' },
    { username:'Erica', full_name:'Erica Garcia', email:'eg9088890@gmail.com', role:'supervisor', password:'Erica880%' },
    { username:'Ramon', full_name:'Ramon Gutierrez', email:'dgutierrez2004.rg@gmail.com', role:'supervisor', password:'Ramon162$' },
  ];

  for (const u of newUsers) {
    const hash = await bcrypt.hash(u.password, 12);
    const existing = await sql`SELECT id FROM users WHERE username=${u.username} AND company_id=${company_id}`;
    if (existing.length) {
      await sql`UPDATE users SET full_name=${u.full_name}, email=${u.email}, role=${u.role}, password_hash=${hash}, active=true, force_password_change=true WHERE username=${u.username} AND company_id=${company_id}`;
      results.push({ username: u.username, action: 'updated' });
    } else {
      await sql`INSERT INTO users (company_id, username, full_name, email, role, password_hash, active, force_password_change) VALUES (${company_id}, ${u.username}, ${u.full_name}, ${u.email}, ${u.role}, ${hash}, true, true)`;
      results.push({ username: u.username, action: 'created' });
    }
  }

  return res.json({ success: true, results });
};
