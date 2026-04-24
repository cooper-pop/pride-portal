// api/contracts.js
// Union / labor contract widget — MVP
//
// Three capabilities:
//   1. Store the current collective bargaining agreement (plain text plus
//      a structured summary JSON) so it's queryable by scenario.
//   2. "Ask the Lawyer" — the operator types or picks a scenario; Claude
//      reads the full contract and returns relevant articles, analysis,
//      recommended action, required process, risks, and an escalation
//      flag for situations that warrant actual counsel.
//   3. Consultation log — every Q&A pair is saved for reference, search,
//      and audit.
//
// Permissions (see api/_permissions.js):
//   view / ask  — manager+
//   create / edit / delete  — admin only
//
// Data model:
//   hr_contracts (id, company_id, title, parties, union_name,
//     effective_date, expiration_date, full_text, extracted_data JSONB,
//     is_current BOOL, archived BOOL, created_at, updated_at)
//   hr_consultations (id, company_id, contract_id, user_id, username,
//     scenario, response JSONB, created_at)

const fs = require('fs');
const path = require('path');
const { neon } = require('@neondatabase/serverless');
const perms = require('./_permissions');
const { logAudit } = require('./_audit');
let Anthropic;
try { Anthropic = require('@anthropic-ai/sdk'); } catch (e) { /* lazy - only needed for AI paths */ }

// The full 2025-2028 contract text lives alongside this file. Read it once
// per cold start so we don't re-read the disk on every request.
let _cachedContractText = null;
function getSeedContractText() {
  if (_cachedContractText !== null) return _cachedContractText;
  try {
    const p = path.join(__dirname, '_contract_seed_text.txt');
    _cachedContractText = fs.readFileSync(p, 'utf8');
  } catch (e) {
    console.error('[contracts] could not read seed text:', e.message);
    _cachedContractText = '';
  }
  return _cachedContractText;
}

// Hand-authored structured summary of the 2025-2028 CBA. Populated so the
// Contract tab can render rich metadata without needing to re-run AI
// extraction. Next-contract uploads can either reuse this shape or trigger
// extraction to produce an equivalent JSON.
const SEED_EXTRACTED = {
  title: 'UFCW Local 1529 Collective Bargaining Agreement 2025-2028',
  parties: {
    company: 'Magnolia Processing, Inc. d/b/a Pride of the Pond Catfish',
    union: 'United Food & Commercial Workers, Local 1529'
  },
  term: {
    effective_date: '2025-04-13',
    expiration_date: '2028-04-13',
    wage_reopeners: ['2026-02-02', '2027-02-02']
  },
  bargaining_unit: 'All fish processing and maintenance employees; excludes office clerical, truck drivers, guards, professional employees, and supervisors as defined by the NLRA.',
  articles: [
    { id: 'I',     title: 'Recognition',            summary: 'Union is exclusive bargaining rep; Company retains right to assign work.' },
    { id: 'II',    title: 'Management Rights',      summary: 'Company has broad authority: hire/fire, schedule, products, methods, subcontracting subject to Art XIV, discipline, new/close locations. Rights not subject to arbitration.' },
    { id: 'III',   title: 'No Strike / No Lockout', summary: 'No picketing, strikes, slowdowns, boycotts, lockouts. Discipline for violations grievable. Not in effect during wage-opener negotiations if ratified.' },
    { id: 'IV',    title: 'Grievance Procedure',    summary: 'Written grievance required. 1st Step → written response. Time limits apply. If union declines to pursue, employee may proceed individually.' },
    { id: 'V',     title: 'Arbitration',            summary: 'Final step after grievance. 15-day notice required. Arbitrator decision binding. 60-day hearing & decision windows.' },
    { id: 'VI',    title: 'Hours of Work',          summary: '40-hour work week Sun-Sat. Time and one-half over 40. 9-hour daily max (more senior employees have first right on OT). 2-hour show-up pay if scheduled and work unavailable. 30-min unpaid lunch; 15-min break every 2 hours. Acts of God excuse scheduling — temperature and fish supply do NOT.' },
    { id: 'VII',   title: 'Wages / Previous Experience', summary: 'Per Appendix A. Previous POTP experience = full credit. New classifications require Union bargaining.' },
    { id: 'VIII',  title: 'General',                summary: 'No discrimination or retaliation for union activity. No discrimination on race/creed/color/sex/age/national origin/ADA.' },
    { id: 'IX',    title: 'Probationary Period',    summary: '30 days. Probationary employees may be discharged without cause. Company may extend probation up to 30 more days with union consent.' },
    { id: 'X',     title: 'Separability',           summary: 'If any provision conflicts with federal/state law, that provision is deleted or modified; rest stays in force.' },
    { id: 'XI',    title: 'Complete Agreement',     summary: 'This contract is the whole agreement. No side deals. Amendments in writing only.' },
    { id: 'XII',   title: 'Stewards',               summary: 'Union designates Shop Stewards and Independent Contractors. Company notified in writing. Stewards not employees of Local 1529. 1 week/year paid training release. Annual joint training session (up to 2 stewards paid).' },
    { id: 'XIII',  title: 'Interchangeability',     summary: 'Employees may be assigned across jobs as operations require.' },
    { id: 'XIV',   title: 'Subcontracting',         summary: 'Allowed when orders exceed in-house capacity. Cannot be used to avoid hiring or avoid expansion. No bargaining-unit employee may be adversely affected.' },
    { id: 'XV',    title: 'Seniority',              summary: 'Company seniority = continuous service. Probationary employees have none. Layoffs by seniority (among qualified). Seniority lost by: discharge for cause, failure to report after recall, quit, outside work during leave, 12 months layoff, 12 (up to +6) months leave, permanent shutdown, 3 consecutive no-call/no-show days. Injury on comp keeps seniority 18 months. Postings for promotions; 15 working days to prove capable (30 for maintenance).' },
    { id: 'XVI',   title: 'Holidays',               summary: '8 recognized: New Year, July 4, Labor Day, Thanksgiving, Christmas Eve (½ day under 4yr / full day over), Christmas, MLK, Memorial Day. 8 hours straight time for paid holidays. Must work last scheduled day before and first scheduled day after unless excused. 1.5x plus holiday pay if worked. No employee required to work Christmas Eve.' },
    { id: 'XVII',  title: 'Vacations',              summary: 'Based on anniversary: 1 week at 1 year, 2 at 3 years, 3 at 10 years, 4 at 20 years (see Section 1). Vacation pay at regular straight-time. Must be taken by anniversary unless mutually agreed.' },
    { id: 'XVIII', title: 'Leave of Absence',       summary: 'Requests in writing. Unpaid. Max 12 months (+6 discretionary). Employee may not engage in gainful work during leave (grounds for loss of seniority).' },
    { id: 'XIX',   title: 'Funeral Leave',          summary: 'Up to 3 paid days for immediate family deaths as enumerated in contract.' },
    { id: 'XX',    title: 'Legal Proceedings',      summary: 'Jury duty / subpoena paid leave.' },
    { id: 'XXI',   title: 'Safety and Health',      summary: 'Company maintains safe workplace. Employees comply with safety rules. Safety-rule infractions may warrant immediate discipline; inconsistent prior enforcement does not waive right to enforce.' },
    { id: 'XXII',  title: 'Tools and Equipment',    summary: 'Company provides required tools. Employees responsible for care; loss/damage through negligence at employee expense.' },
    { id: 'XXIII', title: 'Miscellaneous',          summary: 'Bulletin boards for Union notices. Time clocks maintained per law. Free parking.' },
    { id: 'XXIV',  title: 'Military Clause',        summary: 'USERRA compliance.' },
    { id: 'XXV',   title: 'Written Reprimand',      summary: '12-month expiration on warnings (Constructive Advice Forms / written warnings). Employees grievable. Copies to union weekly. Drugs/alcohol or dishonesty → immediate termination without written warning required.' },
    { id: 'XXVI',  title: 'Union Visitation',       summary: 'Up to 3 Union agents may enter plant for business. Clean-up meetings with 24-hour notice.' },
    { id: 'XXVII', title: 'Union Membership',       summary: 'Dues checkoff with written authorization. Indemnification clause protects Company.' },
    { id: 'XXVIII',title: 'Bathrooms',              summary: 'Reasonable bathroom privileges; abuse may result in discipline.' },
    { id: 'XXIX',  title: 'Supervisor Harassment',  summary: 'No harassment of employees by supervisors. Fair and respectful treatment required.' },
    { id: 'XXX',   title: 'Pension',                summary: 'Company will explore implementation of a 401(k) during agreement life.' },
    { id: 'XXXI',  title: 'Economic Relief',        summary: 'Company may request meeting with Union if economic difficulties arise; Union agrees to consider in good faith.' },
    { id: 'XXXII', title: 'Perfect Attendance Incentive', summary: '$0.20/hr bonus on paychecks for weeks with perfect attendance (non-probationary). $200 bonus for perfect calendar year. FMLA, jury duty, job-related injury do not disqualify. Disqualified if discharged for gross misconduct.' },
    { id: 'XXXIII',title: 'Duration of Agreement',  summary: 'April 13, 2025 – April 13, 2028. Wage reopeners Feb 2, 2026 and Feb 2, 2027.' }
  ],
  wages: {
    classifications: ['Production', 'Skilled', 'Leaders', 'Maintenance'],
    tenure_bands: ['Start', '1-5 Years', '6-9 Years', '10-15 Years', '16-25 Years', '26+ Years'],
    table: [
      { tenure: 'Start',         production: 14.83, skilled: 14.83, leaders: 14.83, maintenance: 14.83 },
      { tenure: '1-5 Years',     production: 15.03, skilled: 15.23, leaders: 15.83, maintenance: 18.03 },
      { tenure: '6-9 Years',     production: 15.33, skilled: 15.53, leaders: 16.13, maintenance: 18.33 },
      { tenure: '10-15 Years',   production: 15.63, skilled: 15.83, leaders: 16.43, maintenance: 18.63 },
      { tenure: '16-25 Years',   production: 15.93, skilled: 16.13, leaders: 16.73, maintenance: 18.93 },
      { tenure: '26+ Years',     production: 16.23, skilled: 16.43, leaders: 17.03, maintenance: 19.23 }
    ],
    trimmer_incentives: [
      { min_lbs_per_hour: 100, bonus_per_hour: 0.25, quality_requirement: 'Minimum 91% yield with good quality' },
      { min_lbs_per_hour: 125, bonus_per_hour: 0.50 },
      { min_lbs_per_hour: 150, bonus_per_hour: 1.00 },
      { min_lbs_per_hour: 175, bonus_per_hour: 1.25 }
    ],
    night_premium_per_hour: 0.20,
    notes: 'Yield and pounds calculated weekly. Trimmer incentive requires 91% yield and good quality.'
  },
  holidays: [
    "New Year's Day", 'July Fourth', 'Labor Day', 'Thanksgiving Day',
    'Christmas Eve', 'Christmas Day', "Dr. Martin Luther King's Birthday", 'Memorial Day'
  ],
  key_numbers: {
    probationary_period_days: 30,
    daily_hour_cap: 9,
    weekly_ot_threshold: 40,
    show_up_pay_hours: 2,
    written_reprimand_expiration_months: 12,
    layoff_max_seniority_months: 12,
    compensable_injury_seniority_months: 18,
    leave_of_absence_max_months: 12,
    leave_of_absence_extension_months: 6,
    no_call_no_show_days_to_lose_seniority: 3,
    grievance_first_step_days: 5,
    arbitration_notice_days: 15,
    arbitration_hearing_window_days: 60,
    arbitration_decision_window_days: 60,
    perfect_attendance_weekly_bonus_per_hour: 0.20,
    perfect_attendance_yearly_bonus: 200.00
  },
  key_procedures: {
    grievance: '(1) Written grievance describing contract violation submitted at Step 1; (2) Company provides written answer; (3) If unresolved, 15 days to notify desire to arbitrate.',
    arbitration: '(1) Notice within 15 days of Step 1 answer; (2) Joint written submission of issue; (3) Impartial arbitrator selected (FMCS panel if no agreement within 10 days); (4) Hearing within 60 days; (5) Decision within 60 days; binding.',
    termination_for_cause: 'Generally requires progressive discipline (written warnings that expire 12 months). Summary termination allowed for drugs/alcohol on the job or proven dishonesty. Employee may grieve any discharge.'
  }
};

async function ensureTables(sql) {
  await sql`CREATE TABLE IF NOT EXISTS hr_contracts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id TEXT NOT NULL,
    title TEXT NOT NULL,
    parties TEXT,
    union_name TEXT,
    effective_date DATE,
    expiration_date DATE,
    full_text TEXT,
    extracted_data JSONB,
    is_current BOOLEAN DEFAULT false,
    archived BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
  )`;
  await sql`CREATE INDEX IF NOT EXISTS hr_contracts_company_idx
    ON hr_contracts(company_id, is_current, archived)`;

  await sql`CREATE TABLE IF NOT EXISTS hr_consultations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id TEXT NOT NULL,
    contract_id UUID REFERENCES hr_contracts(id) ON DELETE SET NULL,
    user_id TEXT,
    username TEXT,
    scenario TEXT NOT NULL,
    response JSONB,
    tags TEXT[],
    created_at TIMESTAMPTZ DEFAULT NOW()
  )`;
  await sql`CREATE INDEX IF NOT EXISTS hr_consultations_company_time_idx
    ON hr_consultations(company_id, created_at DESC)`;
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const sql = neon(process.env.DATABASE_URL);
  const url = new URL(req.url, 'http://x');
  const action = (req.query && req.query.action) || url.searchParams.get('action') || '';

  try { await ensureTables(sql); } catch (e) { console.error('[contracts] ensureTables:', e.message); }

  const user = perms.requireAuth(req, res);
  if (!user) return;
  const companyId = String(user.company_id);

  try {
    // ── GET get_state ───────────────────────────────────────────────────
    // Returns the current active contract (if any) plus its extracted data.
    // Auto-seeds the 2025-2028 CBA on first call for any company (POTP only
    // for now, but safe to leave gated per-company — each tenant seeds its
    // own copy only if they ask to).
    if (req.method === 'GET' && action === 'get_state') {
      if (!perms.canPerform(user, 'contracts', 'view')) return perms.deny(res, user, 'contracts', 'view');
      const rows = await sql`
        SELECT id, title, parties, union_name, effective_date, expiration_date,
               extracted_data, is_current, archived, created_at, updated_at
        FROM hr_contracts
        WHERE company_id = ${companyId} AND archived = false
        ORDER BY is_current DESC, created_at DESC
      `;
      const current = rows.find(r => r.is_current) || rows[0] || null;
      return res.json({
        ok: true,
        current,
        contracts: rows,
        has_seed_available: !rows.length && getSeedContractText().length > 0
      });
    }

    // ── POST seed_current ───────────────────────────────────────────────
    // Admin-only. Inserts the baked-in 2025-2028 CBA (full text + extracted
    // structured JSON). Idempotent — skipped if a current contract already
    // exists for the company.
    if (req.method === 'POST' && action === 'seed_current') {
      if (user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
      const existing = await sql`
        SELECT id FROM hr_contracts
        WHERE company_id = ${companyId} AND is_current = true AND archived = false
        LIMIT 1
      `;
      if (existing.length) {
        return res.json({ ok: true, skipped: true, reason: 'A current contract already exists.' });
      }
      const fullText = getSeedContractText();
      if (!fullText) return res.status(500).json({ error: 'Seed text unavailable on the server.' });

      const [row] = await sql`
        INSERT INTO hr_contracts (
          company_id, title, parties, union_name, effective_date, expiration_date,
          full_text, extracted_data, is_current, archived
        ) VALUES (
          ${companyId},
          ${SEED_EXTRACTED.title},
          ${SEED_EXTRACTED.parties.company + ' / ' + SEED_EXTRACTED.parties.union},
          ${SEED_EXTRACTED.parties.union},
          ${SEED_EXTRACTED.term.effective_date}::date,
          ${SEED_EXTRACTED.term.expiration_date}::date,
          ${fullText},
          ${JSON.stringify(SEED_EXTRACTED)}::jsonb,
          true,
          false
        )
        RETURNING id, title, effective_date, expiration_date
      `;
      await logAudit(sql, req, user, {
        action: 'contracts.seed_current',
        resource_type: 'contract', resource_id: row.id,
        details: { title: SEED_EXTRACTED.title, term: SEED_EXTRACTED.term }
      });
      return res.json({ ok: true, contract: row });
    }

    // ── POST ask_lawyer ─────────────────────────────────────────────────
    // Takes a scenario string + optional contract_id. Loads the full
    // contract text, sends to Claude, returns structured JSON guidance.
    if (req.method === 'POST' && action === 'ask_lawyer') {
      if (!perms.canPerform(user, 'contracts', 'ask')) return perms.deny(res, user, 'contracts', 'ask');
      const { scenario, contract_id } = req.body || {};
      const scenarioText = String(scenario || '').trim();
      if (!scenarioText) return res.status(400).json({ error: 'Scenario required' });
      if (scenarioText.length > 4000) return res.status(400).json({ error: 'Scenario too long (max 4000 chars).' });

      // Pull the target contract (explicit id, else the current)
      let contract;
      if (contract_id) {
        const r = await sql`SELECT id, title, full_text, extracted_data FROM hr_contracts
          WHERE id = ${contract_id} AND company_id = ${companyId} AND archived = false LIMIT 1`;
        contract = r[0];
      } else {
        const r = await sql`SELECT id, title, full_text, extracted_data FROM hr_contracts
          WHERE company_id = ${companyId} AND is_current = true AND archived = false
          ORDER BY created_at DESC LIMIT 1`;
        contract = r[0];
      }
      if (!contract) return res.status(400).json({ error: 'No active contract found. Seed or upload one first.' });

      if (!process.env.ANTHROPIC_API_KEY) return res.status(500).json({ error: 'AI not configured (missing ANTHROPIC_API_KEY).' });
      if (!Anthropic) return res.status(500).json({ error: 'Anthropic SDK not installed on the server.' });
      // Defensive: make sure we actually loaded a class. The SDK exports the
      // Anthropic class as the default — if module shape changed, surface it.
      if (typeof Anthropic !== 'function') {
        console.error('[contracts] Anthropic SDK shape unexpected:', typeof Anthropic, Object.keys(Anthropic || {}));
        return res.status(500).json({ error: 'Anthropic SDK import unexpected shape' });
      }
      // Sanity check: the contract must have text to quote
      if (!contract.full_text || contract.full_text.length < 500) {
        return res.status(500).json({ error: 'Contract has no full_text stored — reinstall the contract.' });
      }

      const systemPrompt = 'You are an experienced labor-relations analyst advising the Company under a collective bargaining agreement. You read the full contract and answer scenario questions with precision — citing exact articles and sections, quoting the contract text verbatim in the relevant_articles list, and flagging any situation that likely requires outside counsel. You do not provide actual legal advice; you interpret the contract.';

      const userPrompt = `CONTRACT TITLE: ${contract.title}

FULL CONTRACT TEXT:
"""
${contract.full_text}
"""

SCENARIO:
"""
${scenarioText}
"""

Respond with ONLY valid JSON (no markdown, no commentary) in this exact shape:
{
  "summary": "One-sentence headline of what the contract allows/requires here.",
  "relevant_articles": [
    {"article": "Article roman numeral or name", "section": "Section N if applicable", "title": "Article title", "quote": "Exact verbatim quote from the contract text"}
  ],
  "analysis": "Plain-English explanation in 2-4 short paragraphs.",
  "recommended_action": "What the Company should do, as a numbered or bulleted list of steps.",
  "required_process": "Procedural requirements the Company must follow (grievance procedure, steward notification, documentation, notice periods, etc.).",
  "risks": ["Concrete risks or exposure points for the Company."],
  "timing": "Any deadlines, time limits, or notice periods that apply. Null if none.",
  "escalation_flag": "If this situation likely requires actual legal counsel (termination with discrimination/retaliation angles, mass layoff, threatened strike, arbitration with high stakes, etc.), state so and why. Null if not applicable.",
  "confidence": "high | medium | low"
}

Rules:
- relevant_articles quotes MUST be verbatim from the contract — no paraphrasing, no ellipses inside the quote. Multiple short quotes better than one long paraphrase.
- If the scenario is not addressed by the contract, say so in summary + analysis; relevant_articles may be empty.
- Default toward the grievance procedure when a dispute with an employee could arise.
- Write for a non-lawyer small-business owner. Clear, actionable, short paragraphs.
- Confidence: "high" if the contract has explicit language on point; "medium" if inference is required; "low" if the contract is silent or ambiguous.`;

      const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
      let msg;
      try {
        msg = await client.messages.create({
          model: 'claude-sonnet-4-6',
          max_tokens: 4000,
          system: systemPrompt,
          messages: [{ role: 'user', content: userPrompt }]
        });
      } catch (e) {
        // Surface the real Anthropic error so Cooper can see what failed
        // (bad api key, model not found, rate limit, etc.).
        console.error('[contracts] Anthropic call failed:', e && e.message, e && e.status, e && e.error);
        var detail = e && (e.message || JSON.stringify(e.error || {})) || 'unknown';
        return res.status(500).json({
          error: 'Claude call failed: ' + detail,
          anthropic_status: (e && e.status) || null
        });
      }
      const raw = (msg.content || []).filter(c => c.type === 'text').map(c => c.text).join('\n').trim()
        .replace(/^```json?\n?/, '').replace(/\n?```$/, '').trim();
      let parsed;
      try { parsed = JSON.parse(raw); }
      catch (e) {
        console.error('[contracts] JSON parse failed. Raw head:', raw.slice(0, 300));
        return res.status(500).json({ error: 'AI response not JSON', raw: raw.slice(0, 600) });
      }

      // Save the consultation so it shows up in the log.
      let saved_id = null;
      try {
        const [saved] = await sql`
          INSERT INTO hr_consultations (company_id, contract_id, user_id, username, scenario, response)
          VALUES (${companyId}, ${contract.id}, ${String(user.user_id || '')}, ${user.username || null},
                  ${scenarioText}, ${JSON.stringify(parsed)}::jsonb)
          RETURNING id
        `;
        saved_id = saved.id;
      } catch (e) {
        console.error('[contracts] consultation save failed:', e.message);
      }

      await logAudit(sql, req, user, {
        action: 'contracts.ask_lawyer',
        resource_type: 'consultation', resource_id: saved_id,
        details: {
          scenario_preview: scenarioText.slice(0, 200),
          escalation_flag: !!parsed.escalation_flag,
          confidence: parsed.confidence
        }
      });

      return res.json({ ok: true, consultation_id: saved_id, response: parsed });
    }

    // ── GET get_consultations ───────────────────────────────────────────
    if (req.method === 'GET' && action === 'get_consultations') {
      if (!perms.canPerform(user, 'contracts', 'view')) return perms.deny(res, user, 'contracts', 'view');
      const limit = Math.min(parseInt(url.searchParams.get('limit') || '100', 10), 500);
      const rows = await sql`
        SELECT id, contract_id, username, scenario, response, created_at
        FROM hr_consultations
        WHERE company_id = ${companyId}
        ORDER BY created_at DESC
        LIMIT ${limit}
      `;
      return res.json({ ok: true, consultations: rows });
    }

    // ── POST delete_consultation ────────────────────────────────────────
    if (req.method === 'POST' && action === 'delete_consultation') {
      if (!perms.canPerform(user, 'contracts', 'delete')) return perms.deny(res, user, 'contracts', 'delete');
      const id = (req.body && req.body.id) || null;
      if (!id) return res.status(400).json({ error: 'id required' });
      await sql`DELETE FROM hr_consultations WHERE id = ${id} AND company_id = ${companyId}`;
      await logAudit(sql, req, user, {
        action: 'contracts.delete_consultation',
        resource_type: 'consultation', resource_id: id
      });
      return res.json({ ok: true });
    }

    return res.status(400).json({ error: 'Unknown action: ' + action });
  } catch (err) {
    console.error('[contracts] error:', err && err.stack ? err.stack : err);
    return res.status(500).json({
      error: 'Server error: ' + ((err && err.message) || 'unknown'),
      name: err && err.name
    });
  }
};
