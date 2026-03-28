FROM node:20-bookworm

ENV DEBIAN_FRONTEND=noninteractive

# Install Chromium and deps
RUN apt-get update && apt-get install -y \
    chromium \
    pulseaudio ffmpeg \
    dbus dbus-x11 \
    fonts-liberation fonts-noto-color-emoji \
    xvfb \
    --no-install-recommends && \
    rm -rf /var/lib/apt/lists/*

ENV DISPLAY=:99
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

WORKDIR /app
COPY package.json ./
RUN npm install
COPY . .

EXPOSE 7860

CMD ["bash", "start.sh"]
