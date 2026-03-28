// Simple health check server for HuggingFace Spaces (needs port 7860)
const http = require('http');
http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ status: 'running', agent: process.env.AGENT_ID || 'commander', uptime: process.uptime() }));
}).listen(7860, () => console.log('Health check on :7860'));
