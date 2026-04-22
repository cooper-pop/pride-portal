const { neon } = require('@neondatabase/serverless');
const jwt = require('jsonwebtoken');
const Anthropic = require('@anthropic-ai/sdk');
const cloudinary = require('cloudinary').v2;
const { PDFDocument } = require('pdf-lib');

// Anthropic's document API caps at 100 pages per PDF. Anything bigger has to be split,
// or the request fails with "exceeds maximum page count". We split into 95-page chunks
// and offset the reported page_number so the UI still jumps to the correct full-document page.
const EXTRACTION_PROMPT = `You are extracting part numbers from a maintenance or parts manual for industrial machinery at a catfish processing facility. Return ONLY valid JSON (no markdown, no commentary) in this exact shape:
{"parts":[{"part_number":"ABC-123","description":"Short description if clearly shown","page_number":5}]}

Rules:
- Only extract part numbers from the parts list / bill of materials / exploded diagram section
- Ignore part numbers embedded in procedure text, page footers, revision stamps, section numbers
- Do NOT invent or guess part numbers
- Include manufacturer OEM numbers, cross-ref numbers, and internal SKUs when clearly labeled
- Description is optional — use the label/name next to the part number, keep it under 60 chars
- page_number is the 1-indexed PDF page where the part's exploded diagram / picture / primary listing appears. If a part appears on multiple pages, pick the page that shows its picture. Use null if you cannot determine a page.
- If this document has no parts list, return {"parts":[]}
- Return every unique part number (deduplicate identical ones, keeping the first occurrence)`;

async function extractPartsFromPdfBuffer(client, buffer) {
  // Load the source PDF so we can count pages and split if needed
  let srcPdf;
  try {
    srcPdf = await PDFDocument.load(buffer, { ignoreEncryption: true });
  } catch (e) {
    throw new Error('PDF parse failed: ' + e.message);
  }
  const totalPages = srcPdf.getPageCount();
  const MAX = 95; // leave a small buffer under Anthropic's 100-page cap
  const chunks = [];
  if (totalPages <= MAX) {
    chunks.push({ offset: 0, pageCount: totalPages, buffer });
  } else {
    for (let start = 0; start < totalPages; start += MAX) {
      const end = Math.min(start + MAX, totalPages);
      const chunkDoc = await PDFDocument.create();
      const indices = [];
      for (let i = start; i < end; i++) indices.push(i);
      const pages = await chunkDoc.copyPages(srcPdf, indices);
      pages.forEach(p => chunkDoc.addPage(p));
      const bytes = await chunkDoc.save();
      chunks.push({ offset: start, pageCount: end - start, buffer: Buffer.from(bytes) });
    }
  }

  const allParts = [];
  const seenKeys = new Set();
  const chunkErrors = [];
  for (let idx = 0; idx < chunks.length; idx++) {
    const chunk = chunks[idx];
    const b64 = chunk.buffer.toString('base64');
    const chunkEnd = chunk.offset + chunk.pageCount;
    const chunkPrompt = chunks.length > 1
      ? EXTRACTION_PROMPT + `\n\nIMPORTANT: This PDF chunk is pages ${chunk.offset + 1}–${chunkEnd} of a larger ${totalPages}-page document. When you report page_number, give the page number WITHIN THIS CHUNK (1-indexed from 1 to ${chunk.pageCount}). The server will add the chunk offset to get the full-document page number.`
      : EXTRACTION_PROMPT;
    try {
      const msg = await client.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 8000,
        messages: [{ role: 'user', content: [
          { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: b64 } },
          { type: 'text', text: chunkPrompt }
        ]}]
      });
      const raw = msg.content[0].text.trim().replace(/^```json?\n?/, '').replace(/\n?```$/, '');
      const parsed = JSON.parse(raw);
      const parts = Array.isArray(parsed.parts) ? parsed.parts : [];
      for (const p of parts) {
        const pn = String(p.part_number || '').trim();
        if (!pn) continue;
        const key = pn.toLowerCase();
        if (seenKeys.has(key)) continue;
        seenKeys.add(key);
        // Offset the reported page_number into full-document coordinates
        let pg = parseInt(p.page_number);
        if (Number.isFinite(pg)) pg = pg + chunk.offset;
        else pg = null;
        allParts.push({
          part_number: pn,
          description: String(p.description || '').trim(),
          page_number: pg
        });
      }
    } catch (err) {
      console.error(`Chunk ${idx + 1}/${chunks.length} (offset ${chunk.offset}) failed:`, err.message);
      chunkErrors.push(`chunk ${idx + 1}: ${err.message}`);
    }
  }
  return { parts: allParts, totalPages, chunkCount: chunks.length, chunkErrors };
}

function configureCloudinary() {
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
    secure: true
  });
}

// Seed parts_inventory with zero-qty / zero-cost rows for every NEW part number
// discovered from a manual. Existing rows are left untouched so user-adjusted
// qty / cost is preserved. Invoice imports later fill in the real cost via their
// own upsert path (which matches on part_number).
async function seedInventoryFromManualParts(sql, parts, companyId, machineTag, manualTitle) {
  let seeded = 0;
  const seen = new Set();
  for (const p of (parts || [])) {
    const pn = String(p.part_number || '').trim();
    if (!pn) continue;
    const key = pn.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    try {
      const existing = await sql`SELECT id FROM parts_inventory
        WHERE company_id = ${companyId} AND LOWER(part_number) = LOWER(${pn}) LIMIT 1`;
      if (existing.length > 0) continue;
      const desc = String(p.description || '').trim().slice(0, 200) || ('From ' + manualTitle);
      await sql`INSERT INTO parts_inventory
        (company_id, part_number, description, quantity, min_quantity, unit_cost, avg_cost, total_value, machine_tag, notes)
        VALUES (${companyId}, ${pn}, ${desc}, 0, 0, 0, 0, 0, ${machineTag || ''}, ${'From manual: ' + manualTitle})`;
      seeded++;
    } catch (e) {
      // Don't abort the whole seed pass on one failure — just log and move on
      console.error('seedInventoryFromManualParts failed for', pn, e.message);
    }
  }
  return seeded;
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
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
  const action = req.query.action;
  const body = req.body || {};

  try {
    if (action === 'get_manuals') {
      const rows = await sql`
        SELECT id, title, machine_tag, file_url, cloudinary_public_id,
               file_size_bytes, filename, notes, part_count,
               created_at, updated_at
        FROM parts_manuals
        WHERE company_id = ${company_id}
        ORDER BY created_at DESC`;
      return res.json(rows);
    }

    if (action === 'get_manual_parts') {
      const { manual_id } = body;
      if (!manual_id) return res.status(400).json({ error: 'Missing manual_id' });
      const rows = await sql`SELECT id, part_number, description, machine_tag, page_number
        FROM manual_part_index
        WHERE manual_id = ${manual_id} AND company_id = ${company_id}
        ORDER BY part_number`;
      return res.json(rows);
    }

    if (action === 'get_upload_signature') {
      if (!process.env.CLOUDINARY_CLOUD_NAME || !process.env.CLOUDINARY_API_KEY || !process.env.CLOUDINARY_API_SECRET) {
        return res.status(500).json({ error: 'Cloudinary env vars missing' });
      }
      configureCloudinary();
      const folder = 'parts-manuals';
      const timestamp = Math.round(Date.now() / 1000);
      const paramsToSign = { timestamp, folder };
      const signature = cloudinary.utils.api_sign_request(paramsToSign, process.env.CLOUDINARY_API_SECRET);
      return res.json({
        signature,
        timestamp,
        folder,
        api_key: process.env.CLOUDINARY_API_KEY,
        cloud_name: process.env.CLOUDINARY_CLOUD_NAME
      });
    }

    if (action === 'save_manual_record') {
      const { title, machine_tag, file_url, cloudinary_public_id, file_size_bytes, filename, notes } = body;
      if (!title || !String(title).trim()) return res.status(400).json({ error: 'Title required' });

      // Save record first so a slow/failed extraction doesn't lose the upload
      const [manual] = await sql`
        INSERT INTO parts_manuals
          (company_id, title, machine_tag, file_url, cloudinary_public_id, file_size_bytes, filename, notes, part_count)
        VALUES (${company_id}, ${String(title).trim()}, ${machine_tag || ''},
                ${file_url || ''}, ${cloudinary_public_id || ''}, ${file_size_bytes || 0},
                ${filename || ''}, ${notes || ''}, 0)
        RETURNING *`;

      // If no file_url, nothing to extract; return metadata-only record
      if (!file_url) return res.json({ ok: true, manual, extracted_count: 0 });

      // Extract part numbers via Claude document API (fetch the PDF from Cloudinary).
      // Uses the chunking helper so PDFs over Anthropic's 100-page cap still work.
      let extractedParts = [];
      let extractionError = null;
      let extractionMeta = null;
      try {
        const fetchResp = await fetch(file_url);
        if (!fetchResp.ok) throw new Error('PDF fetch failed: ' + fetchResp.status);
        const buffer = Buffer.from(await fetchResp.arrayBuffer());
        const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
        const result = await extractPartsFromPdfBuffer(client, buffer);
        extractedParts = result.parts;
        extractionMeta = { totalPages: result.totalPages, chunkCount: result.chunkCount };
        if (result.chunkErrors.length > 0) {
          extractionError = result.chunkErrors.join('; ');
        }
      } catch (err) {
        console.error('Manual extract error:', err);
        extractionError = err.message;
      }

      // Insert extracted parts (deduped)
      let inventorySeeded = 0;
      if (extractedParts.length > 0) {
        const seen = new Set();
        for (const p of extractedParts) {
          const pn = String(p.part_number || '').trim();
          if (!pn) continue;
          const key = pn.toLowerCase();
          if (seen.has(key)) continue;
          seen.add(key);
          const desc = String(p.description || '').trim().slice(0, 200);
          const pg = Number.isFinite(parseInt(p.page_number)) ? parseInt(p.page_number) : null;
          await sql`INSERT INTO manual_part_index (manual_id, company_id, part_number, description, machine_tag, page_number)
            VALUES (${manual.id}, ${company_id}, ${pn}, ${desc}, ${machine_tag || ''}, ${pg})`;
        }
        await sql`UPDATE parts_manuals SET part_count = ${seen.size}, updated_at = NOW() WHERE id = ${manual.id}`;
        // Also seed the main parts_inventory so these show up as catalog rows (qty=0, $0.00)
        inventorySeeded = await seedInventoryFromManualParts(sql, extractedParts, company_id, machine_tag, String(title).trim());
      }

      return res.json({
        ok: true,
        manual,
        extracted_count: extractedParts.length,
        inventory_seeded: inventorySeeded,
        extraction_error: extractionError,
        total_pages: extractionMeta ? extractionMeta.totalPages : null,
        chunk_count: extractionMeta ? extractionMeta.chunkCount : null
      });
    }

    if (action === 'reindex_manual') {
      const { id } = body;
      if (!id) return res.status(400).json({ error: 'Missing id' });
      const rows = await sql`SELECT id, title, machine_tag, file_url FROM parts_manuals WHERE id = ${id} AND company_id = ${company_id} LIMIT 1`;
      if (!rows.length) return res.status(404).json({ error: 'Manual not found' });
      const manual = rows[0];
      if (!manual.file_url) return res.status(400).json({ error: 'Manual has no stored file to re-extract' });

      let extractedParts = [];
      let extractionMeta = null;
      let chunkErrorStr = '';
      try {
        const fetchResp = await fetch(manual.file_url);
        if (!fetchResp.ok) throw new Error('PDF fetch failed: ' + fetchResp.status);
        const buffer = Buffer.from(await fetchResp.arrayBuffer());
        const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
        const result = await extractPartsFromPdfBuffer(client, buffer);
        extractedParts = result.parts;
        extractionMeta = { totalPages: result.totalPages, chunkCount: result.chunkCount };
        if (result.chunkErrors.length > 0) chunkErrorStr = result.chunkErrors.join('; ');
      } catch (err) {
        console.error('Reindex extract error:', err);
        return res.status(500).json({ error: 'Reindex failed: ' + err.message });
      }

      await sql`DELETE FROM manual_part_index WHERE manual_id = ${id} AND company_id = ${company_id}`;
      const seen = new Set();
      for (const p of extractedParts) {
        const pn = String(p.part_number || '').trim();
        if (!pn) continue;
        const key = pn.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        const desc = String(p.description || '').trim().slice(0, 200);
        const pg = Number.isFinite(parseInt(p.page_number)) ? parseInt(p.page_number) : null;
        await sql`INSERT INTO manual_part_index (manual_id, company_id, part_number, description, machine_tag, page_number)
          VALUES (${id}, ${company_id}, ${pn}, ${desc}, ${manual.machine_tag || ''}, ${pg})`;
      }
      await sql`UPDATE parts_manuals SET part_count = ${seen.size}, updated_at = NOW() WHERE id = ${id}`;
      // Seed inventory with any NEW part numbers (never clobbers existing rows)
      const inventorySeeded = await seedInventoryFromManualParts(sql, extractedParts, company_id, manual.machine_tag, manual.title || '');
      return res.json({
        ok: true,
        extracted_count: seen.size,
        inventory_seeded: inventorySeeded,
        total_pages: extractionMeta ? extractionMeta.totalPages : null,
        chunk_count: extractionMeta ? extractionMeta.chunkCount : null,
        extraction_error: chunkErrorStr || null
      });
    }

    if (action === 'save_manual_metadata') {
      const { id, title, machine_tag, file_url, notes } = body;
      if (!id) return res.status(400).json({ error: 'Missing id' });
      const [m] = await sql`
        UPDATE parts_manuals SET
          title = ${String(title || '').trim()},
          machine_tag = ${machine_tag || ''},
          file_url = ${file_url || ''},
          notes = ${notes || ''},
          updated_at = NOW()
        WHERE id = ${id} AND company_id = ${company_id} RETURNING *`;
      await sql`UPDATE manual_part_index SET machine_tag = ${machine_tag || ''} WHERE manual_id = ${id} AND company_id = ${company_id}`;
      return res.json({ ok: true, manual: m });
    }

    if (action === 'get_download_url') {
      const pid = String(body.public_id || body.cloudinary_public_id || '').trim();
      if (!pid) return res.status(400).json({ error: 'public_id required' });
      if (!process.env.CLOUDINARY_CLOUD_NAME) return res.status(500).json({ error: 'Cloudinary not configured' });
      configureCloudinary();
      // Verify the user owns this manual (defense-in-depth)
      const owned = await sql`SELECT id FROM parts_manuals WHERE cloudinary_public_id = ${pid} AND company_id = ${company_id} LIMIT 1`;
      if (!owned.length) return res.status(404).json({ error: 'Not found' });
      const url = cloudinary.url(pid, {
        resource_type: 'raw',
        secure: true,
        sign_url: true,
        expires_at: Math.floor(Date.now() / 1000) + 3600
      });
      return res.json({ url });
    }

    if (action === 'delete_manual') {
      if (!body.id) return res.status(400).json({ error: 'Missing id' });
      // Look up cloudinary id before deleting the row
      const rows = await sql`SELECT cloudinary_public_id FROM parts_manuals WHERE id = ${body.id} AND company_id = ${company_id}`;
      const publicId = rows.length ? rows[0].cloudinary_public_id : null;
      await sql`DELETE FROM manual_part_index WHERE manual_id = ${body.id} AND company_id = ${company_id}`;
      await sql`DELETE FROM parts_manuals WHERE id = ${body.id} AND company_id = ${company_id}`;
      // Best-effort Cloudinary cleanup — don't fail the request if it errors
      if (publicId && process.env.CLOUDINARY_CLOUD_NAME) {
        try {
          configureCloudinary();
          await cloudinary.uploader.destroy(publicId, { resource_type: 'raw' });
        } catch (err) {
          console.error('Cloudinary destroy failed:', err);
        }
      }
      return res.json({ ok: true });
    }

    if (action === 'search_part') {
      const q = String(body.query || body.part_number || '').trim();
      if (!q) return res.json({ matches: [] });
      const like = '%' + q + '%';
      const rows = await sql`
        SELECT mpi.part_number, mpi.description, mpi.machine_tag, mpi.page_number,
               mpi.manual_id, pm.title AS manual_title,
               pm.file_url, pm.cloudinary_public_id
        FROM manual_part_index mpi
        LEFT JOIN parts_manuals pm ON pm.id = mpi.manual_id
        WHERE mpi.company_id = ${company_id}
          AND LOWER(mpi.part_number) LIKE LOWER(${like})
        ORDER BY mpi.part_number LIMIT 100`;
      return res.json({ matches: rows });
    }

    if (action === 'check_invoice_parts') {
      const { items, machine_tag } = body;
      const flags = [];
      if (!machine_tag || machine_tag === 'shop_stock') return res.json({ flags });
      for (const li of (items || [])) {
        const pn = String(li.part_number || '').trim();
        if (!pn) continue;
        const matches = await sql`
          SELECT DISTINCT mpi.machine_tag, pm.title AS manual_title
          FROM manual_part_index mpi
          LEFT JOIN parts_manuals pm ON pm.id = mpi.manual_id
          WHERE mpi.company_id = ${company_id}
            AND LOWER(mpi.part_number) = LOWER(${pn})
            AND mpi.machine_tag IS NOT NULL AND mpi.machine_tag <> ''`;
        if (!matches.length) continue;
        const matchesSelected = matches.some(m => String(m.machine_tag) === String(machine_tag));
        if (!matchesSelected) {
          flags.push({
            part_number: pn,
            description: String(li.description || li.item || '').trim(),
            expected_machine_tags: [...new Set(matches.map(m => m.machine_tag).filter(Boolean))]
          });
        }
      }
      return res.json({ flags });
    }

    return res.status(400).json({ error: 'Unknown action: ' + action });
  } catch (e) {
    console.error('Manuals API error:', e);
    return res.status(500).json({ error: 'Server error: ' + e.message });
  }
};
