const { neon } = require('@neondatabase/serverless');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { logAudit } = require('./_audit');

const RP_ID = 'pride-portal-eight.vercel.app';
const RP_NAME = 'Pride of the Pond';
const ORIGIN = 'https://pride-portal-eight.vercel.app';

function verifyToken(req) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) throw new Error('Unauthorized');
  return jwt.verify(auth.slice(7), process.env.JWT_SECRET);
}

// Store challenges temporarily in memory (serverless - use DB for prod scale)
const challenges = new Map();

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const sql = neon(process.env.DATABASE_URL);
  const url = new URL(req.url, 'http://x');
  const action = url.searchParams.get('action');

  // --- REGISTRATION CHALLENGE ---
  if (req.method === 'POST' && action === 'register-challenge') {
    let user;
    try { user = verifyToken(req); } catch(e) { return res.status(401).json({ error: 'Unauthorized' }); }
    const challenge = crypto.randomBytes(32).toString('base64url');
    challenges.set(user.user_id, { challenge, type: 'register', ts: Date.now() });
    const [dbUser] = await sql`SELECT id, username, full_name, email FROM users WHERE id=${user.user_id}`;
    return res.json({
      challenge,
      rp: { id: RP_ID, name: RP_NAME },
      user: {
        id: Buffer.from(dbUser.id).toString('base64url'),
        name: dbUser.username,
        displayName: dbUser.full_name
      },
      pubKeyCredParams: [{ alg: -7, type: 'public-key' }, { alg: -257, type: 'public-key' }],
      authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required', residentKey: 'preferred' },
      timeout: 60000,
      attestation: 'none'
    });
  }

  // --- REGISTRATION VERIFY ---
  if (req.method === 'POST' && action === 'register-verify') {
    let user;
    try { user = verifyToken(req); } catch(e) { return res.status(401).json({ error: 'Unauthorized' }); }
    const { credential, device_name } = req.body;
    const stored = challenges.get(user.user_id);
    if (!stored || stored.type !== 'register') return res.status(400).json({ error: 'No challenge found' });
    challenges.delete(user.user_id);
    // Store credential
    const credId = credential.id;
    const pubKey = JSON.stringify(credential.response);
    await sql`INSERT INTO passkeys (user_id, credential_id, public_key, device_name) VALUES (${user.user_id}, ${credId}, ${pubKey}, ${device_name||'iPhone'}) ON CONFLICT (credential_id) DO UPDATE SET public_key=${pubKey}`;
    // Passkey registration is security-sensitive — a new auth factor is being
    // added to the account. Log device_name but NOT credential_id/pubkey (which
    // would be PII in the audit trail).
    await logAudit(sql, req, user, {
      action: 'passkey.register',
      resource_type: 'passkey',
      details: { device_name: device_name || 'iPhone' }
    });
    return res.json({ success: true });
  }

  // --- AUTH CHALLENGE (pre-login) ---
  if (req.method === 'POST' && action === 'auth-challenge') {
    const { username, company_id } = req.body;
    const [dbUser] = await sql`SELECT id FROM users WHERE username=${username} AND company_id=${company_id} AND active=true`;
    if (!dbUser) return res.status(404).json({ error: 'User not found' });
    const passkeys = await sql`SELECT credential_id FROM passkeys WHERE user_id=${dbUser.id}`;
    const challenge = crypto.randomBytes(32).toString('base64url');
    challenges.set('auth_' + dbUser.id, { challenge, ts: Date.now() });
    return res.json({
      challenge,
      rpId: RP_ID,
      timeout: 60000,
      userVerification: 'required',
      allowCredentials: passkeys.map(p => ({ id: p.credential_id, type: 'public-key' }))
    });
  }

  // --- AUTH VERIFY (complete login) ---
  if (req.method === 'POST' && action === 'auth-verify') {
    const { username, company_id, credential } = req.body;
    const [dbUser] = await sql`SELECT id, username, full_name, role, active FROM users WHERE username=${username} AND company_id=${company_id} AND active=true`;
    if (!dbUser) {
      await logAudit(sql, req, { company_id, username }, {
        action: 'passkey.login.failure',
        success: false,
        details: { reason: 'unknown_user' }
      });
      return res.status(404).json({ error: 'User not found' });
    }
    const stored = challenges.get('auth_' + dbUser.id);
    if (!stored) {
      await logAudit(sql, req, { company_id, user_id: dbUser.id, username: dbUser.username }, {
        action: 'passkey.login.failure',
        success: false,
        details: { reason: 'no_challenge' }
      });
      return res.status(400).json({ error: 'No challenge' });
    }
    challenges.delete('auth_' + dbUser.id);
    // Verify credential exists
    const [pk] = await sql`SELECT id, counter FROM passkeys WHERE credential_id=${credential.id} AND user_id=${dbUser.id}`;
    if (!pk) {
      await logAudit(sql, req, { company_id, user_id: dbUser.id, username: dbUser.username }, {
        action: 'passkey.login.failure',
        success: false,
        details: { reason: 'unknown_credential' }
      });
      return res.status(400).json({ error: 'Unknown credential' });
    }
    await sql`UPDATE passkeys SET counter=counter+1 WHERE id=${pk.id}`;
    const [company] = await sql`SELECT id, slug, name FROM companies WHERE id=(SELECT company_id FROM users WHERE id=${dbUser.id})`;
    const token = jwt.sign({ user_id: dbUser.id, username: dbUser.username, role: dbUser.role, company_id: company.id }, process.env.JWT_SECRET, { expiresIn: '7d' });
    await logAudit(sql, req, { company_id: company.id, user_id: dbUser.id, username: dbUser.username }, {
      action: 'passkey.login.success',
      details: { role: dbUser.role, company_slug: company.slug, passkey_id: pk.id }
    });
    return res.json({ token, user: { id: dbUser.id, username: dbUser.username, full_name: dbUser.full_name, role: dbUser.role }, company: { id: company.id, slug: company.slug, name: company.name } });
  }

  // --- LIST passkeys (for user management) ---
  if (req.method === 'GET') {
    let user;
    try { user = verifyToken(req); } catch(e) { return res.status(401).json({ error: 'Unauthorized' }); }
    const target_user_id = url.searchParams.get('user_id') || user.user_id;
    if (target_user_id !== user.user_id && user.role !== 'admin') return res.status(403).json({ error: 'Forbidden' });
    const passkeys = await sql`SELECT id, credential_id, device_name, created_at FROM passkeys WHERE user_id=${target_user_id}`;
    return res.json(passkeys);
  }

  // --- DELETE passkey (admin reset or user self-remove) ---
  if (req.method === 'DELETE') {
    let user;
    try { user = verifyToken(req); } catch(e) { return res.status(401).json({ error: 'Unauthorized' }); }
    const id = url.searchParams.get('id');
    if (!id) return res.status(400).json({ error: 'Missing id' });
    // Distinguish admin-driven removal (someone lost their phone, admin wipes
    // the credential) from self-service removal — separate audit actions.
    const isAdminDelete = user.role === 'admin';
    if (isAdminDelete) {
      await sql`DELETE FROM passkeys WHERE id=${id}`;
    } else {
      await sql`DELETE FROM passkeys WHERE id=${id} AND user_id=${user.user_id}`;
    }
    await logAudit(sql, req, user, {
      action: isAdminDelete ? 'passkey.delete_by_admin' : 'passkey.delete_self',
      resource_type: 'passkey',
      resource_id: id
    });
    return res.json({ success: true });
  }

  return res.status(405).json({ error: 'Method not allowed' });
};
