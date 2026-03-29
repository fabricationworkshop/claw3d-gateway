# Relax with Adam — 7 Agent Deployment Guide

Each agent is a separate Railway service running the same `bot.js`.
They share all API keys but have unique `AGENT_NAME` and `ELEVENLABS_VOICE_ID`.

## Shared env vars (set on all 7 services)

```
BROWSERLESS_TOKEN    = 2UEfyHJMG1pab4L9c3b1c28c5cb2b685a5d9f67c2633bdaf4
TOPIA_WORLD_URL      = https://topia.io/relaxwithadam
TOPIA_WORLD_PASSWORD = breathe
ANTHROPIC_API_KEY    = (your Anthropic key)
OPENAI_API_KEY       = (your OpenAI key)
ELEVENLABS_API_KEY   = (your ElevenLabs key)
PORT                 = 7860
```

## Per-agent env vars

| Railway Service | AGENT_NAME | Avatar     | Project          | ELEVENLABS_VOICE_ID |
|-----------------|-----------|------------|------------------|---------------------|
| bot-adam        | Adam      | Green human | abw-2026 (CMS)  | (choose voice)      |
| bot-bowie       | Bowie     | Astronaut   | abw-testing (OCR)| (choose voice)     |
| bot-cobalt      | Cobalt    | Blue fox    | electrical-experts| (choose voice)    |
| bot-tonya       | Tonya     | Pumpkin     | music-demo       | (choose voice)      |
| bot-rex         | Rex       | Dinosaur    | honed-earth (ERP)| (choose voice)     |
| bot-jeanie      | Jeanie    | Purple alien| jobsearch-demo   | (choose voice)      |
| bot-commander   | Commander | (7th char)  | mission-control  | IZt4o6EpGPON08MHCsHt (existing) |

## Personalities (auto-selected by AGENT_NAME in bot.js)

- **Adam** — Wise, grounded host. Breathwork guide. abw-2026 CMS.
- **Bowie** — Curious astronaut-explorer. Precision scanner. abw-testing OCR.
- **Cobalt** — Energetic blue fox. Problem-solver. electrical-experts.
- **Tonya** — Nurturing healer. Sound/breathwork guide. music-demo therapy.
- **Rex** — Steadfast dinosaur. Heavy lifter. honed-earth stone ERP.
- **Jeanie** — Visionary purple alien. Transformation. jobsearch-demo.
- **Commander** — Operations hub. Mission tracker. mission-control dashboard.

## Browserless

7 concurrent sessions required — upgrade Browserless plan to support 7+ concurrents.

## ElevenLabs voices to assign

Go to elevenlabs.io → Voice Library → pick a voice for each character.
Copy the Voice ID from the URL or voice settings and set as ELEVENLABS_VOICE_ID.

Suggested character → voice style:
- Adam: calm, warm, male (e.g. "Adam" preset or "George")
- Bowie: curious, slightly breathy
- Cobalt: upbeat, energetic
- Tonya: soft, nurturing, female
- Rex: deep, steady, gravelly
- Jeanie: playful, ethereal, female
- Commander: authoritative, clear, male
