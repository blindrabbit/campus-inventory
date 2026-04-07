# backend/Dockerfile
FROM node:20-alpine
WORKDIR /app

# Prisma precisa do OpenSSL disponível para detectar e gerar o engine correto no Alpine
RUN apk add --no-cache openssl

# Habilita pnpm nativamente via corepack
RUN corepack enable && corepack prepare pnpm@latest --activate

COPY package.json ./
RUN pnpm install

COPY . .

# Gera o cliente Prisma em runtime (não no build)
# Isso permite que o schema seja criado/modificado sem rebuild do container
RUN mkdir -p /app/data

EXPOSE 8000
CMD ["sh", "-c", "pnpm prisma generate && pnpm run dev"]