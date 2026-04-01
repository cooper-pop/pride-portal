const { neon } = require('@neondatabase/serverless');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const sql = neon(process.env.DATABASE_URL);
  const { username, password, company_slug } = req.body;
  if (!username || !password || !company_slug) return res.status(400).json({ error: 'Missing fields' });

  // Find company
  const [company] = await sql`SELECT id, name, slug FROM companies WHERE slug=${company_slug}`;
  if (!company) return res.status(401).json({ error: 'Invalid company' });

  // Find user
  const [user] = await sql`SELECT id, username, full_name, role, password_hash, active, force_password_change FROM users WHERE username=${username} AND company_id=${company.id}`;
  if (!user) return res.status(401).json({ error: 'Invalid credentials' });
  if (!user.active) return res.status(401).json({ error: 'Account deactivated. Contact your administrator.' });

  // Check password
  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid) return res.status(401).json({ error: 'Invalid credentials' });

  // Check if user has passkeys registered
  const passkeys = await sql`SELECT id FROM passkeys WHERE user_id=${user.id}`;

  // Issue JWT
  const token = jwt.sign({
    user_id: user.id,
    username: user.username,
    role: user.role,
    company_id: company.id
  }, process.env.JWT_SECRET, { expiresIn: '7d' });

  return res.json({
    token,
    user: { id: user.id, username: user.username, full_name: user.full_name, role: user.role },
    company: { id: company.id, slug: company.slug, name: company.name },
    force_password_change: user.force_password_change || false,
    needs_passkey_setup: passkeys.length === 0,
    has_passkey: passkeys.length > 0
  });
};
