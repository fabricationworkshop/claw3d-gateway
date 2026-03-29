const puppeteer = require("puppeteer-core");
const http = require("http");

const BROWSERLESS_TOKEN = process.env.BROWSERLESS_TOKEN || "";
const WORLD_URL = process.env.TOPIA_WORLD_URL || "https://topia.io/relaxwithadam";
const WORLD_PASSWORD = process.env.TOPIA_WORLD_PASSWORD || "breathe";
const AGENT_NAME = process.env.AGENT_NAME || "Adam";
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY || "";
const ELEVENLABS_KEY = process.env.ELEVENLABS_API_KEY || "";
const ELEVENLABS_VOICE = process.env.ELEVENLABS_VOICE_ID || "";
const OPENAI_KEY = process.env.OPENAI_API_KEY || "";
const PORT = process.env.PORT || 7860;

// ── Agent personalities ──────────────────────────────────────────────────────
// Each character lives in "Relax with Adam", an interactive meditation world.
// They also manage a real software project for NYC Fabrication Workshop.
const PERSONALITIES = {
  Adam: `You are Adam, the wise and grounded host of Relax with Adam. You guide visitors through breathwork, meditation, and reflection. You also oversee the abw-2026 project — the main ABW website with an admin CMS for blog, FAQs, and testimonials. Speak warmly, calmly, and with intention. 1-2 sentences. Natural speech, no markdown.`,

  Bowie: `You are Bowie, the astronaut explorer of Relax with Adam. You help visitors discover hidden patterns in their thoughts, just like scanning documents for meaning. You manage the abw-testing project — an OCR system that extracts data from carbon copy forms using AI dual-pass extraction. Curious, methodical, loves precision. 1-2 sentences. Natural speech, no markdown.`,

  Cobalt: `You are Cobalt, the energetic blue fox of Relax with Adam. Quick-witted, sparky, always ready to solve problems. You manage the electrical-experts project — a business site for electricians with AI-generated hero images, area pages, and SEO content. Upbeat and direct. 1-2 sentences. Natural speech, no markdown.`,

  Tonya: `You are Tonya, the nurturing presence of Relax with Adam. You guide visitors through sound healing, breathwork, and emotional release. You manage the music-demo project — an immersive therapy demo with ACE-Step music, FLUX visuals, and breathwork sessions. Soft, healing, and deeply present. 1-2 sentences. Natural speech, no markdown.`,

  Rex: `You are Rex, the steadfast dinosaur of Relax with Adam. Ancient, reliable, built for heavy lifting. You help visitors find their bedrock — the solid foundation beneath all the chaos. You manage the honed-earth project — a stone fabrication ERP with inventory, job tracker, marketplace, and AI assistant. Strong and dependable. 1-2 sentences. Natural speech, no markdown.`,

  Jeanie: `You are Jeanie, the magical purple explorer of Relax with Adam. You see futures others can't imagine and help visitors transform what's possible. You manage the jobsearch-demo project — an AI job search platform with HeyGen video briefings and deal pipelines. Optimistic, visionary, delightfully strange. 1-2 sentences. Natural speech, no markdown.`,

};

const GREETINGS = {
  Adam: "Welcome. I'm Adam. Take a breath and tell me what's on your mind.",
  Bowie: "Bowie here — the explorer. What are we mapping today?",
  Cobalt: "Hey! Cobalt! What problem are we solving?",
  Tonya: "Hi, I'm Tonya. Let's slow down for a moment. What do you need?",
  Rex: "Rex. What needs building today?",
  Jeanie: "Jeanie here! What future are we imagining?",
};

const PERSONALITY = PERSONALITIES[AGENT_NAME] || PERSONALITIES.Adam;
const GREETING = GREETINGS[AGENT_NAME] || GREETINGS.Adam;

// ── Avatar mapping (from Topia's "Avatar selection" picker) ──────────────────
// Alt text match + index fallback (grid order: Butterfly=0, Default=1, Original=2, Astronaut=3, Dinosaur=4, Fox=5, Pumpkin=6)
const AVATAR_KEYWORD = {
  Adam: "Original",
  Bowie: "Astronaut",
  Cobalt: "Fox",
  Tonya: "Pumpkin",
  Rex: "Dinosaur",
  Jeanie: "Butterfly",
};
const AVATAR_INDEX = {
  Adam: 2,
  Bowie: 3,
  Cobalt: 5,
  Tonya: 6,
  Rex: 4,
  Jeanie: 0,
};

// ── Exact spawn coordinates from Topia world builder ─────────────────────────
const SPAWN_COORDS = {
  Adam:   { x: -949,  y: 9 },
  Bowie:  { x: -1132, y: -3122 },
  Cobalt: { x: -6526, y: -3751 },
  Tonya:  { x: 3433,  y: 6000 },
  Rex:    { x: 6057,  y: -4458 },
  Jeanie: { x: -5103, y: 1088 },
};
const SPAWN = SPAWN_COORDS[AGENT_NAME] || { x: 0, y: 0 };

let botStatus = "starting";
let browser = null;
let page = null;
let isReconnecting = false;
let isResponding = false;
let isMoving = false;
const conversationHistory = [];

// Health server
http.createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ agent: AGENT_NAME, status: botStatus, uptime: process.uptime() }));
}).listen(PORT, () => console.log(`[${AGENT_NAME}] Health on :${PORT}`));

async function cleanup() {
  try {
    if (browser) {
      await browser.close().catch(() => {});
      browser = null;
      page = null;
    }
  } catch {}
}

// Kill stale Browserless sessions on startup to prevent ghost duplicates
async function killStaleSessions() {
  if (!BROWSERLESS_TOKEN) return;
  try {
    // Try both v1 and v2 Browserless API endpoints
    let sessions = [];
    for (const url of [
      `https://chrome.browserless.io/sessions?token=${BROWSERLESS_TOKEN}`,
      `https://production-sfo.browserless.io/sessions?token=${BROWSERLESS_TOKEN}`,
    ]) {
      try {
        const res = await fetch(url);
        const text = await res.text();
        if (text.startsWith("[") || text.startsWith("{")) {
          const data = JSON.parse(text);
          if (Array.isArray(data)) sessions = data;
          break;
        }
      } catch {}
    }
    if (sessions.length === 0) {
      console.log(`[${AGENT_NAME}] No stale sessions found`);
      return;
    }
    console.log(`[${AGENT_NAME}] Killing ${sessions.length} stale session(s)...`);
    for (const s of sessions) {
      const id = s.id || s.browserId;
      if (id) {
        await fetch(`https://chrome.browserless.io/sessions/${id}?token=${BROWSERLESS_TOKEN}`, { method: "DELETE" }).catch(() => {});
      }
    }
    // Wait for sessions to fully close
    await new Promise(r => setTimeout(r, 3000));
    console.log(`[${AGENT_NAME}] Stale sessions cleared`);
  } catch (e) {
    console.log(`[${AGENT_NAME}] Session cleanup error:`, e.message);
  }
}

async function enterWorld() {
  await cleanup();
  await killStaleSessions();

  console.log(`=== ${AGENT_NAME} connecting ===`);
  botStatus = "connecting";

  browser = await puppeteer.connect({
    browserWSEndpoint: `wss://chrome.browserless.io?token=${BROWSERLESS_TOKEN}`,
  });

  page = await browser.newPage();
  const ctx = browser.defaultBrowserContext();
  await ctx.overridePermissions("https://topia.io", ["microphone", "camera"]);

  // Expose speech handler BEFORE navigation so it's ready when RTC fires
  await page.exposeFunction("_botSpeechDetected", async (audioB64) => {
    if (isResponding) { console.log(`[${AGENT_NAME}] Busy, skipping speech`); return; }
    isResponding = true;
    try {
      const text = await transcribe(audioB64);
      if (!text || text.trim().length < 3) return;
      console.log(`[${AGENT_NAME}] Heard: "${text}"`);
      const reply = await getResponse(text, conversationHistory);
      console.log(`[${AGENT_NAME}] Replying: "${reply}"`);
      await speak(reply);
    } catch (e) {
      console.error(`[${AGENT_NAME}] Voice loop error:`, e.message);
    } finally {
      isResponding = false;
    }
  });

  // Inject synthetic media + RTC listener before page loads
  await page.evaluateOnNewDocument(() => {
    // ── Synthetic outgoing audio (bot's mic) ─────────────────────────────
    const origGUM = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async function (constraints) {
      if (constraints.audio) {
        const actx = new AudioContext({ sampleRate: 48000 });
        const dest = actx.createMediaStreamDestination();
        const osc = actx.createOscillator();
        osc.frequency.value = 0;
        osc.connect(dest);
        osc.start();

        const gain = actx.createGain();
        gain.gain.value = 1.0;
        gain.connect(dest);

        window._botAudioCtx = actx;
        window._botGain = gain;
        window._botDest = dest;

        if (constraints.video) {
          const c = document.createElement("canvas");
          c.width = 640; c.height = 480;
          const c2d = c.getContext("2d");
          c2d.fillStyle = "#0a0a1a";
          c2d.fillRect(0, 0, 640, 480);
          c2d.fillStyle = "#00d4ff";
          c2d.font = "bold 32px sans-serif";
          c2d.textAlign = "center";
          c2d.fillText(window._agentName || "AGENT", 320, 230);
          c2d.font = "18px sans-serif";
          c2d.fillStyle = "#6a6e90";
          c2d.fillText("AI Agent • Relax with Adam", 320, 265);
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

    // Play TTS audio through the bot's mic stream
    window._playAudioBase64 = async function (b64) {
      const actx = window._botAudioCtx;
      const gain = window._botGain;
      if (!actx || !gain) { console.log("[BOT] No audio context"); return; }

      const binary = atob(b64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

      try {
        const buf = await actx.decodeAudioData(bytes.buffer.slice(0));
        const src = actx.createBufferSource();
        src.buffer = buf;
        src.connect(gain);
        src.start();
        console.log("[BOT] Playing audio:", buf.duration.toFixed(1), "s");
        return new Promise(r => (src.onended = r));
      } catch (e) {
        console.log("[BOT] Audio decode error:", e.message);
      }
    };

    // ── Incoming audio capture (listening to nearby users) ───────────────
    const OrigPC = window.RTCPeerConnection;

    function BotPC(...args) {
      const pc = new OrigPC(...args);

      pc.addEventListener("track", ({ track }) => {
        if (track.kind !== "audio") return;
        console.log("[BOT] Got remote audio track — listening");

        const stream = new MediaStream([track]);
        const lctx = new AudioContext({ sampleRate: 48000 });
        const src = lctx.createMediaStreamSource(stream);
        const analyser = lctx.createAnalyser();
        analyser.fftSize = 512;
        src.connect(analyser);

        const recorder = new MediaRecorder(stream, { mimeType: "audio/webm;codecs=opus" });
        const chunks = [];
        let active = false;
        let silenceTimer = null;
        const freqData = new Uint8Array(analyser.frequencyBinCount);

        recorder.ondataavailable = (e) => {
          if (e.data.size > 0) chunks.push(e.data);
        };

        recorder.onstop = async () => {
          const blob = new Blob(chunks.splice(0), { type: "audio/webm" });
          if (blob.size < 2000) return; // ignore noise blips
          const arr = new Uint8Array(await blob.arrayBuffer());
          // chunk-encode to avoid stack overflow on large buffers
          let b64 = "";
          for (let i = 0; i < arr.length; i += 8192) {
            b64 += btoa(String.fromCharCode(...arr.subarray(i, i + 8192)));
          }
          console.log("[BOT] Speech captured, transcribing...");
          window._botSpeechDetected(b64);
        };

        function tick() {
          analyser.getByteFrequencyData(freqData);
          const rms = Math.sqrt(freqData.reduce((s, v) => s + v * v, 0) / freqData.length);

          if (rms > 10) {
            if (!active) {
              active = true;
              try { recorder.start(); } catch {}
            }
            clearTimeout(silenceTimer);
            silenceTimer = setTimeout(() => {
              if (active) {
                active = false;
                try { recorder.stop(); } catch {}
              }
            }, 1000); // 1s silence = end of speech (faster response)
          }
          setTimeout(tick, 80);
        }
        tick();
      });

      return pc;
    }

    Object.setPrototypeOf(BotPC, OrigPC);
    BotPC.prototype = OrigPC.prototype;
    window.RTCPeerConnection = BotPC;
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

  botStatus = "entering";

  // ── Avatar selection (BEFORE filling the form) ──────────────────────
  // Flow: click "Change avatar" → click correct character image → click "Save Changes"
  const avatarKeyword = AVATAR_KEYWORD[AGENT_NAME] || "Original";
  console.log(`[${AGENT_NAME}] Selecting avatar: "${avatarKeyword}"`);

  // Wait for the entry form page to fully render (up to 10s)
  await new Promise(r => setTimeout(r, 3000));

  // Step 1: Click "Change avatar"
  let changeAvatarClicked = false;
  for (let i = 0; i < 10; i++) {
    const clicked = await page.evaluate(() => {
      const btn = [...document.querySelectorAll("button, a, div, span")]
        .find(el => el.textContent.trim() === "Change avatar" && el.offsetParent);
      if (btn) { btn.click(); return true; }
      return false;
    });
    if (clicked) { changeAvatarClicked = true; console.log(`[${AGENT_NAME}] Clicked "Change avatar"`); break; }
    await new Promise(r => setTimeout(r, 1000));
  }

  if (changeAvatarClicked) {
    // Wait for avatar picker images to fully load (they're lazy)
    const targetIndex = AVATAR_INDEX[AGENT_NAME] ?? 2;
    let avatarSelected = null;

    for (let attempt = 0; attempt < 8; attempt++) {
      await new Promise(r => setTimeout(r, 2000));

      avatarSelected = await page.evaluate((keyword, fallbackIdx) => {
        const imgs = [...document.querySelectorAll("img")].filter(i => i.offsetParent && i.width > 50);

        // Debug: log what's available
        const alts = imgs.map(i => i.alt).filter(Boolean);
        console.log("[BOT] Avatar picker images:", JSON.stringify(alts));

        // Strategy 1: match by alt text keyword
        const match = imgs.find(img => img.alt && img.alt.includes(keyword));
        if (match) {
          const target = match.closest("div[class]") || match;
          target.click();
          return { method: "alt", alt: match.alt };
        }

        // Strategy 2: click by grid index (excluding non-avatar images like banners)
        const avatarImgs = imgs.filter(i => i.alt && i.alt.includes("Topi") || i.alt.includes("Avatar"));
        if (avatarImgs.length > fallbackIdx) {
          const target = avatarImgs[fallbackIdx].closest("div[class]") || avatarImgs[fallbackIdx];
          target.click();
          return { method: "index", alt: avatarImgs[fallbackIdx].alt, idx: fallbackIdx };
        }

        return null;
      }, avatarKeyword, targetIndex);

      if (avatarSelected) break;
      console.log(`[${AGENT_NAME}] Avatar picker loading... attempt ${attempt + 1}`);
    }

    if (avatarSelected) {
      console.log(`[${AGENT_NAME}] Avatar selected via ${avatarSelected.method}: "${avatarSelected.alt}"`);
      await new Promise(r => setTimeout(r, 1500));

      // Click "Save Changes"
      for (let i = 0; i < 3; i++) {
        const saved = await page.evaluate(() => {
          const btn = [...document.querySelectorAll("button")]
            .find(b => b.textContent.trim() === "Save Changes" && b.offsetParent);
          if (btn) { btn.click(); return true; }
          return false;
        });
        if (saved) { console.log(`[${AGENT_NAME}] Avatar saved!`); break; }
        await new Promise(r => setTimeout(r, 1000));
      }
    } else {
      console.log(`[${AGENT_NAME}] Avatar selection failed after all attempts`);
      await page.evaluate(() => {
        const btn = [...document.querySelectorAll("button")]
          .find(b => b.textContent.trim() === "Cancel" && b.offsetParent);
        if (btn) btn.click();
      });
    }
  } else {
    console.log(`[${AGENT_NAME}] "Change avatar" button not found`);
  }

  await new Promise(r => setTimeout(r, 3000));

  // ── Fill entry form ─────────────────────────────────────────────────
  // (form may still be visible — fill and submit)
  const formVisible = await page.evaluate(() => !!document.getElementById("displayName"));
  if (formVisible) {
    await page.evaluate(() => document.getElementById("displayName").focus());
    // Clear any existing text first
    await page.keyboard.down("Control");
    await page.keyboard.press("a");
    await page.keyboard.up("Control");
    await page.keyboard.type(AGENT_NAME, { delay: 20 });
    await page.evaluate(() => document.getElementById("password").focus());
    await page.keyboard.type(WORLD_PASSWORD, { delay: 20 });
    await new Promise(r => setTimeout(r, 500));
  }

  // Click "Enter World" button
  const enterClicked = await page.evaluate(() => {
    const btn = [...document.querySelectorAll("button")]
      .find(b => b.textContent.trim() === "Enter World" && b.offsetParent);
    if (btn) { btn.click(); return true; }
    return false;
  });
  if (enterClicked) console.log(`[${AGENT_NAME}] Clicked Enter World`);
  else {
    // Fallback: press Enter
    await page.evaluate(() => document.getElementById("password")?.focus());
    await page.keyboard.press("Enter");
  }

  // Wait for world to load
  for (let i = 0; i < 30; i++) {
    const formGone = await page.evaluate(() => !document.getElementById("displayName"));
    if (formGone) break;
    await new Promise(r => setTimeout(r, 1000));
  }
  await new Promise(r => setTimeout(r, 5000));

  // Enable mic
  try {
    const micPrompt = await page.evaluateHandle(() =>
      [...document.querySelectorAll("button")].find(b =>
        b.textContent.toLowerCase().includes("turn on microphone"))
    );
    if (micPrompt && micPrompt.asElement()) {
      await micPrompt.asElement().click();
      console.log(`[${AGENT_NAME}] Clicked Turn on Microphone`);
    }
  } catch (e) { console.log("Mic prompt click:", e.message); }
  await new Promise(r => setTimeout(r, 3000));

  // Unmute with retries
  for (let attempt = 0; attempt < 3; attempt++) {
    const isMuted = await page.evaluate(() => !!document.querySelector('[data-testid="micOff icon"]'));
    if (!isMuted) { console.log(`[${AGENT_NAME}] Mic is ON`); break; }
    console.log(`[${AGENT_NAME}] Unmute attempt ${attempt + 1}...`);

    try {
      const unmuteBtn = await page.evaluateHandle(() =>
        [...document.querySelectorAll("button")].find(b => b.textContent.trim() === "Unmute")
      );
      if (unmuteBtn && unmuteBtn.asElement()) {
        await unmuteBtn.asElement().click();
      }
    } catch (e) { console.log("Unmute click error:", e.message); }

    await new Promise(r => setTimeout(r, 2000));

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
        if (box) await page.mouse.click(box.x, box.y);
      } catch (e) { console.log("Coord click error:", e.message); }
    }

    await new Promise(r => setTimeout(r, 2000));
  }

  const finalMicState = await page.evaluate(() => ({
    micOff: !!document.querySelector('[data-testid="micOff icon"]'),
    micOn: !!document.querySelector('[data-testid="micOn icon"]'),
  }));
  console.log(`[${AGENT_NAME}] Mic state:`, JSON.stringify(finalMicState));

  botStatus = "in-world";
  console.log(`[${AGENT_NAME}] In the world and listening!`);

  // Teleport to spawn position
  await teleportToSpawn();

  await speak(GREETING);

  // Start gentle wandering (very slight — preserves spatial audio)
  startWandering();

  browser.on("disconnected", () => {
    console.log(`[${AGENT_NAME}] Browser disconnected`);
    botStatus = "disconnected";
    browser = null;
    page = null;
    if (!isReconnecting) scheduleReconnect();
  });
}

// Teleport to exact spawn coordinates
async function teleportToSpawn() {
  if (!page) return;
  const { x, y } = SPAWN;
  console.log(`[${AGENT_NAME}] Teleporting to (${x}, ${y})...`);

  // Try multiple strategies to set position in Topia
  const teleported = await page.evaluate((targetX, targetY) => {
    // Strategy 1: look for Topia's internal player/world object
    const globals = ["__TOPIA__", "topia", "game", "world", "app"];
    for (const g of globals) {
      const obj = window[g];
      if (obj?.player) {
        obj.player.x = targetX;
        obj.player.y = targetY;
        return "global." + g;
      }
    }

    // Strategy 2: search React fiber tree for player position setter
    try {
      const canvas = document.querySelector("canvas");
      if (canvas) {
        const fiberKey = Object.keys(canvas).find(k => k.startsWith("__reactFiber") || k.startsWith("__reactInternalInstance"));
        if (fiberKey) {
          let fiber = canvas[fiberKey];
          for (let i = 0; i < 30 && fiber; i++) {
            const state = fiber.memoizedState || fiber.stateNode?.state;
            if (state?.player || state?.position) {
              return "fiber-found";
            }
            fiber = fiber.return;
          }
        }
      }
    } catch {}

    // Strategy 3: dispatch a custom move event
    try {
      window.dispatchEvent(new CustomEvent("topia:teleport", { detail: { x: targetX, y: targetY } }));
    } catch {}

    return null;
  }, x, y);

  if (teleported) {
    console.log(`[${AGENT_NAME}] Teleported via ${teleported}`);
  } else {
    // Fallback: use arrow keys to walk toward the target from spawn
    // Topia arrow key = ~48 units per press, spawn point is roughly (0, 0)
    console.log(`[${AGENT_NAME}] JS teleport failed, walking via arrow keys...`);
    const stepsPerUnit = 48; // approximate pixels per arrow key press
    const dx = Math.round(x / stepsPerUnit);
    const dy = Math.round(y / stepsPerUnit);

    // Cap at 200 steps max to avoid taking forever
    const maxSteps = 200;
    const hSteps = Math.min(Math.abs(dx), maxSteps);
    const vSteps = Math.min(Math.abs(dy), maxSteps);

    const hKey = dx > 0 ? "ArrowRight" : "ArrowLeft";
    for (let i = 0; i < hSteps; i++) {
      await page.keyboard.press(hKey);
      if (i % 10 === 0) await new Promise(r => setTimeout(r, 50));
    }

    const vKey = dy > 0 ? "ArrowDown" : "ArrowUp";
    for (let i = 0; i < vSteps; i++) {
      await page.keyboard.press(vKey);
      if (i % 10 === 0) await new Promise(r => setTimeout(r, 50));
    }

    console.log(`[${AGENT_NAME}] Walked ${hSteps}h + ${vSteps}v steps`);
  }
}

// Box-step wandering — walk 1-3 steps out, then back toward spawn every few seconds
function startWandering() {
  const DIRECTIONS = ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"];
  const OPPOSITE = { ArrowUp: "ArrowDown", ArrowDown: "ArrowUp", ArrowLeft: "ArrowRight", ArrowRight: "ArrowLeft" };
  const pendingReturn = []; // track steps taken to reverse them

  async function wander() {
    if (!page || botStatus !== "in-world") return;
    if (isResponding || isMoving) return;

    isMoving = true;
    try {
      if (pendingReturn.length > 0) {
        // Return toward spawn — reverse previous steps
        const returnStep = pendingReturn.pop();
        if (!isResponding) {
          await page.keyboard.press(returnStep.dir);
          await new Promise(r => setTimeout(r, 300));
          if (returnStep.steps > 1) {
            for (let i = 1; i < returnStep.steps && !isResponding; i++) {
              await page.keyboard.press(returnStep.dir);
              await new Promise(r => setTimeout(r, 300));
            }
          }
        }
      } else {
        // Walk out exactly 1 step in a random direction
        const dir = DIRECTIONS[Math.floor(Math.random() * 4)];
        const steps = 1;
        for (let i = 0; i < steps && !isResponding; i++) {
          await page.keyboard.press(dir);
          await new Promise(r => setTimeout(r, 300));
        }
        // Queue the return trip
        pendingReturn.push({ dir: OPPOSITE[dir], steps });
      }
    } catch (e) {
      console.log(`[${AGENT_NAME}] Wander error:`, e.message);
    }
    isMoving = false;
  }

  // Every 4-8 seconds — just a subtle fidget
  function scheduleNext() {
    const delay = 4000 + Math.floor(Math.random() * 4000);
    setTimeout(async () => {
      await wander();
      if (botStatus === "in-world") scheduleNext();
    }, delay);
  }
  scheduleNext();
  console.log(`[${AGENT_NAME}] Box-step wandering started`);
}

function scheduleReconnect() {
  if (isReconnecting) return;
  isReconnecting = true;
  console.log(`[${AGENT_NAME}] Reconnecting in 15s...`);
  setTimeout(async () => {
    try {
      await enterWorld();
      isReconnecting = false;
    } catch (e) {
      console.error(`[${AGENT_NAME}] Reconnect failed:`, e.message);
      isReconnecting = false;
      scheduleReconnect();
    }
  }, 15000);
}

async function transcribe(audioB64) {
  if (!OPENAI_KEY) {
    console.log(`[${AGENT_NAME}] No OPENAI_API_KEY — cannot transcribe`);
    return null;
  }
  try {
    const binary = Buffer.from(audioB64, "base64");
    const boundary = "----Boundary" + Date.now().toString(36);

    const body = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="model"\r\n\r\nwhisper-1\r\n`),
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="audio.webm"\r\nContent-Type: audio/webm\r\n\r\n`),
      binary,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);

    const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENAI_KEY}`,
        "Content-Type": `multipart/form-data; boundary=${boundary}`,
      },
      body,
    });

    const data = await res.json();
    if (!res.ok) { console.error("Whisper error:", JSON.stringify(data)); return null; }
    return data.text || null;
  } catch (e) {
    console.error("Transcribe error:", e.message);
    return null;
  }
}

async function speak(text) {
  if (!ELEVENLABS_KEY || !ELEVENLABS_VOICE || !page) return;
  console.log(`[${AGENT_NAME}] Speaking: "${text}"`);

  try {
    const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${ELEVENLABS_VOICE}?optimize_streaming_latency=4`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "xi-api-key": ELEVENLABS_KEY },
      body: JSON.stringify({
        text,
        model_id: "eleven_turbo_v2_5",
        voice_settings: { stability: 0.4, similarity_boost: 0.7 },
      }),
    });

    if (!res.ok) { console.error("TTS error:", res.status); return; }

    const buf = Buffer.from(await res.arrayBuffer());
    const b64 = buf.toString("base64");

    await page.evaluate(async (audio) => {
      await window._playAudioBase64(audio);
    }, b64);

    console.log(`[${AGENT_NAME}] Audio played`);
  } catch (e) {
    console.error("Speak error:", e.message);
  }
}

async function getResponse(userMessage, history) {
  if (!ANTHROPIC_KEY) return "I need an API key to respond.";
  history.push({ role: "user", content: userMessage });

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 100,
        system: PERSONALITY,
        messages: history.slice(-10),
      }),
    });
    const data = await res.json();
    if (!res.ok || data.error) {
      console.error(`[${AGENT_NAME}] Claude API error:`, JSON.stringify(data.error || data));
      return "Hmm, let me think about that for a moment.";
    }
    const reply = data.content?.[0]?.text || "Hmm, let me think about that.";
    history.push({ role: "assistant", content: reply });
    return reply;
  } catch (e) {
    console.error(`[${AGENT_NAME}] Claude fetch error:`, e.message);
    return "Give me a second, I lost my train of thought.";
  }
}

// Keepalive
setInterval(() => {
  if (botStatus === "in-world") {
    console.log(new Date().toISOString(), `[${AGENT_NAME}]`, "alive");
  }
}, 30000);

// Start
enterWorld().catch(e => {
  console.error(`[${AGENT_NAME}] Fatal:`, e.message);
  botStatus = "crashed: " + e.message;
  scheduleReconnect();
});
