FROM node:lts AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig*.json ./
COPY src src
RUN npm run build

FROM node:lts
ENV NODE_ENV=production
ENV APP_ID=""
ENV PRIVATE_KEY=""
ENV WEBHOOK_SECRET=""
ENV PATH="/usr/local/docker:${PATH}"
WORKDIR /app
COPY package*.json ./
ARG DOCKER_VERSION=19.03.8
RUN npm install --only=production && \
    curl -fsSL "https://download.docker.com/linux/static/stable/x86_64/docker-${DOCKER_VERSION}.tgz" | tar -xz -C /usr/local docker/docker && \
    mkdir -p "${HOME}/.docker/cli-plugins" && \
    DOCKER_LOCK_VERSION="$(git ls-remote https://github.com/michaelperel/docker-lock | grep refs/tags | grep -oE "[0-9]+\.[0-9]+\.[0-9]+$" | sort --version-sort | tail -n 1)" && \
    curl -fsSL "https://github.com/michaelperel/docker-lock/releases/download/v${DOCKER_LOCK_VERSION}/docker-lock-linux" -o "${HOME}/.docker/cli-plugins/docker-lock" && \
    chmod +x "${HOME}/.docker/cli-plugins/docker-lock"
COPY --from=builder /app/lib/ lib/
COPY ./docker-lock.sh ./
EXPOSE 3000
CMD [ "npm", "run", "start" ]
