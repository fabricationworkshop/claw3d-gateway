const { readAgentLog, getAgentsExtended, resolveAgentState } = require('./agents');
const crypto = require('crypto');

// In-memory standup state
let currentMeeting = null;

const DEFAULT_CONFIG = {
  enabled: true,
  scheduleEnabled: false,
  scheduleCron: '0 9 * * 1-5',
  speakerSeconds: 30,
  autoAdvance: true,
  sources: {
    github: { enabled: false },
    jira: { enabled: false },
    manual: { enabled: true },
  },
};

/**
 * Build standup summary cards from agent-log.json
 */
function buildCards() {
  const data = readAgentLog();
  const agents = getAgentsExtended();

  return agents.map(agent => {
    const agentLogs = data.log.filter(l => l.agent === agent.id);
    const recentLogs = agentLogs.slice(-5);

    // Build speech from recent activity
    const speech = agent.speech || (recentLogs.length > 0
      ? recentLogs[recentLogs.length - 1].action
      : 'No recent activity.');

    // Extract current task
    const currentTask = agent.task || 'No active task';

    // Derive blockers (none for completed agents)
    const blockers = agent.status === 'error' ? ['Encountered an error during execution'] : [];

    return {
      agentId: agent.id,
      agentName: agent.name,
      speech: speech.length > 120 ? speech.substring(0, 117) + '...' : speech,
      currentTask,
      blockers,
      recentCommits: recentLogs.map(l => ({
        sha: crypto.createHash('md5').update(l.action).digest('hex').substring(0, 7),
        message: l.action,
        timestamp: l.time,
      })),
      activeTickets: [],
      manualNotes: [],
      sourceStates: [
        { source: 'manual', status: 'ok', lastFetched: new Date().toISOString() },
      ],
    };
  });
}

/**
 * GET /api/office/standup/config
 */
function getConfig(req, res) {
  res.json(DEFAULT_CONFIG);
}

/**
 * GET /api/office/standup/meeting
 */
function getMeeting(req, res) {
  if (!currentMeeting) {
    return res.json({ meeting: null });
  }
  res.json({ meeting: currentMeeting });
}

/**
 * POST /api/office/standup/meeting/start
 */
function startMeeting(req, res) {
  const agents = getAgentsExtended();
  const cards = buildCards();
  const participantOrder = agents.map(a => a.id);

  currentMeeting = {
    id: crypto.randomUUID(),
    trigger: 'manual',
    phase: 'gathering',
    scheduledFor: null,
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    completedAt: null,
    currentSpeakerAgentId: null,
    speakerStartedAt: null,
    speakerDurationMs: DEFAULT_CONFIG.speakerSeconds * 1000,
    participantOrder,
    arrivedAgentIds: [],
    cards,
  };

  // Auto-progress: all agents arrive immediately, start first speaker
  currentMeeting.arrivedAgentIds = [...participantOrder];
  currentMeeting.phase = 'in_progress';
  currentMeeting.currentSpeakerAgentId = participantOrder[0];
  currentMeeting.speakerStartedAt = new Date().toISOString();
  currentMeeting.updatedAt = new Date().toISOString();

  console.log(`[standup] Meeting started: ${currentMeeting.id} with ${agents.length} agents`);
  res.json({ meeting: currentMeeting });
}

/**
 * PUT /api/office/standup/meeting — state machine actions
 */
function updateMeeting(req, res) {
  if (!currentMeeting) {
    return res.status(404).json({ error: 'No active meeting' });
  }

  const { action, arrivedAgentIds, speakerAgentId } = req.body || {};

  switch (action) {
    case 'arrivals':
      if (arrivedAgentIds) {
        currentMeeting.arrivedAgentIds = [
          ...new Set([...currentMeeting.arrivedAgentIds, ...arrivedAgentIds]),
        ];
      }
      break;

    case 'start':
      currentMeeting.phase = 'in_progress';
      currentMeeting.currentSpeakerAgentId = speakerAgentId || currentMeeting.participantOrder[0];
      currentMeeting.speakerStartedAt = new Date().toISOString();
      break;

    case 'advance': {
      const idx = currentMeeting.participantOrder.indexOf(currentMeeting.currentSpeakerAgentId);
      if (idx < currentMeeting.participantOrder.length - 1) {
        currentMeeting.currentSpeakerAgentId = currentMeeting.participantOrder[idx + 1];
        currentMeeting.speakerStartedAt = new Date().toISOString();
      } else {
        currentMeeting.phase = 'complete';
        currentMeeting.completedAt = new Date().toISOString();
        currentMeeting.currentSpeakerAgentId = null;
      }
      break;
    }

    case 'complete':
      currentMeeting.phase = 'complete';
      currentMeeting.completedAt = new Date().toISOString();
      currentMeeting.currentSpeakerAgentId = null;
      break;

    default:
      return res.status(400).json({ error: `Unknown action: ${action}` });
  }

  currentMeeting.updatedAt = new Date().toISOString();
  res.json({ meeting: currentMeeting });
}

module.exports = {
  getConfig,
  getMeeting,
  startMeeting,
  updateMeeting,
};
