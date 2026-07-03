# Security Policy

## Reporting a Vulnerability
If you discover a security vulnerability in Horos, please do **not** open a public issue. Instead, email us directly at info@aletheia-core.com. We aim to acknowledge all reports within 72 hours.

## Supported Versions
We actively support and patch the latest release (currently `v0.3.3`). Security fixes in `main` will ship in the next release (`v0.4.0`, unreleased).

## Security Considerations & Trade-offs
* **Token-in-URL Authentication:** To maintain compatibility with some connectors, Horos allows authenticating via a query parameter (e.g., `?token=SECRET`). Please be aware that this can cause secrets to land in web proxy logs, browser histories, or hosting logs.
* **Recommendation:** We strongly recommend using **HTTP Header Authentication** (e.g., `Authorization: Bearer <your_token>`) as your primary and safest method. 
* **Secret Rotation:** We recommend rotating your connection secrets and server secrets on a strict monthly cadence.
