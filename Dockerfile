FROM node:22-alpine

# Python + the pipeline's packages, so an admin can build/refresh/import data
# from the dashboard's Data panel on the deployed server (Mode B).
RUN apk add --no-cache python3 py3-numpy py3-scipy py3-requests py3-dotenv

ENV NODE_ENV=production
ENV PORT=3000
ENV TIDEWATCH_DATA_DIR=/app/state/processed
ENV TIDEWATCH_RAW_DIR=/app/state/raw
ENV TIDEWATCH_PACKAGES_DIR=/app/state/packages
ENV TIDEWATCH_PYTHON=python3
# Set at run time to enable the Data panel for admins (≥ 16 characters):
#   docker run -e TIDEWATCH_ADMIN_TOKEN=... -e CENSUS_API_KEY=...
# Leave unset for a read-only public deployment.

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY backend ./backend
COPY frontend ./frontend
COPY utils ./utils
COPY config ./config
COPY data/*.py ./data/

# Keep persistent state separate from /app/data, which contains pipeline code.
RUN mkdir -p /app/state/processed /app/state/raw /app/state/packages && chown -R node:node /app/state

USER node

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then((response) => process.exit(response.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "backend/server.js"]
