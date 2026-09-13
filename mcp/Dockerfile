# Horos MCP server — polyglot image (SPEC-mcp-server-v0 §5, §10).
#
# Build from the REPO ROOT so the context includes src/, package.json, python/, mcp/:
#   docker build -f mcp/Dockerfile -t horos-mcp .
#
# Stage 1 builds the frozen TS router (dist/). The final python:3.11-slim image carries
# dist/, the Python generator package, the MCP server, git, and a Node runtime (for the
# router runner). Layout under /app mirrors the repo so horos_mcp.router's default paths
# (dist/, python/graph-gen-python/, mcp/router_runner.mjs) resolve without env overrides.

# ---- stage 1: build the TS router ----
FROM node:22-bookworm-slim AS router-build
WORKDIR /build
COPY package.json package-lock.json tsconfig.json tsconfig.build.json ./
RUN npm ci
COPY src ./src
RUN npm run build && npm prune --omit=dev && node --input-type=module -e "await import('/build/dist/graph/index.js'); console.log('dist built')"

# ---- final: python runtime + node + generator + server ----
FROM python:3.11-slim-bookworm AS final

# git for cloning; libstdc++6/libgcc for the copied node binary; ca-certificates for HTTPS.
RUN apt-get update \
    && apt-get install -y --no-install-recommends git ca-certificates libstdc++6 \
    && rm -rf /var/lib/apt/lists/* \
    # Create a non-root user. All app files will be chowned to this user after
    # the pip/COPY steps (which must run as root) so the final process runs with
    # minimal privilege. UID 1001 avoids collisions with well-known service UIDs.
    && useradd -m -u 1001 horos

# Bring the Node runtime over from the builder (same Debian bookworm base). The router
# runner is plain ESM importing dist/ — it needs only the `node` binary, no node_modules.
COPY --from=router-build /usr/local/bin/node /usr/local/bin/node

WORKDIR /app

# Python deps for the MCP server (pinned).
COPY mcp/requirements.txt /app/mcp/requirements.txt
RUN pip install --no-cache-dir -r /app/mcp/requirements.txt

# App payload: built router, generator package, MCP server.
COPY --from=router-build /build/dist /app/dist
COPY --from=router-build /build/node_modules /app/node_modules
COPY python/graph-gen-python /app/python/graph-gen-python
COPY mcp /app/mcp

# horos_mcp importable; never shadows the installed `mcp` SDK (no mcp/ package under /app/mcp).
ENV PYTHONPATH=/app/mcp \
    PYTHONUNBUFFERED=1

# Build-time smoke test (M3 acceptance): both runtimes work and all tools are listed.
# Runner scripts (generate_runner, verify_runner) are checked with --check (syntax only)
# because they call process.exit(1) when invoked without args; import() would execute them.
RUN node --version \
    && PYTHONPATH=/app/python/graph-gen-python python -m graph_gen_python --help >/dev/null \
    && node --input-type=module -e "await import('/app/dist/verify/index.js'); console.log('dist ok')" \
    && node --input-type=module -e "await import('/app/dist/generator/index.js'); console.log('generator dependencies ok')" \
    && node --check /app/mcp/generate_runner.mjs && echo 'generate_runner ok' \
    && node --check /app/mcp/verify_runner.mjs && echo 'verify_runner ok' \
    && python -c "import asyncio; from horos_mcp.server import build_mcp; \
tools = [t.name for t in asyncio.run(build_mcp().list_tools())]; \
assert 'route_context' in tools, f'route_context missing: {tools}'; \
assert 'verify_receipt' in tools, f'verify_receipt missing: {tools}'; \
print('server ok')"

# Hand off ownership and drop to non-root user for the actual server process.
RUN chown -R horos:horos /app
USER horos

# Render injects $PORT; default for local runs. HOROS_SERVER_SECRET / GITHUB_TOKEN are
# provided as secrets at deploy time (never baked into the image).
ENV PORT=8000
EXPOSE 8000

CMD ["python", "-m", "horos_mcp.server"]
