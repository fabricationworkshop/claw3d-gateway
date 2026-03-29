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

const PERSONALITY = `You are ${AGENT_NAME}, an AI agent in a virtual world. You manage software projects for NYC Fabrication Workshop. Be conversational, concise (1-2 sentences max), and speak naturally — no markdown. You know about: abw-testing (OCR app), honed-earth (stone fabrication ERP), toys-comics (inventory), electrical-experts (electrician site), abw-2026 (CMS), music-demo (therapy), jobsearch-demo (job search), kimi-workshop.`;

let botStatus = "starting";
let page = null;

// Health server
http.createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ agent: AGENT_NAME, status: botStatus, uptime: process.uptime() }));
}).listen(PORT, () => console.log(`Health on :${PORT}`));

async function main() {
  console.log(`=== ${AGENT_NAME} ===`);
  const browser = await puppeteer.connect({
    browserWSEndpoint: `wss://chrome.browserless.io?token=${BROWSERLESS_TOKEN}`,
  });

  page = await browser.newPage();
  const ctx = browser.defaultBrowserContext();
  await ctx.overridePermissions("https://topia.io", ["microphone", "camera"]);

  // Inject synthetic media stream + audio capture/playback infrastructure
  await page.evaluateOnNewDocument(() => {
    // Override getUserMedia to provide a controllable stream
    const origGUM = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async function (constraints) {
      if (constraints.audio) {
        const audioCtx = new AudioContext({ sampleRate: 48000 });
        const dest = audioCtx.createMediaStreamDestination();

        // Silent oscillator as base (keeps stream alive)
        const osc = audioCtx.createOscillator();
        osc.frequency.value = 0;
        osc.connect(dest);
        osc.start();

        // Store globally for audio injection
        window.__audioCtx = audioCtx;
        window.__audioDest = dest;
        window.__gainNode = audioCtx.createGain();
        window.__gainNode.connect(dest);

        if (constraints.video) {
          const canvas = document.createElement("canvas");
          canvas.width = 640;
          canvas.height = 480;
          const c = canvas.getContext("2d");
          c.fillStyle = "#0a0a1a";
          c.fillRect(0, 0, 640, 480);
          c.fillStyle = "#00d4ff";
          c.font = "bold 28px sans-serif";
          c.textAlign = "center";
          c.fillText("COMMANDER", 320, 230);
          c.font = "16px sans-serif";
          c.fillStyle = "#6a6e90";
          c.fillText("AI Agent • NYC Fabrication", 320, 260);
          const vidStream = canvas.captureStream(5);
          return new MediaStream([...dest.stream.getAudioTracks(), ...vidStream.getVideoTracks()]);
        }
        return dest.stream;
      }
      return origGUM(constraints);
    };

    // Override enumerateDevices
    const origEnum = navigator.mediaDevices.enumerateDevices.bind(navigator.mediaDevices);
    navigator.mediaDevices.enumerateDevices = async () => {
      const real = await origEnum();
      return [...real,
        { deviceId: "bot-mic", kind: "audioinput", label: "Bot Mic", groupId: "bot", toJSON() { return this; } },
        { deviceId: "bot-cam", kind: "videoinput", label: "Bot Cam", groupId: "bot", toJSON() { return this; } },
      ];
    };

    // Audio capture from incoming WebRTC (what other users say)
    window.__capturedAudio = [];
    window.__isCapturing = false;

    // Hook into RTCPeerConnection to capture incoming audio
    const OrigRTC = window.RTCPeerConnection;
    window.RTCPeerConnection = function (...args) {
      const pc = new OrigRTC(...args);
      pc.addEventListener("track", (e) => {
        if (e.track.kind === "audio" && !window.__isCapturing) {
          window.__isCapturing = true;
          try {
            const ctx = window.__audioCtx || new AudioContext();
            const source = ctx.createMediaStreamSource(new MediaStream([e.track]));
            const analyser = ctx.createAnalyser();
            analyser.fftSize = 2048;
            source.connect(analyser);
            window.__remoteAnalyser = analyser;
            console.log("[BOT] Hooked into remote audio track");
          } catch (err) {
            console.log("[BOT] Audio hook error:", err.message);
          }
        }
      });
      return pc;
    };
    window.RTCPeerConnection.prototype = OrigRTC.prototype;
    Object.keys(OrigRTC).forEach((k) => (window.RTCPeerConnection[k] = OrigRTC[k]));

    // Function to play audio buffer through the bot's mic stream
    window.__playAudio = async function (audioArrayBuffer) {
      const ctx = window.__audioCtx;
      if (!ctx) return;
      const audioBuffer = await ctx.decodeAudioData(audioArrayBuffer);
      const source = ctx.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(window.__gainNode);
      source.start();
      return new Promise((resolve) => (source.onended = resolve));
    };
  });

  // Navigate and enter world
  await page.goto(WORLD_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
  botStatus = "loading";

  for (let i = 0; i < 20; i++) {
    const count = await page.evaluate(() => document.querySelectorAll("input").length);
    if (count > 0) break;
    await new Promise((r) => setTimeout(r, 2000));
  }
  await new Promise((r) => setTimeout(r, 3000));

  await page.evaluate(() => document.getElementById("displayName").focus());
  await page.keyboard.type(AGENT_NAME, { delay: 20 });
  await page.evaluate(() => document.getElementById("password").focus());
  await page.keyboard.type(WORLD_PASSWORD, { delay: 20 });
  await new Promise((r) => setTimeout(r, 1000));
  await page.evaluate(() => document.getElementById("password").focus());
  await page.keyboard.press("Enter");

  console.log("Entering world...");
  botStatus = "entering";
  await new Promise((r) => setTimeout(r, 20000));

  // Enable mic
  await page.evaluate(() => {
    const btn = [...document.querySelectorAll("button")].find((b) =>
      b.textContent.toLowerCase().includes("turn on microphone")
    );
    if (btn) btn.click();
  });
  await new Promise((r) => setTimeout(r, 3000));

  // Enable camera
  await page.evaluate(() => {
    const btn = [...document.querySelectorAll("button")].find((b) =>
      b.textContent.toLowerCase().includes("turn on camera")
    );
    if (btn) btn.click();
  });
  await new Promise((r) => setTimeout(r, 2000));

  botStatus = "in-world";
  console.log(`${AGENT_NAME} is in the world with mic+camera!`);

  // Start the voice conversation loop
  startVoiceLoop();

  // Keepalive
  setInterval(async () => {
    try { console.log(new Date().toISOString(), AGENT_NAME, "alive"); } catch {}
  }, 30000);

  browser.on("disconnected", () => {
    console.log("Disconnected — restarting in 10s");
    botStatus = "disconnected";
    setTimeout(() => main().catch(console.error), 10000);
  });
}

// Voice conversation loop
async function startVoiceLoop() {
  console.log("Voice loop started — listening for speech...");
  const conversationHistory = [];

  // Poll for speech activity every 2 seconds
  setInterval(async () => {
    try {
      // Check if there's audio activity from remote users
      const hasActivity = await page.evaluate(() => {
        const analyser = window.__remoteAnalyser;
        if (!analyser) return false;
        const data = new Uint8Array(analyser.frequencyBinCount);
        analyser.getByteFrequencyData(data);
        const avg = data.reduce((a, b) => a + b, 0) / data.length;
        return avg > 5; // threshold for speech
      });

      if (hasActivity) {
        console.log("Speech detected from visitor!");
        // For now, respond with a greeting since we can't transcribe WebRTC audio easily
        // In production, this would use Whisper on captured audio
        await respondWithVoice("Hey, I heard you! I'm Commander, the ops architect. What project do you want to talk about?", conversationHistory);
      }
    } catch {}
  }, 5000);
}

async function respondWithVoice(text, history) {
  if (!ELEVENLABS_KEY) {
    console.log("No ElevenLabs key — skipping TTS");
    return;
  }

  console.log(`Speaking: "${text}"`);

  // Generate TTS audio
  const ttsRes = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${ELEVENLABS_VOICE}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "xi-api-key": ELEVENLABS_KEY },
    body: JSON.stringify({
      text,
      model_id: "eleven_turbo_v2_5",
      voice_settings: { stability: 0.5, similarity_boost: 0.75 },
    }),
  });

  if (!ttsRes.ok) {
    console.error("TTS error:", ttsRes.status);
    return;
  }

  const audioBuffer = await ttsRes.arrayBuffer();
  const base64Audio = Buffer.from(audioBuffer).toString("base64");

  // Inject audio into the page and play through bot's mic stream
  await page.evaluate(async (b64) => {
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    await window.__playAudio(bytes.buffer);
  }, base64Audio);

  console.log("Audio played through bot mic");
}

async function getClaudeResponse(userMessage, history) {
  if (!ANTHROPIC_KEY) return "I can't respond without an API key.";

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
  const reply = data.content?.[0]?.text || "Sorry, I couldn't process that.";
  history.push({ role: "assistant", content: reply });
  return reply;
}

main().catch((e) => {
  console.error("Fatal:", e.message);
  botStatus = "crashed: " + e.message;
  setTimeout(() => main().catch(console.error), 15000);
});
