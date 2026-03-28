#!/bin/bash
# Start dbus
mkdir -p /run/dbus
dbus-daemon --system --fork 2>/dev/null || true

# Start Xvfb
rm -f /tmp/.X99-lock
Xvfb :99 -screen 0 1280x720x24 &
export DISPLAY=:99

# PulseAudio
pulseaudio --start --exit-idle-time=-1 2>/dev/null || true

echo "Ready. Starting bot: $AGENT_NAME"
exec node bot.js
