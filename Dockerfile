# Dockerfile
FROM node:20-alpine

# Create app directory
WORKDIR /app

# Create a non-root user with write permissions to /app
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nestjs -u 1001 -G nodejs

# Set ownership of /app to nestjs user
RUN chown -R nestjs:nodejs /app

# Switch to non-root user
USER nestjs

# Copy package files
COPY --chown=nestjs:nodejs package*.json ./
COPY --chown=nestjs:nodejs prisma ./prisma/

# Install dependencies
RUN npm ci --legacy-peer-deps

# Generate Prisma client
RUN npx prisma generate

# Copy source code
COPY --chown=nestjs:nodejs . .

# Expose port
EXPOSE 3000

# Run the app
CMD ["npm", "run", "start:prod"]