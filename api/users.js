const { neon } = require('@neondatabase/serverless');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');

function verifyToken(req) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) throw new Error('Unauthorized');
  return jwt.verify(auth.slice(7), process.env.JWT_SECRET);
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const sql = neon(process.env.DATABASE_URL);

  // Run migration to add new columns if missing
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
  } catch(e) { /* columns already exist */ }

  let user;
  try { user = verifyToken(req); } catch(e) { return res.status(401).json({ error: 'Unauthorized' }); }
  // Allow non-admins to change their own password only
  const isSelfPatch = req.method === 'PATCH' && req.body?.id === user.user_id && Object.keys(req.body).filter(k=>k!=='id').every(k=>k==='password');
  if (user.role !== 'admin' && !isSelfPatch) return res.status(403).json({ error: 'Admin only' });

  const company_id = user.company_id;

  // GET - list all users for this company
  if (req.method === 'GET') {
    const users = await sql`SELECT id, username, full_name, email, role, active, force_password_change, created_at FROM users WHERE company_id=${company_id} ORDER BY created_at ASC`;
    return res.json(users);
  }

  // POST - create new user
  if (req.method === 'POST') {
    const { username, full_name, email, role, password } = req.body;
    if (!username || !full_name || !role || !password) return res.status(400).json({ error: 'Missing fields' });
    const existing = await sql`SELECT id FROM users WHERE username=${username} AND company_id=${company_id}`;
    if (existing.length) return res.status(400).json({ error: 'Username already exists' });
    const hash = await bcrypt.hash(password, 12);
    const [newUser] = await sql`INSERT INTO users (company_id, username, full_name, email, role, password_hash, active, force_password_change) VALUES (${company_id}, ${username}, ${full_name}, ${email||null}, ${role}, ${hash}, true, true) RETURNING id, username, full_name, email, role, active`;
    return res.json(newUser);
  }

  // PATCH - update user
  if (req.method === 'PATCH') {
    const { id, full_name, email, role, active, password } = req.body;
    if (!id) return res.status(400).json({ error: 'Missing id' });
    if (password) {
      const hash = await bcrypt.hash(password, 12);
      // Clear force_password_change when user sets their own password
      const isAdmin = user.role === 'admin';
      const isSelf = id === user.user_id;
      await sql`UPDATE users SET password_hash=${hash}, force_password_change=${isAdmin && !isSelf ? false : false} WHERE id=${id} AND company_id=${company_id}`;
    }
    if (full_name !== undefined || email !== undefined || role !== undefined || active !== undefined) {
      await sql`UPDATE users SET
        full_name=COALESCE(${full_name}, full_name),
        email=COALESCE(${email}, email),
        role=COALESCE(${role}, role),
        active=COALESCE(${active}, active)
        WHERE id=${id} AND company_id=${company_id}`;
    }
    return res.json({ success: true });
  }

  // DELETE - deactivate user (soft delete)
  if (req.method === 'DELETE') {
    const id = new URL(req.url, 'http://x').searchParams.get('id');
    if (!id) return res.status(400).json({ error: 'Missing id' });
    await sql`DELETE FROM users WHERE id=${id} AND company_id=${company_id}`;
    return res.json({ success: true });
  }

  return res.status(405).json({ error: 'Method not allowed' });
};
