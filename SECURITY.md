# Security Policy

## Reporting a Vulnerability
If you discover a security vulnerability in Horos, please do **not** open a public issue. Instead, email us directly at info@aletheia-core.com. We aim to acknowledge all reports within 72 hours.

## Supported Versions
We actively support and patch the latest release (currently `v0.3.3`). Security fixes in `main` will ship in the next release (`v0.4.0`, unreleased).

## Threat Model

Horos is a **stateless, read-only context router**. It clones public (or token-authorised) repositories, generates a dependency graph in-request, selects relevant files, and returns a signed receipt. No data is persisted between requests.

**What Horos protects against:**
- Secret leakage: `GITHUB_TOKEN` and `HOROS_SERVER_SECRET` are never returned to callers or written to logs. The token is injected server-side into the clone URL and scrubbed from any error message before surfacing.
- Path traversal in `manual_include` paths: inputs are validated to be relative and free of `..` components before reaching the subprocess layer.
- Workspace abuse: per-request resource caps (50 000 files, 500 MB, 60 s clone, 120 s processing) prevent runaway clones from exhausting the host.
- Auth bypass: every request except `GET /healthz` is checked against `HOROS_SERVER_SECRET` via constant-time HMAC comparison before any tool runs.

**What Horos does NOT protect against (out of scope for v1):**
- Denial-of-service by authenticated clients hammering the endpoint. Rate limiting is a Render/platform concern; no per-client throttle exists in the server itself.
- Malicious content in the cloned repository affecting the graph generator's output. The generator is a static analyser; it does not execute user code.
- Inference attacks on the selected files (the response is sent only to the authenticated caller).

## Secret Rotation Steps

### `HOROS_SERVER_SECRET` (bearer token for MCP clients)
1. Generate a new high-entropy token: `python3 -c "import secrets; print(secrets.token_hex(32))"`
2. In the Render dashboard, navigate to **Environment** for the `horos-mcp` service.
3. Update `HOROS_SERVER_SECRET` to the new value and save. Render will restart the service automatically.
4. Update the token in all MCP client configurations (VS Code `.vscode/mcp.json`, GitHub Copilot connector, etc.).
5. Verify the old token is rejected: `curl -H "Authorization: Bearer <old>" https://horos.onrender.com/mcp` → expect 401.
6. Verify the new token is accepted with an authenticated request:
   `curl -sf -o /dev/null -w "%{http_code}" -X POST https://horos.onrender.com/mcp -H "Authorization: Bearer <new>" -H "Content-Type: application/json" -H "Accept: application/json, text/event-stream" -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}' | grep -q 200 && echo OK`
   Expect HTTP 200 (not 401).

### `GITHUB_TOKEN` (read-only clone token for private repos)
1. In GitHub: **Settings → Developer settings → Personal access tokens → Fine-grained tokens**.
2. Create a new token scoped to `contents: read` only.
3. Update `GITHUB_TOKEN` in the Render dashboard and save.
4. Revoke the old token from GitHub's token management page.

## Security Considerations & Trade-offs
* **Token-in-URL Authentication:** To maintain compatibility with some connectors, Horos allows authenticating via a query parameter (e.g., `?token=SECRET`). Please be aware that this can cause secrets to land in web proxy logs, browser histories, or hosting logs.
* **Recommendation:** We strongly recommend using **HTTP Header Authentication** (e.g., `Authorization: Bearer <your_token>`) as your primary and safest method.
* **Secret Rotation:** We recommend rotating your connection secrets and server secrets on a strict monthly cadence.
