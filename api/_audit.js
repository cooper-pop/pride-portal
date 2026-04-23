// api/_audit.js
// Security audit log — records every authentication event and mutation.
// Design principles:
//   - Never block the main request. If logging fails we swallow the error so
//     a broken audit table doesn't take the whole portal down.
//   - Idempotent DDL. First call on a cold container creates the table; all
//     subsequent calls short-circuit via the `tableEnsured` flag.
//   - Rich-but-bounded details. Store JSONB of what changed, NOT the raw
//     request body — we never want to capture passwords/tokens.
//
// To read the log manually (DB or /api/audit when that endpoint lands):
//   SELECT created_at, username, action, resource_type, resource_id, success, ip_address, details
//   FROM audit_log WHERE company_id=<id> ORDER BY created_at DESC LIMIT 200;

let tableEnsured = false;

async function ensureAuditTable(sql) {
  if (tableEnsured) return;
  // company_id + user_id are TEXT rather than UUID because this portal's
  // companies table uses integer ids (SERIAL) while its users table uses
  // UUIDs. Using TEXT accepts both formats transparently — Neon's HTTP
  // serverless driver then doesn't need to infer a specific type for the
  // NULL case either.
  await sql`CREATE TABLE IF NOT EXISTS audit_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id TEXT,
    user_id TEXT,
    username TEXT,
    action TEXT NOT NULL,
    resource_type TEXT,
    resource_id TEXT,
    success BOOLEAN DEFAULT true,
    details JSONB,
    ip_address TEXT,
    user_agent TEXT,
    created_at TIMESTAMPTZ DEFAULT now()
  )`;
  // Migration for existing deploys where company_id/user_id were created
  // as UUID before we discovered the schema mismatch. ALTER succeeds as a
  // no-op when the columns are already TEXT. USING cast preserves whatever
  // rows did get written.
  try {
    await sql`ALTER TABLE audit_log ALTER COLUMN company_id TYPE TEXT USING company_id::text`;
  } catch (e) { /* already TEXT or other benign */ }
  try {
    await sql`ALTER TABLE audit_log ALTER COLUMN user_id TYPE TEXT USING user_id::text`;
  } catch (e) { /* already TEXT or other benign */ }
  await sql`CREATE INDEX IF NOT EXISTS idx_audit_log_company_time ON audit_log(company_id, created_at DESC)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_audit_log_user_time ON audit_log(user_id, created_at DESC)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_audit_log_action ON audit_log(action, created_at DESC)`;
  tableEnsured = true;
}

function getClientIp(req) {
  // Vercel forwards the original client IP in x-forwarded-for. When the
  // header holds a chain (proxy1, proxy2, client) we want the first entry.
  const fwd = (req.headers && req.headers['x-forwarded-for']) || '';
  const first = fwd.split(',')[0].trim();
  return first || (req.headers && req.headers['x-real-ip']) ||
    (req.socket && req.socket.remoteAddress) || null;
}

function getUserAgent(req) {
  return (req.headers && req.headers['user-agent']) || null;
}

/**
 * Writes an audit row. Never throws.
 *
 * @param sql       Neon client
 * @param req       Express-style request (for IP + UA extraction)
 * @param user      Authed user from JWT (may be null for failed logins). The
 *                  JWT payload uses `user_id`; DB rows use `id`. We handle both.
 * @param opts      { action, resource_type?, resource_id?, success?, details? }
 *                  - action: required, e.g. 'login.success', 'user.create'
 *                  - success: defaults to true; pass false for failed attempts
 *                  - details: freeform object, JSON-serialized into details column
 */
async function logAudit(sql, req, user, opts) {
  try {
    await ensureAuditTable(sql);
    const {
      action,
      resource_type = null,
      resource_id = null,
      success = true,
      details = null
    } = opts || {};
    if (!action) return;
    const ip = getClientIp(req);
    const ua = getUserAgent(req);
    const detailsJson = details ? JSON.stringify(details) : null;
    // Coerce to string so Neon passes a TEXT parameter, matching the TEXT
    // column. This lets the same code work whether companies.id is an
    // integer or a UUID.
    const companyIdRaw = user && (user.company_id !== undefined ? user.company_id : user.companyId);
    const userIdRaw = user && (user.user_id !== undefined ? user.user_id : user.id);
    const companyId = (companyIdRaw !== undefined && companyIdRaw !== null) ? String(companyIdRaw) : null;
    const userId = (userIdRaw !== undefined && userIdRaw !== null) ? String(userIdRaw) : null;
    const username = (user && user.username) || null;
    const resourceIdStr = (resource_id !== undefined && resource_id !== null) ? String(resource_id) : null;
    await sql`INSERT INTO audit_log (
      company_id, user_id, username, action, resource_type, resource_id,
      success, details, ip_address, user_agent
    ) VALUES (
      ${companyId},
      ${userId},
      ${username},
      ${action},
      ${resource_type},
      ${resourceIdStr},
      ${success},
      ${detailsJson}::jsonb,
      ${ip},
      ${ua}
    )`;
  } catch (e) {
    // Intentional: audit failures must never break the main request.
    // Log to stdout so Vercel captures it for later inspection.
    console.error('[audit] failed to log', opts && opts.action, e && e.message ? e.message : e);
  }
}

module.exports = { ensureAuditTable, logAudit, getClientIp, getUserAgent };
