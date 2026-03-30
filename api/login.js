const { neon } = require('@neondatabase/serverless');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { username, password, company_slug } = req.body;
    if (!username || !password || !company_slug) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const sql = neon(process.env.DATABASE_URL);
    const users = await sql`
      SELECT u.id, u.username, u.password_hash, u.role, u.full_name, u.company_id,
             c.slug as company_slug, c.name as company_name
      FROM users u
      JOIN companies c ON c.id = u.company_id
      WHERE lower(u.username) = lower(${username}) AND c.slug = ${company_slug}
      LIMIT 1
    `;

    if (!users.length) return res.status(401).json({ error: 'Invalid username or password' });

    const user = users[0];
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) return res.status(401).json({ error: 'Invalid username or password' });

    const token = jwt.sign(
      {
        user_id: user.id,
        company_id: user.company_id,
        company_slug: user.company_slug,
        company_name: user.company_name,
        role: user.role,
        full_name: user.full_name,
        username: user.username
      },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    return res.status(200).json({
      token,
      user: {
        id: user.id,
        username: user.username,
        full_name: user.full_name,
        role: user.role,
        company_slug: user.company_slug,
        company_name: user.company_name
      }
    });
  } catch (err) {
    console.error('Login error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
};
