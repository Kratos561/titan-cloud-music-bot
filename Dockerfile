FROM node:22-alpine

WORKDIR /app

ENV YTDLP_BGUTIL_SCRIPT_PATH=/root/bgutil-ytdlp-pot-provider/server/build/generate_once.js

RUN apk add --no-cache ffmpeg python3 py3-pip make g++ pkgconfig libtool autoconf automake git

# Usar pre-releases/nightly porque YouTube rompe extractores con frecuencia.
RUN pip3 install --break-system-packages --upgrade --pre --no-cache-dir "yt-dlp[default]" bgutil-ytdlp-pot-provider && yt-dlp --version

# El proveedor oficial bgutil mejora la obtencion de PO Tokens en entornos cloud.
RUN git clone --depth 1 https://github.com/Brainicism/bgutil-ytdlp-pot-provider.git /root/bgutil-ytdlp-pot-provider \
  && cd /root/bgutil-ytdlp-pot-provider/server \
  && npm install \
  && npx tsc

COPY package*.json ./
RUN npm install --omit=dev

COPY . .

EXPOSE 3000

CMD ["npm", "start"]
