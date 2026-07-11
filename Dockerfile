FROM node:22-alpine AS build
WORKDIR /app
RUN npm i -g pnpm@10.33.0
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
ARG VITE_POSTHOG_PROJECT_TOKEN
ARG VITE_POSTHOG_HOST
ENV VITE_POSTHOG_PROJECT_TOKEN=$VITE_POSTHOG_PROJECT_TOKEN
ENV VITE_POSTHOG_HOST=$VITE_POSTHOG_HOST
RUN pnpm build

FROM node:22-alpine
WORKDIR /app
COPY --from=build /app/.output ./.output
ENV NODE_ENV=production PORT=3000 DATA_DIR=/data PRINTS_DIR=/prints AUTH_PROVIDER=local
VOLUME ["/data", "/prints"]
EXPOSE 3000
CMD ["node", ".output/server/index.mjs"]
