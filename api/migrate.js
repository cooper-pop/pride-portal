import { neon } from '@neondatabase/serverless';
export default async function handler(req, res) {
  if(req.method!=='POST') return res.status(405).end();
  const {secret} = req.body||{};
  if(secret!=='potp-seed-2026') return res.status(403).json({error:'forbidden'});
  const sql = neon(process.env.DATABASE_URL);
  try {
    await sql`
      CREATE TABLE IF NOT EXISTS tasks (
        id SERIAL PRIMARY KEY,
        company_id INTEGER REFERENCES companies(id),
        title TEXT NOT NULL,
        description TEXT,
        category TEXT DEFAULT 'General',
        priority TEXT DEFAULT 'Medium',
        assigned_to TEXT NOT NULL,
        due_date DATE,
        due_time TIME,
        shift TEXT DEFAULT 'Any',
        recurring TEXT DEFAULT 'none',
        recurring_days TEXT,
        steps JSONB DEFAULT '[]',
        created_by INTEGER REFERENCES users(id),
        created_at TIMESTAMPTZ DEFAULT NOW(),
        is_active BOOLEAN DEFAULT TRUE
      )
    `;
    await sql`
      CREATE TABLE IF NOT EXISTS task_instances (
        id SERIAL PRIMARY KEY,
        task_id INTEGER REFERENCES tasks(id) ON DELETE CASCADE,
        company_id INTEGER REFERENCES companies(id),
        assigned_to INTEGER REFERENCES users(id),
        instance_date DATE NOT NULL,
        status TEXT DEFAULT 'pending',
        started_at TIMESTAMPTZ,
        completed_at TIMESTAMPTZ,
        completion_photo TEXT,
        completion_note TEXT,
        step_completions JSONB DEFAULT '[]',
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `;
    await sql`
      CREATE TABLE IF NOT EXISTS task_messages (
        id SERIAL PRIMARY KEY,
        company_id INTEGER REFERENCES companies(id),
        from_user_id INTEGER REFERENCES users(id),
        to_user_id INTEGER REFERENCES users(id),
        body TEXT NOT NULL,
        photo TEXT,
        acknowledged BOOLEAN DEFAULT FALSE,
        acknowledged_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `;
    await sql`
      CREATE TABLE IF NOT EXISTS engagement_logs (
        id SERIAL PRIMARY KEY,
        company_id INTEGER REFERENCES companies(id),
        user_id INTEGER REFERENCES users(id),
        session_date DATE NOT NULL DEFAULT CURRENT_DATE,
        session_start TIMESTAMPTZ DEFAULT NOW(),
        session_end TIMESTAMPTZ,
        task_time_seconds INTEGER DEFAULT 0,
        tasks_completed INTEGER DEFAULT 0
      )
    `;
    res.json({ok:true, tables:['tasks','task_instances','task_messages','engagement_logs']});
  } catch(e) { res.status(500).json({error:e.message}); }
}
