import { neon } from '@neondatabase/serverless';
import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'potp-secret-2026-xk9q7r';

function getUser(req) {
  try {
    const auth = req.headers.authorization || '';
    const token = auth.replace('Bearer ', '');
    return jwt.verify(token, JWT_SECRET);
  } catch { return null; }
}

export default async function handler(req, res) {
  const sql = neon(process.env.DATABASE_URL);

// Auto-create tables if they don't exist
async function ensureTables(sql) {
  await sql`CREATE TABLE IF NOT EXISTS tasks (id SERIAL PRIMARY KEY, company_id INTEGER REFERENCES companies(id), title TEXT NOT NULL, description TEXT, category TEXT DEFAULT 'General', priority TEXT DEFAULT 'Medium', assigned_to TEXT NOT NULL, due_date DATE, due_time TIME, shift TEXT DEFAULT 'Any', recurring TEXT DEFAULT 'none', recurring_days TEXT, steps JSONB DEFAULT '[]', created_by INTEGER REFERENCES users(id), created_at TIMESTAMPTZ DEFAULT NOW(), is_active BOOLEAN DEFAULT TRUE)`;
  await sql`CREATE TABLE IF NOT EXISTS task_instances (id SERIAL PRIMARY KEY, task_id INTEGER REFERENCES tasks(id) ON DELETE CASCADE, company_id INTEGER REFERENCES companies(id), assigned_to INTEGER REFERENCES users(id), instance_date DATE NOT NULL, status TEXT DEFAULT 'pending', started_at TIMESTAMPTZ, completed_at TIMESTAMPTZ, completion_photo TEXT, completion_note TEXT, step_completions JSONB DEFAULT '[]', created_at TIMESTAMPTZ DEFAULT NOW())`;
  await sql`CREATE TABLE IF NOT EXISTS task_messages (id SERIAL PRIMARY KEY, company_id INTEGER REFERENCES companies(id), from_user_id INTEGER REFERENCES users(id), to_user_id INTEGER REFERENCES users(id), body TEXT NOT NULL, photo TEXT, acknowledged BOOLEAN DEFAULT FALSE, acknowledged_at TIMESTAMPTZ, created_at TIMESTAMPTZ DEFAULT NOW())`;
  await sql`CREATE TABLE IF NOT EXISTS engagement_logs (id SERIAL PRIMARY KEY, company_id INTEGER REFERENCES companies(id), user_id INTEGER REFERENCES users(id), session_date DATE NOT NULL DEFAULT CURRENT_DATE, session_start TIMESTAMPTZ DEFAULT NOW(), session_end TIMESTAMPTZ, task_time_seconds INTEGER DEFAULT 0, tasks_completed INTEGER DEFAULT 0)`;
}
  if(!_tablesEnsured){ try{ await ensureTables(sql); _tablesEnsured=true; }catch(e){ return res.status(503).json({error:'DB initializing, retry in a moment'}); } }

  const user = getUser(req);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });

  const { action } = req.query;

  // ── GET handlers ──
  if (req.method === 'GET') {

    // Get today's tasks for current user
    if (action === 'my_tasks') {
      const today = new Date().toISOString().split('T')[0];
      const rows = await sql`
        SELECT ti.*, t.title, t.description, t.category, t.priority,
               t.steps, t.due_time, t.shift, t.recurring,
               u.username as created_by_name
        FROM task_instances ti
        JOIN tasks t ON ti.task_id = t.id
        JOIN users u ON t.created_by = u.id
        WHERE ti.assigned_to = ${user.id}
          AND ti.instance_date = ${today}
          AND ti.company_id = ${user.company_id}
        ORDER BY t.priority DESC, t.due_time ASC NULLS LAST
      `;
      return res.json(rows);
    }

    // Get tasks for a specific date (admin: all users, user: own)
    if (action === 'day_tasks') {
      const { date } = req.query;
      if (user.role === 'admin' || user.role === 'manager') {
        const rows = await sql`
          SELECT ti.*, t.title, t.description, t.category, t.priority,
                 t.steps, t.due_time, t.shift, t.recurring,
                 u.username as assigned_username, u.role as assigned_role
          FROM task_instances ti
          JOIN tasks t ON ti.task_id = t.id
          JOIN users u ON ti.assigned_to = u.id
          WHERE ti.instance_date = ${date}
            AND ti.company_id = ${user.company_id}
          ORDER BY u.username, t.due_time ASC NULLS LAST
        `;
        return res.json(rows);
      }
      const rows = await sql`
        SELECT ti.*, t.title, t.description, t.category, t.priority,
               t.steps, t.due_time, t.shift
        FROM task_instances ti
        JOIN tasks t ON ti.task_id = t.id
        WHERE ti.assigned_to = ${user.id}
          AND ti.instance_date = ${date}
          AND ti.company_id = ${user.company_id}
        ORDER BY t.due_time ASC NULLS LAST
      `;
      return res.json(rows);
    }

    // Get all tasks (admin: manage view)
    if (action === 'all_tasks') {
      if (user.role !== 'admin') return res.status(403).json({error:'Admin only'});
      const rows = await sql`
        SELECT t.*, u.username as created_by_name,
          (SELECT COUNT(*) FROM task_instances ti WHERE ti.task_id=t.id AND ti.status='complete') as completions,
          (SELECT COUNT(*) FROM task_instances ti WHERE ti.task_id=t.id AND ti.status='pending' AND ti.instance_date < CURRENT_DATE) as overdue_count
        FROM tasks t
        JOIN users u ON t.created_by = u.id
        WHERE t.company_id = ${user.company_id} AND t.is_active = TRUE
        ORDER BY t.created_at DESC
      `;
      return res.json(rows);
    }

    // Get messages for current user
    if (action === 'messages') {
      const rows = await sql`
        SELECT tm.*, u.username as from_name, u.role as from_role
        FROM task_messages tm
        JOIN users u ON tm.from_user_id = u.id
        WHERE tm.to_user_id = ${user.id}
          AND tm.acknowledged = FALSE
          AND tm.company_id = ${user.company_id}
        ORDER BY tm.created_at DESC
      `;
      return res.json(rows);
    }

    // Get performance grades (admin sees all, user sees own)
    if (action === 'grades') {
      const thirtyDaysAgo = new Date(Date.now()-30*24*60*60*1000).toISOString().split('T')[0];
      if (user.role === 'admin') {
        const rows = await sql`
          SELECT u.id, u.username, u.role,
            COUNT(ti.id) as total_tasks,
            SUM(CASE WHEN ti.status='complete' AND ti.completed_at <= (ti.instance_date + (t.due_time::text||' '||'00')::interval + interval '0 seconds') THEN 1 ELSE 0 END) as on_time,
            SUM(CASE WHEN ti.status='complete' THEN 1 ELSE 0 END) as completed,
            SUM(CASE WHEN ti.status='pending' AND ti.instance_date < CURRENT_DATE THEN 1 ELSE 0 END) as missed,
            COALESCE(SUM(el.task_time_seconds),0) as total_task_seconds,
            COALESCE(SUM(el.tasks_completed),0) as total_completed
          FROM users u
          LEFT JOIN task_instances ti ON ti.assigned_to=u.id AND ti.instance_date >= ${thirtyDaysAgo} AND ti.company_id=${user.company_id}
          LEFT JOIN tasks t ON ti.task_id=t.id
          LEFT JOIN engagement_logs el ON el.user_id=u.id AND el.session_date >= ${thirtyDaysAgo} AND el.company_id=${user.company_id}
          WHERE u.company_id=${user.company_id}
          GROUP BY u.id, u.username, u.role
          ORDER BY u.username
        `;
        return res.json(rows);
      }
      // own grade only
      const rows = await sql`
        SELECT u.id, u.username, u.role,
          COUNT(ti.id) as total_tasks,
          SUM(CASE WHEN ti.status='complete' THEN 1 ELSE 0 END) as completed,
          SUM(CASE WHEN ti.status='pending' AND ti.instance_date < CURRENT_DATE THEN 1 ELSE 0 END) as missed
        FROM users u
        LEFT JOIN task_instances ti ON ti.assigned_to=u.id AND ti.instance_date >= ${thirtyDaysAgo} AND ti.company_id=${user.company_id}
        WHERE u.id=${user.id}
        GROUP BY u.id, u.username, u.role
      `;
      return res.json(rows);
    }

    // Get engagement stats (admin only)
    if (action === 'engagement') {
      if (user.role !== 'admin') return res.status(403).json({error:'Admin only'});
      const rows = await sql`
        SELECT u.id, u.username, u.role,
          COUNT(DISTINCT el.session_date) as days_active,
          COALESCE(SUM(EXTRACT(EPOCH FROM (el.session_end - el.session_start))),0) as total_session_seconds,
          COALESCE(SUM(el.task_time_seconds),0) as total_task_seconds,
          COALESCE(SUM(el.tasks_completed),0) as tasks_completed,
          MAX(el.session_end) as last_seen
        FROM users u
        LEFT JOIN engagement_logs el ON el.user_id=u.id AND el.company_id=${user.company_id}
          AND el.session_date >= CURRENT_DATE - INTERVAL '30 days'
        WHERE u.company_id=${user.company_id}
        GROUP BY u.id, u.username, u.role
        ORDER BY total_session_seconds DESC
      `;
      return res.json(rows);
    }

    return res.status(400).json({error:'Unknown action'});
  }

  // ── POST handlers ──
  if (req.method === 'POST') {

    // Create task (admin only)
    if (action === 'create_task') {
      if (user.role !== 'admin') return res.status(403).json({error:'Admin only'});
      const { title, description, category, priority, assigned_to, due_date, due_time, shift, recurring, recurring_days, steps } = req.body;
      const task = await sql`
        INSERT INTO tasks (company_id, title, description, category, priority, assigned_to, due_date, due_time, shift, recurring, recurring_days, steps, created_by)
        VALUES (${user.company_id}, ${title}, ${description||''}, ${category||'General'}, ${priority||'Medium'},
                ${assigned_to}, ${due_date||null}, ${due_time||null}, ${shift||'Any'},
                ${recurring||'none'}, ${recurring_days||null}, ${JSON.stringify(steps||[])}, ${user.id})
        RETURNING *
      `;
      const taskId = task[0].id;
      // Create instance(s) for today (and future dates for recurring)
      const users = assigned_to === 'all'
        ? await sql`SELECT id FROM users WHERE company_id=${user.company_id} AND id!=${user.id}`
        : await sql`SELECT id FROM users WHERE id=${assigned_to} AND company_id=${user.company_id}`;
      const today = new Date().toISOString().split('T')[0];
      for (const u of users) {
        await sql`
          INSERT INTO task_instances (task_id, company_id, assigned_to, instance_date)
          VALUES (${taskId}, ${user.company_id}, ${u.id}, ${due_date||today})
          ON CONFLICT DO NOTHING
        `;
      }
      return res.json({ok:true, task: task[0]});
    }

    // Update task instance (complete, start, update steps)
    if (action === 'update_instance') {
      const { instance_id, status, completion_photo, completion_note, step_completions } = req.body;
      const updates = {};
      if (status==='in_progress') updates.started_at = new Date().toISOString();
      if (status==='complete') {
        if (!completion_photo) return res.status(400).json({error:'Photo required to complete task'});
        updates.completed_at = new Date().toISOString();
        updates.completion_photo = completion_photo;
        updates.completion_note = completion_note||'';
      }
      await sql`
        UPDATE task_instances
        SET status=${status},
            started_at=COALESCE(${updates.started_at||null}, started_at),
            completed_at=COALESCE(${updates.completed_at||null}, completed_at),
            completion_photo=COALESCE(${updates.completion_photo||null}, completion_photo),
            completion_note=COALESCE(${updates.completion_note||null}, completion_note),
            step_completions=COALESCE(${JSON.stringify(step_completions)||null}::jsonb, step_completions)
        WHERE id=${instance_id} AND assigned_to=${user.id}
      `;
      // Log task completion time
      if (status==='complete') {
        await sql`
          INSERT INTO engagement_logs (company_id, user_id, session_date, tasks_completed)
          VALUES (${user.company_id}, ${user.id}, CURRENT_DATE, 1)
          ON CONFLICT DO NOTHING
        `;
      }
      return res.json({ok:true});
    }

    // Send message (admin only)
    if (action === 'send_message') {
      if (user.role !== 'admin') return res.status(403).json({error:'Admin only'});
      const { to_user_id, body, photo } = req.body;
      // Validate photo size (1MB = ~1.37MB base64)
      if (photo && photo.length > 1400000) return res.status(400).json({error:'Photo exceeds 1MB limit'});
      await sql`
        INSERT INTO task_messages (company_id, from_user_id, to_user_id, body, photo)
        VALUES (${user.company_id}, ${user.id}, ${to_user_id}, ${body}, ${photo||null})
      `;
      return res.json({ok:true});
    }

    // Acknowledge message
    if (action === 'ack_message') {
      const { message_id } = req.body;
      await sql`
        UPDATE task_messages SET acknowledged=TRUE, acknowledged_at=NOW()
        WHERE id=${message_id} AND to_user_id=${user.id}
      `;
      return res.json({ok:true});
    }

    // Log engagement session
    if (action === 'log_session') {
      const { task_time_seconds } = req.body;
      await sql`
        INSERT INTO engagement_logs (company_id, user_id, session_date, session_start, session_end, task_time_seconds)
        VALUES (${user.company_id}, ${user.id}, CURRENT_DATE, NOW() - (${task_time_seconds}||' seconds')::interval, NOW(), ${task_time_seconds||0})
      `;
      return res.json({ok:true});
    }

    // Delete task (admin only)
    if (action === 'delete_task') {
      if (user.role !== 'admin') return res.status(403).json({error:'Admin only'});
      const { task_id } = req.body;
      await sql`UPDATE tasks SET is_active=FALSE WHERE id=${task_id} AND company_id=${user.company_id}`;
      return res.json({ok:true});
    }

    // Spawn recurring instances for today (called on page load)
    if (action === 'spawn_instances') { if(!_tablesEnsured){return res.json({ok:true,spawned:0,note:'tables not ready'});}
      const today = new Date().toISOString().split('T')[0];
      const dayName = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'][new Date().getDay()];
      const recurringTasks = await sql`
        SELECT t.*, array_agg(u.id) as user_ids
        FROM tasks t
        CROSS JOIN users u
        WHERE t.company_id=${user.company_id}
          AND t.is_active=TRUE
          AND t.recurring != 'none'
          AND (t.assigned_to='all' OR t.assigned_to::integer = u.id)
          AND u.company_id=${user.company_id}
          AND (
            t.recurring='daily'
            OR (t.recurring='weekly' AND t.recurring_days ILIKE '%'||${dayName}||'%')
          )
        GROUP BY t.id
      `;
      let spawned=0;
      for (const task of recurringTasks) {
        for (const uid of task.user_ids) {
          const exists = await sql`
            SELECT id FROM task_instances WHERE task_id=${task.id} AND assigned_to=${uid} AND instance_date=${today}
          `;
          if (!exists.length) {
            await sql`
              INSERT INTO task_instances (task_id, company_id, assigned_to, instance_date)
              VALUES (${task.id}, ${user.company_id}, ${uid}, ${today})
            `;
            spawned++;
          }
        }
      }
      return res.json({ok:true, spawned});
    }

    return res.status(400).json({error:'Unknown action'});
  }

  res.status(405).end();
}
