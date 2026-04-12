const { neon } = require('@neondatabase/serverless');
module.exports = async function handler(req, res) {
  try {
    const sql = neon(process.env.DATABASE_URL);
    const rows = await sql`UPDATE trimmer_entries SET emp_number = '1883' WHERE id = 'd8f0d856-b614-4e46-b600-e1f0b7215b00' AND emp_number = '1683' RETURNING id, full_name, emp_number`;
    return res.json({ ok: true, updated: rows });
  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
};