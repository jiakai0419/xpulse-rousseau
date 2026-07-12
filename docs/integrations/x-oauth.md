# X OAuth Setup

## Purpose

Connect the local app to the user's X account through OAuth 2.0 Authorization Code with PKCE, then use the authenticated home timeline endpoint as the source for real Following posts.

## Official Facts Used

- X OAuth 2.0 must be enabled in the App authentication settings.
- OAuth 2.0 uses a `Client ID` from the App's keys and tokens section.
- Redirect URI validation is exact, so the callback URL must match exactly.
- Default access tokens last two hours unless the `offline.access` scope is requested.
- `tweet.read` and `users.read` are the minimal read scopes this app needs, plus `offline.access` for refresh tokens.
- The token endpoint is `https://api.x.com/2/oauth2/token`.
- The authorize endpoint is `https://x.com/i/oauth2/authorize`.

Source: X OAuth 2.0 Authorization Code Flow with PKCE documentation.

## Local Callback URL

Use this callback URL in the X Developer Console:

```txt
http://127.0.0.1:3000/api/auth/x/callback
```

If you change `HOST`, `PORT`, or `X_REDIRECT_URI`, the Developer Console callback URL must change to the exact same value.

## Required `.env`

```txt
X_CLIENT_ID=
X_CLIENT_SECRET=
X_REDIRECT_URI=http://127.0.0.1:3000/api/auth/x/callback
X_OAUTH_SCOPES=tweet.read users.read offline.access
TIMELINE_SOURCE=replay
```

`X_CLIENT_SECRET` is optional for public-client app types, but should be provided for a Web App/confidential-client configuration.

Credential priority does not change merely because time passes while the Reader is open. A complete stored OAuth identity takes precedence when it has no expiry or has the refresh token and `X_CLIENT_ID` needed to maintain the same identity. Online refreshes that OAuth token when needed and fails visibly instead of silently falling back to a different manual account. If an expiring OAuth identity cannot be refreshed and complete manual `X_USER_ID` / `X_USER_ACCESS_TOKEN` credentials exist, both status and Online choose manual from the start—even before the OAuth token reaches its refresh window. The status API always reports the identity selected by this stable rule.

## Flow In This App

1. Open the local app.
2. Click `连接` next to X status.
3. The app generates a PKCE verifier/challenge and random state.
4. The browser redirects to X authorization.
5. X redirects back to `/api/auth/x/callback`.
6. The server validates state and exchanges the code within the callback.
7. The server calls `/2/users/me` to identify the authenticated user.
8. Tokens and user info are saved to `.data/x-oauth.json`.
9. Selecting source `X` and refreshing uses the stored token to call the home timeline.

## Stored Token File

```txt
.data/x-oauth.json
```

This file is ignored by git. It may contain access and refresh tokens, so treat it as sensitive local state.

## Troubleshooting

- `X_CLIENT_ID is required`: fill `X_CLIENT_ID` in `.env`.
- `unknown_or_expired_state`: start the X connection again. The in-memory OAuth state expires and is lost when the server restarts.
- OAuth page rejects redirect URI: the Developer Console callback URL does not exactly match `X_REDIRECT_URI`.
- Token expires quickly: make sure `offline.access` is included in both `.env` and the X app's allowed scopes.
