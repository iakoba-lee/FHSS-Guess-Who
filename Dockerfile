FROM node:24-slim

ENV NODE_ENV=production

WORKDIR /app

# Copy package files first to leverage Docker cache
COPY package*.json ./

# Install dependencies (only production ones)
RUN npm install --omit=dev

# Copy the rest of the application
COPY . .

# Create uploads directory to ensure it exists
RUN mkdir -p public/uploads

EXPOSE 8080

CMD ["node", "server.js"]
