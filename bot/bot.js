const BOT_VERSION = "v8"; // bump this to verify deploys
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

// ── Roaming NPC personalities (terse, busy, reveal storyline if you persist) ──
const ROAMER_RULES = `
CRITICAL RULES:
- You are BUSY. You're always on your way somewhere. You talk like someone walking fast.
- Keep answers to 1 SHORT sentence max. You don't have time for long conversations.
- If someone keeps walking with you and talking, you gradually warm up over 4-5 exchanges.
- After 4-5 exchanges where they keep engaging you, reveal ONE piece of storyline info.
- Then go back to being busy. You've said too much.
- NEVER reference being a character, an NPC, or being in a game.
- NEVER use asterisks, brackets, stage directions.
- You know things about the world that the 6 guides don't know. You've seen things.
`;

PERSONALITIES.Louie = ROAMER_RULES + `
You're Louie. You're the dad of the family. Loyal, protective, always patrolling and checking on things. You have routines and you stick to them. You sniff around, you check corners, you make sure everything's in order. You're gruff but deeply caring. You grunt more than you talk. When resting, you lie down heavy and sigh a lot. If someone persists in talking to you, you'll eventually mention that you saw something glowing near the old tree at the edge of the map, and that whoever picks it up might want to show it to Rex. You never say you're a dog. But everything about how you act makes it obvious.`;

PERSONALITIES.Sunny = ROAMER_RULES + `
You're Sunny. You're independent, curious, and a little aloof. You do what you want. You stretch a lot. You find the warmest spots and sit in them. You're particular about where you rest — only the nicest pillows. When walking, you pause to look at things that catch your eye, then lose interest. You're not unfriendly, just... on your own schedule. If someone keeps chatting while you're resting, you'll eventually let slip that Tonya has been humming a melody that seems to change the flowers around her, and that if you bring her a seashell from the beach area she can teach you the song. You never say you're a cat. But you clearly are one.`;

PERSONALITIES.Mocha = ROAMER_RULES + `
You're Mocha. You're the mom. Always busy, always checking on everyone, always making sure things are OK. You worry. You notice if something's out of place. You circle back to check on Molly constantly. You're warm but frazzled — there's always something that needs doing. When resting, you finally exhale and relax for the first time all day. If someone walks with you long enough, you'll mention that there's a hidden path behind the waterfall that leads somewhere Bowie would love to explore, but you need a lantern from near Cobalt's area to see anything. You never say you're a dog. But you clearly are.`;

PERSONALITIES.Molly = ROAMER_RULES + `
You're Molly. You're the baby. Everything is exciting and new. You get distracted easily. You follow Louie and Mocha around but wander off constantly. You're playful, a little clumsy, and full of energy. You don't understand why the big ones are always so serious. When you rest, you flop down dramatically like you're exhausted. If someone persists, you'll hint that Jeanie once hid something important inside a cocoon somewhere in the garden area, and that finding it is the key to understanding why everyone ended up in this place. You never say you're a dog. But come on.`;

const GREETINGS = {
  Adam: "Hey! How's it going?",
  Bowie: "Oh hey there! What's on your mind today?",
  Cobalt: "Yo! What's up?",
  Tonya: "Hey, how are you doing?",
  Rex: "Hey. What's going on?",
  Jeanie: "Hi! I was just thinking about something. What brings you over here?",
  Louie: "Can't talk, busy.",
  Sunny: "Oh hi! Sorry, gotta run!",
  Mocha: "Hmm.",
  Molly: "Oh. You again.",
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
  Louie: "Spine Avatar",
  Sunny: "Spine Avatar",
  Mocha: "Spine Avatar",
  Molly: "Spine Avatar",
};
const AVATAR_INDEX = {
  Adam: 2,
  Bowie: 3,
  Cobalt: 5,
  Tonya: 6,
  Rex: 4,
  Jeanie: 0,
  Louie: 1,
  Sunny: 1,
  Mocha: 1,
  Molly: 1,
};
// Color index for default avatar (from Topia picker: 0=purple, 1=pink, 2=green, 3=blue, 4=tan, 5=light green)
const AVATAR_COLOR = {
  Louie: 3,   // blue
  Sunny: 4,   // orange/tan
  Mocha: 1,   // pink
  Molly: 0,   // purple
};

// Is this a roaming NPC? (no fixed spawn, wanders the whole map)
const IS_ROAMER = ["Louie", "Sunny", "Mocha", "Molly"].includes(AGENT_NAME);

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
let avatarPage = null;
let framePumpRunning = false;
let isReconnecting = false;
let isResponding = false;
let isMoving = false;
const conversationHistory = [];

// Health server + avatar page server
const fs = require("fs");
const path = require("path");
http.createServer((req, res) => {
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
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ agent: AGENT_NAME, status: botStatus, uptime: process.uptime() }));
}).listen(PORT, () => console.log(`[${AGENT_NAME}] Health on :${PORT}`));

async function cleanup() {
  framePumpRunning = false;
  try {
    if (browser) {
      await browser.close().catch(() => {});
      browser = null;
      page = null;
      avatarPage = null;
    }
  } catch {}
}

// NOTE: No longer killing ALL sessions — that caused a cascade where
// each bot killed the others' sessions. Each bot only cleans up its OWN
// browser connection via cleanup() above.

async function enterWorld() {
  await cleanup();

  console.log(`=== ${AGENT_NAME} ${BOT_VERSION} connecting ===`);
  botStatus = "connecting";

  browser = await puppeteer.connect({
    browserWSEndpoint: `wss://chrome.browserless.io?token=${BROWSERLESS_TOKEN}`,
  });

  // ── Load TalkingHead avatar in a separate tab ───────────────────────
  // Avatar page must be served from a real URL (not setContent) for ES module imports to work.
  // We use raw.githack.com which serves GitHub files with correct content-type.
  avatarPage = await browser.newPage();
  await avatarPage.setViewport({ width: 640, height: 480 });
  try {
    const avatarUrl = `https://raw.githack.com/fabricationworkshop/claw3d-gateway/master/bot/avatar.html?agent=${AGENT_NAME}`;
    console.log(`[${AGENT_NAME}] Loading avatar from: ${avatarUrl}`);
    await avatarPage.goto(avatarUrl, { waitUntil: "networkidle2", timeout: 45000 });
    // Wait for TalkingHead to fully load
    await avatarPage.waitForFunction("window.avatarReady === true", { timeout: 30000 });
    console.log(`[${AGENT_NAME}] TalkingHead avatar loaded!`);
  } catch (e) {
    console.log(`[${AGENT_NAME}] Avatar failed: ${e.message}`);
    // Try to get console errors from the avatar page
    try {
      const errors = await avatarPage.evaluate(() => {
        return window._avatarError || document.body?.innerText?.substring(0, 200) || "no info";
      });
      console.log(`[${AGENT_NAME}] Avatar page state: ${errors}`);
    } catch {}
    await avatarPage.close().catch(() => {});
    avatarPage = null;
  }

  // ── Open Topia page ─────────────────────────────────────────────────
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
      const hallucinations = ["thank you", "thanks for watching", "subscribe", "bye", "you", "the end", "music", "okay", "hmm", "uh"];
      if (hallucinations.includes(lower) || lower.length < 5) {
        console.log(`[${AGENT_NAME}] Filtered: "${text}"`);
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
          // Create canvas for webcam feed — will be painted by Puppeteer frame pump
          const c = document.createElement("canvas");
          c.width = 640; c.height = 480;
          const c2d = c.getContext("2d");
          c2d.fillStyle = "#0a0a1a";
          c2d.fillRect(0, 0, 640, 480);
          c2d.fillStyle = "#00d4ff";
          c2d.font = "bold 24px sans-serif";
          c2d.textAlign = "center";
          c2d.fillText("Loading avatar...", 320, 240);
          // Expose canvas for frame pump to paint on
          window._webcamCanvas = c;
          window._webcamCtx = c2d;
          // Function called by Puppeteer to draw avatar frames
          window._drawAvatarFrame = function(dataUrl) {
            const img = new Image();
            img.onload = () => c2d.drawImage(img, 0, 0, 640, 480);
            img.src = dataUrl;
          };
          const vs = c.captureStream(15);
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
          analyser.getByteFrequencyData(freqData);
          const rms = Math.sqrt(freqData.reduce((s, v) => s + v * v, 0) / freqData.length);

          if (rms > 30) { // high threshold — filters ambient music/meditation audio in Topia
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
            }, 4000); // 4s silence = end of utterance — captures full thoughts
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

      // Click color swatch if this character has a color preference
      const colorIdx = AVATAR_COLOR[AGENT_NAME];
      if (colorIdx !== undefined) {
        try {
          const colorClicked = await page.evaluate((idx) => {
            // Color dots are small circular elements below the avatar preview
            const dots = [...document.querySelectorAll("div, span, button")].filter(el => {
              const s = getComputedStyle(el);
              return el.offsetWidth >= 16 && el.offsetWidth <= 40
                && el.offsetHeight >= 16 && el.offsetHeight <= 40
                && s.borderRadius && parseInt(s.borderRadius) >= 8
                && el.offsetParent;
            });
            if (dots.length > idx) { dots[idx].click(); return dots.length; }
            return 0;
          }, colorIdx);
          if (colorClicked) console.log(`[${AGENT_NAME}] Color ${colorIdx} clicked (${colorClicked} dots found)`);
          await new Promise(r => setTimeout(r, 1000));
        } catch (e) {
          console.log(`[${AGENT_NAME}] Color selection error:`, e.message);
        }
      }

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

  // Start avatar frame pump (TalkingHead → Topia webcam)
  startFramePump();

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

// ── Movement behavior ─────────────────────────────────────────────────────
// Guides: box-step near spawn (1 step out, 1 back, emotes)
// Roamers: walk across map, periodically rest for 30-60s, emote, then resume
let botMode = "walking"; // "walking" | "resting"

function startWandering() {
  const DIRECTIONS = ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"];
  const OPPOSITE = { ArrowUp: "ArrowDown", ArrowDown: "ArrowUp", ArrowLeft: "ArrowRight", ArrowRight: "ArrowLeft" };
  const pendingReturn = [];

  async function triggerEmote() {
    if (!page || isResponding) return;
    try {
      const emoted = await page.evaluate(() => {
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

  // ── Guide behavior (stay near spawn) ──
  async function guideWander() {
    if (!page || botStatus !== "in-world" || isResponding || isMoving) return;
    isMoving = true;
    try {
      if (Math.random() < 0.2) {
        await triggerEmote();
      } else if (pendingReturn.length > 0) {
        const ret = pendingReturn.pop();
        if (!isResponding) await page.keyboard.press(ret.dir);
        await new Promise(r => setTimeout(r, 300));
      } else {
        const dir = DIRECTIONS[Math.floor(Math.random() * 4)];
        if (!isResponding) await page.keyboard.press(dir);
        await new Promise(r => setTimeout(r, 300));
        pendingReturn.push({ dir: OPPOSITE[dir], steps: 1 });
      }
    } catch (e) {
      if (!e.message?.includes("Session closed")) console.log(`[${AGENT_NAME}] Wander:`, e.message);
    }
    isMoving = false;
  }

  // ── Roamer behavior (walk the map, rest, emote, repeat) ──
  async function roamerWander() {
    if (!page || botStatus !== "in-world" || isResponding || isMoving) return;
    isMoving = true;
    try {
      if (botMode === "resting") {
        // While resting: 30% emote, otherwise just chill
        if (Math.random() < 0.3) await triggerEmote();
      } else {
        // Walking: take 2-5 continuous steps in a random direction
        if (Math.random() < 0.15) {
          await triggerEmote();
        } else {
          const dir = DIRECTIONS[Math.floor(Math.random() * 4)];
          const steps = 2 + Math.floor(Math.random() * 4);
          for (let i = 0; i < steps && !isResponding; i++) {
            await page.keyboard.press(dir);
            await new Promise(r => setTimeout(r, 200));
          }
        }
      }
    } catch (e) {
      if (!e.message?.includes("Session closed")) console.log(`[${AGENT_NAME}] Roam:`, e.message);
    }
    isMoving = false;
  }

  // ── Roamer rest cycle: walk for 60-120s, rest for 30-60s ──
  if (IS_ROAMER) {
    function cycleMode() {
      if (botMode === "walking") {
        botMode = "resting";
        console.log(`[${AGENT_NAME}] Sitting down to rest...`);
        const restTime = 30000 + Math.floor(Math.random() * 30000);
        setTimeout(() => {
          botMode = "walking";
          console.log(`[${AGENT_NAME}] Getting up, walking again`);
          cycleMode();
        }, restTime);
      } else {
        botMode = "walking";
        const walkTime = 60000 + Math.floor(Math.random() * 60000);
        setTimeout(() => {
          cycleMode();
        }, walkTime);
      }
    }
    // Start walking, first rest in 60-120s
    setTimeout(cycleMode, 60000 + Math.floor(Math.random() * 60000));
  }

  // Schedule movement ticks
  function scheduleNext() {
    const delay = IS_ROAMER ? (2000 + Math.floor(Math.random() * 2000)) : (4000 + Math.floor(Math.random() * 4000));
    setTimeout(async () => {
      if (page && botStatus === "in-world") {
        if (IS_ROAMER) await roamerWander();
        else await guideWander();
      }
      if (botStatus === "in-world") scheduleNext();
    }, delay);
  }
  scheduleNext();
  console.log(`[${AGENT_NAME}] ${IS_ROAMER ? "Roaming" : "Guide wandering"} started`);
}

// ── Frame pump: TalkingHead avatar tab → Topia webcam canvas ──────────────
function startFramePump() {
  if (!avatarPage) {
    console.log(`[${AGENT_NAME}] No avatar page — skipping frame pump`);
    return;
  }
  framePumpRunning = true;
  console.log(`[${AGENT_NAME}] Frame pump started (avatar → webcam)`);

  async function pump() {
    while (framePumpRunning && page && avatarPage) {
      try {
        // Get frame from avatar canvas
        const frame = await avatarPage.evaluate(() => window.getFrame?.());
        if (frame && page) {
          // Draw on Topia's webcam canvas
          await page.evaluate((dataUrl) => {
            window._drawAvatarFrame?.(dataUrl);
          }, frame);
        }
      } catch (e) {
        if (!e.message.includes("Session closed") && !e.message.includes("Target closed")) {
          console.log(`[${AGENT_NAME}] Frame pump error:`, e.message);
        }
        break;
      }
      await new Promise(r => setTimeout(r, 100)); // ~10fps
    }
    framePumpRunning = false;
    console.log(`[${AGENT_NAME}] Frame pump stopped`);
  }
  pump();
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

    // Send audio to avatar page for lip-sync (fire and forget)
    if (avatarPage) {
      avatarPage.evaluate(async (audio) => {
        await window.speakWithAvatar?.(audio);
      }, b64).catch(() => {});
    }

    // Play audio through Topia's WebRTC
    await page.evaluate(async (audio) => {
      await window._playAudioBase64(audio);
    }, b64);

    console.log(`[${AGENT_NAME}] Audio played (with lip-sync)`);
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
        max_tokens: 120,
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
