const { readAgentLog } = require('./agents');

/**
 * Returns session previews in Claw3D's sessions.preview format.
 * Maps our agent-log.json activity log entries to preview items.
 */
function getSessionPreviews(keys, limit = 8, maxChars = 240) {
  const data = readAgentLog();
  const sessionStart = data.session ? new Date(data.session.started).getTime() : Date.now();

  const previews = keys.map(key => {
    // Parse session key: "agent:<agentId>:<mainKey>"
    const parts = key.split(':');
    const agentId = parts[1] || key;

    // Find log entries for this agent
    const agentLogs = data.log.filter(l => l.agent === agentId);

    if (agentLogs.length === 0) {
      return { key, status: 'empty', items: [] };
    }

    // Convert log entries to preview items
    const items = agentLogs.slice(-limit).map(entry => {
      const [h, m] = (entry.time || '00:00').split(':').map(Number);
      const timestamp = sessionStart + (h * 3600000) + (m * 60000);
      const text = entry.action.length > maxChars
        ? entry.action.substring(0, maxChars) + '...'
        : entry.action;

      return {
        role: 'assistant',
        text,
        timestamp,
      };
    });

    // Also find the agent's speech/current status and prepend as "user" context
    const agent = data.agents.find(a => a.id === agentId);
    if (agent && agent.task) {
      items.unshift({
        role: 'user',
        text: `Task: ${agent.task}`,
        timestamp: sessionStart,
      });
    }

    return { key, status: 'ok', items: items.slice(-limit) };
  });

  return {
    ts: Date.now(),
    previews,
  };
}

/**
 * Returns empty sessions list (stub for now).
 */
function getSessionsList(agentId) {
  const data = readAgentLog();
  const agents = agentId
    ? data.agents.filter(a => a.id === agentId)
    : data.agents;

  return {
    sessions: agents.map(a => ({
      key: `agent:${a.id}:main`,
      updatedAt: Date.now(),
      displayName: `${a.name} Session`,
      origin: { label: 'gateway-adapter', provider: 'custom' },
      thinkingLevel: 'normal',
      modelProvider: 'anthropic',
      model: 'claude-sonnet-4',
      execHost: 'node',
      execSecurity: 'full',
      execAsk: 'off',
    })),
  };
}

module.exports = {
  getSessionPreviews,
  getSessionsList,
};
