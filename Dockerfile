FROM node:22-alpine

WORKDIR /app

RUN apk add --no-cache ffmpeg python3 py3-pip make g++ pkgconfig libtool autoconf automake

# Instalar yt-dlp SIEMPRE en la version mas reciente (sin cache)
RUN pip3 install --break-system-packages --upgrade --no-cache-dir yt-dlp && yt-dlp --version

COPY package*.json ./
RUN npm install --omit=dev

COPY . .

EXPOSE 3000

CMD ["npm", "start"]
