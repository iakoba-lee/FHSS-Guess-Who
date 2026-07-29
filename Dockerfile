FROM node:24-slim

ENV NODE_ENV=production

WORKDIR /app

# Copy package files first to leverage Docker cache
COPY package*.json ./

# Install dependencies (only production ones)
RUN npm install --omit=dev

# Copy the rest of the application
COPY . .

# Keep a seed copy of data/ outside the persistent volume mount path
RUN mkdir -p public/uploads \
  && if [ -d data ]; then cp -a data seed-data; else mkdir -p data seed-data; fi

EXPOSE 8080

CMD ["node", "server.js"]
