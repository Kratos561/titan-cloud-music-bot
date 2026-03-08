FROM node:22-alpine

WORKDIR /app

RUN apk add --no-cache ffmpeg python3 py3-pip make g++ pkgconfig libtool autoconf automake

# Instalar yt-dlp (necesario para @distube/yt-dlp)
RUN pip3 install --break-system-packages yt-dlp

COPY package*.json ./
RUN npm install --omit=dev

COPY . .

EXPOSE 3000

CMD ["npm", "start"]
