# The issuer, as an image a TEE can measure.
#
# Phala Cloud does not build from source: it runs a docker-compose against an
# image already published to a registry, and seals the secrets to the MEASURED
# build. That measurement is the whole point — it is what lets somebody check
# that the backend holding `ENROLMENT_TAG_KEYS` is running this code and not
# something that quietly keeps a copy of who enrolled where.
#
# TWO STAGES, and the split is not cosmetic. The build stage needs TypeScript
# and the type packages; the runtime must not carry them. A smaller image is a
# smaller thing to attest and a smaller thing to get wrong.
#
# NODE 24, matching what this is developed and tested on. The backend is ESM
# (`"type": "module"`) and uses `node:` builtins throughout.

# ── build ────────────────────────────────────────────────────────────────────
FROM node:24-alpine AS build
WORKDIR /app

# Manifests first, so a source-only change does not re-resolve the whole tree.
COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# ── runtime ──────────────────────────────────────────────────────────────────
FROM node:24-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./

# PRODUCTION DEPENDENCIES ONLY, AND THE ONE THAT MUST SURVIVE IT.
# `@worldcoin/idkit-core` is a runtime dependency, not a build-time one:
# `auth/worldIdBridge.ts` loads its WASM at the moment a voter asks to verify,
# through the `file:` fetch shim. An image that dropped it would start
# perfectly, serve every other route, and fail only on sign-in — the worst
# possible shape for a bug. It is declared under `dependencies`, so
# `--omit=dev` keeps it; this comment exists so nobody moves it.
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=build /app/dist ./dist

# NOT COPIED: `.env`. Secrets are supplied by Phala's encrypted store and
# sealed to the build. An image with credentials baked in is an image that
# leaks them to anyone who can pull it, and this one is published publicly.
# `.dockerignore` enforces the same thing on the build context.

# Runs unprivileged. The node image ships this user; nothing here needs root.
USER node

EXPOSE 3000
CMD ["node", "dist/index.js"]
