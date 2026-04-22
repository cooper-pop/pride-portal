const { neon } = require('@neondatabase/serverless');
const jwt = require('jsonwebtoken');
const Anthropic = require('@anthropic-ai/sdk');
const { PDFDocument } = require('pdf-lib');

// Anthropic's document API caps at 100 pages. For troubleshooting we pass the first
// 100 pages (usually covers the TOC, operating principles, maintenance, and diagnostics).
// Users can narrow down via Reindex or specific manual selection later if that isn't enough.
async function fetchAndTrimManual(fileUrl) {
  const resp = await fetch(fileUrl);
  if (!resp.ok) throw new Error('Manual fetch failed: ' + resp.status);
  const buffer = Buffer.from(await resp.arrayBuffer());
  const src = await PDFDocument.load(buffer, { ignoreEncryption: true });
  const totalPages = src.getPageCount();
  if (totalPages <= 100) return { buffer, totalPages, trimmed: false };
  const dst = await PDFDocument.create();
  const indices = [];
  for (let i = 0; i < 100; i++) indices.push(i);
  const pages = await dst.copyPages(src, indices);
  pages.forEach(p => dst.addPage(p));
  const bytes = await dst.save();
  return { buffer: Buffer.from(bytes), totalPages, trimmed: true };
}

const SYSTEM_PROMPT = `You are a senior maintenance technician diagnosing problems on industrial machinery at a catfish processing facility. Your job is to help the user find the root cause quickly and safely.

You will be given:
1. The machine being diagnosed (make / model / name)
2. The user's symptom description
3. A PDF of the machine's parts/service manual (possibly truncated to the first 100 pages)
4. A list of parts currently in inventory for this machine
5. Access to a web_search tool for looking up service bulletins, failure modes, and community troubleshooting threads

Use the web_search tool when:
- The manual doesn't cover the specific symptom
- You want to confirm a common failure mode with other users of this machine
- You need current service bulletins or recall info

Do NOT use web search for:
- Re-confirming what the manual already clearly says
- Generic advice that doesn't reference this machine specifically

Return ONLY valid JSON (no markdown fences, no commentary). Schema:
{
  "summary": "1-3 sentence plain-English diagnosis",
  "safety_warnings": ["Lock out power before...", ...],
  "likely_causes": [
    {"cause": "Short cause description", "confidence": "high"|"medium"|"low", "reasoning": "why you think so"}
  ],
  "diagnostic_steps": [
    {"step": 1, "instruction": "What to check / do", "manual_page": 42, "expected_result": "What a healthy machine looks like here"}
  ],
  "parts_to_check": [
    {"part_number": "ABC-123", "name": "Name of part", "manual_page": 58, "reason": "Why this part is suspect"}
  ],
  "web_findings": [
    {"url": "https://...", "title": "Page title", "summary": "1-sentence takeaway"}
  ],
  "next_actions": ["If steps 1-3 clear the issue, you're done. Otherwise...", ...]
}

Rules:
- manual_page MUST be a real page number you saw in the attached PDF (1-indexed). Omit the field if you don't have a confident reference.
- part_number MUST appear in the manual's parts list OR in the inventory list provided. Do not invent part numbers.
- Put safety-critical checks (power, pressure, moving parts) at the top of diagnostic_steps.
- Keep every individual string under 300 characters. This is a field tool, not a textbook.
- If the symptoms are too vague to diagnose, put clarifying questions in next_actions like "Can you describe WHEN the noise happens — startup, under load, or always?"
- If you use web_search, cite the findings in web_findings. Every web_findings entry MUST have a real URL from the search results, not a guess.`;

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization,Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const auth = req.headers.authorization;
  if (!auth) return res.status(401).json({ error: 'Unauthorized' });

  let user_id, company_id;
  try {
    const p = jwt.verify(auth.replace('Bearer ', ''), process.env.JWT_SECRET);
    user_id = p.user_id;
    company_id = p.company_id;
  } catch (e) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const sql = neon(process.env.DATABASE_URL);
  const body = req.body || {};
  const action = req.query.action || 'diagnose';

  try {
    if (action !== 'diagnose') {
      return res.status(400).json({ error: 'Unknown action: ' + action });
    }

    const symptoms = String(body.symptoms || '').trim();
    if (!symptoms) return res.status(400).json({ error: 'Please describe the symptoms you are seeing.' });
    const machine_tag = String(body.machine_tag || '').trim();
    const manual_id = String(body.manual_id || '').trim();

    // Look up machine info
    let machineLabel = 'the machine';
    if (machine_tag && machine_tag !== 'shop_stock') {
      try {
        const mrows = await sql`SELECT name, make, model, year FROM parts_machines
          WHERE company_id = ${company_id} AND id = ${machine_tag} LIMIT 1`;
        if (mrows.length) {
          const m = mrows[0];
          machineLabel = [m.name, m.make, m.model, m.year].filter(Boolean).join(' ').trim() || 'the machine';
        }
      } catch (e) { /* table may not exist yet; fall through with default label */ }
    }

    // Pick manual(s): if manual_id supplied, use just that; otherwise pull all manuals
    // tagged to this machine (up to 2, prefer most recently updated).
    let manualRows = [];
    if (manual_id) {
      manualRows = await sql`SELECT id, title, file_url FROM parts_manuals
        WHERE company_id = ${company_id} AND id = ${manual_id} AND file_url <> '' LIMIT 1`;
    } else if (machine_tag) {
      manualRows = await sql`SELECT id, title, file_url FROM parts_manuals
        WHERE company_id = ${company_id} AND machine_tag = ${machine_tag} AND file_url <> ''
        ORDER BY updated_at DESC LIMIT 2`;
    }

    // Fetch + trim each manual PDF (first 100 pages each)
    const pdfAttachments = [];
    const manualRefs = [];
    for (const m of manualRows) {
      try {
        const pdf = await fetchAndTrimManual(m.file_url);
        pdfAttachments.push({
          type: 'document',
          source: { type: 'base64', media_type: 'application/pdf', data: pdf.buffer.toString('base64') }
        });
        manualRefs.push({ id: m.id, title: m.title, totalPages: pdf.totalPages, trimmed: pdf.trimmed });
      } catch (e) {
        console.error('Manual fetch/trim failed for', m.title, e.message);
      }
    }

    // Pull inventory context for this machine (what parts are on hand)
    let inventoryContext = 'No parts currently stocked for this machine.';
    try {
      const invRows = await sql`SELECT part_number, description, quantity, machine_tag
        FROM parts_inventory
        WHERE company_id = ${company_id}
          AND (machine_tag = ${machine_tag || ''} OR machine_tag = '')
        ORDER BY CASE WHEN machine_tag = ${machine_tag || ''} THEN 0 ELSE 1 END, part_number
        LIMIT 60`;
      if (invRows.length > 0) {
        inventoryContext = 'Parts in inventory (on-hand qty > 0 is ready to use):\n' +
          invRows.map(r => '  ' + r.part_number + ' — ' + (r.description || '').slice(0, 80) + ' (qty ' + r.quantity + ')').join('\n');
      }
    } catch (e) { /* fall through */ }

    // Build the user message: PDFs + situation
    const situation = [
      'Machine: ' + machineLabel,
      '',
      'Manual(s) attached: ' + (manualRefs.length === 0
        ? '(none — no manual on file for this machine; rely on web_search for this one)'
        : manualRefs.map(r => '  ' + r.title + (r.trimmed ? ' (first 100 of ' + r.totalPages + ' pages attached)' : '')).join('\n')),
      '',
      inventoryContext,
      '',
      'Symptoms reported by the maintenance staff:',
      symptoms,
      '',
      'Please diagnose.'
    ].join('\n');

    const content = [];
    for (const att of pdfAttachments) content.push(att);
    content.push({ type: 'text', text: situation });

    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const msg = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 8000,
      system: SYSTEM_PROMPT,
      tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 6 }],
      messages: [{ role: 'user', content }]
    });

    // Extract final text output. Web search produces tool_use + tool_result blocks; the
    // model's structured JSON response lives in a trailing text block.
    const text = (msg.content || []).filter(c => c.type === 'text').map(c => c.text).join('\n').trim();
    const cleaned = text.replace(/^```json?\n?/, '').replace(/\n?```$/, '').trim();

    let parsed;
    try { parsed = JSON.parse(cleaned); }
    catch (e) {
      // Best-effort JSON recovery: find the first { and last } and try that substring
      const first = cleaned.indexOf('{');
      const last = cleaned.lastIndexOf('}');
      if (first >= 0 && last > first) {
        try { parsed = JSON.parse(cleaned.substring(first, last + 1)); }
        catch (e2) {
          return res.status(500).json({
            error: 'AI response not valid JSON',
            raw: cleaned.slice(0, 800),
            manual_refs: manualRefs
          });
        }
      } else {
        return res.status(500).json({
          error: 'AI response not valid JSON',
          raw: cleaned.slice(0, 800),
          manual_refs: manualRefs
        });
      }
    }

    return res.json({
      ok: true,
      machine_label: machineLabel,
      manual_refs: manualRefs,
      diagnosis: parsed,
      usage: msg.usage || null
    });
  } catch (err) {
    console.error('Troubleshoot error:', err);
    return res.status(500).json({ error: 'Troubleshoot failed: ' + (err && err.message ? err.message : String(err)) });
  }
};
