# The editor, as one process: the engine serving the built page on :8000.
FROM node:24-alpine

WORKDIR /app
COPY package.json package-lock.json ./
COPY engine/package.json engine/
COPY editor/package.json editor/
RUN npm ci

COPY . .
RUN npm run build

EXPOSE 8000
# Bound to every interface because a container's loopback is its own; the
# file browser switches itself off on a non-loopback bind, as it does anywhere.
CMD ["node", "engine/src/main.ts", "--editor", "editor/dist", "--host", "0.0.0.0", "--port", "8000"]
