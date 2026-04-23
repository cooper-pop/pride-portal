const { neon } = require('@neondatabase/serverless');
const Anthropic = require('@anthropic-ai/sdk');
const cloudinary = require('cloudinary').v2;
const { PDFDocument } = require('pdf-lib');
const perms = require('./_permissions');
const { logAudit } = require('./_audit');
let waitUntil;
try { waitUntil = require('@vercel/functions').waitUntil; }
catch (e) { waitUntil = (p) => p; }

// ═══════════════════════════════════════════════════════════════════════════
// Contract Bids API
// Upload vendor agreements / proposals / quotes → AI extracts structured
// data (pricing, terms, fine print, red flags) → side-by-side comparison
// within a category → AI-drafted negotiation emails referencing concrete
// competitor terms.
//
// Reuses the manuals pipeline: Cloudinary direct upload, waitUntil-based
// async extraction with progress logged to the DB, pdf-lib chunking for
// long PDFs, JSON-truncation salvage.
// ═══════════════════════════════════════════════════════════════════════════

const DOC_TYPES = new Set(['current_agreement', 'proposal', 'counter_offer', 'other']);

const EXTRACTION_PROMPT = `You are extracting structured data from a vendor contract, proposal, or quote for a catfish processing facility. The document might be an insurance policy, service agreement, supply contract, uniform rental agreement, packaging bid, a price sheet, or any other B2B commercial document.

Return ONLY valid JSON (no markdown fences, no commentary) in this exact shape:
{
  "vendor_name": "",
  "document_type": "agreement | proposal | quote | counter_offer | other",
  "category_guess": "insurance | packaging | uniforms | supplies | services | waste_management | legal | other",
  "effective_date": "YYYY-MM-DD or null",
  "expiration_date": "YYYY-MM-DD or null",
  "contract_term": "e.g., '1 year', '3 years', 'month-to-month', 'evergreen'",
  "auto_renewal": "yes | no | null",
  "auto_renewal_details": "fine-print on auto-renewal — term length, notice window, price changes",
  "cancellation_terms": "what the customer must do to cancel",
  "notice_required": "e.g., '30 days written notice'",
  "price_summary": "one-line pricing summary, e.g., '$14,500/year' or 'varies per item'",
  "pricing_details": [
    {"item": "item or line description", "unit": "per year/month/unit/etc", "price": "$X or percentage"}
  ],
  "payment_terms": "net 30 / net 60 / monthly / annual / etc",
  "key_benefits": ["what's included / favorable about this offer"],
  "key_exclusions": ["what's explicitly NOT covered / excluded"],
  "key_concerns": ["fine print to watch — penalties, gotchas, unusual clauses"],
  "red_flags": ["clearly unfavorable or risky items"],
  "strengths": ["clearly favorable items"],
  "coverage_limits": [
    {"type": "e.g., general liability", "limit": "e.g., $1M per occurrence / $2M aggregate"}
  ],
  "deductibles": "string or null — insurance only",
  "liability_limits": "string or null",
  "price_escalation": "e.g., '3% annual CPI increase' or 'none noted'",
  "delivery_lead_time": "string or null — goods/supplies only",
  "minimum_order": "MOQ if applicable",
  "freight_terms": "e.g., FOB origin / FOB destination / freight prepaid",
  "warranty": "warranty terms if applicable",
  "key_contacts": [
    {"name": "", "title": "", "email": "", "phone": ""}
  ],
  "executive_summary": "3-4 sentence plain-English summary",
  "comparison_notes": "what makes this offering distinctive — useful for comparing vs other vendors"
}

Rules:
- Use null for fields you cannot find in the document
- Use "not specified" for fields the document is silent on (vs. null when the field doesn't apply)
- For array fields, use [] when empty — never omit the field
- Be exact with numbers, dates, and dollar amounts — do NOT round or summarize
- "red_flags" and "key_concerns" are critical — surface anything the buyer would want to know about but might miss in fine print
- "strengths" should be real differentiators, not generic marketing copy
- Keep every individual string under 400 characters
- Bullet items should be 1-2 sentences each
- Do not invent information — if it's not in the document, use null
- For scanned / OCR'd PDFs, do your best but don't guess at unclear numbers`;

function salvageTruncatedJson(raw) {
  if (!raw || typeof raw !== 'string') return null;
  const first = raw.indexOf('{');
  if (first < 0) return null;
  let depth = 0, inString = false, escape = false, lastGoodEnd = -1;
  for (let i = first; i < raw.length; i++) {
    const ch = raw[i];
    if (escape) { escape = false; continue; }
    if (inString) {
      if (ch === '\\') escape = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{') depth++;
    else if (ch === '}') { depth--; if (depth === 0) lastGoodEnd = i; }
  }
  if (lastGoodEnd < 0) return null;
  try { return JSON.parse(raw.slice(first, lastGoodEnd + 1)); }
  catch (e) { return null; }
}

async function fetchAndMaybeTrim(fileUrl) {
  const resp = await fetch(fileUrl);
  if (!resp.ok) throw new Error('PDF fetch failed: ' + resp.status);
  const buffer = Buffer.from(await resp.arrayBuffer());
  // If it's under Anthropic's 100-page cap we don't need to touch it.
  try {
    const src = await PDFDocument.load(buffer, { ignoreEncryption: true });
    const totalPages = src.getPageCount();
    if (totalPages <= 95) return { buffer, totalPages, trimmed: false };
    // For oversized contracts, trim to first 95 pages. Most commercial docs fit in 95,
    // and contract appendices (schedules, forms) past page 100 rarely change the headline
    // terms — user can re-upload a trimmed copy if they need coverage past that.
    const dst = await PDFDocument.create();
    const indices = [];
    for (let i = 0; i < 95; i++) indices.push(i);
    const pages = await dst.copyPages(src, indices);
    pages.forEach(p => dst.addPage(p));
    const bytes = await dst.save();
    return { buffer: Buffer.from(bytes), totalPages, trimmed: true };
  } catch (e) {
    // If pdf-lib can't parse it (unusual PDF), just send the original and let Anthropic try.
    return { buffer, totalPages: null, trimmed: false };
  }
}

async function writeDocStatus(sql, companyId, docId, status, logLine) {
  try {
    const stamped = new Date().toISOString() + ' ' + logLine;
    await sql`UPDATE bid_documents SET
      extraction_status = ${status},
      extraction_log = COALESCE(extraction_log, '') || ${stamped + '\n'},
      updated_at = NOW()
      WHERE id = ${docId} AND company_id = ${companyId}`;
  } catch (e) {
    console.error('writeDocStatus failed:', e.message);
  }
}

async function runBidExtractionInBackground({ sql, companyId, docId, fileUrl, title }) {
  const progress = (line) => writeDocStatus(sql, companyId, docId, 'processing', line);
  try {
    await progress('fetching PDF: ' + (fileUrl || '').slice(0, 80));
    const { buffer, totalPages, trimmed } = await fetchAndMaybeTrim(fileUrl);
    await progress('pdf loaded: ' + (totalPages || '?') + ' pages, ' + buffer.length + ' bytes' + (trimmed ? ' (trimmed to first 95 pages)' : ''));
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const b64 = buffer.toString('base64');
    await progress('calling Anthropic for extraction...');
    const t0 = Date.now();
    const msg = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 16000,
      messages: [{ role: 'user', content: [
        { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: b64 } },
        { type: 'text', text: EXTRACTION_PROMPT }
      ]}]
    });
    const raw = (msg.content || []).filter(c => c.type === 'text').map(c => c.text).join('\n').trim()
      .replace(/^```json?\n?/, '').replace(/\n?```$/, '').trim();
    let parsed;
    let salvaged = false;
    try { parsed = JSON.parse(raw); }
    catch (parseErr) {
      parsed = salvageTruncatedJson(raw);
      if (!parsed) throw new Error('AI response not valid JSON: ' + parseErr.message);
      salvaged = true;
    }
    await progress('anthropic ok (' + ((Date.now() - t0) / 1000).toFixed(1) + 's)' + (salvaged ? ' [JSON salvaged from truncated response]' : ''));
    // Persist extracted data
    await sql`UPDATE bid_documents SET
      extracted_data = ${JSON.stringify(parsed)}::jsonb,
      updated_at = NOW()
      WHERE id = ${docId} AND company_id = ${companyId}`;
    const summary = 'EXTRACTION DONE: ' + (parsed.vendor_name || 'vendor not detected')
      + (parsed.price_summary ? ' · ' + parsed.price_summary : '')
      + (parsed.red_flags && parsed.red_flags.length ? ' · ' + parsed.red_flags.length + ' red flag' + (parsed.red_flags.length === 1 ? '' : 's') : '');
    await writeDocStatus(sql, companyId, docId, 'done', summary);
  } catch (err) {
    console.error('Bid extraction failed:', err);
    await writeDocStatus(sql, companyId, docId, 'failed', 'EXTRACTION FAILED: ' + (err && err.message ? err.message : String(err)));
  }
}

async function ensureTables(sql) {
  await sql`CREATE TABLE IF NOT EXISTS bid_categories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id INT NOT NULL,
    name TEXT NOT NULL,
    description TEXT DEFAULT '',
    notes TEXT DEFAULT '',
    archived BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
  )`;
  await sql`CREATE INDEX IF NOT EXISTS idx_bid_categories_co ON bid_categories(company_id) WHERE archived = false`;

  await sql`CREATE TABLE IF NOT EXISTS bid_vendors (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id INT NOT NULL,
    name TEXT NOT NULL,
    contact_name TEXT DEFAULT '',
    contact_email TEXT DEFAULT '',
    phone TEXT DEFAULT '',
    website TEXT DEFAULT '',
    notes TEXT DEFAULT '',
    archived BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
  )`;
  await sql`CREATE INDEX IF NOT EXISTS idx_bid_vendors_co ON bid_vendors(company_id) WHERE archived = false`;

  await sql`CREATE TABLE IF NOT EXISTS bid_documents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id INT NOT NULL,
    category_id UUID,
    vendor_id UUID,
    title TEXT DEFAULT '',
    doc_type TEXT DEFAULT 'proposal',
    file_url TEXT DEFAULT '',
    cloudinary_public_id TEXT DEFAULT '',
    file_size_bytes BIGINT DEFAULT 0,
    filename TEXT DEFAULT '',
    extracted_data JSONB DEFAULT '{}'::jsonb,
    extraction_status TEXT DEFAULT 'pending',
    extraction_log TEXT DEFAULT '',
    is_current_agreement BOOLEAN DEFAULT false,
    notes TEXT DEFAULT '',
    archived BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
  )`;
  await sql`CREATE INDEX IF NOT EXISTS idx_bid_documents_co ON bid_documents(company_id, category_id) WHERE archived = false`;
  await sql`CREATE INDEX IF NOT EXISTS idx_bid_documents_vendor ON bid_documents(company_id, vendor_id) WHERE archived = false`;
}

function configureCloudinary() {
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
    secure: true
  });
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization,Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // All Contract Bids endpoints require manager or admin — supervisors have
  // no visibility into Financial-category data.
  const user = perms.requireAccess(req, res, 'bids', 'view');
  if (!user) return;
  const { user_id, company_id } = user;

  const sql = neon(process.env.DATABASE_URL);
  const action = req.query.action;
  const body = req.body || {};

  try {
    await ensureTables(sql);
    // Per-action role gate — delete requires an explicit delete perm,
    // save_* is create vs edit depending on whether body.id is set.
    if (action === 'delete_category' || action === 'delete_vendor' || action === 'delete_document') {
      if (!perms.canPerform(user, 'bids', 'delete')) return perms.deny(res, user, 'bids', 'delete');
    } else if (action === 'save_category' || action === 'save_vendor' ||
               action === 'save_document' || action === 'reindex_document' ||
               action === 'update_document_meta' || action === 'generate_negotiation_email') {
      const act = perms.actionForSave(body);
      if (!perms.canPerform(user, 'bids', act)) return perms.deny(res, user, 'bids', act);
    }

    // ─── READ ────────────────────────────────────────────────────────────────
    if (action === 'get_state') {
      const [categories, vendors, documents] = await Promise.all([
        sql`SELECT id, name, description, notes FROM bid_categories
            WHERE company_id = ${company_id} AND archived = false ORDER BY name`,
        sql`SELECT id, name, contact_name, contact_email, phone, website, notes
            FROM bid_vendors WHERE company_id = ${company_id} AND archived = false ORDER BY name`,
        sql`SELECT id, category_id, vendor_id, title, doc_type, file_url, cloudinary_public_id,
                   file_size_bytes, filename, extracted_data, extraction_status,
                   is_current_agreement, notes, created_at, updated_at
            FROM bid_documents WHERE company_id = ${company_id} AND archived = false
            ORDER BY created_at DESC`
      ]);
      return res.json({ categories, vendors, documents });
    }

    if (action === 'get_document_status') {
      const id = String(body.id || req.query.id || '').trim();
      if (!id) return res.status(400).json({ error: 'id required' });
      const rows = await sql`SELECT id, title, extraction_status, extraction_log, extracted_data, updated_at
        FROM bid_documents WHERE id = ${id} AND company_id = ${company_id} LIMIT 1`;
      if (!rows.length) return res.status(404).json({ error: 'Not found' });
      return res.json(rows[0]);
    }

    if (action === 'get_upload_signature') {
      if (!process.env.CLOUDINARY_CLOUD_NAME || !process.env.CLOUDINARY_API_KEY || !process.env.CLOUDINARY_API_SECRET) {
        return res.status(500).json({ error: 'Cloudinary env vars missing' });
      }
      configureCloudinary();
      const folder = 'bid-documents';
      const timestamp = Math.round(Date.now() / 1000);
      const paramsToSign = { timestamp, folder };
      const signature = cloudinary.utils.api_sign_request(paramsToSign, process.env.CLOUDINARY_API_SECRET);
      return res.json({
        signature, timestamp, folder,
        api_key: process.env.CLOUDINARY_API_KEY,
        cloud_name: process.env.CLOUDINARY_CLOUD_NAME
      });
    }

    if (action === 'get_document_download_url') {
      const pid = String(body.public_id || body.cloudinary_public_id || '').trim();
      if (!pid) return res.status(400).json({ error: 'public_id required' });
      if (!process.env.CLOUDINARY_CLOUD_NAME) return res.status(500).json({ error: 'Cloudinary not configured' });
      configureCloudinary();
      const owned = await sql`SELECT id FROM bid_documents WHERE cloudinary_public_id = ${pid} AND company_id = ${company_id} LIMIT 1`;
      if (!owned.length) return res.status(404).json({ error: 'Not found' });
      const url = cloudinary.url(pid, {
        resource_type: 'raw', secure: true, sign_url: true,
        expires_at: Math.floor(Date.now() / 1000) + 3600
      });
      return res.json({ url });
    }

    // ─── CATEGORIES CRUD ─────────────────────────────────────────────────────
    if (action === 'save_category') {
      const name = String(body.name || '').trim();
      if (!name) return res.status(400).json({ error: 'Name required' });
      if (body.id) {
        const [c] = await sql`UPDATE bid_categories
          SET name = ${name}, description = ${body.description || ''}, notes = ${body.notes || ''}, updated_at = NOW()
          WHERE id = ${body.id} AND company_id = ${company_id} RETURNING *`;
        await logAudit(sql, req, user, {
          action: 'bids.save_category',
          resource_type: 'bid_category',
          resource_id: (c && c.id) || body.id,
          details: { name: body.name, updated: !!body.id }
        });
        return res.json({ ok: true, category: c });
      }
      const [c] = await sql`INSERT INTO bid_categories (company_id, name, description, notes)
        VALUES (${company_id}, ${name}, ${body.description || ''}, ${body.notes || ''}) RETURNING *`;
      await logAudit(sql, req, user, {
        action: 'bids.save_category',
        resource_type: 'bid_category',
        resource_id: c && c.id,
        details: { name: body.name, updated: !!body.id }
      });
      return res.json({ ok: true, category: c });
    }
    if (action === 'delete_category') {
      if (!body.id) return res.status(400).json({ error: 'id required' });
      await sql`UPDATE bid_categories SET archived = true, updated_at = NOW()
        WHERE id = ${body.id} AND company_id = ${company_id}`;
      await logAudit(sql, req, user, {
        action: 'bids.delete_category',
        resource_type: 'bid_category',
        resource_id: body.id,
        details: {}
      });
      return res.json({ ok: true });
    }

    // ─── VENDORS CRUD ────────────────────────────────────────────────────────
    if (action === 'save_vendor') {
      const name = String(body.name || '').trim();
      if (!name) return res.status(400).json({ error: 'Name required' });
      const fields = {
        name,
        contact_name: body.contact_name || '',
        contact_email: body.contact_email || '',
        phone: body.phone || '',
        website: body.website || '',
        notes: body.notes || ''
      };
      if (body.id) {
        const [v] = await sql`UPDATE bid_vendors
          SET name = ${fields.name}, contact_name = ${fields.contact_name},
              contact_email = ${fields.contact_email}, phone = ${fields.phone},
              website = ${fields.website}, notes = ${fields.notes}, updated_at = NOW()
          WHERE id = ${body.id} AND company_id = ${company_id} RETURNING *`;
        await logAudit(sql, req, user, {
          action: 'bids.save_vendor',
          resource_type: 'bid_vendor',
          resource_id: (v && v.id) || body.id,
          details: { name: body.name, updated: !!body.id }
        });
        return res.json({ ok: true, vendor: v });
      }
      const [v] = await sql`INSERT INTO bid_vendors (company_id, name, contact_name, contact_email, phone, website, notes)
        VALUES (${company_id}, ${fields.name}, ${fields.contact_name}, ${fields.contact_email},
                ${fields.phone}, ${fields.website}, ${fields.notes}) RETURNING *`;
      await logAudit(sql, req, user, {
        action: 'bids.save_vendor',
        resource_type: 'bid_vendor',
        resource_id: v && v.id,
        details: { name: body.name, updated: !!body.id }
      });
      return res.json({ ok: true, vendor: v });
    }
    if (action === 'delete_vendor') {
      if (!body.id) return res.status(400).json({ error: 'id required' });
      await sql`UPDATE bid_vendors SET archived = true, updated_at = NOW()
        WHERE id = ${body.id} AND company_id = ${company_id}`;
      await logAudit(sql, req, user, {
        action: 'bids.delete_vendor',
        resource_type: 'bid_vendor',
        resource_id: body.id,
        details: {}
      });
      return res.json({ ok: true });
    }

    // ─── DOCUMENTS ───────────────────────────────────────────────────────────
    if (action === 'save_document') {
      const { title, category_id, vendor_id, doc_type, file_url, cloudinary_public_id,
              file_size_bytes, filename, is_current_agreement, notes } = body;
      if (!title || !String(title).trim()) return res.status(400).json({ error: 'Title required' });
      const dt = DOC_TYPES.has(doc_type) ? doc_type : 'other';
      const initialStatus = file_url ? 'pending' : 'none';

      const [doc] = await sql`INSERT INTO bid_documents
        (company_id, category_id, vendor_id, title, doc_type, file_url, cloudinary_public_id,
         file_size_bytes, filename, is_current_agreement, notes, extraction_status)
        VALUES (${company_id}, ${category_id || null}, ${vendor_id || null},
                ${String(title).trim()}, ${dt}, ${file_url || ''}, ${cloudinary_public_id || ''},
                ${file_size_bytes || 0}, ${filename || ''}, ${!!is_current_agreement},
                ${notes || ''}, ${initialStatus})
        RETURNING *`;

      // If it's marked as the current agreement, clear the flag on other docs
      // in the same category + vendor combo so only one can be "current" at a time.
      if (is_current_agreement && category_id && vendor_id) {
        await sql`UPDATE bid_documents SET is_current_agreement = false, updated_at = NOW()
          WHERE company_id = ${company_id} AND category_id = ${category_id} AND vendor_id = ${vendor_id}
            AND id <> ${doc.id} AND archived = false`;
      }

      const saveDocDetails = {};
      if (body.filename !== undefined) saveDocDetails.filename = body.filename;
      if (body.category_id !== undefined) saveDocDetails.category_id = body.category_id;
      if (body.vendor_id !== undefined) saveDocDetails.vendor_id = body.vendor_id;
      saveDocDetails.is_current_agreement = !!body.is_current_agreement;

      if (!file_url) {
        await logAudit(sql, req, user, {
          action: 'bids.save_document',
          resource_type: 'bid_document',
          resource_id: doc && doc.id,
          details: saveDocDetails
        });
        return res.json({ ok: true, document: doc, extraction_status: 'none' });
      }

      const bgPromise = runBidExtractionInBackground({
        sql, companyId: company_id, docId: doc.id,
        fileUrl: file_url, title: String(title).trim()
      });
      try { waitUntil(bgPromise); } catch (e) { /* local fallback */ }

      await logAudit(sql, req, user, {
        action: 'bids.save_document',
        resource_type: 'bid_document',
        resource_id: doc && doc.id,
        details: saveDocDetails
      });
      return res.json({ ok: true, document: doc, extraction_status: 'pending', poll_doc_id: doc.id });
    }

    if (action === 'reindex_document') {
      const id = String(body.id || '').trim();
      if (!id) return res.status(400).json({ error: 'id required' });
      const rows = await sql`SELECT id, title, file_url FROM bid_documents
        WHERE id = ${id} AND company_id = ${company_id} LIMIT 1`;
      if (!rows.length) return res.status(404).json({ error: 'Not found' });
      const doc = rows[0];
      if (!doc.file_url) return res.status(400).json({ error: 'Document has no stored file to re-extract' });
      await sql`UPDATE bid_documents SET extraction_status = 'pending', extraction_log = '',
        extracted_data = '{}'::jsonb, updated_at = NOW() WHERE id = ${id}`;
      const bgPromise = runBidExtractionInBackground({
        sql, companyId: company_id, docId: id, fileUrl: doc.file_url, title: doc.title || ''
      });
      try { waitUntil(bgPromise); } catch (e) { /* local fallback */ }
      await logAudit(sql, req, user, {
        action: 'bids.reindex_document',
        resource_type: 'bid_document',
        resource_id: id,
        details: {}
      });
      return res.json({ ok: true, extraction_status: 'pending', poll_doc_id: id });
    }

    if (action === 'update_document_meta') {
      const id = String(body.id || '').trim();
      if (!id) return res.status(400).json({ error: 'id required' });
      const dt = DOC_TYPES.has(body.doc_type) ? body.doc_type : 'other';
      const [doc] = await sql`UPDATE bid_documents SET
        title = ${String(body.title || '').trim()},
        category_id = ${body.category_id || null},
        vendor_id = ${body.vendor_id || null},
        doc_type = ${dt},
        is_current_agreement = ${!!body.is_current_agreement},
        notes = ${body.notes || ''},
        updated_at = NOW()
        WHERE id = ${id} AND company_id = ${company_id} RETURNING *`;
      if (body.is_current_agreement && doc.category_id && doc.vendor_id) {
        await sql`UPDATE bid_documents SET is_current_agreement = false, updated_at = NOW()
          WHERE company_id = ${company_id} AND category_id = ${doc.category_id}
            AND vendor_id = ${doc.vendor_id} AND id <> ${doc.id} AND archived = false`;
      }
      await logAudit(sql, req, user, {
        action: 'bids.update_document_meta',
        resource_type: 'bid_document',
        resource_id: id,
        details: {
          is_current_agreement: !!body.is_current_agreement,
          updated_fields: Object.keys(body).filter(k => k !== 'id' && k !== 'action')
        }
      });
      return res.json({ ok: true, document: doc });
    }

    if (action === 'delete_document') {
      const id = String(body.id || '').trim();
      if (!id) return res.status(400).json({ error: 'id required' });
      const rows = await sql`SELECT cloudinary_public_id FROM bid_documents
        WHERE id = ${id} AND company_id = ${company_id}`;
      const publicId = rows.length ? rows[0].cloudinary_public_id : null;
      await sql`UPDATE bid_documents SET archived = true, updated_at = NOW()
        WHERE id = ${id} AND company_id = ${company_id}`;
      // Best-effort Cloudinary cleanup
      if (publicId && process.env.CLOUDINARY_CLOUD_NAME) {
        try {
          configureCloudinary();
          await cloudinary.uploader.destroy(publicId, { resource_type: 'raw' });
        } catch (err) { console.error('Cloudinary destroy failed:', err); }
      }
      await logAudit(sql, req, user, {
        action: 'bids.delete_document',
        resource_type: 'bid_document',
        resource_id: id,
        details: {}
      });
      return res.json({ ok: true });
    }

    // ─── NEGOTIATION EMAIL GENERATOR ─────────────────────────────────────────
    // Given a target vendor + category, pulls that vendor's latest doc (the proposal),
    // the current agreement (if any) in that category, and competing proposals, and
    // asks Claude to draft a negotiation email.
    if (action === 'generate_negotiation_email') {
      const vendorId = String(body.vendor_id || '').trim();
      const categoryId = String(body.category_id || '').trim();
      const targetDocId = String(body.target_doc_id || '').trim();
      if (!vendorId || !categoryId) return res.status(400).json({ error: 'vendor_id and category_id required' });

      const [vendorRows, categoryRows] = await Promise.all([
        sql`SELECT name, contact_name, contact_email FROM bid_vendors
            WHERE id = ${vendorId} AND company_id = ${company_id} AND archived = false LIMIT 1`,
        sql`SELECT name FROM bid_categories
            WHERE id = ${categoryId} AND company_id = ${company_id} AND archived = false LIMIT 1`
      ]);
      if (!vendorRows.length) return res.status(404).json({ error: 'Vendor not found' });
      if (!categoryRows.length) return res.status(404).json({ error: 'Category not found' });
      const vendor = vendorRows[0];
      const category = categoryRows[0];

      // Target document = the vendor's most recent proposal in this category, or
      // an explicit one if the caller passed a target_doc_id.
      let targetDoc;
      if (targetDocId) {
        const r = await sql`SELECT id, title, doc_type, extracted_data, is_current_agreement
          FROM bid_documents WHERE id = ${targetDocId} AND company_id = ${company_id} LIMIT 1`;
        targetDoc = r.length ? r[0] : null;
      } else {
        const r = await sql`SELECT id, title, doc_type, extracted_data, is_current_agreement
          FROM bid_documents
          WHERE company_id = ${company_id} AND category_id = ${categoryId} AND vendor_id = ${vendorId}
            AND archived = false
          ORDER BY created_at DESC LIMIT 1`;
        targetDoc = r.length ? r[0] : null;
      }
      if (!targetDoc || !targetDoc.extracted_data) {
        return res.status(400).json({ error: 'No extracted proposal for this vendor in this category yet. Upload one first.' });
      }

      // Current agreement context: any doc flagged is_current_agreement = true in this category
      const currentAgreements = await sql`SELECT id, title, vendor_id, extracted_data
        FROM bid_documents
        WHERE company_id = ${company_id} AND category_id = ${categoryId}
          AND is_current_agreement = true AND archived = false`;

      // Competing proposals: other documents in the same category, not from this vendor
      const competingDocs = await sql`SELECT id, title, vendor_id, doc_type, extracted_data
        FROM bid_documents
        WHERE company_id = ${company_id} AND category_id = ${categoryId}
          AND vendor_id <> ${vendorId} AND archived = false
          AND extracted_data IS NOT NULL`;

      // Build the context for Claude. We pass everything as structured JSON plus a prompt.
      const context = {
        category: category.name,
        target_vendor: vendor.name,
        target_contact: {
          name: vendor.contact_name || null,
          email: vendor.contact_email || null
        },
        target_proposal: targetDoc.extracted_data,
        current_agreements: currentAgreements.map(d => d.extracted_data),
        competing_proposals: competingDocs.map(d => d.extracted_data)
      };

      const negotiationPrompt = `You are drafting a professional negotiation email from a catfish processing facility to a vendor who has submitted a ${category.name} proposal. You'll be given the target vendor's proposal, the buyer's current agreement in this category (if any), and competing proposals from other vendors.

Draft an email that:
1. Thanks the vendor for their proposal
2. Raises 3-6 specific negotiation points based on actual gaps between their proposal and either the current agreement or competing offers
3. References competitor pricing or terms WITHOUT revealing specific vendor names (say "another vendor", "one of your competitors", etc.)
4. Calls out any red flags or concerning fine print from their proposal
5. Makes a specific ask: revised proposal addressing these points by a reasonable date
6. Is friendly and professional but firm — the buyer has leverage

Return ONLY valid JSON:
{
  "subject": "Short, specific subject line",
  "body": "Plain text email body. 4-6 paragraphs. Address '${vendor.contact_name || 'the team'}' if a contact name is available, otherwise 'Hello'. Sign off as 'Cooper Battle, Pride of the Pond'.",
  "negotiation_points": [
    {"point": "short label", "justification": "1-sentence rationale for bringing this up"}
  ]
}

Context:\n` + JSON.stringify(context, null, 2);

      const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
      const msg = await client.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 4000,
        messages: [{ role: 'user', content: negotiationPrompt }]
      });
      const raw = (msg.content || []).filter(c => c.type === 'text').map(c => c.text).join('\n').trim()
        .replace(/^```json?\n?/, '').replace(/\n?```$/, '').trim();
      let parsed;
      try { parsed = JSON.parse(raw); }
      catch (e) {
        parsed = salvageTruncatedJson(raw);
        if (!parsed) return res.status(500).json({ error: 'AI response not JSON', raw: raw.slice(0, 500) });
      }
      return res.json({
        ok: true,
        email: parsed,
        vendor: vendor,
        category: category.name,
        has_current_agreement: currentAgreements.length > 0,
        competing_count: competingDocs.length
      });
    }

    // COMPARE VENDORS ──────────────────────────────────────────────────
    // AI-powered side-by-side comparison + recommendation across every
    // vendor's latest document in a category. Returns winner + reasons,
    // per-vendor scorecards, risks to discuss, and concrete next steps.
    //
    // Input: { category_id }
    // One document per vendor is used — the one flagged is_current_agreement
    // if any, else the most recent by created_at.
    if (action === 'compare_vendors') {
      const categoryId = String(body.category_id || '').trim();
      if (!categoryId) return res.status(400).json({ error: 'category_id required' });

      const [categoryRows] = await Promise.all([
        sql`SELECT name, description FROM bid_categories
            WHERE id = ${categoryId} AND company_id = ${company_id} AND archived = false LIMIT 1`
      ]);
      if (!categoryRows.length) return res.status(404).json({ error: 'Category not found' });
      const category = categoryRows[0];

      // One document per vendor in this category. DISTINCT ON (vendor_id)
      // with ORDER BY vendor, is_current_agreement DESC, created_at DESC
      // prefers the current agreement (if flagged), else the most recent doc.
      const docs = await sql`
        SELECT DISTINCT ON (d.vendor_id)
          d.id, d.title, d.doc_type, d.extracted_data, d.is_current_agreement,
          d.file_url, d.created_at,
          v.id AS vendor_id, v.name AS vendor_name,
          v.contact_name, v.contact_email
        FROM bid_documents d
        JOIN bid_vendors v ON v.id = d.vendor_id
        WHERE d.company_id = ${company_id}
          AND d.category_id = ${categoryId}
          AND d.archived = false
          AND v.archived = false
          AND d.extraction_status = 'done'
          AND d.extracted_data IS NOT NULL
        ORDER BY d.vendor_id, d.is_current_agreement DESC NULLS LAST, d.created_at DESC
      `;

      if (docs.length < 2) {
        return res.status(400).json({
          error: 'Need at least 2 vendors with extracted documents to compare.',
          have: docs.length
        });
      }

      // Build the structured payload. We pass Claude a stable vendor list
      // (with our internal vendor_id) plus each vendor's extracted data, so
      // the response can reference specific vendor_ids in its recommendation.
      const vendors = docs.map(d => ({
        vendor_id: d.vendor_id,
        vendor_name: d.vendor_name,
        doc_title: d.title,
        doc_type: d.doc_type,
        is_current_agreement: !!d.is_current_agreement,
        extracted: d.extracted_data
      }));

      const comparePrompt = `You are a commercial contract analyst for a catfish processing facility. You'll be given ${vendors.length} vendors' extracted contract/proposal data for the category "${category.name}".

Your job: decide which vendor offers the best overall value and explain why in terms a small-business owner can act on.

Consider:
- Total cost (annual, per-unit, total contract value) — weighted heavily
- Contract term length and renewal flexibility (month-to-month > multi-year auto-renew)
- Cancellation terms, notice required
- Coverage / scope / inclusions vs exclusions
- Red flags, gotchas, unfavorable fine print
- Warranty, lead time, service terms (for goods/services)
- Coverage limits, deductibles, liability (for insurance)
- Whether one is the "current agreement" — status quo has switching costs, so a new vendor must be meaningfully better to justify change
- Anything unique or distinctive ("comparison_notes")

Return ONLY valid JSON (no markdown, no commentary) in this exact shape:

{
  "category_name": "${category.name}",
  "compared_vendor_count": ${vendors.length},
  "recommendation": {
    "winner_vendor_id": "<vendor_id from the list>",
    "winner_vendor_name": "<vendor_name>",
    "confidence": "high | medium | low",
    "headline": "One sentence: why the winner is the best choice",
    "key_reasons": [
      "Concrete reason 1 — reference actual numbers/terms from their proposal",
      "Concrete reason 2",
      "Concrete reason 3"
    ]
  },
  "scorecards": [
    {
      "vendor_id": "<vendor_id>",
      "vendor_name": "<vendor_name>",
      "score": 1-10,
      "one_line_summary": "Single line characterizing this vendor's offer",
      "pros": ["1-2 concrete strengths"],
      "cons": ["1-2 concrete weaknesses"]
    }
  ],
  "side_by_side_highlights": [
    {
      "dimension": "e.g., Annual cost | Contract term | Liability limit",
      "values": [
        {"vendor_name": "<name>", "value": "<concrete value or 'not specified'>"}
      ],
      "note": "One-line takeaway comparing the values"
    }
  ],
  "risks_to_discuss": [
    "Risk/gotcha present in one or more proposals that should be negotiated or clarified"
  ],
  "recommended_next_steps": [
    "Concrete action: e.g., 'Ask Vendor X to match Vendor Y's 30-day cancellation notice'"
  ]
}

Rules:
- winner_vendor_id MUST match one of the vendor_id values in the input.
- scorecards must include EVERY vendor in the input, in the same order.
- side_by_side_highlights should surface 3-6 dimensions where the vendors genuinely differ. Skip dimensions where all vendors say the same thing.
- Be specific: quote actual dollar amounts, percentages, dates from the extracted_data.
- If data is missing for a vendor on a given dimension, say "not specified" rather than guessing.
- Keep every individual string under 300 characters. Keep lists short (2-4 items).
- confidence = "high" when the winner has clear numerical advantages; "medium" when trade-offs are real but one still comes out ahead; "low" when vendors are genuinely close or data is thin.

Input vendors:
` + JSON.stringify({ category: category.name, vendors }, null, 2);

      const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
      const msg = await client.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 4000,
        messages: [{ role: 'user', content: comparePrompt }]
      });
      const raw = (msg.content || []).filter(c => c.type === 'text').map(c => c.text).join('\n').trim()
        .replace(/^```json?\n?/, '').replace(/\n?```$/, '').trim();
      let parsed;
      try { parsed = JSON.parse(raw); }
      catch (e) {
        parsed = salvageTruncatedJson(raw);
        if (!parsed) return res.status(500).json({ error: 'AI response not JSON', raw: raw.slice(0, 500) });
      }

      // Audit log — AI comparison is a manager-level analysis action worth tracking
      await logAudit(sql, req, user, {
        action: 'bids.compare_vendors',
        resource_type: 'bid_category',
        resource_id: categoryId,
        details: {
          category: category.name,
          vendor_count: vendors.length,
          winner: parsed && parsed.recommendation ? parsed.recommendation.winner_vendor_name : null,
          confidence: parsed && parsed.recommendation ? parsed.recommendation.confidence : null
        }
      });

      return res.json({
        ok: true,
        comparison: parsed,
        category: category.name,
        vendor_count: vendors.length,
        // Echo the vendor list so the frontend can cross-reference ids
        vendors: vendors.map(v => ({ vendor_id: v.vendor_id, vendor_name: v.vendor_name }))
      });
    }

    return res.status(400).json({ error: 'Unknown action: ' + action });
  } catch (err) {
    console.error('Bids API error:', err);
    return res.status(500).json({ error: 'Server error: ' + err.message });
  }
};
