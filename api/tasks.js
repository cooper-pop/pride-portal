const { neon } = require('@neondatabase/serverless');
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'potp-secret-2026-xk9q7r';

function getUser(req) {
  try {
    const auth = req.headers.authorization || '';
    const token = auth.replace('Bearer ', '');
    const decoded = jwt.verify(token, JWT_SECRET);
    // Normalize: JWT has user_id, but we use id throughout
    return {
      id: String(decoded.user_id || decoded.id),
      username: decoded.username,
      role: decoded.role,
      company_id: parseInt(decoded.company_id)
    };
  } catch(e) { return null; }
}

let _tablesReady2 = false;

async function ensureTables(sql) {
  // Tables already exist with correct column types
  await sql`CREATE TABLE IF NOT EXISTS tasks (
    id SERIAL PRIMARY KEY, company_id INTEGER, title TEXT NOT NULL,
    description TEXT, category TEXT DEFAULT 'General', priority TEXT DEFAULT 'Medium',
    assigned_to TEXT NOT NULL, due_date DATE, due_time TIME, shift TEXT DEFAULT 'Any',
    recurring TEXT DEFAULT 'none', recurring_days TEXT, steps JSONB DEFAULT '[]',
    created_by TEXT, created_at TIMESTAMPTZ DEFAULT NOW(), is_active BOOLEAN DEFAULT TRUE)`;
  await sql`CREATE TABLE IF NOT EXISTS task_instances (
    id SERIAL PRIMARY KEY, task_id INTEGER, company_id INTEGER, assigned_to INTEGER,
    instance_date DATE NOT NULL, status TEXT DEFAULT 'pending',
    started_at TIMESTAMPTZ, completed_at TIMESTAMPTZ,
    completion_photo TEXT, completion_note TEXT,
    step_completions JSONB DEFAULT '[]', created_at TIMESTAMPTZ DEFAULT NOW())`;
  await sql`CREATE TABLE IF NOT EXISTS task_messages (
    id SERIAL PRIMARY KEY, company_id INTEGER, from_user_id TEXT, to_user_id TEXT,
    body TEXT NOT NULL, photo TEXT, acknowledged BOOLEAN DEFAULT FALSE,
    acknowledged_at TIMESTAMPTZ, created_at TIMESTAMPTZ DEFAULT NOW())`;
  await sql`CREATE TABLE IF NOT EXISTS engagement_logs (
    id SERIAL PRIMARY KEY, company_id INTEGER, user_id TEXT,
    session_date DATE NOT NULL DEFAULT CURRENT_DATE,
    session_start TIMESTAMPTZ DEFAULT NOW(), session_end TIMESTAMPTZ,
    task_time_seconds INTEGER DEFAULT 0, tasks_completed INTEGER DEFAULT 0)`;

  // Fix column types if they're wrong (alter existing tables)
  try {
    await sql`ALTER TABLE tasks ALTER COLUMN created_by TYPE TEXT`;
    await sql`ALTER TABLE task_instances ALTER COLUMN assigned_to TYPE TEXT`;
    await sql`ALTER TABLE task_messages ALTER COLUMN from_user_id TYPE TEXT`;
    await sql`ALTER TABLE task_messages ALTER COLUMN to_user_id TYPE TEXT`;
    await sql`ALTER TABLE engagement_logs ALTER COLUMN user_id TYPE TEXT`;
  } catch(e) { /* columns already correct type */ }

}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const sql = neon(process.env.DATABASE_URL);
  
  try { await ensureTables(sql); } catch(e) { console.error('ensureTables:',e.message); }

  const user = getUser(req);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });
  const userId = user.id;
  const companyId = user.company_id;

  const action = req.query.action || (req.body && req.body.action);
  const body = req.body || {};
  const today = new Date().toISOString().split('T')[0];

  try {

    // ── my_tasks: tasks for logged-in user today ──
    if (action === 'my_tasks') {
      const rows = await sql`
        SELECT ti.*, t.title, t.description, t.category, t.priority,
               t.steps, t.due_time, t.shift, t.recurring,
               u.username as created_by_name
        FROM task_instances ti
        JOIN tasks t ON ti.task_id = t.id
        JOIN users u ON t.created_by = u.id::text
        WHERE ti.assigned_to = ${userId}
          AND ti.instance_date = ${today}
          AND ti.company_id = ${companyId}
        ORDER BY t.priority DESC, t.due_time ASC NULLS LAST`;
      return res.json(rows);
    }

    // ── day_tasks: tasks for a specific date ──
    if (action === 'day_tasks') {
      const date = req.query.date || today;
      const rows = await sql`
        SELECT ti.*, t.title, t.description, t.category, t.priority,
               t.steps, t.due_time, t.shift, t.recurring,
               u.username as assigned_username, u.role as assigned_role
        FROM task_instances ti
        JOIN tasks t ON ti.task_id = t.id
        JOIN users u ON ti.assigned_to = u.id::text
        WHERE ti.instance_date = ${date}
          AND ti.company_id = ${companyId}
        ORDER BY u.username, t.due_time ASC NULLS LAST`;
      return res.json(rows);
    }

    // ── all_tasks: admin view all active tasks ──
    if (action === 'all_tasks') {
      if (user.role !== 'admin') return res.status(403).json({error:'Admin only'});
      const rows = await sql`
        SELECT t.*, u.username as created_by_name,
          (SELECT COUNT(*) FROM task_instances ti WHERE ti.task_id=t.id AND ti.status='complete') as completions,
          (SELECT COUNT(*) FROM task_instances ti WHERE ti.task_id=t.id AND ti.status='pending'
            AND ti.instance_date < CURRENT_DATE) as overdue_count
        FROM tasks t JOIN users u ON t.created_by = u.id::text
        WHERE t.company_id = ${companyId} AND t.is_active = TRUE
        ORDER BY t.created_at DESC`;
      return res.json(rows);
    }

    // ── messages: unacknowledged messages for user ──
    if (action === 'messages') {
      const rows = await sql`
        SELECT tm.*, u.username as from_name, u.role as from_role
        FROM task_messages tm JOIN users u ON tm.from_user_id = u.id::text
        WHERE tm.to_user_id = ${userId}
          AND tm.acknowledged = FALSE
          AND tm.company_id = ${companyId}
        ORDER BY tm.created_at DESC`;
      return res.json(rows);
    }

    // ── grades: performance grades ──
    if (action === 'grades') {
      const thirtyAgo = new Date(Date.now()-30*24*60*60*1000).toISOString().split('T')[0];
      if (user.role === 'admin') {
        const rows = await sql`
          SELECT u.id, u.username, u.role,
            COUNT(ti.id) as total_tasks,
            SUM(CASE WHEN ti.status='complete' THEN 1 ELSE 0 END) as completed,
            SUM(CASE WHEN ti.status='pending' AND ti.instance_date < CURRENT_DATE THEN 1 ELSE 0 END) as missed
          FROM users u
          LEFT JOIN task_instances ti ON ti.assigned_to=u.id::text
            AND ti.instance_date >= ${thirtyAgo}
            AND ti.company_id=${companyId}
          WHERE u.company_id=${companyId}
          GROUP BY u.id, u.username, u.role ORDER BY u.username`;
        return res.json(rows);
      }
      const rows = await sql`
        SELECT u.id, u.username, u.role,
          COUNT(ti.id) as total_tasks,
          SUM(CASE WHEN ti.status='complete' THEN 1 ELSE 0 END) as completed,
          SUM(CASE WHEN ti.status='pending' AND ti.instance_date < CURRENT_DATE THEN 1 ELSE 0 END) as missed
        FROM users u
        LEFT JOIN task_instances ti ON ti.assigned_to=u.id::text
          AND ti.instance_date >= ${thirtyAgo}
          AND ti.company_id=${companyId}
        WHERE u.id::text=${userId}
        GROUP BY u.id, u.username, u.role`;
      return res.json(rows);
    }

    // ── engagement: app usage stats (admin only) ──
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
        LEFT JOIN engagement_logs el ON el.user_id=u.id::text
          AND el.company_id=${companyId}
          AND el.session_date >= CURRENT_DATE - INTERVAL '30 days'
        WHERE u.company_id=${companyId}
        GROUP BY u.id, u.username, u.role ORDER BY total_session_seconds DESC`;
      return res.json(rows);
    }

    // ── create_task: admin creates a task ──
    if (action === 'create_task') {
      if (user.role !== 'admin') return res.status(403).json({error:'Admin only'});
      const { title, description, category, priority, assigned_to,
              due_date, due_time, shift, recurring, recurring_days, steps } = body;
      if (!title) return res.status(400).json({error:'Title required'});
      const task = await sql`
        INSERT INTO tasks (company_id, title, description, category, priority,
          assigned_to, due_date, due_time, shift, recurring, recurring_days, steps, created_by)
        VALUES (${companyId}, ${title}, ${description||''}, ${category||'General'},
          ${priority||'Medium'}, ${assigned_to}, ${due_date||null}, ${due_time||null},
          ${shift||'Any'}, ${recurring||'none'}, ${recurring_days||null},
          ${JSON.stringify(steps||[])}, ${userId})
        RETURNING *`;
      const taskId = task[0].id;
      const users = assigned_to === 'all'
        ? await sql`SELECT id FROM users WHERE company_id=${companyId}`
        : await sql`SELECT id FROM users WHERE id=${parseInt(assigned_to)} AND company_id=${companyId}`;
      const instDate = due_date || today;
      for (const u of users) {
        await sql`INSERT INTO task_instances (task_id, company_id, assigned_to, instance_date)
          VALUES (${taskId}, ${companyId}, ${u.id}, ${instDate}) ON CONFLICT DO NOTHING`;
      }
      return res.json({ok:true, task:task[0]});
    }

    // ── update_instance: complete/start a task ──
    if (action === 'update_instance') {
      const { instance_id, status, completion_photo, completion_note, step_completions } = body;
      if (status === 'complete' && !completion_photo) {
        return res.status(400).json({error:'Photo required to complete task'});
      }
      await sql`
        UPDATE task_instances SET
          status = ${status},
          started_at = CASE WHEN ${status} = 'in_progress' THEN NOW() ELSE started_at END,
          completed_at = CASE WHEN ${status} = 'complete' THEN NOW() ELSE completed_at END,
          completion_photo = COALESCE(${completion_photo||null}, completion_photo),
          completion_note = COALESCE(${completion_note||null}, completion_note),
          step_completions = COALESCE(${JSON.stringify(step_completions||null)}::jsonb, step_completions)
        WHERE id = ${instance_id} AND assigned_to = ${userId}`;
      if (status === 'complete') {
        await sql`INSERT INTO engagement_logs (company_id, user_id, session_date, tasks_completed)
          VALUES (${companyId}, ${userId}, CURRENT_DATE, 1)`.catch(()=>{});
      }
      return res.json({ok:true});
    }

    // ── send_message: admin sends alert to user ──
    if (action === 'send_message') {
      if (user.role !== 'admin') return res.status(403).json({error:'Admin only'});
      const { to_user_id, body: msgBody, photo } = body;
      if (!msgBody) return res.status(400).json({error:'Message required'});
      if (photo && photo.length > 1400000) return res.status(400).json({error:'Photo exceeds 1MB'});
      await sql`INSERT INTO task_messages (company_id, from_user_id, to_user_id, body, photo)
        VALUES (${companyId}, ${userId}, ${to_user_id}, ${msgBody}, ${photo||null})`;
      return res.json({ok:true});
    }

    // ── ack_message: user acknowledges a message ──
    if (action === 'ack_message') {
      const { message_id } = body;
      await sql`UPDATE task_messages SET acknowledged=TRUE, acknowledged_at=NOW()
        WHERE id=${message_id} AND to_user_id=${userId}`;
      return res.json({ok:true});
    }

    // ── log_session: track time in app ──
    if (action === 'log_session') {
      const { task_time_seconds } = body;
      await sql`INSERT INTO engagement_logs (company_id, user_id, session_date, task_time_seconds)
        VALUES (${companyId}, ${userId}, CURRENT_DATE, ${task_time_seconds||0})`;
      return res.json({ok:true});
    }

    // ── delete_task: admin soft-deletes a task ──
    if (action === 'delete_task') {
      if (user.role !== 'admin') return res.status(403).json({error:'Admin only'});
      const { task_id } = body;
      await sql`UPDATE tasks SET is_active=FALSE WHERE id=${task_id} AND company_id=${companyId}`;
      return res.json({ok:true});
    }

    // ── spawn_instances: create today's recurring task instances ──
    if (action === 'spawn_instances') {
      const dayName = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'][new Date().getDay()];
      const recurringTasks = await sql`
        SELECT t.id, t.assigned_to, t.recurring, t.recurring_days, t.due_date
        FROM tasks t
        WHERE t.company_id=${companyId}
          AND t.is_active=TRUE
          AND t.recurring != 'none'`;
      let spawned = 0;
      for (const task of recurringTasks) {
        if (task.recurring === 'weekly') {
          const days = (task.recurring_days || '').split(',');
          const shortDay = dayName.substring(0,3);
          if (!days.some(d => d.trim().toLowerCase() === shortDay.toLowerCase())) continue;
        }
        const assignees = task.assigned_to === 'all'
          ? await sql`SELECT id FROM users WHERE company_id=${companyId}`
          : await sql`SELECT id FROM users WHERE id=${parseInt(task.assigned_to)} AND company_id=${companyId}`;
        for (const u of assignees) {
          const exists = await sql`SELECT id FROM task_instances WHERE task_id=${task.id} AND assigned_to=${u.id} AND instance_date=${today}`;
          if (!exists.length) {
            await sql`INSERT INTO task_instances (task_id, company_id, assigned_to, instance_date)
              VALUES (${task.id}, ${companyId}, ${u.id}, ${today})`;
            spawned++;
          }
        }
      }
      return res.json({ok:true, spawned});
    }

    return res.status(400).json({error:'Unknown action: ' + action});

  } catch(e) {
    return res.status(500).json({error: e.message, userId, companyId, action});
  }
};
