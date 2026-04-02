const { neon } = require('@neondatabase/serverless');
const bcrypt = require('bcryptjs');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();
  if (req.body.secret !== 'potp-seed-2026') return res.status(403).json({ error: 'Forbidden' });

  const sql = neon(process.env.DATABASE_URL);
  const action = req.body.action || 'seed';

  // ACTION: fix data - delete Lawrence entries, fix Latasska spelling
  if (action === 'fixdata') {
    // 1. Delete all trimmer_entries where full_name contains Escamilla or Lawrence (as trimmer, not manager)
    const deleted = await sql`DELETE FROM trimmer_entries WHERE LOWER(full_name) LIKE '%escamilla%' RETURNING id, full_name`;
    // 2. Fix Latasska -> Latasha Craig
    const fixed = await sql`UPDATE trimmer_entries SET full_name='Latasha Craig', trim_number='L Craig' WHERE LOWER(full_name) LIKE '%latasska%' RETURNING id, full_name`;
    // 3. Also fix trim_number duplicates by normalizing
    return res.json({ 
      success: true, 
      deleted: deleted.length + ' Lawrence/Escamilla entries removed',
      fixed: fixed.length + ' Latasska Craig entries fixed to Latasha Craig'
    });
  }

  // ACTION: build emp# lookup table
  if (action === 'empdump') {
    const entries = await sql`SELECT DISTINCT emp_number, full_name, COUNT(*) as cnt FROM trimmer_entries WHERE emp_number IS NOT NULL AND emp_number != '' GROUP BY emp_number, full_name ORDER BY emp_number, cnt DESC`;
    return res.json({ success: true, entries });
  }

  // Default: original seed
  const [company] = await sql`SELECT id FROM companies WHERE slug='pride-of-the-pond'`;
  if (!company) return res.status(404).json({ error: 'Company not found' });
  return res.json({ success: true, message: 'Use action: fixdata or empdump' });
};
