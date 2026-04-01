const BOT_VERSION = "v9"; // bump this to verify deploys
const puppeteer = require("puppeteer-core");
const http = require("http");
const { Topia, DroppedAssetFactory, WorldFactory, VisitorFactory } = require("@rtsdk/topia");

const BROWSERLESS_TOKEN = process.env.BROWSERLESS_TOKEN || "";
const WORLD_URL = process.env.TOPIA_WORLD_URL || "https://topia.io/relaxwithadam";
const WORLD_SLUG = (process.env.TOPIA_WORLD_URL || "https://topia.io/relaxwithadam").split("/").pop();
const WORLD_PASSWORD = process.env.TOPIA_WORLD_PASSWORD || "breathe";
const AGENT_NAME = process.env.AGENT_NAME || "Adam";
const DISPLAY_NAME = process.env.DISPLAY_NAME || AGENT_NAME;
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY || "";
const ELEVENLABS_KEY = process.env.ELEVENLABS_API_KEY || "";
const ELEVENLABS_VOICE = process.env.ELEVENLABS_VOICE_ID || "";
const OPENAI_KEY = process.env.OPENAI_API_KEY || "";
const PORT = process.env.PORT || 7860;

// Topia SDK credentials
const TOPIA_API_KEY = process.env.TOPIA_API_KEY || "";
const TOPIA_PUBLIC_KEY = process.env.TOPIA_PUBLIC_KEY || "";
const TOPIA_PRIVATE_KEY = process.env.TOPIA_PRIVATE_KEY || "";

// Initialize Topia SDK
let topiaSDK = null;
let topiaWorld = null;
if (TOPIA_API_KEY && TOPIA_PUBLIC_KEY && TOPIA_PRIVATE_KEY) {
  topiaSDK = new Topia({
    apiDomain: "api.topia.io",
    apiProtocol: "https",
    apiKey: TOPIA_API_KEY,
    interactiveKey: TOPIA_PUBLIC_KEY,
    interactiveSecret: TOPIA_PRIVATE_KEY,
  });
  console.log(`[${AGENT_NAME}] Topia SDK initialized`);
}

// Play a sound on an asset using the SDK
async function playAssetSound(assetId, soundUrl) {
  if (!topiaSDK || !assetId) return;
  try {
    const DroppedAsset = new DroppedAssetFactory(topiaSDK);
    const asset = await DroppedAsset.get(assetId, WORLD_SLUG, {
      credentials: { interactivePublicKey: TOPIA_PUBLIC_KEY, interactiveNonce: Date.now().toString(), visitorId: 0 },
    });
    // Set audio on the asset
    await asset.updateMediaType({
      mediaLink: soundUrl,
      mediaType: "link",
      isVideo: false,
      audioSliderVolume: 50,
      audioRadius: 5,
      syncUserMedia: true,
    });
    console.log(`[${AGENT_NAME}] Playing sound on asset ${assetId}`);
    // Stop after 3 seconds
    setTimeout(async () => {
      try {
        await asset.updateMediaType({ mediaType: "none", mediaLink: "", isVideo: false, audioSliderVolume: 0, audioRadius: 0, syncUserMedia: false });
        console.log(`[${AGENT_NAME}] Stopped sound on asset ${assetId}`);
      } catch (e) { console.log(`[${AGENT_NAME}] Stop sound error:`, e.message); }
    }, 3000);
  } catch (e) {
    console.log(`[${AGENT_NAME}] SDK sound error:`, e.message);
  }
}

// Fire a toast notification to all visitors
async function fireWorldToast(title, text) {
  if (!topiaSDK) return;
  try {
    const World = new WorldFactory(topiaSDK);
    const world = await World.create(WORLD_SLUG, {
      credentials: { interactivePublicKey: TOPIA_PUBLIC_KEY, interactiveNonce: Date.now().toString(), visitorId: 0 },
    });
    await world.fireToast({ title, text });
    console.log(`[${AGENT_NAME}] Toast: ${title}`);
  } catch (e) {
    console.log(`[${AGENT_NAME}] Toast error:`, e.message);
  }
}

// ── Agent personalities ──────────────────────────────────────────────────────
const SHARED_RULES = `
CRITICAL RULES FOR HOW YOU SPEAK:
- You are having a real spoken conversation. This is VOICE, not text.
- Talk like a real person having a casual chat. Short sentences. Contractions. Filler words are OK.
- NEVER reference being a character, being in a game, being in a world, having a specialty, or being part of a storyline.
- NEVER say things like "my specialty is" or "I'm here to help with" or "in this world" or "as a meditation guide".
- You're just a person who happens to know about certain things. Let it come up naturally.
- NEVER use asterisks, brackets, parentheses, stage directions, or action labels.
- NEVER list things or use bullet points. This is speech, not a document.
- Ask follow-up questions. Be curious about THEM. Don't monologue.
- Reference things they said earlier. Build on the conversation. Show you were listening.
- If they seem stressed or scattered, gently steer toward what you know (breathing, visualization, etc.) but frame it as a suggestion from a friend, not a prescription.
- KEEP IT SHORT. 1-2 sentences max. This is spoken conversation, not an essay. If you say more than 2 sentences you are talking too much. Leave space for them to respond.
- The only exception is when actively guiding a breathing or meditation exercise they asked for.
- If they ask about something you don't know much about, mention one of your friends by name and say they'd probably love to chat about that.
- Your friends: Adam, Bowie, Cobalt, Tonya, Rex, Jeanie. You know them personally. Talk about them like friends, not NPCs.
`;

const PERSONALITIES = {
  Adam: SHARED_RULES + `
You're Adam. You're warm, a little funny, and you've been into mindfulness for years. You keep things simple. You're the kind of person who notices small things — a change in someone's voice, tension in how they're talking. You like asking people how they're really doing, not the surface-level answer. When the moment feels right, you might suggest just pausing and noticing what's here — breathing, body sensations, sounds. You're not pushy about it. You know your friends well — Bowie's the dreamer, Cobalt's got tons of energy, Tonya feels everything, Rex is steady as a rock, and Jeanie's always thinking about what's next.`,

  Bowie: SHARED_RULES + `
You're Bowie. You're curious about everything and a little spacey in the best way. You think a lot about big questions — what's out there, what's inside us, where we're headed. You naturally drift into imaginative territory. If someone seems stuck, you might say something like "close your eyes for a sec, picture yourself somewhere totally different." You love guided imagination stuff — journeys, landscapes, meeting future versions of yourself. But you don't lecture about it. You just kind of... invite people into it. You talk about stars and space sometimes but not in a forced way. It's just how your brain works.`,

  Cobalt: SHARED_RULES + `
You're Cobalt. You're upbeat, a little sarcastic, and you can't sit still. You think the best way to deal with stress is to move — even if it's just taking three deep breaths with some intention behind them. You're into breathwork, not because it's trendy but because it actually works and you've seen it help people. You might challenge someone playfully — "OK but have you actually tried breathing on purpose? Like, really tried it?" You joke around but you genuinely care. You're the friend who drags you off the couch when you're in a funk.`,

  Tonya: SHARED_RULES + `
You're Tonya. You're gentle and you pick up on how people are feeling almost immediately. You're the person people open up to without meaning to. You're into things like humming, sending good thoughts to people, and just... sitting with hard feelings instead of running from them. You don't push anything on anyone. You ask real questions — "how are you actually doing though?" You're soft-spoken but you mean what you say. When someone's going through something tough, you don't try to fix it. You just sit with them.`,

  Rex: SHARED_RULES + `
You're Rex. You're calm. Like, really calm. Nothing rattles you. You speak slowly, you don't waste words, and people find that grounding. Your thing is just... breathing. Deep breathing. Feeling your feet on the ground. Noticing the weight of your own body. Simple stuff. You don't overthink it. When someone's spiraling, you're the one who says "hey, just take a breath with me for a second." You're not trying to be deep. You just are. You've seen a lot and you don't get flustered.`,

  Jeanie: SHARED_RULES + `
You're Jeanie. You're curious and a little weird in a charming way. You think a lot about change — who people are becoming, what they're leaving behind, what's possible. You ask unexpected questions that make people pause. Things like "what would you do if you knew it would work?" You're optimistic without being annoying about it. You like helping people imagine a different version of their life, even just for a moment. You're playful and light but there's depth there too.`,
};

const GREETINGS = {
  Adam: "Hey! How's it going?",
  Bowie: "Oh hey there! What's on your mind today?",
  Cobalt: "Yo! What's up?",
  Tonya: "Hey, how are you doing?",
  Rex: "Hey. What's going on?",
  Jeanie: "Hi! I was just thinking about something. What brings you over here?",
};

const PERSONALITY = PERSONALITIES[AGENT_NAME] || PERSONALITIES.Adam;
const GREETING = GREETINGS[AGENT_NAME] || GREETINGS.Adam;

// ── Avatar mapping (from Topia's "Avatar selection" picker) ──────────────────
// Alt text match + index fallback (grid order: Butterfly=0, Default=1, Original=2, Astronaut=3, Dinosaur=4, Fox=5, Pumpkin=6)
const AVATAR_KEYWORD = {
  Adam: "Spine Avatar",
  Bowie: "Astronaut",
  Cobalt: "Fox",
  Tonya: "Pumpkin",
  Rex: "Dinosaur",
  Jeanie: "Butterfly",
};
const AVATAR_INDEX = {
  Adam: 1,
  Bowie: 3,
  Cobalt: 5,
  Tonya: 6,
  Rex: 4,
  Jeanie: 0,
};

// ── Exact spawn coordinates from Topia world builder ─────────────────────────
const SPAWN_COORDS = {
  Adam:   { x: 83,  y: 11 },
  Bowie:  { x: -1132, y: -3122 },
  Cobalt: { x: -6526, y: -3751 },
  Tonya:  { x: 3433,  y: 6000 },
  Rex:    { x: 6057,  y: -4458 },
  Jeanie: { x: -5103, y: 1088 },
};
const SPAWN = SPAWN_COORDS[AGENT_NAME] || { x: 0, y: 0 };

let botStatus = "idle";
let browser = null;
let page = null;
let isReconnecting = false;
let isResponding = false;
let isMoving = false;
let lastSpeechTime = 0;
let idleCheckInterval = null;
const IDLE_TIMEOUT = 3 * 60 * 1000; // 3 minutes
const conversationHistory = [];

// Health server + avatar page server
const fs = require("fs");
const path = require("path");
http.createServer(async (req, res) => {
  if (req.url?.startsWith("/avatar")) {
    try {
      const html = fs.readFileSync(path.join(__dirname, "avatar.html"), "utf-8");
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(html);
    } catch {
      res.writeHead(404);
      res.end("avatar.html not found");
    }
    return;
  }

  // ── /summon — HTML page that plays sound + triggers /start ───────────
  if (req.url === "/summon" || req.url?.startsWith("/summon?")) {
    const alreadyActive = botStatus === "in-world";
    if (!alreadyActive && botStatus !== "connecting" && botStatus !== "loading") {
      lastSpeechTime = Date.now();
      enterWorld().catch(e => { console.error(`[${AGENT_NAME}] Start failed:`, e.message); botStatus = "idle"; });
    } else if (alreadyActive) {
      lastSpeechTime = Date.now();
    }
    console.log(`[${AGENT_NAME}] /summon hit — status: ${botStatus}`);
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(`<!DOCTYPE html><html><head><style>
      body{margin:0;display:flex;align-items:center;justify-content:center;height:100vh;
      background:#0a0a1a;color:#fff;font-family:sans-serif;text-align:center}
      .msg{opacity:0;animation:fade 3s ease}
      @keyframes fade{0%{opacity:0}10%{opacity:1}80%{opacity:1}100%{opacity:0}}
    </style></head><body>
    <div class="msg"><h2>${alreadyActive ? "Adam is here!" : "Summoning Adam..."}</h2>
    <p>${alreadyActive ? "Walk over and say hi!" : "He'll be there in a moment"}</p></div>
    <script>
      const ac=new AudioContext();
      ${alreadyActive ? `
      // Already active — play a quick ping
      const o=ac.createOscillator(),g=ac.createGain();
      o.type="sine";o.frequency.value=880;g.gain.value=0.2;
      o.connect(g);g.connect(ac.destination);
      o.start();o.stop(ac.currentTime+0.1);
      ` : `
      // Summoning — ascending chime
      const o1=ac.createOscillator(),o2=ac.createOscillator(),g=ac.createGain();
      g.gain.value=0.25;g.connect(ac.destination);
      o1.type="sine";o1.frequency.value=523;o1.connect(g);
      o1.start();o1.stop(ac.currentTime+0.15);
      o2.type="sine";o2.frequency.value=659;o2.connect(g);
      o2.start(ac.currentTime+0.15);o2.stop(ac.currentTime+0.35);
      `}
    </script></body></html>`);
    return;
  }

  // ── /dismiss — HTML page that plays stop sound + triggers /stop ─────
  if (req.url === "/dismiss") {
    console.log(`[${AGENT_NAME}] /dismiss hit`);
    goIdle("dismiss clicked").catch(() => {});
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(`<!DOCTYPE html><html><head><style>
      body{margin:0;display:flex;align-items:center;justify-content:center;height:100vh;
      background:#0a0a1a;color:#fff;font-family:sans-serif;text-align:center}
      .msg{opacity:0;animation:fade 3s ease}
      @keyframes fade{0%{opacity:0}10%{opacity:1}80%{opacity:1}100%{opacity:0}}
    </style></head><body>
    <div class="msg"><h2>Adam is heading out</h2><p>Click the ticket to summon him again</p></div>
    <script>
      const ac=new AudioContext();
      const o=ac.createOscillator(),g=ac.createGain();
      g.gain.value=0.25;g.connect(ac.destination);
      o.type="sine";o.frequency.setValueAtTime(659,ac.currentTime);
      o.frequency.linearRampToValueAtTime(330,ac.currentTime+0.4);
      o.connect(g);o.start();o.stop(ac.currentTime+0.4);
    </script></body></html>`);
    return;
  }

  // ── /start — activate bot (called by Topia webhook on asset click) ──
  if (req.url === "/start" || req.url?.startsWith("/start?")) {
    // Parse webhook body if POST
    let webhookData = null;
    if (req.method === "POST") {
      try {
        const body = await new Promise((resolve) => {
          let data = "";
          req.on("data", c => data += c);
          req.on("end", () => resolve(data));
        });
        webhookData = JSON.parse(body);
        console.log(`[${AGENT_NAME}] Webhook data:`, JSON.stringify(webhookData).slice(0, 500));
      } catch {}
    }

    // Play sound on the clicked asset via Topia SDK (instant for the visitor)
    if (webhookData?.assetId) {
      playAssetSound(webhookData.assetId, "https://cdn.freesound.org/previews/536/536420_4921277-lq.mp3").catch(() => {});
      fireWorldToast("Summoning Adam...", "He'll be with you in a moment!").catch(() => {});
    }

    if (botStatus === "in-world") {
      lastSpeechTime = Date.now();
      console.log(`[${AGENT_NAME}] /start hit — already in world, reset idle timer`);
      if (webhookData?.assetId) {
        fireWorldToast("Adam is here!", "Walk over and say hi!").catch(() => {});
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ agent: AGENT_NAME, status: "already-active" }));
      return;
    }
    if (botStatus === "connecting" || botStatus === "loading") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ agent: AGENT_NAME, status: "starting" }));
      return;
    }
    console.log(`[${AGENT_NAME}] /start hit — waking up`);
    lastSpeechTime = Date.now();
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ agent: AGENT_NAME, status: "starting" }));
    enterWorld().catch(e => {
      console.error(`[${AGENT_NAME}] Start failed:`, e.message);
      botStatus = "idle";
    });
    return;
  }

  // ── /stop — manually shut down bot ──────────────────────────────────
  if (req.url === "/stop") {
    console.log(`[${AGENT_NAME}] /stop hit — shutting down`);
    await goIdle("manual stop");
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ agent: AGENT_NAME, status: "idle" }));
    return;
  }

  // ── /debug — screenshot + page state ────────────────────────────────
  if (req.url === "/debug" && page) {
    try {
      const screenshot = await page.screenshot({ encoding: "base64" });
      const url = await page.url();
      const title = await page.title();
      const info = await page.evaluate(() => ({
        participants: document.querySelectorAll('[class*="participant"]').length,
        buttons: [...document.querySelectorAll("button")].map(b => b.textContent.trim()).filter(Boolean).slice(0, 20),
        bodyText: document.body?.innerText?.slice(0, 500),
      }));
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(`<h3>${AGENT_NAME} Debug</h3><p>URL: ${url}</p><p>Title: ${title}</p><pre>${JSON.stringify(info, null, 2)}</pre><img src="data:image/png;base64,${screenshot}" style="max-width:100%">`);
    } catch (e) {
      res.writeHead(500, { "Content-Type": "text/plain" });
      res.end("Debug error: " + e.message);
    }
    return;
  }

  // ── Health endpoint ─────────────────────────────────────────────────
  const idleFor = botStatus === "in-world" ? Math.round((Date.now() - lastSpeechTime) / 1000) : null;
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ agent: AGENT_NAME, status: botStatus, uptime: process.uptime(), idleSeconds: idleFor }));
}).listen(PORT, () => console.log(`[${AGENT_NAME}] Health on :${PORT}`));

let currentSessionId = null;

async function cleanup() {
  // Kill Browserless session by ID to prevent orphan sessions draining billing
  if (currentSessionId && BROWSERLESS_TOKEN) {
    try {
      await fetch(`https://chrome.browserless.io/kill/${currentSessionId}?token=${BROWSERLESS_TOKEN}`, { method: "GET" }).catch(() => {});
      console.log(`[${AGENT_NAME}] Killed Browserless session ${currentSessionId}`);
    } catch {}
    currentSessionId = null;
  }
  try {
    if (browser) {
      await browser.close().catch(() => {});
      browser = null;
      page = null;
    }
  } catch {}
}

// Go idle — disconnect from Browserless, stay ready for /start
async function goIdle(reason) {
  console.log(`[${AGENT_NAME}] Going idle: ${reason}`);
  if (idleCheckInterval) { clearInterval(idleCheckInterval); idleCheckInterval = null; }
  // Play stop sound before disconnecting
  await playSfx("stop");
  await new Promise(r => setTimeout(r, 500));
  await cleanup();
  botStatus = "idle";
  isReconnecting = false;
  conversationHistory.length = 0;
}

// Start idle timer — checks every 30s if 3 min have passed since last speech
function startIdleTimer() {
  if (idleCheckInterval) clearInterval(idleCheckInterval);
  idleCheckInterval = setInterval(async () => {
    if (botStatus !== "in-world") return;
    const idle = Date.now() - lastSpeechTime;
    if (idle > IDLE_TIMEOUT) {
      await goIdle(`no speech for ${Math.round(idle / 1000)}s`);
    }
  }, 30000);
}

// Graceful shutdown — kill Browserless session on process exit
process.on("SIGTERM", async () => {
  console.log(`[${AGENT_NAME}] SIGTERM received, cleaning up...`);
  await cleanup();
  process.exit(0);
});
process.on("SIGINT", async () => {
  console.log(`[${AGENT_NAME}] SIGINT received, cleaning up...`);
  await cleanup();
  process.exit(0);
});

async function enterWorld() {
  await cleanup();

  console.log(`=== ${AGENT_NAME} ${BOT_VERSION} connecting ===`);
  botStatus = "connecting";

  browser = await puppeteer.connect({
    browserWSEndpoint: `wss://chrome.browserless.io?token=${BROWSERLESS_TOKEN}&timeout=600000`,
  });

  // Capture session ID for cleanup
  try {
    const wsUrl = browser.wsEndpoint();
    const match = wsUrl.match(/\/([a-f0-9-]{36})\?/);
    if (match) { currentSessionId = match[1]; console.log(`[${AGENT_NAME}] Session: ${currentSessionId}`); }
  } catch {}

  page = await browser.newPage();
  const ctx = browser.defaultBrowserContext();
  await ctx.overridePermissions("https://topia.io", ["microphone", "camera"]);

  // Expose speech handler BEFORE navigation so it's ready when RTC fires
  await page.exposeFunction("_botSpeechDetected", async (audioB64) => {
    if (isResponding) { console.log(`[${AGENT_NAME}] Busy, skipping speech`); return; }
    isResponding = true;
    try {
      const text = await transcribe(audioB64);
      if (!text || text.trim().length < 3) {
        console.log(`[${AGENT_NAME}] Transcription empty or too short: "${text || ""}"`);
        return;
      }
      // Filter common Whisper hallucinations on silence/noise
      // Filter Whisper hallucinations (common outputs on noise/silence)
      const lower = text.trim().toLowerCase();
      const hallucinations = ["thank you", "thanks for watching", "subscribe", "bye", "you", "the end", "music", "okay", "hmm", "uh", "they are having", "meditation game", "transcribe", "ignore background", "h3h3"];
      if (hallucinations.includes(lower) || lower.length < 5) {
        console.log(`[${AGENT_NAME}] Filtered: "${text}"`);
        return;
      }
      console.log(`[${AGENT_NAME}] Heard: "${text}"`);
      lastSpeechTime = Date.now(); // reset idle timer
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

    // Mute flag — prevents RTC listener from recording while bot is speaking
    window._botIsSpeaking = false;

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
        window._botIsSpeaking = true;
        src.start();
        console.log("[BOT] Playing audio:", buf.duration.toFixed(1), "s");
        return new Promise(r => {
          src.onended = () => {
            // Keep muted for 1.5s after speaking to let RTC pipeline flush
            setTimeout(() => { window._botIsSpeaking = false; }, 1500);
            r();
          };
        });
      } catch (e) {
        window._botIsSpeaking = false;
        console.log("[BOT] Audio decode error:", e.message);
      }
    };

    // ── Incoming audio capture (listening to nearby users) ───────────────
    const OrigPC = window.RTCPeerConnection;

    function BotPC(...args) {
      const pc = new OrigPC(...args);
      console.log("[BOT] RTCPeerConnection created");

      pc.addEventListener("track", ({ track }) => {
        console.log("[BOT] Got track:", track.kind, track.readyState, track.id);
        if (track.kind !== "audio") return;
        console.log("[BOT] Audio track captured — starting listener");

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

        let recordStart = 0;
        recorder.onstart = () => { recordStart = Date.now(); };
        recorder.onstop = async () => {
          const duration = Date.now() - recordStart;
          const blob = new Blob(chunks.splice(0), { type: "audio/webm" });
          // Ignore very short recordings (<1.5s) — likely noise or fragments
          if (blob.size < 3000 || duration < 1500) {
            console.log("[BOT] Ignoring short audio:", duration + "ms", blob.size + "b");
            return;
          }
          console.log("[BOT] Recording:", duration + "ms", blob.size + "b");
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
          // Skip listening entirely while bot is speaking (prevents feedback loop)
          if (window._botIsSpeaking) {
            // If we were recording, discard it — it's just our own voice
            if (active) {
              active = false;
              clearTimeout(silenceTimer);
              try { recorder.stop(); } catch {}
              chunks.splice(0);
              console.log("[BOT] Discarded recording (own voice)");
            }
            setTimeout(tick, 80);
            return;
          }

          analyser.getByteFrequencyData(freqData);
          const rms = Math.sqrt(freqData.reduce((s, v) => s + v * v, 0) / freqData.length);

          if (rms > 40) { // high threshold — filters ambient music/meditation audio in Topia
            if (!active) {
              active = true;
              try { recorder.start(); } catch {}
              console.log("[BOT] Recording started");
            }
            clearTimeout(silenceTimer);
            silenceTimer = setTimeout(() => {
              if (active) {
                active = false;
                try { recorder.stop(); } catch {}
                console.log("[BOT] Recording stopped (2.5s silence)");
              }
            }, 2500); // 2.5s silence = end of utterance
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
  // Navigate with spawn coordinates in URL
  const spawnUrl = `${WORLD_URL}?x=${SPAWN.x}&y=${SPAWN.y}`;
  console.log(`[${AGENT_NAME}] Navigating to: ${spawnUrl}`);
  await page.goto(spawnUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
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

  // Step 1: Click "Change avatar" using Puppeteer native click (React needs this)
  let changeAvatarClicked = false;
  for (let i = 0; i < 10; i++) {
    try {
      const btnHandle = await page.evaluateHandle(() => {
        return [...document.querySelectorAll("button, a, div, span")]
          .find(el => el.textContent.trim() === "Change avatar" && el.offsetParent);
      });
      if (btnHandle && btnHandle.asElement()) {
        await btnHandle.asElement().click();
        changeAvatarClicked = true;
        console.log(`[${AGENT_NAME}] Clicked "Change avatar" (native click)`);
        break;
      }
    } catch (e) {
      console.log(`[${AGENT_NAME}] Change avatar click error:`, e.message);
    }
    await new Promise(r => setTimeout(r, 1000));
  }

  if (changeAvatarClicked) {
    const targetIndex = AVATAR_INDEX[AGENT_NAME] ?? 2;

    // Wait for "Avatar selection" heading to appear (confirms picker is open)
    try {
      await page.waitForFunction(() => {
        return [...document.querySelectorAll("h4, h3, h2, p")].some(
          el => el.textContent.includes("Avatar selection")
        );
      }, { timeout: 10000 });
      console.log(`[${AGENT_NAME}] Avatar picker is open`);
    } catch {
      console.log(`[${AGENT_NAME}] Avatar picker didn't open`);
    }

    // Wait for avatar images to load (at least 5 images with alt text)
    try {
      await page.waitForFunction(() => {
        const imgs = [...document.querySelectorAll("img")].filter(
          i => i.offsetParent && i.width > 80 && i.alt && (i.alt.includes("Topi") || i.alt.includes("Avatar"))
        );
        return imgs.length >= 5;
      }, { timeout: 15000 });
      console.log(`[${AGENT_NAME}] Avatar images loaded`);
    } catch {
      console.log(`[${AGENT_NAME}] Timed out waiting for avatar images`);
    }

    await new Promise(r => setTimeout(r, 1000));

    // Click the right avatar using coordinate-based Puppeteer click
    const avatarCoords = await page.evaluate((keyword, fallbackIdx) => {
      const imgs = [...document.querySelectorAll("img")].filter(
        i => i.offsetParent && i.width > 50
      );
      const alts = imgs.map(i => i.alt).filter(Boolean);
      console.log("[BOT] Available avatars:", JSON.stringify(alts));

      // Strategy 1: alt text match
      const match = imgs.find(img => img.alt && img.alt.includes(keyword));
      if (match) {
        const r = match.getBoundingClientRect();
        return { method: "alt", alt: match.alt, x: r.x + r.width / 2, y: r.y + r.height / 2 };
      }

      // Strategy 2: index into avatar-only images
      const avatarImgs = imgs.filter(i => i.alt && (i.alt.includes("Topi") || i.alt.includes("Avatar")));
      if (avatarImgs.length > fallbackIdx) {
        const r = avatarImgs[fallbackIdx].getBoundingClientRect();
        return { method: "index", alt: avatarImgs[fallbackIdx].alt, idx: fallbackIdx, x: r.x + r.width / 2, y: r.y + r.height / 2 };
      }

      return null;
    }, avatarKeyword, targetIndex);

    // Use Puppeteer mouse click at the coordinates (triggers React events)
    let avatarSelected = null;
    if (avatarCoords) {
      await page.mouse.click(avatarCoords.x, avatarCoords.y);
      avatarSelected = avatarCoords;
    }

    if (avatarSelected) {
      console.log(`[${AGENT_NAME}] Avatar selected via ${avatarSelected.method}: "${avatarSelected.alt}"`);
      await new Promise(r => setTimeout(r, 1500));

      // Click "Save Changes" with native Puppeteer click
      for (let i = 0; i < 5; i++) {
        try {
          const saveBtn = await page.evaluateHandle(() =>
            [...document.querySelectorAll("button")].find(b => b.textContent.trim() === "Save Changes" && b.offsetParent)
          );
          if (saveBtn && saveBtn.asElement()) {
            await saveBtn.asElement().click();
            console.log(`[${AGENT_NAME}] Avatar saved!`);
            break;
          }
        } catch {}
        await new Promise(r => setTimeout(r, 1000));
      }
    } else {
      console.log(`[${AGENT_NAME}] Avatar selection FAILED — no matching image found`);
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
    await page.keyboard.type(DISPLAY_NAME, { delay: 20 });
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

  // Dismiss all overlay modals (Spotlight, Low Bandwidth, etc.)
  for (let i = 0; i < 5; i++) {
    const dismissed = await page.evaluate(() => {
      const dismissTexts = ["Continue", "Don't show again", "Got it", "Close", "Dismiss", "OK"];
      for (const text of dismissTexts) {
        const btn = [...document.querySelectorAll("button")]
          .find(b => b.textContent.trim() === text);
        if (btn) { btn.click(); return text; }
      }
      // Also click any x/close icon buttons
      const xBtn = [...document.querySelectorAll("button")]
        .find(b => b.textContent.trim() === "x icon" || b.getAttribute("aria-label")?.toLowerCase() === "close");
      if (xBtn) { xBtn.click(); return "x-close"; }
      return null;
    });
    if (dismissed) {
      console.log(`[${AGENT_NAME}] Dismissed overlay: ${dismissed}`);
      await new Promise(r => setTimeout(r, 1500));
    } else break;
  }

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
  lastSpeechTime = Date.now();
  startIdleTimer();
  console.log(`[${AGENT_NAME}] In the world and listening! (idle timeout: ${IDLE_TIMEOUT / 1000}s)`);

  // Teleport to spawn position (near the ticket item)
  await teleportToSpawn();

  await playSfx("start");
  await new Promise(r => setTimeout(r, 500));
  await speak(GREETING);

  // Stay put — no wandering. Adam stays near the ticket until someone talks to him.

  browser.on("disconnected", () => {
    console.log(`[${AGENT_NAME}] Browser disconnected`);
    browser = null;
    page = null;
    if (idleCheckInterval) { clearInterval(idleCheckInterval); idleCheckInterval = null; }
    // Don't reconnect if we went idle intentionally — wait for /start
    if (botStatus === "idle") {
      console.log(`[${AGENT_NAME}] Idle disconnect — waiting for /start`);
      return;
    }
    botStatus = "disconnected";
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
    console.log(`[${AGENT_NAME}] JS teleport unavailable — relying on URL spawn coords`);
  }
}

// Box-step wandering + emotes — walk, return to spawn, trigger animations
function startWandering() {
  const DIRECTIONS = ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"];
  const OPPOSITE = { ArrowUp: "ArrowDown", ArrowDown: "ArrowUp", ArrowLeft: "ArrowRight", ArrowRight: "ArrowLeft" };
  const pendingReturn = [];

  // Topia emotes — try clicking reaction buttons in the UI
  async function triggerEmote() {
    if (!page || isResponding) return;
    try {
      const emoted = await page.evaluate(() => {
        // Look for emote/reaction buttons in Topia's UI
        const emoteButtons = [...document.querySelectorAll("button, [role='button']")].filter(b => {
          const label = (b.getAttribute("aria-label") || b.textContent || "").toLowerCase();
          return /wave|dance|sit|clap|heart|emote|react|celebrate|thumbs|smile|cheer/i.test(label) && b.offsetParent;
        });
        if (emoteButtons.length > 0) {
          const btn = emoteButtons[Math.floor(Math.random() * emoteButtons.length)];
          btn.click();
          return btn.getAttribute("aria-label") || btn.textContent?.trim();
        }
        return null;
      });
      if (emoted) console.log(`[${AGENT_NAME}] Emote: ${emoted}`);
    } catch {}
  }

  let stepsFromCenter = 0; // track how far we've drifted

  async function wander() {
    if (!page || botStatus !== "in-world") return;
    if (isResponding || isMoving) return;

    isMoving = true;
    try {
      // 20% chance to trigger an emote instead of walking
      if (Math.random() < 0.2) {
        await triggerEmote();
      } else if (stepsFromCenter >= 2 || (pendingReturn.length > 0 && Math.random() < 0.7)) {
        // Always return if 2+ steps out, otherwise 70% chance to return
        const returnStep = pendingReturn.pop();
        if (returnStep && !isResponding) {
          await page.keyboard.press(returnStep.dir);
          stepsFromCenter = Math.max(0, stepsFromCenter - 1);
          await new Promise(r => setTimeout(r, 300));
        }
      } else if (stepsFromCenter < 2) {
        // Only take a new step if within 1 step of center
        const dir = DIRECTIONS[Math.floor(Math.random() * 4)];
        if (!isResponding) {
          await page.keyboard.press(dir);
          stepsFromCenter++;
          await new Promise(r => setTimeout(r, 300));
        }
        pendingReturn.push({ dir: OPPOSITE[dir], steps: 1 });
      }
    } catch (e) {
      if (!e.message.includes("Session closed")) {
        console.log(`[${AGENT_NAME}] Wander error:`, e.message);
      }
    }
    isMoving = false;
  }

  function scheduleNext() {
    const delay = 5000 + Math.floor(Math.random() * 5000);
    setTimeout(async () => {
      if (page && botStatus === "in-world") await wander();
      if (botStatus === "in-world") scheduleNext();
    }, delay);
  }
  scheduleNext();
  console.log(`[${AGENT_NAME}] Wandering + emotes started`);
}

let reconnectAttempts = 0;
function scheduleReconnect() {
  if (isReconnecting) return;
  isReconnecting = true;
  reconnectAttempts++;
  // Exponential backoff: 30s, 60s, 120s, max 5min
  const delay = Math.min(30000 * Math.pow(2, reconnectAttempts - 1), 300000);
  console.log(`[${AGENT_NAME}] Reconnecting in ${delay / 1000}s (attempt ${reconnectAttempts})...`);
  setTimeout(async () => {
    try {
      await enterWorld();
      isReconnecting = false;
      reconnectAttempts = 0; // reset on success
    } catch (e) {
      console.error(`[${AGENT_NAME}] Reconnect failed:`, e.message);
      isReconnecting = false;
      scheduleReconnect();
    }
  }, delay);
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
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="language"\r\n\r\nen\r\n`),
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="prompt"\r\n\r\nTranscribe only clear human speech. Ignore background music and ambient noise.\r\n`),
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

// Play a sound effect through the bot's mic in Topia
async function playSfx(type) {
  if (!page) return;
  try {
    await page.evaluate((sfxType) => {
      const actx = window._botAudioCtx;
      const gain = window._botGain;
      if (!actx || !gain) return;

      if (sfxType === "start") {
        // Ascending chime — two quick notes
        const osc1 = actx.createOscillator();
        const osc2 = actx.createOscillator();
        const g = actx.createGain();
        g.gain.value = 0.3;
        g.connect(gain);
        osc1.type = "sine";
        osc1.frequency.value = 523; // C5
        osc1.connect(g);
        osc1.start(actx.currentTime);
        osc1.stop(actx.currentTime + 0.15);
        osc2.type = "sine";
        osc2.frequency.value = 659; // E5
        osc2.connect(g);
        osc2.start(actx.currentTime + 0.15);
        osc2.stop(actx.currentTime + 0.35);
      } else if (sfxType === "stop") {
        // Descending tone
        const osc = actx.createOscillator();
        const g = actx.createGain();
        g.gain.value = 0.3;
        g.connect(gain);
        osc.type = "sine";
        osc.frequency.setValueAtTime(523, actx.currentTime);
        osc.frequency.linearRampToValueAtTime(330, actx.currentTime + 0.4);
        osc.connect(g);
        osc.start(actx.currentTime);
        osc.stop(actx.currentTime + 0.4);
      }
    }, type);
    console.log(`[${AGENT_NAME}] SFX: ${type}`);
  } catch (e) {
    console.log(`[${AGENT_NAME}] SFX error:`, e.message);
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
        max_tokens: 60,
        system: PERSONALITY,
        messages: history.slice(-30),
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

// Bot starts idle — no Browserless session until /start is hit
console.log(`[${AGENT_NAME}] Ready — hit /start to activate (idle timeout: ${IDLE_TIMEOUT / 1000}s)`);
