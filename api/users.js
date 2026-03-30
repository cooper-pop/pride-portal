const { neon } = require('@neondatabase/serverless');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

function verifyToken(req) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) throw new Error('No token');
  return jwt.verify(auth.slice(7), process.env.JWT_SECRET);
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  let user;
  try { user = verifyToken(req); } catch { return res.status(401).json({ error: 'Unauthorized' }); }
  if (user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });

  const sql = neon(process.env.DATABASE_URL);
  const { id } = req.query;

  try {
    if (req.method === 'GET') {
      const users = await sql`
        SELECT id, username, full_name, role, created_at
        FROM users WHERE company_id = ${user.company_id}
        ORDER BY role, full_name
      `;
      return res.json(users);
    }

    if (req.method === 'POST') {
      const { username, password, full_name, role } = req.body;
      if (!username || !password || !full_name || !role) {
        return res.status(400).json({ error: 'All fields required' });
      }
      if (!['admin', 'manager', 'supervisor'].includes(role)) {
        return res.status(400).json({ error: 'Invalid role' });
      }
      const password_hash = await bcrypt.hash(password, 12);
      const [newUser] = await sql`
        INSERT INTO users (company_id, username, password_hash, role, full_name)
        VALUES (${user.company_id}, ${username.toLowerCase()}, ${password_hash}, ${role}, ${full_name})
        RETURNING id, username, full_name, role, created_at
      `;
      return res.json(newUser);
    }

    if (req.method === 'DELETE') {
      if (!id) return res.status(400).json({ error: 'Missing id' });
      if (id === user.user_id) return res.status(400).json({ error: 'Cannot delete yourself' });
      await sql`DELETE FROM users WHERE id = ${id} AND company_id = ${user.company_id}`;
      return res.json({ success: true });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('Users error:', err);
    return res.status(500).json({ error: err.message });
  }
};
