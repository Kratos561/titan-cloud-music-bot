FROM node:22-alpine

WORKDIR /app

RUN apk add --no-cache ffmpeg python3 py3-pip make g++ pkgconfig libtool autoconf automake

# Usar pre-releases/nightly porque YouTube rompe extractores con frecuencia.
RUN pip3 install --break-system-packages --upgrade --pre --no-cache-dir "yt-dlp[default]" && yt-dlp --version

COPY package*.json ./
RUN npm install --omit=dev

COPY . .

EXPOSE 3000

CMD ["npm", "start"]
