#!/bin/bash
# Start PulseAudio with virtual sink/source
pulseaudio --start --exit-idle-time=-1 2>/dev/null || true
pactl load-module module-null-sink sink_name=virtual_speaker sink_properties=device.description="Virtual_Speaker" 2>/dev/null || true
pactl load-module module-virtual-source source_name=virtual_mic master=virtual_speaker.monitor source_properties=device.description="Virtual_Mic" 2>/dev/null || true
pactl set-default-sink virtual_speaker 2>/dev/null || true
pactl set-default-source virtual_mic 2>/dev/null || true

echo "Audio ready"
echo "Starting bot: $AGENT_NAME"

# Start voice pipeline in background
node voice-pipeline.js &

# Start the bot (this process must stay alive)
exec node bot.js
