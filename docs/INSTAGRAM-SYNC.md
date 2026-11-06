# Instagram: manual Insights sync

This integration uses Facebook Login for Business with a configuration that grants `instagram_basic` and `instagram_manage_insights`, a required Instagram asset, and a system-user access token. No recurring job or background social sync is configured.

## Production setup

- `META_APP_ID`: the Meta application ID (not a secret).
- `META_INSTAGRAM_CONFIG_ID`: the custom Facebook Login for Business configuration ID (not a secret).
- `META_APP_SECRET`: store directly in Vercel Production as Sensitive. Never share it in chat or commit it.
- `META_GRAPH_VERSION`: defaults to `v25.0`; update deliberately alongside API verification.
- Register `https://content-studio-xi-peach.vercel.app/api/instagram/callback` as a valid OAuth redirect URI in Facebook Login for Business settings. The redirect must exactly match APP_ORIGIN plus `/api/instagram/callback`.
- Reuse this project's existing private Blob store and `SESSION_SECRET`, with `VERCEL_BLOB_RETRIES=0`.
- Select exactly one Instagram account during consent. Standard Access testing requires the authorizing person to have the appropriate app role and control of the selected asset. Account and Insights eligibility must still be confirmed through the actual consent and first read.

## Creator workflow

### First-party portfolio System User

When Unified Login approves the account but returns an empty assigned-account list, an explicitly assigned portfolio System User is supported. Assign the project app and Instagram account to that System User, then generate a token for this app with `instagram_basic` and `instagram_manage_insights`. Save it directly in Vercel Production as Sensitive `META_INSTAGRAM_SYSTEM_USER_TOKEN`; configure the non-secret `META_INSTAGRAM_SYSTEM_USER_ID` and `META_INSTAGRAM_ACCOUNT_ID` for this project's exact assets. Deploy after changing environment configuration.

Settings → Validate Instagram connection performs read-only identity, exact account, and media-access checks and encrypts the token into the existing private Blob credential namespace. It does not call the empty assigned-account edge, modify Meta assets, or write Sheets. Insights access is verified by the first explicit sync. Status reads never import a token. A failed validation leaves the previous connection intact; Blob errors fail closed and uncertain writes are not retried. ETags prevent concurrent replacement. The token is never returned to the browser or placed in request URLs. Server tokens are not an automatic fallback for a missing, corrupt, expired or revoked saved credential.

This setup cannot infer the token's actual expiry date and does not label it permanent or grant a fresh 60-day lifetime. If access expires or is revoked, replace the server token, deploy the changed configuration and validate again. This first-party route differs from OAuth reconnect: changing a Vercel environment variable requires a deployment.

Identity validation reads `/me?fields=id`. If that differs from the configured portfolio System User ID, it reads the configured numeric SystemUser node with the same token and requires both resolved IDs to match. It does not depend on an optional `system_user_id` field being available through `/me`. The exact Instagram profile and media access are checked separately. An unrelated token is never accepted merely because it can read an Instagram account. Inaccessible identity mapping fails closed. Provider failures report only a fixed request stage and numeric error/subcode; raw provider messages, URLs, tokens, and response bodies are never surfaced.

Settings → Instagram insights → Connect Instagram. Approve the selected account and choose Continue to app. Then click Sync Instagram explicitly. Reconnecting replaces the encrypted server credential; it does not require copying a token or redeploying. Expiring or revoked access requires reconnecting; this system-user integration does not promise automatic token refresh.

Sync reads the connected account's assigned Instagram assets and published media. It matches saved Instagram post links by shortcode, allowing Reel and post permalink forms for the same shortcode. It does not fetch user-supplied URLs or follow provider-supplied pagination URLs. Up to 100 saved post links and 20 provider media pages are supported; unmatched links are counted rather than guessed.

Supported values are available views, likes, comments, shares, saves, and average watch time for Reels identified by Meta's `media_product_type=REELS`. The `ig_reels_avg_watch_time` value is converted from milliseconds to the tracker's `avgWatch` seconds; the existing card calculates Avg. watched against the Instagram version's actual duration. This is an average metric, not an accumulated total, and it is not capped at the video duration because replay can exceed it. A measured zero is retained. Unsupported, null or absent values are omitted so a same-day manual value is not cleared. Feed posts do not request this Reels-only metric. Duration, completion rate and other platforms are not changed. The snapshot date is the retrieval date in Asia/Jakarta; counts are cumulative totals, not differences.

The server fetches all results before writing. One shared spreadsheet lock and one atomic content/metadata batch commit protect each sync. Sync refreshes available API metrics on the same video/Instagram/date observation, including manually entered or corrected observations. The row ID is retained and previous values are appended to correction history. Missing API metrics, duration, completion rate, older dates and other platforms are preserved. A refreshed manual observation is marked as Instagram-managed. Unchanged or older fetched results are skipped. Changed post links/versions, duplicate observations, formula cells (including average watch time), and unresolved metadata block the entire write. Writes with an uncertain result are never retried automatically.

## Connection security

- Authenticated, same-origin POST initiation and sync. GET status requires app authentication.
- Random expiring OAuth state bound to an opaque HttpOnly browser cookie. A create-only private Blob claim makes callbacks single-use across server instances before exchanging the code.
- The app secret and authorization code are sent to the fixed Graph endpoint in a POST body. Access tokens are sent only in Authorization headers for fixed Graph requests. Provider errors are sanitized.
- AES-256-GCM with fresh IVs and HKDF keys scoped to the Meta app ID, APP_ORIGIN, provider, and purpose. Google credentials and OAuth attempts use different namespaces and keys. Private reads bypass caches; credential replacement uses ETags.
- No tokens are rendered in HTML or exposed in status JSON, browser storage, cookies, Git, or Sheets. Storage/decryption errors fail closed. Sign-out clears the outstanding Instagram state cookie.

## Verification boundary

Automated tests use fake provider responses and private Blob mocks; spreadsheet writes use mock Google APIs. Real Meta consent, asset availability, permission coverage, and metrics availability require the creator to connect their account and perform the first sync. Authorization itself does not write spreadsheet content.

Primary reference points: Meta's [system-user assigned Instagram accounts](https://github.com/facebook/facebook-python-business-sdk/blob/main/facebook_business/adobjects/systemuser.py), [Instagram user media edge](https://github.com/facebook/facebook-python-business-sdk/blob/main/facebook_business/adobjects/iguser.py), and [Instagram media Insights edge](https://github.com/facebook/facebook-python-business-sdk/blob/main/facebook_business/adobjects/igmedia.py). Dashboard flow and permissions are grounded in the creator's supplied Meta configuration screenshots. Some Meta documentation pages were unavailable to automated browsing during implementation; the live consent round trip remains an explicit verification gate.
