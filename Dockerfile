FROM node:22-alpine

WORKDIR /app

RUN apk add --no-cache ffmpeg python3 make g++ pkgconfig libtool autoconf automake

COPY package*.json ./
RUN npm install --omit=dev

COPY . .

EXPOSE 3000

CMD ["npm", "start"]
