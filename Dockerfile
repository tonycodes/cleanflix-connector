FROM node:22-alpine
WORKDIR /app
COPY package.json server.js ./
ENV NODE_ENV=production
CMD ["node", "server.js"]
