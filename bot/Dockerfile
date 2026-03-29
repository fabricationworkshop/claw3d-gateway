FROM node:20-slim

WORKDIR /app
COPY package.json ./
RUN npm install
COPY bot.js ./

CMD ["node", "bot.js"]
