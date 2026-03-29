const puppeteer = require("puppeteer-core");
const http = require("http");

const BROWSERLESS_TOKEN = process.env.BROWSERLESS_TOKEN || "";
const WORLD_URL = process.env.TOPIA_WORLD_URL || "https://topia.io/relaxwithadam";
const WORLD_PASSWORD = process.env.TOPIA_WORLD_PASSWORD || "breathe";
const AGENT_NAME = process.env.AGENT_NAME || "Commander";
const PORT = process.env.PORT || 7860;

let botStatus = "starting";
let lastScreenshot = null;
let reconnectAttempts = 0;

// Health server
http.createServer((req, res) => {
  if (req.url === "/screenshot" && lastScreenshot) {
    res.writeHead(200, { "Content-Type": "image/png" });
    res.end(lastScreenshot);
    return;
  }
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ agent: AGENT_NAME, status: botStatus, uptime: process.uptime(), reconnects: reconnectAttempts }));
}).listen(PORT, () => console.log(`Health server on :${PORT}`));

async function enterWorld() {
  console.log(`=== ${AGENT_NAME} connecting via Browserless ===`);
  botStatus = "connecting";

  const browser = await puppeteer.connect({
    browserWSEndpoint: `wss://chrome.browserless.io?token=${BROWSERLESS_TOKEN}`,
  });
  console.log("Connected to Browserless");

  const page = await browser.newPage();
  await page.goto(WORLD_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
  console.log("Page loaded");
  botStatus = "loading";

  // Wait for form inputs
  for (let i = 0; i < 20; i++) {
    const count = await page.evaluate(() => document.querySelectorAll("input").length);
    if (count > 0) break;
    await new Promise((r) => setTimeout(r, 2000));
  }
  await new Promise((r) => setTimeout(r, 3000));

  // Focus and type into Display Name (#displayName — index 1, index 0 is hidden HubSpot)
  await page.evaluate(() => document.getElementById("displayName").focus());
  await page.keyboard.type(AGENT_NAME, { delay: 30 });
  console.log("Typed name:", AGENT_NAME);

  // Focus and type password
  await page.evaluate(() => document.getElementById("password").focus());
  await page.keyboard.type(WORLD_PASSWORD, { delay: 30 });
  console.log("Typed password");

  // Verify
  const vals = await page.evaluate(() => ({
    name: document.getElementById("displayName").value,
    pass: document.getElementById("password").value,
  }));
  console.log("Form values:", vals);

  await new Promise((r) => setTimeout(r, 1000));

  // Press Enter to submit
  await page.evaluate(() => document.getElementById("password").focus());
  await page.keyboard.press("Enter");
  console.log("Pressed Enter");

  // Wait for world to load
  await new Promise((r) => setTimeout(r, 20000));

  const state = await page.evaluate(() => ({
    formVisible: !!document.getElementById("displayName"),
    canvases: document.querySelectorAll("canvas").length,
  }));

  if (state.formVisible) {
    throw new Error("Form still visible after submit — entry failed");
  }

  lastScreenshot = await page.screenshot();
  botStatus = "in-world";
  console.log(`${AGENT_NAME} is in the world!`);

  // Keepalive loop — screenshot every 30s, detect disconnection
  const keepalive = setInterval(async () => {
    try {
      lastScreenshot = await page.screenshot();
      console.log(new Date().toISOString(), AGENT_NAME, "alive");
    } catch (e) {
      console.error("Keepalive failed:", e.message);
      clearInterval(keepalive);
      botStatus = "disconnected";
      // Trigger reconnect
      reconnect();
    }
  }, 30000);

  // Handle browser disconnect
  browser.on("disconnected", () => {
    console.log("Browser disconnected");
    clearInterval(keepalive);
    botStatus = "disconnected";
    reconnect();
  });
}

async function reconnect() {
  reconnectAttempts++;
  const delay = Math.min(30000, 5000 * reconnectAttempts);
  console.log(`Reconnecting in ${delay / 1000}s (attempt ${reconnectAttempts})...`);
  botStatus = `reconnecting (${reconnectAttempts})`;
  await new Promise((r) => setTimeout(r, delay));

  try {
    await enterWorld();
    reconnectAttempts = 0;
  } catch (e) {
    console.error("Reconnect failed:", e.message);
    botStatus = "reconnect-failed: " + e.message;
    reconnect();
  }
}

// Start
enterWorld().catch((e) => {
  console.error("Fatal:", e.message);
  botStatus = "crashed: " + e.message;
  reconnect();
});
