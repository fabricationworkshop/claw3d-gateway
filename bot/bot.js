const puppeteer = require("puppeteer-core");
const http = require("http");

const WORLD_URL = process.env.TOPIA_WORLD_URL || "https://topia.io/relaxwithadam";
const WORLD_PASSWORD = process.env.TOPIA_WORLD_PASSWORD || "breathe";
const AGENT_NAME = process.env.AGENT_NAME || "Commander";
const PORT = process.env.PORT || 7860;

let botStatus = "starting";
let lastScreenshot = null;

// Health server
http.createServer((req, res) => {
  if (req.url === "/screenshot" && lastScreenshot) {
    res.writeHead(200, {"Content-Type": "image/png"});
    res.end(lastScreenshot);
    return;
  }
  res.writeHead(200, {"Content-Type": "application/json"});
  res.end(JSON.stringify({agent: AGENT_NAME, status: botStatus, uptime: process.uptime()}));
}).listen(PORT, () => console.log(`Health server on :${PORT}`));

async function main() {
  console.log("=== Agent Bot:", AGENT_NAME, "===");
  console.log("World:", WORLD_URL);

  const browser = await puppeteer.launch({
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || "/usr/bin/chromium",
    headless: "new",
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--no-first-run",
      "--use-fake-ui-for-media-stream",
      "--use-fake-device-for-media-stream",
      "--autoplay-policy=no-user-gesture-required",
      "--window-size=1280,720",
    ],
    defaultViewport: { width: 1280, height: 720 },
  });

  console.log("Browser launched");
  const page = await browser.newPage();
  const ctx = browser.defaultBrowserContext();
  await ctx.overridePermissions("https://topia.io", ["microphone", "camera"]);

  console.log("Navigating to Topia...");
  botStatus = "loading";
  await page.goto(WORLD_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
  console.log("DOM loaded, waiting for UI...");

  // Wait for React to render
  let foundForm = false;
  for (let i = 0; i < 30; i++) {
    const inputs = await page.$$("input");
    if (inputs.length > 0) { foundForm = true; break; }
    await new Promise(r => setTimeout(r, 2000));
    console.log(`Waiting for form... attempt ${i+1}/30`);
  }

  if (!foundForm) {
    const text = await page.evaluate(() => document.body?.innerText?.substring(0, 500) || "empty");
    console.log("Page content:", text);
    lastScreenshot = await page.screenshot();
    botStatus = "error: " + text.substring(0, 100);
    return;
  }

  botStatus = "entering";
  await new Promise(r => setTimeout(r, 1000));

  // Fill form
  const inputs = await page.$$("input");
  console.log(`Found ${inputs.length} inputs`);

  if (inputs.length >= 1) {
    await inputs[0].click({ clickCount: 3 });
    await inputs[0].type(AGENT_NAME, { delay: 50 });
    console.log("Typed name:", AGENT_NAME);
  }

  if (inputs.length >= 2 && WORLD_PASSWORD) {
    await inputs[1].click({ clickCount: 3 });
    await inputs[1].type(WORLD_PASSWORD, { delay: 50 });
    console.log("Typed password");
  }

  await new Promise(r => setTimeout(r, 1000));

  // Click Enter World
  const buttons = await page.$$("button");
  for (const btn of buttons) {
    const text = await btn.evaluate(el => el.textContent.trim());
    if (text.toLowerCase().includes("enter")) {
      await btn.click();
      console.log("Clicked:", text);
      break;
    }
  }

  // Wait for world
  await new Promise(r => setTimeout(r, 15000));
  lastScreenshot = await page.screenshot();
  botStatus = "in-world";
  console.log(`${AGENT_NAME} is in the world!`);

  // Keepalive
  setInterval(async () => {
    try {
      lastScreenshot = await page.screenshot();
      console.log(new Date().toISOString(), AGENT_NAME, "alive");
    } catch (e) {
      console.error("Screenshot error:", e.message);
    }
  }, 30000);

  process.on("SIGTERM", async () => { await browser.close(); process.exit(0); });
}

main().catch(e => {
  console.error("Fatal:", e.message);
  botStatus = "crashed: " + e.message;
});
