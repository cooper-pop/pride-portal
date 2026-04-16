import { neon } from '@neondatabase/serverless';

const sql = neon(process.env.DATABASE_URL);

export default async function handler(req, res) {
  const { method } = req;
  
  // Initialize tables on first request
  try {
    await sql`CREATE TABLE IF NOT EXISTS fish_vats (
      vat_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      vat_number INTEGER UNIQUE NOT NULL,
      capacity_lbs INTEGER DEFAULT 50000,
      current_load_lbs INTEGER DEFAULT 0,
      status TEXT DEFAULT 'available' CHECK (status IN ('available', 'loading', 'processing', 'cleaning', 'maintenance')),
      last_cleaned TIMESTAMPTZ,
      temperature NUMERIC,
      oxygen_level NUMERIC,
      notes TEXT,
      company_id INTEGER DEFAULT 1,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )`;
    
    await sql`CREATE TABLE IF NOT EXISTS fish_producers (
      producer_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      producer_name TEXT UNIQUE NOT NULL,
      contact_person TEXT,
      phone TEXT,
      email TEXT,
      delivery_days TEXT[], -- ['monday', 'tuesday', 'friday']
      typical_load_size INTEGER, -- tons
      preferred_vat_numbers INTEGER[],
      active BOOLEAN DEFAULT true,
      quality_rating INTEGER CHECK (quality_rating >= 1 AND quality_rating <= 5),
      payment_terms TEXT,
      notes TEXT,
      company_id INTEGER DEFAULT 1,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )`;
    
    await sql`CREATE TABLE IF NOT EXISTS fish_deliveries (
      delivery_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      producer_id UUID NOT NULL REFERENCES fish_producers(producer_id),
      delivery_date DATE NOT NULL,
      scheduled_time TIME,
      actual_arrival_time TIMESTAMPTZ,
      estimated_lbs INTEGER,
      actual_lbs INTEGER,
      vat_number INTEGER,
      truck_driver TEXT,
      truck_license TEXT,
      delivery_status TEXT DEFAULT 'scheduled' CHECK (delivery_status IN ('scheduled', 'en_route', 'arrived', 'unloading', 'completed', 'cancelled')),
      quality_grade TEXT CHECK (quality_grade IN ('premium', 'standard', 'grade2', 'rejected')),
      mortality_count INTEGER DEFAULT 0,
      temperature_check NUMERIC,
      oxygen_check NUMERIC,
      sample_taken BOOLEAN DEFAULT false,
      coordinated_by TEXT, -- James Gaters usually
      notes TEXT,
      company_id INTEGER DEFAULT 1,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )`;
    
    await sql`CREATE TABLE IF NOT EXISTS fish_schedule_templates (
      template_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      template_name TEXT NOT NULL,
      week_pattern JSONB, -- {monday: [{producer: 'WCC', tons: 25, vat: 1}], tuesday: [...]}
      active BOOLEAN DEFAULT true,
      created_by TEXT,
      company_id INTEGER DEFAULT 1,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`;
    
    await sql`CREATE INDEX IF NOT EXISTS fish_deliveries_date_idx ON fish_deliveries(delivery_date)`;
    await sql`CREATE INDEX IF NOT EXISTS fish_deliveries_producer_idx ON fish_deliveries(producer_id)`;
    await sql`CREATE INDEX IF NOT EXISTS fish_deliveries_status_idx ON fish_deliveries(delivery_status)`;
  } catch (initError) {
    console.log('Table initialization (likely already exists):', initError.message);
  }

  try {
    if (method === 'GET') {
      const { action } = req.query;
      
      if (action === 'vats') {
        const vats = await sql`
          SELECT v.*, 
                 COUNT(d.delivery_id) as scheduled_deliveries,
                 SUM(CASE WHEN d.delivery_status IN ('scheduled', 'en_route') THEN d.estimated_lbs ELSE 0 END) as pending_lbs
          FROM fish_vats v
          LEFT JOIN fish_deliveries d ON v.vat_number = d.vat_number AND d.delivery_date >= CURRENT_DATE
          GROUP BY v.vat_id, v.vat_number, v.capacity_lbs, v.current_load_lbs, v.status, v.last_cleaned, v.temperature, v.oxygen_level, v.notes, v.company_id, v.created_at, v.updated_at
          ORDER BY v.vat_number
        `;
        return res.json(vats);
      }
      
      if (action === 'producers') {
        const producers = await sql`
          SELECT p.*,
                 COUNT(d.delivery_id) as total_deliveries,
                 AVG(d.actual_lbs) as avg_delivery_size,
                 MAX(d.delivery_date) as last_delivery
          FROM fish_producers p
          LEFT JOIN fish_deliveries d ON p.producer_id = d.producer_id
          WHERE p.active = true
          GROUP BY p.producer_id
          ORDER BY p.producer_name
        `;
        return res.json(producers);
      }
      
      if (action === 'schedule') {
        const { start_date, end_date, vat_number, producer_id } = req.query;
        
        let query = `
          SELECT d.*, p.producer_name, p.contact_person, p.phone,
                 v.capacity_lbs, v.current_load_lbs, v.status as vat_status
          FROM fish_deliveries d
          JOIN fish_producers p ON d.producer_id = p.producer_id
          LEFT JOIN fish_vats v ON d.vat_number = v.vat_number
          WHERE 1=1
        `;
        let params = [];
        let paramCount = 0;
        
        if (start_date) {
          paramCount++;
          query += ` AND d.delivery_date >= $${paramCount}`;
          params.push(start_date);
        }
        if (end_date) {
          paramCount++;
          query += ` AND d.delivery_date <= $${paramCount}`;
          params.push(end_date);
        }
        if (vat_number) {
          paramCount++;
          query += ` AND d.vat_number = $${paramCount}`;
          params.push(vat_number);
        }
        if (producer_id) {
          paramCount++;
          query += ` AND d.producer_id = $${paramCount}`;
          params.push(producer_id);
        }
        
        query += ` ORDER BY d.delivery_date, d.scheduled_time`;
        
        const deliveries = await sql(query, params);
        return res.json(deliveries);
      }
      
      if (action === 'weekly_view') {
        const { week_start } = req.query;
        const weekStart = week_start || new Date().toISOString().split('T')[0];
        
        // Calculate week end (6 days later)
        const startDate = new Date(weekStart);
        const endDate = new Date(startDate);
        endDate.setDate(startDate.getDate() + 6);
        
        const weeklySchedule = await sql`
          SELECT d.*, p.producer_name, p.typical_load_size,
                 EXTRACT(DOW FROM d.delivery_date) as day_of_week,
                 TO_CHAR(d.delivery_date, 'Day') as day_name
          FROM fish_deliveries d
          JOIN fish_producers p ON d.producer_id = p.producer_id
          WHERE d.delivery_date >= ${weekStart} 
            AND d.delivery_date <= ${endDate.toISOString().split('T')[0]}
          ORDER BY d.delivery_date, d.scheduled_time
        `;
        
        return res.json(weeklySchedule);
      }
      
      if (action === 'capacity_analysis') {
        const { target_date } = req.query;
        const analysisDate = target_date || new Date().toISOString().split('T')[0];
        
        const analysis = await sql`
          SELECT 
            v.vat_number,
            v.capacity_lbs,
            v.current_load_lbs,
            v.status,
            COALESCE(SUM(d.estimated_lbs), 0) as scheduled_lbs,
            (v.capacity_lbs - v.current_load_lbs - COALESCE(SUM(d.estimated_lbs), 0)) as available_capacity
          FROM fish_vats v
          LEFT JOIN fish_deliveries d ON v.vat_number = d.vat_number 
            AND d.delivery_date = ${analysisDate}
            AND d.delivery_status IN ('scheduled', 'en_route', 'arrived')
          GROUP BY v.vat_id, v.vat_number, v.capacity_lbs, v.current_load_lbs, v.status
          ORDER BY v.vat_number
        `;
        
        return res.json(analysis);
      }
    }
    
    if (method === 'POST') {
      const { action } = req.body;
      
      if (action === 'create_delivery') {
        const { 
          producer_id, delivery_date, scheduled_time, estimated_lbs, 
          vat_number, truck_driver, coordinated_by, notes 
        } = req.body;
        
        const [delivery] = await sql`
          INSERT INTO fish_deliveries 
          (producer_id, delivery_date, scheduled_time, estimated_lbs, vat_number, truck_driver, coordinated_by, notes)
          VALUES (${producer_id}, ${delivery_date}, ${scheduled_time}, ${estimated_lbs}, ${vat_number}, ${truck_driver}, ${coordinated_by}, ${notes})
          RETURNING *
        `;
        return res.json(delivery);
      }
      
      if (action === 'update_delivery_status') {
        const { delivery_id, status, actual_arrival_time, actual_lbs, quality_grade, notes } = req.body;
        
        const [delivery] = await sql`
          UPDATE fish_deliveries 
          SET delivery_status = ${status},
              actual_arrival_time = ${actual_arrival_time},
              actual_lbs = ${actual_lbs},
              quality_grade = ${quality_grade},
              notes = ${notes},
              updated_at = NOW()
          WHERE delivery_id = ${delivery_id}
          RETURNING *
        `;
        return res.json(delivery);
      }
      
      if (action === 'update_vat_status') {
        const { vat_number, status, current_load_lbs, temperature, oxygen_level, notes } = req.body;
        
        const [vat] = await sql`
          UPDATE fish_vats 
          SET status = ${status},
              current_load_lbs = ${current_load_lbs},
              temperature = ${temperature},
              oxygen_level = ${oxygen_level},
              notes = ${notes},
              last_cleaned = CASE WHEN ${status} = 'available' THEN NOW() ELSE last_cleaned END,
              updated_at = NOW()
          WHERE vat_number = ${vat_number}
          RETURNING *
        `;
        return res.json(vat);
      }
      
      if (action === 'create_weekly_template') {
        const { template_name, week_pattern, created_by } = req.body;
        
        const [template] = await sql`
          INSERT INTO fish_schedule_templates (template_name, week_pattern, created_by)
          VALUES (${template_name}, ${JSON.stringify(week_pattern)}, ${created_by})
          RETURNING *
        `;
        return res.json(template);
      }
      
      if (action === 'seed_initial') {
        // Initialize 16 vats
        for (let i = 1; i <= 16; i++) {
          await sql`
            INSERT INTO fish_vats (vat_number, capacity_lbs, current_load_lbs, status)
            VALUES (${i}, 50000, 0, 'available')
            ON CONFLICT (vat_number) DO NOTHING
          `;
        }
        
        // Initialize producers from your schedule
        const producers = [
          { name: 'RIPPLING WATER', delivery_days: ['monday', 'friday'], typical_load: 25000, contact: 'Contact TBD' },
          { name: 'WCC', delivery_days: ['tuesday', 'friday'], typical_load: 25000, contact: 'Contact TBD' },
          { name: 'BEN SAUL/SHIRK', delivery_days: ['tuesday', 'wednesday', 'friday'], typical_load: 30000, contact: 'Contact TBD' },
          { name: 'GIESBRECHT', delivery_days: ['wednesday'], typical_load: 25000, contact: 'Contact TBD' },
          { name: 'CATFISH ENTERPRISE', delivery_days: ['friday'], typical_load: 25000, contact: 'Contact TBD' },
          { name: 'SCHMIDT', delivery_days: ['friday'], typical_load: 25000, contact: 'Contact TBD' },
          { name: 'BATTLE FISH NORTH', delivery_days: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'], typical_load: 50000, contact: 'Cooper Battle' }
        ];
        
        let inserted = 0;
        for (const producer of producers) {
          try {
            await sql`
              INSERT INTO fish_producers (producer_name, delivery_days, typical_load_size, contact_person, quality_rating)
              VALUES (${producer.name}, ${producer.delivery_days}, ${producer.typical_load}, ${producer.contact}, 4)
              ON CONFLICT (producer_name) DO NOTHING
            `;
            inserted++;
          } catch (e) {
            console.log(`Skip duplicate: ${producer.name}`);
          }
        }
        
        return res.json({ 
          success: true, 
          message: `Initialized 16 vats and ${inserted} producers for live fish scheduling`
        });
      }
    }
    
    if (method === 'PUT') {
      const { delivery_id } = req.body;
      const updateData = { ...req.body };
      delete updateData.delivery_id;
      updateData.updated_at = new Date().toISOString();
      
      const setClause = Object.keys(updateData)
        .map((key, index) => `${key} = $${index + 2}`)
        .join(', ');
      
      const values = [delivery_id, ...Object.values(updateData)];
      
      const [delivery] = await sql(`
        UPDATE fish_deliveries 
        SET ${setClause}
        WHERE delivery_id = $1
        RETURNING *
      `, values);
      
      return res.json(delivery);
    }
    
    if (method === 'DELETE') {
      const { delivery_id } = req.body;
      
      await sql`
        DELETE FROM fish_deliveries 
        WHERE delivery_id = ${delivery_id}
      `;
      
      return res.json({ success: true });
    }
    
    return res.status(405).json({ error: 'Method not allowed' });
    
  } catch (error) {
    console.error('Fish scheduling API error:', error);
    return res.status(500).json({ error: error.message });
  }
}
