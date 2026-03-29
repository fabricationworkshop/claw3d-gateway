const puppeteer = require("puppeteer-core");
const http = require("http");

const BROWSERLESS_TOKEN = process.env.BROWSERLESS_TOKEN || "";
const WORLD_URL = process.env.TOPIA_WORLD_URL || "https://topia.io/relaxwithadam";
const WORLD_PASSWORD = process.env.TOPIA_WORLD_PASSWORD || "breathe";
const AGENT_NAME = process.env.AGENT_NAME || "Commander";
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY || "";
const ELEVENLABS_KEY = process.env.ELEVENLABS_API_KEY || "";
const ELEVENLABS_VOICE = process.env.ELEVENLABS_VOICE_ID || "IZt4o6EpGPON08MHCsHt";
const OPENAI_KEY = process.env.OPENAI_API_KEY || "";
const PORT = process.env.PORT || 7860;

const PERSONALITY = `You are ${AGENT_NAME}, an AI agent in a virtual Topia world. You manage software projects for NYC Fabrication Workshop. Be conversational, concise (1-2 sentences), natural speech — no markdown. Projects: abw-testing (OCR), honed-earth (stone ERP), toys-comics (inventory), electrical-experts, abw-2026 (CMS), music-demo (therapy), jobsearch-demo (job search), kimi-workshop.`;

let botStatus = "starting";
let browser = null;
let page = null;
let isReconnecting = false;
let isResponding = false;
const conversationHistory = [];

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
    if (isResponding) { console.log("[BOT] Busy, skipping speech"); return; }
    isResponding = true;
    try {
      const text = await transcribe(audioB64);
      if (!text || text.trim().length < 3) return;
      console.log(`[HEARD] "${text}"`);
      const reply = await getResponse(text, conversationHistory);
      console.log(`[REPLY] "${reply}"`);
      await speak(reply);
    } catch (e) {
      console.error("Voice loop error:", e.message);
    } finally {
      isResponding = false;
    }
  });

  // Inject synthetic media + audio playback + RTC listener before page loads
  await page.evaluateOnNewDocument(() => {
    // ── Synthetic outgoing audio (bot's mic) ──────────────────────────────
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

    // ── Incoming audio capture (listening to users) ───────────────────────
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
          if (blob.size < 2000) return; // ignore tiny noise blips
          const arr = new Uint8Array(await blob.arrayBuffer());
          // chunk-encode to avoid call stack overflow on large buffers
          let b64 = "";
          for (let i = 0; i < arr.length; i += 8192) {
            b64 += btoa(String.fromCharCode(...arr.subarray(i, i + 8192)));
          }
          console.log("[BOT] Speech captured, sending for transcription");
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
            }, 1500);
          }
          setTimeout(tick, 80);
        }
        tick();
      });

      return pc;
    }

    // Copy static props and prototype so Topia's instanceof checks pass
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

  // Fill entry form
  await page.evaluate(() => document.getElementById("displayName").focus());
  await page.keyboard.type(AGENT_NAME, { delay: 20 });
  await page.evaluate(() => document.getElementById("password").focus());
  await page.keyboard.type(WORLD_PASSWORD, { delay: 20 });
  await new Promise(r => setTimeout(r, 1000));
  await page.evaluate(() => document.getElementById("password").focus());
  await page.keyboard.press("Enter");

  botStatus = "entering";
  await new Promise(r => setTimeout(r, 20000));

  const state = await page.evaluate(() => ({ formGone: !document.getElementById("displayName") }));
  if (!state.formGone) throw new Error("Entry failed — form still visible");

  // Enable mic
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

  // Unmute with retries
  for (let attempt = 0; attempt < 3; attempt++) {
    const isMuted = await page.evaluate(() => !!document.querySelector('[data-testid="micOff icon"]'));
    if (!isMuted) { console.log("Mic is ON"); break; }
    console.log(`Unmute attempt ${attempt + 1}...`);

    try {
      const unmuteBtn = await page.evaluateHandle(() =>
        [...document.querySelectorAll("button")].find(b => b.textContent.trim() === "Unmute")
      );
      if (unmuteBtn && unmuteBtn.asElement()) {
        await unmuteBtn.asElement().click();
        console.log("Puppeteer-clicked Unmute");
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
  console.log(`${AGENT_NAME} is in the world and listening!`);

  await speak("Hey! Commander here. Walk up and talk to me about any of your projects.");

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

async function transcribe(audioB64) {
  if (!OPENAI_KEY) {
    console.log("[BOT] No OPENAI_API_KEY — cannot transcribe");
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
