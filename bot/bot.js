const { chromium } = require("playwright");
const http = require("http");

const WORLD_URL = process.env.TOPIA_WORLD_URL || "https://topia.io/relaxwithadam";
const WORLD_PASSWORD = process.env.TOPIA_WORLD_PASSWORD || "breathe";
const AGENT_NAME = process.env.AGENT_NAME || "Commander";

let botStatus = "starting";
let lastScreenshot = null;

// Health server on port 7860 (required by HuggingFace)
http.createServer((req, res) => {
  if (req.url === "/screenshot" && lastScreenshot) {
    res.writeHead(200, {"Content-Type": "image/png"});
    res.end(lastScreenshot);
    return;
  }
  res.writeHead(200, {"Content-Type": "application/json"});
  res.end(JSON.stringify({agent: AGENT_NAME, status: botStatus, uptime: process.uptime()}));
}).listen(7860, () => console.log("Health server on :7860")).on('error', (e) => {
  if (e.code === 'EADDRINUSE') console.log("Port 7860 already in use, skipping health server");
  else throw e;
});

async function main() {
  console.log("=== Agent Bot:", AGENT_NAME, "===");
  console.log("World:", WORLD_URL);

  const browser = await chromium.launch({
    headless: true,
    args: [
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--use-fake-ui-for-media-stream",
      "--use-fake-device-for-media-stream",
      "--auto-accept-camera-and-microphone-capture",
    ],
  });

  console.log("Browser launched");
  const context = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    permissions: ["microphone", "camera"],
    ignoreHTTPSErrors: true,
  });
  const page = await context.newPage();

  console.log("Navigating to Topia...");
  botStatus = "loading";
  await page.goto(WORLD_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
  console.log("DOM loaded, waiting for UI...");

  // Wait for React to render — look for any input
  let foundForm = false;
  for (let i = 0; i < 30; i++) {
    const inputs = await page.locator("input").count();
    if (inputs > 0) { foundForm = true; break; }
    await page.waitForTimeout(2000);
    console.log(`Waiting for form... attempt ${i+1}/30`);
  }

  if (!foundForm) {
    const text = await page.textContent("body") || "empty";
    console.log("Page content:", text.substring(0, 500));
    lastScreenshot = await page.screenshot();

    if (text.toLowerCase().includes('gpu') || text.toLowerCase().includes('webgl') || text.toLowerCase().includes('browser')) {
      console.log("Detected GPU/WebGL error page");
      botStatus = "error-gpu: " + text.substring(0, 100);
    } else {
      botStatus = "error-no-form: " + text.substring(0, 100);
    }
    return;
  }

  await page.waitForTimeout(1000);
  botStatus = "entering";

  // Fill display name
  const inputs = await page.locator("input").all();
  console.log(`Found ${inputs.length} inputs`);

  if (inputs.length >= 1) {
    await inputs[0].fill(AGENT_NAME);
    console.log("Filled name:", AGENT_NAME);
  }

  // Fill password if present
  if (inputs.length >= 2 && WORLD_PASSWORD) {
    await inputs[1].fill(WORLD_PASSWORD);
    console.log("Filled password");
  }

  await page.waitForTimeout(1000);

  // Click Enter World
  const enterButton = page.locator("button", { hasText: /enter/i });
  if (await enterButton.count() > 0) {
    await enterButton.first().click();
    console.log("Clicked Enter World");
  }

  // Wait for world to load
  await page.waitForTimeout(15000);
  lastScreenshot = await page.screenshot();
  botStatus = "in-world";
  console.log(`${AGENT_NAME} is in the world!`);

  // Periodic screenshot + keepalive
  setInterval(async () => {
    try {
      lastScreenshot = await page.screenshot();
      console.log(new Date().toISOString(), AGENT_NAME, "alive");
    } catch (e) {
      console.error("Screenshot error:", e.message);
    }
  }, 30000);

  process.on("SIGTERM", async () => { await browser.close(); process.exit(0); });
  process.on("SIGINT", async () => { await browser.close(); process.exit(0); });
}

main().catch(e => {
  console.error("Fatal:", e.message);
  botStatus = "crashed: " + e.message;
});
