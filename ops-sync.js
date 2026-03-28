// Syncs agent activity from agent-log.json to mission-control-ops Supabase DB
// Watches for changes and POSTs to the ops API

const fs = require('fs');
const path = require('path');

const OPS_API_URL = process.env.OPS_API_URL || 'https://mission-control-mu-gold.vercel.app/api/agents';
const OPS_SUPABASE_URL = 'https://xqxakajrxvvalvvialnu.supabase.co';
const OPS_SERVICE_KEY = process.env.OPS_SERVICE_KEY;
const AGENT_LOG_PATH = path.resolve(__dirname, '..', 'agent-log.json');

let lastSyncedLogCount = 0;
let currentSessionDbId = null;

async function supaPost(table, data) {
  if (!OPS_SERVICE_KEY) return null;
  const res = await fetch(`${OPS_SUPABASE_URL}/rest/v1/${table}`, {
    method: 'POST',
    headers: {
      'apikey': OPS_SERVICE_KEY,
      'Authorization': `Bearer ${OPS_SERVICE_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=representation',
    },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    console.error(`[ops-sync] POST ${table} failed: ${res.status}`);
    return null;
  }
  return await res.json();
}

async function supaPatch(table, filter, data) {
  if (!OPS_SERVICE_KEY) return;
  await fetch(`${OPS_SUPABASE_URL}/rest/v1/${table}?${filter}`, {
    method: 'PATCH',
    headers: {
      'apikey': OPS_SERVICE_KEY,
      'Authorization': `Bearer ${OPS_SERVICE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(data),
  });
}

async function syncSession(data) {
  if (!data.session || currentSessionDbId) return;

  console.log('[ops-sync] Creating session:', data.session.id);
  const result = await supaPost('agent_sessions', {
    session_id: data.session.id,
    started_at: data.session.started || new Date().toISOString(),
    commander_model: data.session.commander || 'unknown',
    status: 'active',
  });

  if (result && result.length > 0) {
    currentSessionDbId = result[0].id;
    console.log('[ops-sync] Session created:', currentSessionDbId);
  }
}

async function syncAgents(data) {
  if (!currentSessionDbId || !data.agents) return;

  for (const agent of data.agents) {
    // Upsert: check if exists, update or insert
    const checkRes = await fetch(
      `${OPS_SUPABASE_URL}/rest/v1/agents?session_id=eq.${currentSessionDbId}&agent_id=eq.${agent.id}&select=id`,
      { headers: { 'apikey': OPS_SERVICE_KEY, 'Authorization': `Bearer ${OPS_SERVICE_KEY}` } }
    );

    if (checkRes.ok) {
      const existing = await checkRes.json();
      if (existing.length > 0) {
        // Update
        await supaPatch('agents',
          `session_id=eq.${currentSessionDbId}&agent_id=eq.${agent.id}`,
          {
            status: agent.status === 'active' ? 'active' : agent.status === 'completed' ? 'completed' : agent.status,
            location: agent.location,
            project_slug: agent.location,
            task: agent.task,
            speech: agent.speech,
            updated_at: new Date().toISOString(),
          }
        );
      } else {
        // Insert
        await supaPost('agents', {
          session_id: currentSessionDbId,
          agent_id: agent.id,
          name: agent.name,
          role: agent.role,
          color: agent.color,
          status: agent.status === 'active' ? 'active' : agent.status === 'completed' ? 'completed' : agent.status,
          location: agent.location,
          project_slug: agent.location,
          task: agent.task,
          speech: agent.speech,
          spawned_by: agent.id !== 'commander' ? 'commander' : null,
        });
      }
    }
  }
}

async function syncLog(data) {
  if (!currentSessionDbId || !data.log) return;

  const newEntries = data.log.slice(lastSyncedLogCount);
  if (newEntries.length === 0) return;

  console.log(`[ops-sync] Syncing ${newEntries.length} new log entries`);

  for (const entry of newEntries) {
    const isSecurity = /rls|policy|security|bypass|search_path|extension|smtp|password/i.test(entry.action);
    await supaPost('agent_log', {
      session_id: currentSessionDbId,
      agent_id: entry.agent,
      action: entry.action,
      is_security: isSecurity,
    });
  }

  lastSyncedLogCount = data.log.length;
}

async function fullSync() {
  let data;
  try {
    data = JSON.parse(fs.readFileSync(AGENT_LOG_PATH, 'utf8'));
  } catch {
    return;
  }

  await syncSession(data);
  await syncAgents(data);
  await syncLog(data);
}

// Watch for changes
let syncTimer = null;
function startWatching() {
  if (!OPS_SERVICE_KEY) {
    console.log('[ops-sync] No OPS_SERVICE_KEY set, skipping Supabase sync');
    return;
  }

  console.log('[ops-sync] Starting Supabase sync for agent activity');

  // Initial sync
  fullSync().catch(err => console.error('[ops-sync] Initial sync error:', err.message));

  // Watch for file changes
  try {
    fs.watchFile(AGENT_LOG_PATH, { interval: 3000 }, () => {
      console.log('[ops-sync] agent-log.json changed, syncing...');
      if (syncTimer) clearTimeout(syncTimer);
      syncTimer = setTimeout(() => {
        fullSync().catch(err => console.error('[ops-sync] Sync error:', err.message));
      }, 500);
    });
  } catch (err) {
    console.error('[ops-sync] Watch error:', err.message);
  }
}

module.exports = { startWatching, fullSync };
