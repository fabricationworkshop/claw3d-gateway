FROM mcr.microsoft.com/playwright:v1.58.2-noble

ENV DEBIAN_FRONTEND=noninteractive

# PulseAudio for virtual audio
RUN apt-get update && apt-get install -y \
    pulseaudio ffmpeg \
    --no-install-recommends && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json ./
RUN npm install
COPY . .

EXPOSE 7860

CMD ["bash", "start.sh"]
