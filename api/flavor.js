import { neon } from '@neondatabase/serverless';

const sql = neon(process.env.DATABASE_URL);

export default async function handler(req, res) {
  const { method } = req;
  
  // Initialize tables on first request
  try {
    await sql`CREATE TABLE IF NOT EXISTS flavor_ponds (
      pond_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      producer_name TEXT NOT NULL,
      pond_name TEXT NOT NULL,
      active BOOLEAN DEFAULT true,
      company_id INTEGER DEFAULT 1,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(producer_name, pond_name, company_id)
    )`;
    
    await sql`CREATE TABLE IF NOT EXISTS flavor_samples (
      sample_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      pond_id UUID NOT NULL REFERENCES flavor_ponds(pond_id),
      sample_date DATE NOT NULL,
      sample_status TEXT DEFAULT 'pending' CHECK (sample_status IN ('pending', 'completed', 'failed')),
      truck_status TEXT DEFAULT 'pending' CHECK (truck_status IN ('pending', 'completed', 'failed', 'n/a')),
      teresa_status TEXT DEFAULT 'pending' CHECK (teresa_status IN ('pending', 'completed', 'failed', 'n/a')),
      logged_status TEXT DEFAULT 'pending' CHECK (logged_status IN ('pending', 'completed', 'failed', 'n/a')),
      sampled_by TEXT,
      sampled_at TIMESTAMPTZ,
      truck_by TEXT,
      truck_at TIMESTAMPTZ,
      teresa_by TEXT,
      teresa_at TIMESTAMPTZ,
      logged_by TEXT,
      logged_at TIMESTAMPTZ,
      notes TEXT,
      company_id INTEGER DEFAULT 1,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(pond_id, sample_date)
    )`;
    
    await sql`CREATE INDEX IF NOT EXISTS flavor_samples_date_idx ON flavor_samples(sample_date)`;
    await sql`CREATE INDEX IF NOT EXISTS flavor_samples_pond_idx ON flavor_samples(pond_id)`;
  } catch (initError) {
    console.log('Table initialization (likely already exists):', initError.message);
  }
  
  try {
    if (method === 'GET') {
      const { action } = req.query;
      
      if (action === 'producers') {
        const producers = await sql`
          SELECT DISTINCT producer_name, COUNT(*) as pond_count
          FROM flavor_ponds 
          GROUP BY producer_name 
          ORDER BY producer_name
        `;
        return res.json(producers);
      }
      
      if (action === 'ponds') {
        const { producer } = req.query;
        let query = `
          SELECT pond_id, producer_name, pond_name, active 
          FROM flavor_ponds 
        `;
        let params = [];
        
        if (producer) {
          query += ` WHERE producer_name = $1`;
          params = [producer];
        }
        query += ` ORDER BY producer_name, pond_name`;
        
        const ponds = await sql(query, params);
        return res.json(ponds);
      }
      
      if (action === 'samples') {
        const { start_date, end_date, producer, pond_id } = req.query;
        
        let query = `
          SELECT s.*, p.producer_name, p.pond_name,
                 u1.full_name as sampled_by_name,
                 u2.full_name as truck_by_name, 
                 u3.full_name as teresa_by_name,
                 u4.full_name as logged_by_name
          FROM flavor_samples s
          JOIN flavor_ponds p ON s.pond_id = p.pond_id
          LEFT JOIN users u1 ON s.sampled_by = u1.username
          LEFT JOIN users u2 ON s.truck_by = u2.username  
          LEFT JOIN users u3 ON s.teresa_by = u3.username
          LEFT JOIN users u4 ON s.logged_by = u4.username
          WHERE 1=1
        `;
        let params = [];
        let paramCount = 0;
        
        if (start_date) {
          paramCount++;
          query += ` AND s.sample_date >= $${paramCount}`;
          params.push(start_date);
        }
        if (end_date) {
          paramCount++;
          query += ` AND s.sample_date <= $${paramCount}`;
          params.push(end_date);
        }
        if (producer) {
          paramCount++;
          query += ` AND p.producer_name = $${paramCount}`;
          params.push(producer);
        }
        if (pond_id) {
          paramCount++;
          query += ` AND s.pond_id = $${paramCount}`;
          params.push(pond_id);
        }
        
        query += ` ORDER BY s.sample_date DESC, p.producer_name, p.pond_name`;
        
        const samples = await sql(query, params);
        return res.json(samples);
      }
      
      if (action === 'seed_initial') {
        // Clear existing data if requested
        const { reset } = req.query;
        if (reset === 'true') {
          await sql`DELETE FROM flavor_samples`;
          await sql`DELETE FROM flavor_ponds`;
        }
        
        // Producer/pond combinations from your Excel file (cleaned up)
        const producers = [
          { producer: 'A&K FARMERS', ponds: ['P22-5', 'P23', 'P29', 'P31', 'P35', 'P36', 'P37', 'P27'] },
          { producer: 'ALAN JOHNSON', ponds: ['P2', 'P3'] },
          { producer: 'ADAMS LANE', ponds: ['D1', 'D2', 'D3', 'D4', 'D5', 'D6', 'D7', 'D5-ALT'] },
          { producer: 'AARON YODER CATFISH', ponds: ['P2', 'P4', 'P5', 'P6'] },
          { producer: 'AUSTIN HARING', ponds: ['P4'] },
          { producer: 'BCH FARMERS', ponds: ['P1', 'P2', 'P3', 'P4', 'P5', 'P8', 'P9', 'P10', 'P11', 'P12', 'P27', 'P9-5', 'P5-6'] },
          { producer: 'BRADEN FARMERS', ponds: ['P6'] },
          { producer: 'BRADEN HARING', ponds: ['P5'] },
          { producer: 'BATTLE FISH NORTH', ponds: ['P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'P7', 'P8'] },
          { producer: 'CATFISH ENTERPRISE', ponds: ['P1', 'P2', 'P3', 'P4', 'P5'] },
          { producer: 'GIESBRECHT', ponds: ['P1', 'P2', 'P3', 'P4'] },
          { producer: 'RIPPLING WATER', ponds: ['P1', 'P2', 'P3'] },
          { producer: 'WCC', ponds: ['P1', 'P2', 'P3', 'P4'] },
          { producer: 'BEN SAUL/SHIRK', ponds: ['P1', 'P2', 'P3'] },
          { producer: 'SCHMIDT', ponds: ['P1', 'P2'] }
        ];
        
        let inserted = 0;
        for (const { producer, ponds } of producers) {
          for (const pond of ponds) {
            try {
              await sql`
                INSERT INTO flavor_ponds (producer_name, pond_name) 
                VALUES (${producer}, ${pond})
                ON CONFLICT (producer_name, pond_name, company_id) DO NOTHING
              `;
              inserted++;
            } catch (e) {
              console.log(`Skip duplicate: ${producer} - ${pond}`);
            }
          }
        }
        
        return res.json({ success: true, message: `${inserted} producer/pond combinations initialized` });
      }
      
      if (action === 'calendar') {
        const { month, year } = req.query;
        
        if (!month || !year) {
          return res.status(400).json({ error: 'Month and year are required' });
        }
        
        const monthStr = month.toString().padStart(2, '0');
        const yearStr = year.toString();
        const startDate = `${yearStr}-${monthStr}-01`;
        const endDate = `${yearStr}-${monthStr}-31`;
        
        const samples = await sql`
          SELECT s.sample_date, s.pond_id, s.sample_status, s.truck_status, 
                 s.teresa_status, s.logged_status, p.producer_name, p.pond_name
          FROM flavor_samples s
          JOIN flavor_ponds p ON s.pond_id = p.pond_id
          WHERE s.sample_date >= ${startDate} AND s.sample_date <= ${endDate}
          ORDER BY s.sample_date, p.producer_name, p.pond_name
        `;
        return res.json(samples);
      }
    }
    
    if (method === 'POST') {
      const { action } = req.body;
      
      if (action === 'create_sample') {
        const { pond_id, sample_date, sampled_by } = req.body;
        
        const [sample] = await sql`
          INSERT INTO flavor_samples (pond_id, sample_date, sample_status, sampled_by, sampled_at)
          VALUES (${pond_id}, ${sample_date}, 'completed', ${sampled_by}, NOW())
          RETURNING *
        `;
        return res.json(sample);
      }
      
      if (action === 'update_status') {
        const { sample_id, status_type, status, updated_by } = req.body;
        
        const updateField = `${status_type}_status`;
        const updateByField = `${status_type}_by`;
        const updateAtField = `${status_type}_at`;
        
        const [sample] = await sql`
          UPDATE flavor_samples 
          SET ${sql(updateField)} = ${status},
              ${sql(updateByField)} = ${updated_by},
              ${sql(updateAtField)} = NOW()
          WHERE sample_id = ${sample_id}
          RETURNING *
        `;
        return res.json(sample);
      }
      
      if (action === 'bulk_update') {
        const { sample_ids, status_type, status, updated_by } = req.body;
        
        const updateField = `${status_type}_status`;
        const updateByField = `${status_type}_by`;
        const updateAtField = `${status_type}_at`;
        
        await sql`
          UPDATE flavor_samples 
          SET ${sql(updateField)} = ${status},
              ${sql(updateByField)} = ${updated_by},
              ${sql(updateAtField)} = NOW()
          WHERE sample_id = ANY(${sample_ids})
        `;
        
        return res.json({ success: true, updated: sample_ids.length });
      }
      
      if (action === 'add_pond') {
        const { producer_name, pond_name } = req.body;
        
        const [pond] = await sql`
          INSERT INTO flavor_ponds (producer_name, pond_name, active)
          VALUES (${producer_name}, ${pond_name}, true)
          RETURNING *
        `;
        return res.json(pond);
      }
    }
    
    if (method === 'PUT') {
      const { sample_id } = req.body;
      const updateData = { ...req.body };
      delete updateData.sample_id;
      
      const setClause = Object.keys(updateData)
        .map((key, index) => `${key} = $${index + 2}`)
        .join(', ');
      
      const values = [sample_id, ...Object.values(updateData)];
      
      const [sample] = await sql(`
        UPDATE flavor_samples 
        SET ${setClause}
        WHERE sample_id = $1
        RETURNING *
      `, values);
      
      return res.json(sample);
    }
    
    if (method === 'DELETE') {
      const { sample_id } = req.body;
      
      await sql`
        DELETE FROM flavor_samples 
        WHERE sample_id = ${sample_id}
      `;
      
      return res.json({ success: true });
    }
    
    return res.status(405).json({ error: 'Method not allowed' });
    
  } catch (error) {
    console.error('Flavor API error:', error);
    return res.status(500).json({ error: error.message });
  }
}
