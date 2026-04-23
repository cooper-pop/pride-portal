// api/audit.js
// Admin-only viewer for the audit log written by api/_audit.js.
//
// Scope: an admin sees entries for their OWN company, plus rows with no
// company (NULL) — those are failed logins against unknown companies /
// unknown users, which are security-relevant regardless of which tenant
// you're viewing as.
//
// Filters (all optional, all via query string):
//   limit      — number of rows to return (default 100, max 500)
//   offset     — pagination offset (default 0)
//   action     — exact action name, e.g. 'login.failure'
//   username   — exact username
//   success    — 'true' or 'false'
//   since      — ISO timestamp; only return rows created at/after this time
//
// Why empty-string sentinels instead of NULL params:
// Neon's HTTP serverless driver can't infer the type of a NULL parameter
// when it's used in `$1::text IS NULL` expressions, so that pattern crashes
// the query with a type-inference error. Instead, every filter parameter
// is always a non-null string; an empty string (or the epoch date for
// timestamps, or empty-string success sentinel) means "no filter".

const { neon } = require('@neondatabase/serverless');
const perms = require('./_permissions');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  // Admin-only. Using the settings widget permission (admin-only) for consistency
  // with the rest of the security surface.
  const user = perms.requireAccess(req, res, 'settings', 'view');
  if (!user) return;

  const sql = neon(process.env.DATABASE_URL);

  // Ensure table exists. First-time call on a fresh deploy may hit this before
  // any logAudit has fired and created the table.
  try {
    await sql`CREATE TABLE IF NOT EXISTS audit_log (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      company_id UUID,
      user_id UUID,
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
  } catch (e) { /* already exists */ }

  const url = new URL(req.url, 'http://x');
  const qs = url.searchParams;
  const limit = Math.min(Math.max(parseInt(qs.get('limit') || '100', 10), 1), 500);
  const offset = Math.max(parseInt(qs.get('offset') || '0', 10), 0);

  // Sentinel pattern: always non-null strings. Empty string = no filter.
  const actionFilter = (qs.get('action') || '').trim();
  const usernameFilter = (qs.get('username') || '').trim();

  // Success filter: 't' = success only, 'f' = failures only, '' = no filter.
  // Inside SQL we compare via CASE WHEN success THEN 't' ELSE 'f' END.
  const successParam = qs.get('success');
  const successFilter = successParam === 'true' ? 't'
                     : successParam === 'false' ? 'f'
                     : '';

  // Since filter: default to epoch when empty so `created_at >= $1` is always
  // true. This avoids dealing with a NULL timestamp parameter.
  const sinceRaw = (qs.get('since') || '').trim();
  const sinceFilter = sinceRaw || '1970-01-01T00:00:00Z';

  try {
    const events = await sql`
      SELECT id, company_id, user_id, username, action, resource_type, resource_id,
             success, details, ip_address, user_agent, created_at
      FROM audit_log
      WHERE (company_id = ${user.company_id} OR company_id IS NULL)
        AND (${actionFilter} = '' OR action = ${actionFilter})
        AND (${usernameFilter} = '' OR username = ${usernameFilter})
        AND (${successFilter} = '' OR (CASE WHEN success THEN 't' ELSE 'f' END) = ${successFilter})
        AND created_at >= ${sinceFilter}::timestamptz
      ORDER BY created_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `;

    // Total count for pagination UI, with the same filters applied.
    const [{ total }] = await sql`
      SELECT COUNT(*)::int AS total FROM audit_log
      WHERE (company_id = ${user.company_id} OR company_id IS NULL)
        AND (${actionFilter} = '' OR action = ${actionFilter})
        AND (${usernameFilter} = '' OR username = ${usernameFilter})
        AND (${successFilter} = '' OR (CASE WHEN success THEN 't' ELSE 'f' END) = ${successFilter})
        AND created_at >= ${sinceFilter}::timestamptz
    `;

    // Distinct actions + usernames for filter dropdowns (company-scoped).
    // Always returned regardless of filters so the dropdowns don't narrow
    // themselves after the user applies a filter.
    const actionsResult = await sql`
      SELECT DISTINCT action FROM audit_log
      WHERE (company_id = ${user.company_id} OR company_id IS NULL)
      ORDER BY action
    `;
    const usernamesResult = await sql`
      SELECT DISTINCT username FROM audit_log
      WHERE company_id = ${user.company_id} AND username IS NOT NULL
      ORDER BY username
    `;

    return res.json({
      events,
      total,
      limit,
      offset,
      actions: actionsResult.map(r => r.action),
      usernames: usernamesResult.map(r => r.username)
    });
  } catch (e) {
    // Surface the real error message so the frontend can show something
    // useful instead of Vercel's generic "A server error has occurred".
    console.error('[audit] query failed', e && e.message ? e.message : e);
    return res.status(500).json({ error: 'Audit query failed: ' + (e && e.message ? e.message : 'unknown') });
  }
};
