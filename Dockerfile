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
# Nothing to open a browser in: the address is printed.
ENV AI_GRAPH_NO_BROWSER=1
# Bound to every interface because a container's loopback is its own -- and so
# published on the host's loopback only (docker-compose.yml), since nothing here
# asks who is calling. On such a bind the server answers only as localhost, or a
# name AI_GRAPH_ALLOWED_HOSTS lists, and the file browser switches itself off.
CMD ["node", "engine/src/main.ts", "--editor", "editor/dist", "--host", "0.0.0.0", "--port", "8000"]
