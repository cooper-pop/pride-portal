const { neon } = require('@neondatabase/serverless');
const jwt = require('jsonwebtoken');
const Anthropic = require('@anthropic-ai/sdk');

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
        SELECT pm.id, pm.title, pm.machine_tag, pm.file_url, pm.notes,
               pm.part_count, pm.created_at, pm.updated_at
        FROM parts_manuals pm
        WHERE pm.company_id = ${company_id}
        ORDER BY pm.created_at DESC`;
      return res.json(rows);
    }

    if (action === 'get_manual_parts') {
      const { manual_id } = body;
      if (!manual_id) return res.status(400).json({ error: 'Missing manual_id' });
      const rows = await sql`SELECT id, part_number, description, machine_tag
        FROM manual_part_index
        WHERE manual_id = ${manual_id} AND company_id = ${company_id}
        ORDER BY part_number`;
      return res.json(rows);
    }

    if (action === 'upload_manual') {
      const { title, machine_tag, file_base64, media_type, file_url, notes } = body;
      if (!title || !String(title).trim()) return res.status(400).json({ error: 'Title required' });

      // Extract parts via AI if a file was provided
      let extractedParts = [];
      if (file_base64) {
        const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
        const prompt = `You are extracting part numbers from a maintenance or parts manual for industrial machinery at a catfish processing facility. Return ONLY valid JSON (no markdown, no commentary) in this exact shape:\n{"parts":[{"part_number":"ABC-123","description":"Short description if clearly shown"}]}\n\nRules:\n- Only extract part numbers from the parts list / bill of materials / exploded diagram section\n- Ignore part numbers embedded in procedure text, page footers, revision stamps, section numbers\n- Do NOT invent or guess part numbers\n- Include manufacturer OEM numbers, cross-ref numbers, and internal SKUs when clearly labeled\n- Description is optional — use the label/name next to the part number, keep it under 60 chars\n- If this document has no parts list, return {"parts":[]}\n- Return every unique part number (deduplicate identical ones)`;
        const isPdf = (media_type || '').includes('pdf');
        const content = isPdf
          ? [{ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: file_base64 } }, { type: 'text', text: prompt }]
          : [{ type: 'image', source: { type: 'base64', media_type: media_type || 'image/jpeg', data: file_base64 } }, { type: 'text', text: prompt }];
        try {
          const msg = await client.messages.create({
            model: 'claude-sonnet-4-6',
            max_tokens: 8000,
            messages: [{ role: 'user', content }]
          });
          const raw = msg.content[0].text.trim().replace(/^```json?\n?/, '').replace(/\n?```$/, '');
          const parsed = JSON.parse(raw);
          extractedParts = Array.isArray(parsed.parts) ? parsed.parts : [];
        } catch (err) {
          console.error('Manual extract error:', err);
          return res.status(500).json({ error: 'Extraction failed: ' + err.message });
        }
      }

      // Create the manual row
      const [manual] = await sql`
        INSERT INTO parts_manuals (company_id, title, machine_tag, file_url, notes, part_count)
        VALUES (${company_id}, ${String(title).trim()}, ${machine_tag || ''}, ${file_url || ''}, ${notes || ''}, ${extractedParts.length})
        RETURNING *`;

      // Insert extracted parts (deduped)
      if (extractedParts.length > 0) {
        const seen = new Set();
        for (const p of extractedParts) {
          const pn = String(p.part_number || '').trim();
          if (!pn) continue;
          const key = pn.toLowerCase();
          if (seen.has(key)) continue;
          seen.add(key);
          const desc = String(p.description || '').trim().slice(0, 200);
          await sql`INSERT INTO manual_part_index (manual_id, company_id, part_number, description, machine_tag)
            VALUES (${manual.id}, ${company_id}, ${pn}, ${desc}, ${machine_tag || ''})`;
        }
        await sql`UPDATE parts_manuals SET part_count = ${seen.size}, updated_at = NOW() WHERE id = ${manual.id}`;
      }
      return res.json({ ok: true, manual, extracted_count: extractedParts.length });
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
      // Keep index rows' machine_tag in sync with the manual's
      await sql`UPDATE manual_part_index SET machine_tag = ${machine_tag || ''} WHERE manual_id = ${id} AND company_id = ${company_id}`;
      return res.json({ ok: true, manual: m });
    }

    if (action === 'delete_manual') {
      if (!body.id) return res.status(400).json({ error: 'Missing id' });
      await sql`DELETE FROM manual_part_index WHERE manual_id = ${body.id} AND company_id = ${company_id}`;
      await sql`DELETE FROM parts_manuals WHERE id = ${body.id} AND company_id = ${company_id}`;
      return res.json({ ok: true });
    }

    if (action === 'search_part') {
      const q = String(body.query || body.part_number || '').trim();
      if (!q) return res.json({ matches: [] });
      const like = '%' + q + '%';
      const rows = await sql`
        SELECT mpi.part_number, mpi.description, mpi.machine_tag,
               mpi.manual_id, pm.title AS manual_title
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
      // Shop stock is a catch-all — never flag against it
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
