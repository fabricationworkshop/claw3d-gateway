const http = require('http');
const express = require('express');
const { WebSocketServer } = require('ws');
const crypto = require('crypto');
const fs = require('fs');

const { getAgentsList, getStatus, readAgentLog, AGENT_LOG_PATH } = require('./agents');
const { getSessionPreviews, getSessionsList } = require('./sessions');
const standup = require('./standup');

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------
const PORT = process.env.PORT || 18789;
const HEARTBEAT_INTERVAL_MS = 10000;
const POLL_INTERVAL_MS = 2000;

// ---------------------------------------------------------------------------
// Express HTTP server (standup endpoints)
// ---------------------------------------------------------------------------
const app = express();
app.use(express.json());

// CORS — allow Claw3D Studio to reach us
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// Standup HTTP routes
app.get('/api/office/standup/config', standup.getConfig);
app.get('/api/office/standup/meeting', standup.getMeeting);
app.post('/api/office/standup/meeting/start', standup.startMeeting);
app.put('/api/office/standup/meeting', standup.updateMeeting);

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', adapter: 'claw3d-gateway', protocol: 3, uptime: process.uptime() });
});

// ---------------------------------------------------------------------------
// HTTP + WebSocket server
// ---------------------------------------------------------------------------
const server = http.createServer(app);

const wss = new WebSocketServer({ noServer: true });

server.on('upgrade', (request, socket, head) => {
  console.log(`[ws] Upgrade request from ${request.headers.host} path=${request.url}`);
  wss.handleUpgrade(request, socket, head, (ws) => {
    wss.emit('connection', ws, request);
  });
});

// ---------------------------------------------------------------------------
// Global event sequence counter (monotonic)
// ---------------------------------------------------------------------------
let globalSeq = 0;
function nextSeq() { return ++globalSeq; }

// ---------------------------------------------------------------------------
// Track last agent-log.json mtime for change detection
// ---------------------------------------------------------------------------
let lastLogMtime = 0;
try {
  lastLogMtime = fs.statSync(AGENT_LOG_PATH).mtimeMs;
} catch (e) { /* ignore */ }

// ---------------------------------------------------------------------------
// WebSocket connection handler
// ---------------------------------------------------------------------------
wss.on('connection', (ws, req) => {
  console.log(`[ws] New connection from ${req.socket.remoteAddress}`);

  let authenticated = false;
  let heartbeatTimer = null;
  let pollTimer = null;

  // --- Send helper ---
  function send(obj) {
    const msg = JSON.stringify(obj);
    console.log(`[ws] >>> ${msg.substring(0, 200)}${msg.length > 200 ? '...' : ''}`);
    ws.send(msg);
  }

  // --- Send event helper ---
  function sendEvent(event, payload) {
    send({
      type: 'event',
      event,
      payload: payload || {},
      seq: nextSeq(),
    });
  }

  // --- RPC method handlers ---
  function handleMethod(id, method, params) {
    switch (method) {

      // ===================== Connection =====================
      case 'connect': {
        authenticated = true;
        const agentList = getAgentsList();
        send({
          type: 'res',
          id,
          ok: true,
          payload: {
            type: 'hello-ok',
            protocol: 3,
            features: {
              methods: [
                'connect', 'agents.list', 'status',
                'sessions.list', 'sessions.preview',
                'chat.send', 'chat.history',
              ],
              events: ['presence', 'heartbeat', 'chat', 'agent'],
            },
            snapshot: {
              health: {
                agents: agentList.agents.map(a => ({
                  agentId: a.id,
                  name: a.identity.name,
                  isDefault: a.id === 'commander',
                })),
                defaultAgentId: 'commander',
              },
              sessionDefaults: {
                mainKey: 'main',
                scope: 'operator',
              },
            },
            auth: {
              deviceToken: 'adapter-token-' + crypto.randomUUID(),
              role: 'operator',
              scopes: ['operator.admin', 'operator.approvals', 'operator.pairing'],
              issuedAtMs: Date.now(),
            },
            policy: {
              tickIntervalMs: HEARTBEAT_INTERVAL_MS,
            },
          },
        });

        // Start heartbeat and polling after connect
        startHeartbeat();
        startPolling();
        break;
      }

      // ===================== Agents =====================
      case 'agents.list': {
        send({ type: 'res', id, ok: true, payload: getAgentsList() });
        break;
      }

      // ===================== Status =====================
      case 'status': {
        send({ type: 'res', id, ok: true, payload: getStatus() });
        break;
      }

      // ===================== Sessions =====================
      case 'sessions.list': {
        const agentId = params && params.agentId;
        send({ type: 'res', id, ok: true, payload: getSessionsList(agentId) });
        break;
      }

      case 'sessions.preview': {
        const keys = (params && params.keys) || [];
        const limit = (params && params.limit) || 8;
        const maxChars = (params && params.maxChars) || 240;
        send({ type: 'res', id, ok: true, payload: getSessionPreviews(keys, limit, maxChars) });
        break;
      }

      case 'sessions.patch': {
        send({
          type: 'res', id, ok: true,
          payload: {
            ok: true,
            key: params && params.key,
            entry: { thinkingLevel: (params && params.thinkingLevel) || 'normal' },
            resolved: { modelProvider: 'anthropic', model: 'claude-sonnet-4' },
          },
        });
        break;
      }

      case 'sessions.reset': {
        send({ type: 'res', id, ok: true, payload: { ok: true } });
        break;
      }

      // ===================== Chat =====================
      case 'chat.send': {
        const sessionKey = params && params.sessionKey;
        const message = params && params.message;
        const runId = crypto.randomUUID();
        console.log(`[chat] Received message for ${sessionKey}: "${message}"`);

        send({ type: 'res', id, ok: true, payload: { runId } });

        // Send a stub chat event (acknowledge receipt, no real LLM call yet)
        setTimeout(() => {
          sendEvent('chat', {
            runId,
            sessionKey,
            state: 'final',
            seq: nextSeq(),
            stopReason: 'end_turn',
            message: {
              role: 'assistant',
              content: `[Gateway Adapter] Message received. Chat forwarding to Claude not yet wired. Your message: "${message}"`,
            },
          });
        }, 500);
        break;
      }

      case 'chat.history': {
        send({ type: 'res', id, ok: true, payload: { messages: [] } });
        break;
      }

      case 'chat.abort': {
        send({ type: 'res', id, ok: true, payload: { ok: true } });
        break;
      }

      // ===================== Runtime =====================
      case 'agent.wait': {
        send({ type: 'res', id, ok: true, payload: { ok: true } });
        break;
      }

      case 'wake': {
        send({ type: 'res', id, ok: true, payload: { ok: true } });
        break;
      }

      // ===================== Config =====================
      case 'config.get': {
        send({
          type: 'res', id, ok: true,
          payload: {
            config: { adapter: 'claw3d-gateway-adapter', version: '1.0.0' },
            hash: crypto.createHash('md5').update('config').digest('hex'),
            exists: true,
            path: null,
          },
        });
        break;
      }

      case 'models.list': {
        send({
          type: 'res', id, ok: true,
          payload: {
            models: [
              { id: 'claude-opus-4-6', name: 'Claude Opus 4.6', provider: 'anthropic' },
              { id: 'claude-sonnet-4', name: 'Claude Sonnet 4', provider: 'anthropic' },
            ],
          },
        });
        break;
      }

      // ===================== Exec Approvals (stubs) =====================
      case 'exec.approvals.get': {
        send({
          type: 'res', id, ok: true,
          payload: {
            path: '/approvals',
            exists: true,
            hash: 'none',
            file: { version: 1, defaults: { security: 'full', ask: 'off' }, agents: {} },
          },
        });
        break;
      }

      // ===================== Skills (stub) =====================
      case 'skills.status': {
        send({ type: 'res', id, ok: true, payload: { skills: [] } });
        break;
      }

      // ===================== Cron (stub) =====================
      case 'cron.list': {
        send({ type: 'res', id, ok: true, payload: { jobs: [] } });
        break;
      }

      // ===================== Usage (stub) =====================
      case 'sessions.usage':
      case 'usage.cost': {
        send({ type: 'res', id, ok: true, payload: {} });
        break;
      }

      // ===================== Unknown =====================
      default: {
        console.log(`[ws] Unknown method: ${method}`);
        send({
          type: 'res',
          id,
          ok: false,
          error: {
            code: 'UNKNOWN_METHOD',
            message: `Method "${method}" is not implemented`,
            retryable: false,
          },
        });
      }
    }
  }

  // --- Heartbeat timer ---
  function startHeartbeat() {
    heartbeatTimer = setInterval(() => {
      if (ws.readyState === ws.OPEN) {
        sendEvent('heartbeat');
      }
    }, HEARTBEAT_INTERVAL_MS);
  }

  // --- Agent-log.json change polling ---
  function startPolling() {
    pollTimer = setInterval(() => {
      try {
        const stat = fs.statSync(AGENT_LOG_PATH);
        if (stat.mtimeMs > lastLogMtime) {
          lastLogMtime = stat.mtimeMs;
          console.log('[poll] agent-log.json changed, pushing presence event');
          if (ws.readyState === ws.OPEN) {
            sendEvent('presence');
          }
        }
      } catch (e) { /* file may not exist yet */ }
    }, POLL_INTERVAL_MS);
  }

  // --- Incoming message handler ---
  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch (err) {
      console.error('[ws] Invalid JSON:', raw.toString().substring(0, 100));
      return;
    }

    console.log(`[ws] <<< ${JSON.stringify(msg).substring(0, 200)}`);

    if (msg.type === 'req') {
      // First message must be connect
      if (!authenticated && msg.method !== 'connect') {
        console.log('[ws] First message was not connect, closing');
        ws.close(4008, 'First message must be connect');
        return;
      }
      handleMethod(msg.id, msg.method, msg.params);
    }
  });

  // --- Cleanup on close ---
  ws.on('close', (code, reason) => {
    console.log(`[ws] Connection closed: ${code} ${reason}`);
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    if (pollTimer) clearInterval(pollTimer);
  });

  ws.on('error', (err) => {
    console.error('[ws] Error:', err.message);
  });
});

// ---------------------------------------------------------------------------
// Start server
// ---------------------------------------------------------------------------
server.listen(PORT, () => {
  console.log('='.repeat(60));
  console.log('  Claw3D Gateway Adapter');
  console.log('  Protocol: v3');
  console.log(`  WebSocket: ws://localhost:${PORT}/api/gateway/ws`);
  console.log(`  HTTP:      http://localhost:${PORT}`);
  console.log(`  Standup:   http://localhost:${PORT}/api/office/standup/meeting`);
  console.log(`  Health:    http://localhost:${PORT}/health`);
  console.log('='.repeat(60));
});
