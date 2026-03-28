// voice-pipeline.js — Audio pipeline for Topia agent bots
// Captures audio from Topia via PulseAudio, transcribes with Whisper,
// generates response via Claude, speaks via ElevenLabs, pipes back to virtual mic
//
// This runs alongside the main bot.js in the Docker container

const fs = require('fs');
const { exec, spawn } = require('child_process');

const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY || '';
const ELEVENLABS_KEY = process.env.ELEVENLABS_API_KEY || '';
const ELEVENLABS_VOICE = process.env.ELEVENLABS_VOICE_ID || 'IZt4o6EpGPON08MHCsHt';
const AGENT_NAME = process.env.AGENT_NAME || 'Commander';

const AGENT_PERSONALITIES = {
  Commander: 'You are Commander, the ops architect. You orchestrate AI agents across 8 software projects. Be concise and direct. You know about all projects: abw-testing, honed-earth, toys-comics, electrical-experts, abw-2026, music-demo, jobsearch-demo, kimi-workshop.',
  'Security Scout': 'You are Security Scout. You fixed 15 RLS bypass policies and 7 mutable search paths across all projects. You know database security inside out.',
  'Performance Knight': 'You are Performance Knight. You optimized 101 RLS initplan policies and created 19 FK indexes. You care about query performance.',
  'Index Ranger': 'You are Index Ranger. You created 13 indexes on jobsearch-demo and 6 on toys-comics. You specialize in data access patterns.',
  'Build Fixer': 'You are Build Fixer. You fixed 6 consecutive failed Vercel deploys on abw-testing by lazy-initializing SDK clients.',
  'Deep Scanner': 'You are Deep Scanner. You scanned 63 policies on honed-earth alone. You do thorough security audits.',
  '3D Architect': 'You are 3D Architect. You built the Three.js 3D command center visualization.',
};

const personality = AGENT_PERSONALITIES[AGENT_NAME] || AGENT_PERSONALITIES.Commander;

// --- Audio capture via PulseAudio ---
// Records from the monitor of the virtual speaker (what Topia plays)
function startAudioCapture(onSpeechDetected) {
  // Use parec to capture audio from the virtual speaker monitor
  const recorder = spawn('parec', [
    '--device=virtual_speaker.monitor',
    '--format=s16le',
    '--rate=16000',
    '--channels=1',
  ]);

  let buffer = Buffer.alloc(0);
  let silenceFrames = 0;
  let speechFrames = 0;
  const SILENCE_THRESHOLD = 500; // RMS threshold for silence
  const MIN_SPEECH_FRAMES = 10; // Min frames to count as speech
  const SILENCE_AFTER_SPEECH = 30; // Frames of silence to end utterance

  recorder.stdout.on('data', (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);

    // Check for speech every 0.5s (16000 samples/s * 2 bytes * 0.5s = 16000 bytes)
    if (buffer.length >= 16000) {
      const samples = new Int16Array(buffer.buffer, buffer.byteOffset, buffer.length / 2);
      let rms = 0;
      for (const s of samples) rms += s * s;
      rms = Math.sqrt(rms / samples.length);

      if (rms > SILENCE_THRESHOLD) {
        speechFrames++;
        silenceFrames = 0;
      } else {
        silenceFrames++;
        if (speechFrames >= MIN_SPEECH_FRAMES && silenceFrames >= SILENCE_AFTER_SPEECH) {
          // Speech ended — process the buffer
          onSpeechDetected(buffer);
          buffer = Buffer.alloc(0);
          speechFrames = 0;
          silenceFrames = 0;
          return;
        }
      }

      // Keep only the last 30s of audio to avoid memory bloat
      if (buffer.length > 16000 * 2 * 30) {
        buffer = buffer.slice(buffer.length - 16000 * 2 * 10);
      }
    }
  });

  recorder.on('error', (e) => console.error('Recorder error:', e.message));
  return recorder;
}

// --- Speech to Text via Whisper API ---
async function transcribe(audioBuffer) {
  // Save as WAV file
  const wavPath = '/tmp/speech.wav';
  const header = createWavHeader(audioBuffer.length, 16000, 1, 16);
  fs.writeFileSync(wavPath, Buffer.concat([header, audioBuffer]));

  // Use OpenAI Whisper API (or local whisper)
  const OPENAI_KEY = process.env.OPENAI_API_KEY || '';
  if (!OPENAI_KEY) {
    console.log('No OpenAI key for Whisper — skipping transcription');
    return '';
  }

  const formData = new FormData();
  formData.append('file', new Blob([fs.readFileSync(wavPath)]), 'speech.wav');
  formData.append('model', 'whisper-1');

  const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${OPENAI_KEY}` },
    body: formData,
  });
  const data = await res.json();
  return data.text || '';
}

// --- Claude response ---
async function getResponse(userMessage, history = []) {
  if (!ANTHROPIC_KEY) return "I can't respond without an API key.";

  const messages = [
    ...history.slice(-10),
    { role: 'user', content: userMessage }
  ];

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 200,
      system: personality + ' Keep responses under 2 sentences. Speak naturally, no markdown.',
      messages,
    }),
  });
  const data = await res.json();
  return data.content?.[0]?.text || "Sorry, I couldn't process that.";
}

// --- ElevenLabs TTS ---
async function speak(text) {
  if (!ELEVENLABS_KEY) { console.log('No ElevenLabs key'); return; }

  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${ELEVENLABS_VOICE}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'xi-api-key': ELEVENLABS_KEY,
    },
    body: JSON.stringify({
      text,
      model_id: 'eleven_turbo_v2_5',
      voice_settings: { stability: 0.5, similarity_boost: 0.75 },
    }),
  });

  if (!res.ok) { console.error('TTS error:', res.status); return; }

  // Save audio and play through virtual mic
  const audioPath = '/tmp/response.mp3';
  const audioBuffer = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(audioPath, audioBuffer);

  // Play through paplay to the virtual speaker (which Topia picks up as mic input)
  return new Promise((resolve) => {
    exec(`ffmpeg -y -i ${audioPath} -f s16le -ar 44100 -ac 1 /tmp/response.raw && pacat --device=virtual_mic --format=s16le --rate=44100 --channels=1 /tmp/response.raw`, (err) => {
      if (err) console.error('Playback error:', err.message);
      resolve();
    });
  });
}

// --- WAV header helper ---
function createWavHeader(dataLength, sampleRate, channels, bitsPerSample) {
  const header = Buffer.alloc(44);
  const byteRate = sampleRate * channels * bitsPerSample / 8;
  const blockAlign = channels * bitsPerSample / 8;
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + dataLength, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write('data', 36);
  header.writeUInt32LE(dataLength, 40);
  return header;
}

// --- Main pipeline ---
async function startPipeline() {
  console.log(`Voice pipeline starting for ${AGENT_NAME}`);
  const history = [];

  const recorder = startAudioCapture(async (audioBuffer) => {
    console.log(`Speech detected (${(audioBuffer.length / 32000).toFixed(1)}s)`);

    try {
      const text = await transcribe(audioBuffer);
      if (!text || text.length < 3) return;
      console.log(`Heard: "${text}"`);

      const response = await getResponse(text, history);
      console.log(`${AGENT_NAME}: "${response}"`);

      history.push({ role: 'user', content: text });
      history.push({ role: 'assistant', content: response });

      await speak(response);
    } catch (e) {
      console.error('Pipeline error:', e.message);
    }
  });

  console.log('Voice pipeline running — listening for speech...');
}

module.exports = { startPipeline };

// Run standalone if called directly
if (require.main === module) {
  startPipeline();
}
