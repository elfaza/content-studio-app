# Automatic Google OAuth credential storage

The single-user, password-protected app uses direct Google OAuth. Connection initiation requires app authentication and a same-origin POST. The fixed callback is `/api/google/callback` on `APP_ORIGIN`; redirect destinations are not supplied by the browser.

## Storage and encryption

Private store: `content-studio-oauth-private` (`store_OJffxg5O3i8lNsqi`), connected only to the Content Studio Vercel project. Its managed token is a server environment variable, never committed.

Paths are under a SHA-256 scope of the project purpose, Google client ID, and normalized app origin. AES-256-GCM uses a fresh 12-byte IV per write, authenticated context, and a 16-byte tag. HKDF-SHA256 derives separate credential and OAuth-attempt keys from `SESSION_SECRET`. Changing the client/origin isolates credentials; changing the session secret makes existing ciphertext unreadable until reconnecting.

## OAuth attempts

Pending attempts contain a random state, server-held PKCE verifier, browser-binding digest, creation time, and the credential ETag observed at initiation. They are encrypted in private Blob storage. The cookie is only a random binding nonce, with HttpOnly, Secure in production, SameSite=Lax, and a ten-minute lifetime. It contains neither a refresh token nor a verifier.

Callbacks validate the binding, state, and ten-minute expiry before atomically creating a unique claim with `allowOverwrite:false` and `addRandomSuffix:false`. The claim is created before code exchange, never released on failure, and blocks replay across instances. Google receives the S256 verifier only through the server-side code exchange.

Credential writes compare the initiation-time ETag, or create only when no credential existed. An older authorization cannot overwrite a newer connection. `VERCEL_BLOB_RETRIES=0` is mandatory; misconfiguration fails closed. Uncertain claim, exchange, and credential-write outcomes are never retried automatically.

## Reads and refresh

Every request reads the private credential with `useCache:false`. Each request receives a new OAuth client with no previous credential's access-token cache. Google access tokens refresh server-side. No refresh/access token is returned by a connection endpoint or rendered by the success page.

Only a confirmed missing credential object permits `GOOGLE_REFRESH_TOKEN` as a legacy fallback. Read errors, unavailable storage, malformed ciphertext, or authentication failures do not select a legacy token. Explicit live mode never silently changes to demo mode.

## Verification completed

- 51 unit/integration tests passed, including encryption/tamper/context checks, state/PKCE, cross-instance replay claims, uncertain writes, storage failures, credential replacement, authentication, and existing sheet-write protections.
- Real private Blob probe passed atomic create-only, ETag conditional writes, stale-write rejection, and uncached consistent reads. Non-sensitive probe content was deleted; no Google credentials were used.
- Production build and source lint/type checks passed.
- All nine browser regressions passed using fictional demo data, including auth, capture/edit/publishing, mobile pages, category suggestions, explicit link saves, and offline behavior.

The user must still complete a Google consent round trip in the deployed app to verify real provider code exchange, encrypted credential persistence, and subsequent live Sheets access. OAuth authorization itself does not call the spreadsheet repository or modify spreadsheet content.

## Operations

Settings provides Connect/Reconnect Google. On success, select **Continue to app**; no copy/paste or redeployment is needed. Google OAuth apps in Testing require renewed authorization after seven days.

Pending attempt and claim objects are retained. Optional operator cleanup may remove attempts/claims older than 24 hours, after their validity period, but must never remove active claims or credentials as a retry mechanism. There is no automatic destructive cleanup.

## Deployment verification

Production deployment dpl_xY6Uzd5wctQupRTfEgPNGTj4fNZr is READY from implementation commit 5dbf847f615760b680fba4b1a028e1cbe8649929. Anonymous live session inspection returned configured=true and authorized=false. An invalid live OAuth callback returned HTTP 400 with a sanitized, token-free response. A live authenticated initiation/Google consent round trip has not been performed; the sensitive app password is not retrievable through the environment API, and no password was requested in chat. Complete Connect/Reconnect Google in Settings to verify the real provider exchange and subsequent live Sheets access.
