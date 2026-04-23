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
  // Never allow non-admins to change role, active status, or other sensitive fields
  if (user.role !== 'admin' && req.body?.role) return res.status(403).json({ error: 'Cannot change role' });
  if (user.role !== 'admin' && req.body?.active !== undefined) return res.status(403).json({ error: 'Cannot change active status' });

  const company_id = user.company_id;

  // GET - list all users for this company
  if (req.method === 'GET') {
    const users = await sql`SELECT id, username, full_name, email, role, active, force_password_change, created_at FROM users WHERE company_id=${company_id} AND active=true ORDER BY created_at ASC`;
    return res.json(users);
  }

  // POST ?action=create_for_company - admin-only, creates a user in a SPECIFIED
  // company (by slug). Needed when a POTP admin has to bootstrap a BFN user
  // without logging into BFN first (chicken-and-egg for a brand-new company).
  // Body: { company_slug, username, full_name, email, role, password, force_password_change? }
  if (req.method === 'POST' && req.query && req.query.action === 'create_for_company') {
    if (user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
    const { company_slug, username, full_name, email, role, password } = req.body || {};
    const force = !!(req.body && req.body.force_password_change);
    if (!company_slug || !username || !full_name || !role || !password) {
      return res.status(400).json({ error: 'Missing fields (company_slug, username, full_name, role, password required)' });
    }
    if (!['admin','manager','supervisor'].includes(role)) {
      return res.status(400).json({ error: 'Invalid role — must be admin / manager / supervisor' });
    }
    const [targetCompany] = await sql`SELECT id, slug, name FROM companies WHERE slug=${company_slug}`;
    if (!targetCompany) return res.status(404).json({ error: 'Company not found: ' + company_slug });
    const existing = await sql`SELECT id FROM users WHERE username=${username} AND company_id=${targetCompany.id}`;
    if (existing.length) return res.status(400).json({ error: 'Username already exists in ' + targetCompany.name });
    const hash = await bcrypt.hash(password, 12);
    const [newUser] = await sql`INSERT INTO users (company_id, username, full_name, email, role, password_hash, active, force_password_change)
      VALUES (${targetCompany.id}, ${username}, ${full_name}, ${email||null}, ${role}, ${hash}, true, ${force})
      RETURNING id, username, full_name, email, role`;
    return res.json({ ok: true, user: newUser, company: targetCompany });
  }

  // POST ?action=bulk_seed_staff - admin-only, creates multiple accounts at once.
  // Body: { accounts: [{username, full_name, email, role}] }
  // Returns: [{username, full_name, email, role, temp_password}] — caller must
  // capture these and share them with the respective users over a secure channel.
  if (req.method === 'POST' && req.query && req.query.action === 'bulk_seed_staff') {
    if (user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
    const list = Array.isArray(req.body && req.body.accounts) ? req.body.accounts : [];
    const created = [];
    for (const a of list) {
      const username = String(a.username || '').trim();
      const full_name = String(a.full_name || '').trim();
      const email = String(a.email || '').trim() || null;
      const role = String(a.role || '').trim();
      if (!username || !full_name || !role) continue;
      if (!['admin','manager','supervisor'].includes(role)) continue;
      const existing = await sql`SELECT id FROM users WHERE username=${username} AND company_id=${company_id}`;
      if (existing.length) { created.push({ username, full_name, email, role, skipped: 'username already exists' }); continue; }
      // Generate a 12-char temp password: 4-char word-ish + 4-digit + 4-char mixed
      const words = ['Pond','Fish','River','Lake','Deep','Skin','Split','Fillet','Nugget','Trim','Batch','Flavor'];
      const word = words[Math.floor(Math.random() * words.length)];
      const digits = String(Math.floor(Math.random() * 9000) + 1000);
      const suffix = Math.random().toString(36).slice(2, 6);
      const tempPassword = word + digits + suffix;
      const hash = await bcrypt.hash(tempPassword, 12);
      await sql`INSERT INTO users (company_id, username, full_name, email, role, password_hash, active, force_password_change)
        VALUES (${company_id}, ${username}, ${full_name}, ${email}, ${role}, ${hash}, true, true)`;
      created.push({ username, full_name, email, role, temp_password: tempPassword });
    }
    return res.json({ created });
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
    const { id, full_name, email, role, active, password, force_password_change } = req.body;
    if (!id) return res.status(400).json({ error: 'Missing id' });
    if (password) {
      const hash = await bcrypt.hash(password, 12);
      // If the user is changing their OWN password → clear force_password_change.
      // If an admin is resetting SOMEONE ELSE'S password → set it to true so that
      // user is required to change it on their next login. The old ternary had
      // `? false : false` in both branches, effectively disabling the forcing
      // behavior for admin-driven resets.
      const isAdmin = user.role === 'admin';
      const isSelf = id === user.user_id;
      const forceChange = isAdmin && !isSelf;
      await sql`UPDATE users SET password_hash=${hash}, force_password_change=${forceChange} WHERE id=${id} AND company_id=${company_id}`;
    }
    if (full_name !== undefined || email !== undefined || role !== undefined || active !== undefined) {
      await sql`UPDATE users SET
        full_name=COALESCE(${full_name}, full_name),
        email=COALESCE(${email}, email),
        role=COALESCE(${role}, role),
        active=COALESCE(${active}, active)
        WHERE id=${id} AND company_id=${company_id}`;
    }
    // Admin-only: flip force_password_change without touching the password itself.
    // Lets an admin mark an existing account "must change password on next login"
    // even when they don't know the current password.
    if (force_password_change !== undefined) {
      if (user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
      await sql`UPDATE users SET force_password_change=${!!force_password_change}
        WHERE id=${id} AND company_id=${company_id}`;
    }
    return res.json({ success: true });
  }

  // DELETE - deactivate user (soft delete)
  if (req.method === 'DELETE') {
    const id = new URL(req.url, 'http://x').searchParams.get('id');
    if (!id) return res.status(400).json({ error: 'Missing id' });
    await sql`UPDATE users SET active=false WHERE id=${id} AND company_id=${company_id}`;
    return res.json({ success: true });
  }

  return res.status(405).json({ error: 'Method not allowed' });
};
