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

async function step(name, fn) {
  console.log(`[STEP] ${name}...`);
  botStatus = name;
  try {
    const result = await fn();
    console.log(`[STEP] ${name} OK`);
    return result;
  } catch (e) {
    console.error(`[STEP] ${name} FAILED:`, e.message);
    throw e;
  }
}

async function main() {
  console.log("=== Agent Bot:", AGENT_NAME, "===");
  console.log("World:", WORLD_URL);

  const browser = await step("launch-browser", () => puppeteer.launch({
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
  }));

  const page = await step("new-page", () => browser.newPage());

  await step("set-permissions", async () => {
    const ctx = browser.defaultBrowserContext();
    await ctx.overridePermissions("https://topia.io", ["microphone", "camera"]);
  });

  await step("spoof-webgl", () => page.evaluateOnNewDocument(() => {
    const origGetParam = WebGLRenderingContext.prototype.getParameter;
    WebGLRenderingContext.prototype.getParameter = function(param) {
      if (param === 37445) return "Google Inc. (NVIDIA)";
      if (param === 37446) return "ANGLE (NVIDIA, NVIDIA GeForce GTX 1080)";
      return origGetParam.call(this, param);
    };
    if (typeof WebGL2RenderingContext !== 'undefined') {
      const orig2 = WebGL2RenderingContext.prototype.getParameter;
      WebGL2RenderingContext.prototype.getParameter = function(param) {
        if (param === 37445) return "Google Inc. (NVIDIA)";
        if (param === 37446) return "ANGLE (NVIDIA, NVIDIA GeForce GTX 1080)";
        return orig2.call(this, param);
      };
    }
  }));

  await step("navigate", () => page.goto(WORLD_URL, { waitUntil: "domcontentloaded", timeout: 60000 }));

  // Wait for any content to render
  await step("wait-for-render", async () => {
    for (let i = 0; i < 20; i++) {
      const hasContent = await page.evaluate(() => {
        return document.querySelectorAll('input').length > 0 ||
               document.body.innerText.length > 100;
      });
      if (hasContent) return;
      await new Promise(r => setTimeout(r, 2000));
      console.log(`  waiting... ${i+1}/20`);
    }
  });

  // Screenshot to debug
  lastScreenshot = await page.screenshot();

  const pageInfo = await step("inspect-page", () => page.evaluate(() => ({
    text: document.body?.innerText?.substring(0, 500),
    inputCount: document.querySelectorAll('input').length,
    buttonCount: document.querySelectorAll('button').length,
    buttons: [...document.querySelectorAll('button')].map(b => b.textContent.trim()).slice(0, 10),
    title: document.title,
    url: window.location.href,
  })));
  console.log("Page info:", JSON.stringify(pageInfo, null, 2));

  if (pageInfo.inputCount === 0) {
    botStatus = "error-no-inputs: " + (pageInfo.text || "").substring(0, 100);
    console.log("No inputs found. Keeping health server alive for /screenshot debugging.");
    return;
  }

  // Fill form entirely via evaluate
  await step("fill-form", () => page.evaluate((name, password) => {
    const inputs = document.querySelectorAll('input');
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    if (inputs[0]) {
      setter.call(inputs[0], name);
      inputs[0].dispatchEvent(new Event('input', { bubbles: true }));
      inputs[0].dispatchEvent(new Event('change', { bubbles: true }));
    }
    if (inputs[1] && password) {
      setter.call(inputs[1], password);
      inputs[1].dispatchEvent(new Event('input', { bubbles: true }));
      inputs[1].dispatchEvent(new Event('change', { bubbles: true }));
    }
    return { filled: inputs.length };
  }, AGENT_NAME, WORLD_PASSWORD));

  await new Promise(r => setTimeout(r, 1500));
  lastScreenshot = await page.screenshot();

  // Click enter
  const clicked = await step("click-enter", () => page.evaluate(() => {
    const buttons = [...document.querySelectorAll('button')];
    const enter = buttons.find(b => b.textContent.trim().toLowerCase().includes('enter'));
    if (enter) { enter.click(); return enter.textContent.trim(); }
    const enabled = buttons.find(b => !b.disabled);
    if (enabled) { enabled.click(); return enabled.textContent.trim(); }
    return "no-button-found";
  }));
  console.log("Clicked:", clicked);

  // Wait for world to load
  await step("wait-for-world", () => new Promise(r => setTimeout(r, 20000)));
  lastScreenshot = await page.screenshot();
  botStatus = "in-world";
  console.log(`${AGENT_NAME} is in the world!`);

  // Keepalive
  setInterval(async () => {
    try {
      lastScreenshot = await page.screenshot();
      const info = await page.evaluate(() => ({
        url: window.location.href,
        title: document.title,
      }));
      console.log(new Date().toISOString(), AGENT_NAME, "alive", info.url);
    } catch (e) {
      console.error("Keepalive error:", e.message);
    }
  }, 30000);

  process.on("SIGTERM", async () => { await browser.close(); process.exit(0); });
}

main().catch(e => {
  console.error("Fatal:", e.message);
  console.error("Stack:", e.stack?.split('\n').slice(0, 5).join('\n'));
  botStatus = "crashed: " + e.message;
});
