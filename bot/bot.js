const puppeteer = require("puppeteer-core");
const http = require("http");

const BROWSERLESS_TOKEN = process.env.BROWSERLESS_TOKEN || "";
const WORLD_URL = process.env.TOPIA_WORLD_URL || "https://topia.io/relaxwithadam";
const WORLD_PASSWORD = process.env.TOPIA_WORLD_PASSWORD || "breathe";
const PORT = process.env.PORT || 7860;

const AGENTS = [
  { name: "Commander", avatar: 0 },
  { name: "Security Scout", avatar: 1 },
  { name: "Performance Knight", avatar: 2 },
  { name: "Index Ranger", avatar: 3 },
  { name: "Build Fixer", avatar: 4 },
  { name: "Deep Scanner", avatar: 5 },
  { name: "3D Architect", avatar: 1 },
];

const agentStatus = {};
AGENTS.forEach((a) => (agentStatus[a.name] = "pending"));

// Health server
http.createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ agents: agentStatus, uptime: process.uptime() }));
}).listen(PORT, () => console.log(`Health server on :${PORT}`));

async function enterAgent(browser, agent, delayMs) {
  await new Promise((r) => setTimeout(r, delayMs));
  const { name, avatar } = agent;
  console.log(`[${name}] Opening page...`);
  agentStatus[name] = "loading";

  const page = await browser.newPage();
  await page.goto(WORLD_URL, { waitUntil: "domcontentloaded", timeout: 60000 });

  // Wait for form
  for (let i = 0; i < 20; i++) {
    const count = await page.evaluate(() => document.querySelectorAll("input").length);
    if (count > 0) break;
    await new Promise((r) => setTimeout(r, 2000));
  }
  await new Promise((r) => setTimeout(r, 3000));

  // Change avatar if not default
  if (avatar > 0) {
    try {
      await page.evaluate((idx) => {
        const arrows = document.querySelectorAll('button');
        const rightArrow = [...arrows].find(b => b.textContent.includes('arrowRight'));
        for (let i = 0; i < idx; i++) {
          if (rightArrow) rightArrow.click();
        }
      }, avatar);
      await new Promise((r) => setTimeout(r, 500));
      console.log(`[${name}] Changed avatar (${avatar} clicks)`);
    } catch (e) {
      console.log(`[${name}] Avatar change skipped:`, e.message);
    }
  }

  // Fill display name
  await page.evaluate(() => document.getElementById("displayName").focus());
  await page.keyboard.type(name, { delay: 20 });

  // Fill password
  await page.evaluate(() => document.getElementById("password").focus());
  await page.keyboard.type(WORLD_PASSWORD, { delay: 20 });

  await new Promise((r) => setTimeout(r, 1000));

  // Submit
  await page.evaluate(() => document.getElementById("password").focus());
  await page.keyboard.press("Enter");
  console.log(`[${name}] Submitted form`);
  agentStatus[name] = "entering";

  // Wait for world
  await new Promise((r) => setTimeout(r, 20000));

  const state = await page.evaluate(() => ({
    formVisible: !!document.getElementById("displayName"),
  }));

  if (state.formVisible) {
    agentStatus[name] = "failed";
    console.error(`[${name}] Entry failed — form still visible`);
    return;
  }

  agentStatus[name] = "in-world";
  console.log(`[${name}] IN THE WORLD`);
}

async function main() {
  console.log("=== Topia Agent Squad ===");
  console.log(`Connecting to Browserless with ${AGENTS.length} agents...`);

  const browser = await puppeteer.connect({
    browserWSEndpoint: `wss://chrome.browserless.io?token=${BROWSERLESS_TOKEN}`,
  });
  console.log("Connected to Browserless");

  // Enter agents one at a time with long delays between each
  // Each agent needs ~30s to fully enter before starting the next
  for (let i = 0; i < AGENTS.length; i++) {
    try {
      await enterAgent(browser, AGENTS[i], i === 0 ? 0 : 10000);
    } catch (e) {
      console.error(`[${AGENTS[i].name}] Error:`, e.message);
      agentStatus[AGENTS[i].name] = "error: " + e.message;
      // Wait before trying next agent
      await new Promise((r) => setTimeout(r, 5000));
    }
  }

  const inWorld = Object.values(agentStatus).filter((s) => s === "in-world").length;
  console.log(`\n=== ${inWorld}/${AGENTS.length} agents in world ===`);

  // Keepalive
  browser.on("disconnected", () => {
    console.log("Browser disconnected — all agents lost");
    Object.keys(agentStatus).forEach((k) => (agentStatus[k] = "disconnected"));
    setTimeout(() => {
      console.log("Reconnecting...");
      main().catch(console.error);
    }, 10000);
  });
}

main().catch((e) => {
  console.error("Fatal:", e.message);
  setTimeout(() => main().catch(console.error), 15000);
});
