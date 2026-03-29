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
      "--enable-webgl",
      "--ignore-gpu-blocklist",
      "--enable-unsafe-swiftshader",
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

  // Spoof WebGL renderer to bypass Topia's GPU check
  await page.evaluateOnNewDocument(() => {
    const origGetParam = WebGLRenderingContext.prototype.getParameter;
    WebGLRenderingContext.prototype.getParameter = function(param) {
      if (param === 0x1F00) return "Google Inc. (NVIDIA)"; // VENDOR
      if (param === 0x1F01) return "ANGLE (NVIDIA, NVIDIA GeForce GTX 1080 Direct3D11 vs_5_0 ps_5_0, D3D11)"; // RENDERER
      if (param === 37445) return "Google Inc. (NVIDIA)"; // UNMASKED_VENDOR
      if (param === 37446) return "ANGLE (NVIDIA, NVIDIA GeForce GTX 1080 Direct3D11 vs_5_0 ps_5_0, D3D11)"; // UNMASKED_RENDERER
      return origGetParam.call(this, param);
    };
    if (typeof WebGL2RenderingContext !== 'undefined') {
      const origGetParam2 = WebGL2RenderingContext.prototype.getParameter;
      WebGL2RenderingContext.prototype.getParameter = function(param) {
        if (param === 0x1F00) return "Google Inc. (NVIDIA)";
        if (param === 0x1F01) return "ANGLE (NVIDIA, NVIDIA GeForce GTX 1080 Direct3D11 vs_5_0 ps_5_0, D3D11)";
        if (param === 37445) return "Google Inc. (NVIDIA)";
        if (param === 37446) return "ANGLE (NVIDIA, NVIDIA GeForce GTX 1080 Direct3D11 vs_5_0 ps_5_0, D3D11)";
        return origGetParam2.call(this, param);
      };
    }
  });

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

  // Fill form using page.evaluate for reliability in headless
  await page.evaluate((name, password) => {
    const inputs = document.querySelectorAll('input');
    if (inputs[0]) {
      const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      nativeInputValueSetter.call(inputs[0], name);
      inputs[0].dispatchEvent(new Event('input', { bubbles: true }));
      inputs[0].dispatchEvent(new Event('change', { bubbles: true }));
    }
    if (inputs[1] && password) {
      const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      nativeInputValueSetter.call(inputs[1], password);
      inputs[1].dispatchEvent(new Event('input', { bubbles: true }));
      inputs[1].dispatchEvent(new Event('change', { bubbles: true }));
    }
  }, AGENT_NAME, WORLD_PASSWORD);
  console.log("Filled form:", AGENT_NAME);

  await new Promise(r => setTimeout(r, 1500));

  // Click Enter World using evaluate for reliability
  await page.evaluate(() => {
    const buttons = document.querySelectorAll('button');
    for (const btn of buttons) {
      if (btn.textContent.trim().toLowerCase().includes('enter')) {
        btn.click();
        return btn.textContent.trim();
      }
    }
    // Try any submit-like button
    for (const btn of buttons) {
      if (!btn.disabled) {
        btn.click();
        return btn.textContent.trim();
      }
    }
  });
  console.log("Clicked Enter World");

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
