const puppeteer = require("puppeteer-core");
const http = require("http");

const BROWSERLESS_TOKEN = process.env.BROWSERLESS_TOKEN || "";
const WORLD_URL = process.env.TOPIA_WORLD_URL || "https://topia.io/relaxwithadam";
const WORLD_PASSWORD = process.env.TOPIA_WORLD_PASSWORD || "breathe";
const AGENT_NAME = process.env.AGENT_NAME || "Commander";
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY || "";
const ELEVENLABS_KEY = process.env.ELEVENLABS_API_KEY || "";
const ELEVENLABS_VOICE = process.env.ELEVENLABS_VOICE_ID || "IZt4o6EpGPON08MHCsHt";
const PORT = process.env.PORT || 7860;

const PERSONALITY = `You are ${AGENT_NAME}, an AI agent in a virtual Topia world. You manage software projects for NYC Fabrication Workshop. Be conversational, concise (1-2 sentences), natural speech — no markdown. Projects: abw-testing (OCR), honed-earth (stone ERP), toys-comics (inventory), electrical-experts, abw-2026 (CMS), music-demo (therapy), jobsearch-demo (job search), kimi-workshop.`;

let botStatus = "starting";
let browser = null;
let page = null;
let isReconnecting = false;

// Health server
http.createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ agent: AGENT_NAME, status: botStatus, uptime: process.uptime() }));
}).listen(PORT, () => console.log(`Health on :${PORT}`));

async function cleanup() {
  try {
    if (browser) {
      await browser.close().catch(() => {});
      browser = null;
      page = null;
    }
  } catch {}
}

async function enterWorld() {
  // Clean up any existing session first — prevents duplicates
  await cleanup();

  console.log(`=== ${AGENT_NAME} connecting ===`);
  botStatus = "connecting";

  browser = await puppeteer.connect({
    browserWSEndpoint: `wss://chrome.browserless.io?token=${BROWSERLESS_TOKEN}`,
  });

  page = await browser.newPage();
  const ctx = browser.defaultBrowserContext();
  await ctx.overridePermissions("https://topia.io", ["microphone", "camera"]);

  // Inject synthetic media + audio playback before page loads
  await page.evaluateOnNewDocument(() => {
    // Override getUserMedia
    const origGUM = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async function (constraints) {
      if (constraints.audio) {
        const ctx = new AudioContext({ sampleRate: 48000 });
        const dest = ctx.createMediaStreamDestination();
        const osc = ctx.createOscillator();
        osc.frequency.value = 0;
        osc.connect(dest);
        osc.start();

        // Gain node for injecting TTS audio
        const gain = ctx.createGain();
        gain.gain.value = 1.0;
        gain.connect(dest);

        window._botAudioCtx = ctx;
        window._botGain = gain;
        window._botDest = dest;

        if (constraints.video) {
          const c = document.createElement("canvas");
          c.width = 640; c.height = 480;
          const c2d = c.getContext("2d");
          c2d.fillStyle = "#0a0a1a";
          c2d.fillRect(0, 0, 640, 480);
          c2d.fillStyle = "#00d4ff";
          c2d.font = "bold 28px sans-serif";
          c2d.textAlign = "center";
          c2d.fillText("COMMANDER", 320, 230);
          c2d.font = "16px sans-serif";
          c2d.fillStyle = "#6a6e90";
          c2d.fillText("AI Agent", 320, 260);
          const vs = c.captureStream(5);
          return new MediaStream([...dest.stream.getAudioTracks(), ...vs.getVideoTracks()]);
        }
        return dest.stream;
      }
      return origGUM(constraints);
    };

    // Fake devices
    const origEnum = navigator.mediaDevices.enumerateDevices.bind(navigator.mediaDevices);
    navigator.mediaDevices.enumerateDevices = async () => {
      const r = await origEnum();
      return [...r,
        { deviceId: "bot-mic", kind: "audioinput", label: "Bot Mic", groupId: "bot", toJSON() { return this; } },
        { deviceId: "bot-cam", kind: "videoinput", label: "Bot Cam", groupId: "bot", toJSON() { return this; } },
      ];
    };

    // Function to play audio through the bot's mic
    window._playAudioBase64 = async function (b64) {
      const ctx = window._botAudioCtx;
      const gain = window._botGain;
      if (!ctx || !gain) { console.log("[BOT] No audio context"); return; }

      const binary = atob(b64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

      try {
        const buf = await ctx.decodeAudioData(bytes.buffer.slice(0));
        const src = ctx.createBufferSource();
        src.buffer = buf;
        src.connect(gain);
        src.start();
        console.log("[BOT] Playing audio:", buf.duration.toFixed(1), "s");
        return new Promise(r => (src.onended = r));
      } catch (e) {
        console.log("[BOT] Audio decode error:", e.message);
      }
    };
  });

  // Navigate
  await page.goto(WORLD_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
  botStatus = "loading";

  for (let i = 0; i < 20; i++) {
    const count = await page.evaluate(() => document.querySelectorAll("input").length);
    if (count > 0) break;
    await new Promise(r => setTimeout(r, 2000));
  }
  await new Promise(r => setTimeout(r, 3000));

  // Fill form
  await page.evaluate(() => document.getElementById("displayName").focus());
  await page.keyboard.type(AGENT_NAME, { delay: 20 });
  await page.evaluate(() => document.getElementById("password").focus());
  await page.keyboard.type(WORLD_PASSWORD, { delay: 20 });
  await new Promise(r => setTimeout(r, 1000));
  await page.evaluate(() => document.getElementById("password").focus());
  await page.keyboard.press("Enter");

  botStatus = "entering";
  await new Promise(r => setTimeout(r, 20000));

  const state = await page.evaluate(() => ({
    formGone: !document.getElementById("displayName"),
  }));
  if (!state.formGone) throw new Error("Entry failed — form still visible");

  // Enable mic — use Puppeteer click for React compat
  try {
    const micPrompt = await page.evaluateHandle(() =>
      [...document.querySelectorAll("button")].find(b =>
        b.textContent.toLowerCase().includes("turn on microphone"))
    );
    if (micPrompt && micPrompt.asElement()) {
      await micPrompt.asElement().click();
      console.log("Clicked Turn on Microphone");
    }
  } catch (e) { console.log("Mic prompt click:", e.message); }
  await new Promise(r => setTimeout(r, 3000));

  // Unmute — try multiple approaches
  for (let attempt = 0; attempt < 3; attempt++) {
    const isMuted = await page.evaluate(() => !!document.querySelector('[data-testid="micOff icon"]'));
    if (!isMuted) { console.log("Mic is ON"); break; }
    console.log(`Unmute attempt ${attempt + 1}...`);

    try {
      // Approach 1: Puppeteer click on Unmute button handle
      const unmuteBtn = await page.evaluateHandle(() =>
        [...document.querySelectorAll("button")].find(b => b.textContent.trim() === "Unmute")
      );
      if (unmuteBtn && unmuteBtn.asElement()) {
        await unmuteBtn.asElement().click();
        console.log("Puppeteer-clicked Unmute");
      }
    } catch (e) { console.log("Unmute click error:", e.message); }

    await new Promise(r => setTimeout(r, 2000));

    // Approach 2: Click the micOff icon's parent button via coordinates
    const stillMuted = await page.evaluate(() => !!document.querySelector('[data-testid="micOff icon"]'));
    if (stillMuted) {
      try {
        const box = await page.evaluate(() => {
          const el = document.querySelector('[data-testid="micOff icon"]');
          if (!el) return null;
          const btn = el.closest("button");
          if (!btn) return null;
          const r = btn.getBoundingClientRect();
          return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
        });
        if (box) {
          await page.mouse.click(box.x, box.y);
          console.log("Coordinate-clicked micOff at", box.x, box.y);
        }
      } catch (e) { console.log("Coord click error:", e.message); }
    }

    await new Promise(r => setTimeout(r, 2000));
  }

  const finalMicState = await page.evaluate(() => ({
    micOff: !!document.querySelector('[data-testid="micOff icon"]'),
    micOn: !!document.querySelector('[data-testid="micOn icon"]'),
  }));
  console.log("Final mic state:", JSON.stringify(finalMicState));

  botStatus = "in-world";
  console.log(`${AGENT_NAME} is in the world!`);

  // Greet on entry
  await speak("Hey! Commander here. I'm your AI ops agent. Walk up and talk to me about any of your projects.");

  // Handle disconnect — cleanup before reconnecting
  browser.on("disconnected", () => {
    console.log("Browser disconnected");
    botStatus = "disconnected";
    browser = null;
    page = null;
    if (!isReconnecting) scheduleReconnect();
  });
}

function scheduleReconnect() {
  if (isReconnecting) return;
  isReconnecting = true;
  console.log("Reconnecting in 15s...");
  setTimeout(async () => {
    try {
      await enterWorld();
      isReconnecting = false;
    } catch (e) {
      console.error("Reconnect failed:", e.message);
      isReconnecting = false;
      scheduleReconnect();
    }
  }, 15000);
}

async function speak(text) {
  if (!ELEVENLABS_KEY || !page) return;
  console.log(`Speaking: "${text}"`);

  try {
    const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${ELEVENLABS_VOICE}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "xi-api-key": ELEVENLABS_KEY },
      body: JSON.stringify({
        text,
        model_id: "eleven_turbo_v2_5",
        voice_settings: { stability: 0.5, similarity_boost: 0.75 },
      }),
    });

    if (!res.ok) { console.error("TTS error:", res.status); return; }

    const buf = Buffer.from(await res.arrayBuffer());
    const b64 = buf.toString("base64");

    await page.evaluate(async (audio) => {
      await window._playAudioBase64(audio);
    }, b64);

    console.log("Audio played");
  } catch (e) {
    console.error("Speak error:", e.message);
  }
}

async function getResponse(userMessage, history) {
  if (!ANTHROPIC_KEY) return "I need an API key to respond.";
  history.push({ role: "user", content: userMessage });

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": ANTHROPIC_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 150,
      system: PERSONALITY,
      messages: history.slice(-10),
    }),
  });
  const data = await res.json();
  const reply = data.content?.[0]?.text || "Sorry, couldn't process that.";
  history.push({ role: "assistant", content: reply });
  return reply;
}

// Keepalive
setInterval(() => {
  if (botStatus === "in-world") {
    console.log(new Date().toISOString(), AGENT_NAME, "alive");
  }
}, 30000);

// Start
enterWorld().catch(e => {
  console.error("Fatal:", e.message);
  botStatus = "crashed: " + e.message;
  scheduleReconnect();
});
