FROM node:26-alpine

WORKDIR /usr/src/app

RUN apk add --no-cache ffmpeg

ENV NODE_ENV=production

COPY package*.json ./
RUN npm ci --omit=dev

COPY . .

EXPOSE 3000

CMD ["npm", "start"]
