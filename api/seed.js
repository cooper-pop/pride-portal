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

  if (action === 'fixdata') {
    const deleted = await sql`DELETE FROM trimmer_entries WHERE LOWER(full_name) LIKE '%escamilla%' RETURNING id`;
    const fixed = await sql`UPDATE trimmer_entries SET full_name='Latasha Craig', trim_number='L Craig' WHERE LOWER(full_name) LIKE '%latasska%' OR LOWER(full_name) LIKE '%lataska%' RETURNING id`;
    return res.json({ success:true, deleted:deleted.length+' removed', fixed:fixed.length+' fixed' });
  }

  if (action === 'fixnames') {
    const fixes = [
      { wrong: 'Lolita Cober', correct: 'Lolita Gober', trim: 'LGober' },
      { wrong: 'Yesaica Hernandez', correct: 'Yessica Hernandez', trim: 'Y Hernand' },
      { wrong: 'Yesica Hernandez', correct: 'Yessica Hernandez', trim: 'Y Hernand' },
      { wrong: 'Latasha Craig', correct: 'Lataska Craig', trim: 'L Craig' },
      { wrong: 'Latasska Craig', correct: 'Lataska Craig', trim: 'L Craig' },
      { wrong: 'Enerqicia Ortega', correct: 'Erendira Ortega', trim: 'E Orteg' },
      { wrong: 'Latonya Harris', correct: 'Adriana Zuniga', trim: 'A Zuniga' },
      { wrong: 'Raquel Monroy', correct: 'Raquel Monroy', trim: 'R Monroy' },
      { wrong: 'Patrice Williams', correct: 'Patrice Williams', trim: 'PWilliam' },
      { wrong: 'Patrica Starks', correct: 'Patrica Starks', trim: 'P Starks' },
    ];
    const results = [];
    for (const f of fixes) {
      if (f.wrong !== f.correct) {
        const r = await sql`UPDATE trimmer_entries SET full_name=${f.correct}, trim_number=${f.trim} WHERE full_name=${f.wrong} RETURNING id`;
        if (r.length) results.push(f.wrong + ' -> ' + f.correct + ' (' + r.length + ')');
      }
    }
    // Also fix emp 2623 (Samanta Martinez belongs to emp 2523 not 2623)
    const empFix = await sql`UPDATE trimmer_entries SET emp_number='2523' WHERE emp_number='2623' AND full_name='Samanta Martinez' RETURNING id`;
    if (empFix.length) results.push('2623->2523 Samanta Martinez ('+empFix.length+')');
    // Fix emp 2832 Dennise Elias -> 2632
    const empFix2 = await sql`UPDATE trimmer_entries SET emp_number='2632' WHERE emp_number='2832' AND full_name='Dennise Elias' RETURNING id`;
    if (empFix2.length) results.push('2832->2632 Dennise Elias ('+empFix2.length+')');
    // Fix emp 4353 Patrice Williams -> 4363
    const empFix3 = await sql`UPDATE trimmer_entries SET emp_number='4363' WHERE emp_number='4353' AND full_name='Patrice Williams' RETURNING id`;
    if (empFix3.length) results.push('4353->4363 Patrice Williams ('+empFix3.length+')');
    // Fix emp 5268 Keesha Williams -> 5266
    const empFix4 = await sql`UPDATE trimmer_entries SET emp_number='5266' WHERE emp_number='5268' AND full_name='Keesha Williams' RETURNING id`;
    if (empFix4.length) results.push('5268->5266 Keesha Williams ('+empFix4.length+')');
    // Fix emp 7924 Patrica Starks -> 7624
    const empFix5 = await sql`UPDATE trimmer_entries SET emp_number='7624' WHERE emp_number='7924' AND full_name='Patrica Starks' RETURNING id`;
    if (empFix5.length) results.push('7924->7624 Patrica Starks ('+empFix5.length+')');
    // Fix emp 7954 Judith Rico -> 7854
    const empFix6 = await sql`UPDATE trimmer_entries SET emp_number='7854' WHERE emp_number='7954' AND full_name='Judith Rico' RETURNING id`;
    if (empFix6.length) results.push('7954->7854 Judith Rico ('+empFix6.length+')');
    // Fix emp 2550 Raquel Monroy -> 2560
    const empFix7 = await sql`UPDATE trimmer_entries SET emp_number='2560' WHERE emp_number='2550' AND full_name='Raquel Monroy' RETURNING id`;
    if (empFix7.length) results.push('2550->2560 Raquel Monroy ('+empFix7.length+')');
    return res.json({ success:true, results });
  }

  if (action === 'empdump') {
    const entries = await sql`SELECT DISTINCT emp_number, full_name, COUNT(*) as cnt FROM trimmer_entries WHERE emp_number IS NOT NULL AND emp_number != '' GROUP BY emp_number, full_name ORDER BY emp_number, cnt DESC`;
    return res.json({ success:true, entries });
  }

  if (action === 'fixroles') {
    // Reset correct roles for all users by username
    const roles = [
      { username: 'Houston', role: 'manager' },
      { username: 'Tonya', role: 'manager' },
      { username: 'Mary', role: 'manager' },
      { username: 'Lawrence', role: 'supervisor' },
      { username: 'Erica', role: 'supervisor' },
      { username: 'Ramon', role: 'supervisor' },
    ];
    const results = [];
    for (const r of roles) {
      const res2 = await sql`UPDATE users SET role=${r.role} WHERE username=${r.username} RETURNING username, role`;
      if (res2.length) results.push(res2[0].username + ' -> ' + res2[0].role);
    }
    return res.json({ success: true, results });
  }

  if (action === 'fixempnums') {
    // Fix known wrong employee numbers -> correct canonical numbers
    const fixes = [
      { wrong: '5912', correct: '5744', name: 'Phyllis Sturdivant' },
    ];
    const results = [];
    for (const f of fixes) {
      const r = await sql`UPDATE trimmer_entries SET emp_number=${f.correct} WHERE emp_number=${f.wrong}`;
      results.push(f.name + ': emp ' + f.wrong + ' -> ' + f.correct);
    }
    return res.json({ success: true, results });
  }

  if (action === 'checkusers') {
    const users = await sql`SELECT username, role, active FROM users WHERE company_id=(SELECT id FROM companies WHERE slug='pride-of-the-pond') ORDER BY role`;
    return res.json({ success: true, users });
  }

  if (action === 'fixcooper') {
    const r = await sql`UPDATE users SET role='admin' WHERE username='Cooper' AND company_id=(SELECT id FROM companies WHERE slug='pride-of-the-pond') RETURNING username, role`;
    return res.json({ success: true, result: r });
  }

  if (action === 'resetcooper') {
    const bcrypt = require('bcryptjs');
    const hash = await bcrypt.hash('Cooper2026!', 10);
    await sql`UPDATE users SET password_hash=${hash}, force_password_change=false WHERE username='Cooper'`;
    return res.json({ success: true, message: 'Cooper password reset to Cooper2026!' });
  }

  return res.json({ success:true, message:'Use action: fixdata, fixnames, empdump, fixroles, fixempnums, checkusers, fixcooper, or resetcooper' });
};
