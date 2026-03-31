FROM node:20-slim

WORKDIR /app
COPY package.json ./
RUN npm install
COPY bot.js avatar.html ./

CMD ["node", "bot.js"]
# Build 1774766546
