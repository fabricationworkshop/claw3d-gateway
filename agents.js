const fs = require('fs');
const path = require('path');

const AGENT_LOG_PATH = path.resolve(__dirname, '..', 'agent-log.json');

// Claw3D agent schema mapping from our agent-log.json
const AGENT_MODELS = {
  'commander':      { model: 'claude-opus-4-6', provider: 'anthropic', prompt: 'You are Commander, the orchestrator agent coordinating all operations.' },
  'security-scout': { model: 'claude-sonnet-4', provider: 'anthropic', prompt: 'You are Security Scout, specializing in database security and RLS policy auditing.' },
  'perf-knight':    { model: 'claude-sonnet-4', provider: 'anthropic', prompt: 'You are Performance Knight, specializing in query optimization and RLS initplan fixes.' },
  'index-ranger':   { model: 'claude-sonnet-4', provider: 'anthropic', prompt: 'You are Index Ranger, specializing in database indexing and foreign key optimization.' },
  'build-fixer':    { model: 'claude-sonnet-4', provider: 'anthropic', prompt: 'You are Build Fixer, specializing in deploy engineering and CI/CD troubleshooting.' },
  'deep-scanner':   { model: 'claude-sonnet-4', provider: 'anthropic', prompt: 'You are Deep Scanner, specializing in deep code analysis and large-batch database fixes.' },
  'three-builder':  { model: 'claude-sonnet-4', provider: 'anthropic', prompt: 'You are 3D Architect, specializing in Three.js scene building and WebGL rendering.' },
};

const AGENT_SKILLS = {
  'commander':      ['orchestration', 'project-scanning', 'agent-spawning'],
  'security-scout': ['rls-audit', 'policy-fix', 'schema-security'],
  'perf-knight':    ['query-optimization', 'initplan-fix', 'performance-audit'],
  'index-ranger':   ['index-creation', 'fk-analysis', 'data-pathfinding'],
  'build-fixer':    ['build-debug', 'vercel-deploy', 'dependency-fix'],
  'deep-scanner':   ['bulk-analysis', 'policy-optimization', 'deep-scan'],
  'three-builder':  ['threejs', 'webgl', 'scene-building', '3d-rendering'],
};

function readAgentLog() {
  try {
    const raw = fs.readFileSync(AGENT_LOG_PATH, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    console.error('[agents] Failed to read agent-log.json:', err.message);
    return { agents: [], log: [] };
  }
}

/**
 * Returns agents in Claw3D's agents.list format
 */
function getAgentsList() {
  const data = readAgentLog();
  const agents = data.agents.map(a => ({
    id: a.id,
    name: a.name || a.id,
    identity: {
      name: a.name || a.id,
      theme: a.role || 'agent',
      emoji: getAgentEmoji(a.id),
      avatar: null,
      avatarUrl: null,
    },
    // Extra fields for our mission control frontend
    status: a.status || 'active',
    location: a.location || 'command-center',
    room: a.location || 'command-center',
    speech: a.speech || '',
    task: a.task || '',
    currentTask: a.task || '',
    color: a.color || '#888888',
    role: a.role || 'Agent',
  }));

  return {
    defaultId: 'commander',
    mainKey: 'main',
    scope: 'operator',
    agents,
  };
}

/**
 * Returns status snapshot in Claw3D's status format
 */
function getStatus() {
  const data = readAgentLog();
  const now = Date.now();

  const byAgent = data.agents.map(a => {
    const statusMap = {
      'active': 'working',
      'completed': 'idle',
      'error': 'error',
      'idle': 'idle',
    };
    const agentLogs = data.log.filter(l => l.agent === a.id);
    const lastLog = agentLogs[agentLogs.length - 1];
    // Use session start + log time offset as updatedAt
    const sessionStart = data.session ? new Date(data.session.started).getTime() : now;
    let updatedAt = null;
    if (lastLog && lastLog.time) {
      const [h, m] = lastLog.time.split(':').map(Number);
      updatedAt = sessionStart + (h * 3600000) + (m * 60000);
    }

    return {
      agentId: a.id,
      recent: [{
        key: `agent:${a.id}:main`,
        updatedAt,
      }],
    };
  });

  return {
    sessions: {
      recent: byAgent.map(b => b.recent[0]),
      byAgent,
    },
  };
}

/**
 * Map our status field to Claw3D's OfficeAgentState
 */
function resolveAgentState(status) {
  switch (status) {
    case 'active': return 'working';
    case 'completed': return 'idle';
    case 'error': return 'error';
    default: return 'idle';
  }
}

/**
 * Get full agent data for extended schema
 */
function getAgentsExtended() {
  const data = readAgentLog();
  return data.agents.map(a => {
    const meta = AGENT_MODELS[a.id] || { model: 'claude-sonnet-4', provider: 'anthropic', prompt: '' };
    return {
      id: a.id,
      name: a.name || a.id,
      model: meta.model,
      modelProvider: meta.provider,
      systemPrompt: meta.prompt,
      skills: AGENT_SKILLS[a.id] || [],
      createdAt: data.session ? new Date(data.session.started).toISOString() : new Date().toISOString(),
      projectPath: a.location || 'command-center',
      role: a.role,
      color: a.color,
      status: resolveAgentState(a.status),
      speech: a.speech,
      task: a.task,
    };
  });
}

function getAgentEmoji(id) {
  const map = {
    'commander': '\u2694\uFE0F',
    'security-scout': '\uD83D\uDEE1\uFE0F',
    'perf-knight': '\u26A1',
    'index-ranger': '\uD83C\uDFF9',
    'build-fixer': '\uD83D\uDD27',
    'deep-scanner': '\uD83D\uDD2D',
    'three-builder': '\uD83C\uDFD7\uFE0F',
  };
  return map[id] || '\uD83E\uDD16';
}

module.exports = {
  readAgentLog,
  getAgentsList,
  getStatus,
  getAgentsExtended,
  resolveAgentState,
  AGENT_LOG_PATH,
};
