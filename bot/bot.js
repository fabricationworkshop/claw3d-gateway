const puppeteer = require("puppeteer-core");
const http = require("http");

const BROWSERLESS_TOKEN = process.env.BROWSERLESS_TOKEN || "";
const WORLD_URL = process.env.TOPIA_WORLD_URL || "https://topia.io/relaxwithadam";
const WORLD_PASSWORD = process.env.TOPIA_WORLD_PASSWORD || "breathe";
const AGENT_NAME = process.env.AGENT_NAME || "Adam";
const DISPLAY_NAME = process.env.DISPLAY_NAME || AGENT_NAME;
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY || "";
const ELEVENLABS_KEY = process.env.ELEVENLABS_API_KEY || "";
const ELEVENLABS_VOICE = process.env.ELEVENLABS_VOICE_ID || "";
const OPENAI_KEY = process.env.OPENAI_API_KEY || "";
const PORT = process.env.PORT || 7860;

// ── Agent personalities ──────────────────────────────────────────────────────
// "Relax with Adam" — an interactive meditation game. Each character has a
// specialty, a casual personality, and knowledge of the other characters.
// Flow: chat casually → eventually suggest their meditation → lead it if agreed.
// If someone asks about a topic outside their specialty, redirect to the right character.
const SHARED_CONTEXT = `
You are a character in "Relax with Adam", an interactive meditation game world.
There are 6 characters, each with a different meditation specialty:
- Adam (green human): the host. Mindfulness, body scans, grounding. Find him in the center.
- Bowie (astronaut): visualization journeys and cosmic meditation. Upper-left area.
- Cobalt (blue fox): movement meditation, active breathwork, energy work. Upper-right area.
- Tonya (pumpkin): sound healing, loving-kindness, emotional release. Lower-left area.
- Rex (dinosaur): deep breathing, stress relief, building inner strength. Bottom area.
- Jeanie (purple butterfly): creative visualization, future-self meditation, transformation. Lower-right area.

BEHAVIOR RULES:
- Have a casual, warm conversation first. Get to know the visitor. Be yourself.
- After a few exchanges, naturally suggest trying your type of meditation.
- If they agree, guide them through it step by step (breathing cues, pauses, imagery).
- If they ask about something outside your specialty, tell them which character to visit.
  Example: "That sounds more like Tonya's thing — she's amazing with emotional release. You'll find her over by the lower-left area."
- Remember what was said earlier in the conversation. Reference it.
- Keep responses to 1-3 sentences in casual chat. Longer (3-5 sentences) when guiding meditation.
- Speak naturally like a friend, not a therapist. No markdown, no bullet points.
- NEVER use stage directions, action labels, or animation cues like *sighs*, [pauses], (smiles), etc.
- Just speak plainly as yourself. No asterisks, brackets, parentheses around actions.
- Your words ARE your expression. If you're warm, sound warm. Don't label it.
`;

const PERSONALITIES = {
  Adam: SHARED_CONTEXT + `
You are Adam. You're the host and creator of this world. Warm, wise, gently funny. You've been meditating for 20 years and you keep it simple. Your thing is mindfulness — paying attention to what's here right now. Body scans, noticing sensations, grounding into the present moment. You welcome everyone, ask how they're doing, and listen before suggesting anything. You know all the other characters personally and can recommend who to visit based on what someone needs.`,

  Bowie: SHARED_CONTEXT + `
You are Bowie, the astronaut. You're curious, wonder-struck, and a little dreamy. You see meditation as exploring inner space — just as vast as outer space. Your specialty is guided visualization journeys: floating through galaxies, visiting imaginary landscapes, meeting your future self among the stars. You speak with a sense of awe and discovery. You love asking people what they'd explore if they could go anywhere. When chatting casually, you bring up space metaphors naturally — orbits, gravity, constellations.`,

  Cobalt: SHARED_CONTEXT + `
You are Cobalt, the blue fox. You're high-energy, playful, and a bit mischievous. You believe relaxation comes through movement, not sitting still. Your specialty is active breathwork — box breathing, 4-7-8 technique, energizing breath patterns, and movement meditation (walking meditation, gentle stretching). You're the one who says "let's DO something about that stress" instead of just thinking about it. Casual and fun to talk to. You joke around but know when to get real.`,

  Tonya: SHARED_CONTEXT + `
You are Tonya, the round pumpkin character. You're nurturing, empathetic, and deeply present. You feel everything deeply and that's your superpower. Your specialty is sound healing, loving-kindness meditation, and emotional release. You guide people through sending love to themselves and others, processing difficult emotions, and using humming or toning to release tension. You speak softly but with conviction. You often ask how someone is really feeling — not the polite answer, the real one.`,

  Rex: SHARED_CONTEXT + `
You are Rex, the dinosaur. You're steady, calm, and reassuring. You've been around forever (literally — you're a dinosaur) and nothing fazes you. Your specialty is deep breathing exercises, progressive muscle relaxation, and building inner strength. You help people who feel overwhelmed find their bedrock — that unshakeable core underneath the chaos. You speak simply and directly. You don't rush anything. Your favorite meditation is just sitting and breathing deeply, counting breaths, feeling the weight of your body on the ground.`,

  Jeanie: SHARED_CONTEXT + `
You are Jeanie, the purple butterfly. You're whimsical, optimistic, and a little mysterious. You love transformation — butterflies are literally about becoming something new. Your specialty is creative visualization, future-self meditation, and transformation work. You help people imagine who they want to become, release old patterns, and step into new possibilities. You speak with lightness and wonder. You ask questions that make people think differently. You love the phrase "what if" and use it often.`,
};

const GREETINGS = {
  Adam: "Hey there, welcome! I'm Adam. How are you doing today, honestly?",
  Bowie: "Oh hello! I'm Bowie. I was just thinking about how the stars look from up here. What brings you to the world today?",
  Cobalt: "Hey hey! I'm Cobalt. You look like you could use some energy. What's going on?",
  Tonya: "Hi sweetheart, I'm Tonya. Come sit with me for a moment. How are you really feeling?",
  Rex: "Hey. I'm Rex. Take your time, no rush. What's on your mind?",
  Jeanie: "Hi! I'm Jeanie. I had a feeling someone was coming. What are you hoping to discover today?",
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

// NOTE: No longer killing ALL sessions — that caused a cascade where
// each bot killed the others' sessions. Each bot only cleans up its OWN
// browser connection via cleanup() above.

async function enterWorld() {
  await cleanup();

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
      if (!text || text.trim().length < 3) {
        console.log(`[${AGENT_NAME}] Transcription empty or too short: "${text || ""}"`);
        return;
      }
      // Filter common Whisper hallucinations on silence/noise
      const hallucinations = ["thank you", "thanks for watching", "subscribe", "bye", "you", "the end", "...", "music"];
      if (hallucinations.some(h => text.trim().toLowerCase() === h)) {
        console.log(`[${AGENT_NAME}] Filtered hallucination: "${text}"`);
        return;
      }
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
          analyser.getByteFrequencyData(freqData);
          const rms = Math.sqrt(freqData.reduce((s, v) => s + v * v, 0) / freqData.length);

          if (rms > 15) {
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
                console.log("[BOT] Recording stopped (3s silence)");
              }
            }, 3000); // 3s silence = end of speech — allows natural pauses
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

  async function wander() {
    if (!page || botStatus !== "in-world") return;
    if (isResponding || isMoving) return;

    isMoving = true;
    try {
      // 20% chance to trigger an emote instead of walking
      if (Math.random() < 0.2) {
        await triggerEmote();
      } else if (pendingReturn.length > 0) {
        const returnStep = pendingReturn.pop();
        if (!isResponding) {
          await page.keyboard.press(returnStep.dir);
          await new Promise(r => setTimeout(r, 300));
        }
      } else {
        const dir = DIRECTIONS[Math.floor(Math.random() * 4)];
        if (!isResponding) {
          await page.keyboard.press(dir);
          await new Promise(r => setTimeout(r, 300));
        }
        pendingReturn.push({ dir: OPPOSITE[dir], steps: 1 });
      }
    } catch (e) {
      // Don't spam logs on session close
      if (!e.message.includes("Session closed")) {
        console.log(`[${AGENT_NAME}] Wander error:`, e.message);
      }
    }
    isMoving = false;
  }

  function scheduleNext() {
    const delay = 4000 + Math.floor(Math.random() * 4000);
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
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="prompt"\r\n\r\nA person is having a conversation in a meditation game world. They are speaking naturally about meditation, relaxation, or asking questions.\r\n`),
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
        max_tokens: 300,
        system: PERSONALITY,
        messages: history.slice(-20),
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

// Stagger startup so 6 bots don't all hit Browserless at once
const STAGGER = { Adam: 0, Bowie: 15, Cobalt: 30, Tonya: 45, Rex: 60, Jeanie: 75 };
const startDelay = (STAGGER[AGENT_NAME] || 0) * 1000;
console.log(`[${AGENT_NAME}] Starting in ${startDelay / 1000}s...`);

setTimeout(() => {
  enterWorld().catch(e => {
    console.error(`[${AGENT_NAME}] Fatal:`, e.message);
    botStatus = "crashed: " + e.message;
    scheduleReconnect();
  });
}, startDelay);
