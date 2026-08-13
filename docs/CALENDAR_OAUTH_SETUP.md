# Calendar OAuth Setup

Getting `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and
`GOOGLE_CALENDAR_REFRESH_TOKEN` — the three env vars that turn on
scheduling (`check_availability`, `book_meeting`, `find_booking`,
`cancel_meeting`/`reschedule_meeting`, see `api/_features.js`'s
`CALENDAR_ENABLED`). Without these the agent still works fine as
Q&A-only — this is optional, not a prerequisite for the rest of the setup.

Do this once, as the person whose calendar the agent should book real
meetings on (`primary` calendar — see `api/_calendar.js`).

## 1. Create a Google Cloud project and enable the Calendar API

1. Go to [console.cloud.google.com](https://console.cloud.google.com) and
   create a new project (or reuse an existing one — this doesn't need to be
   dedicated).
2. In the sidebar: **APIs & Services → Library**, search "Google Calendar
   API", click it, click **Enable**.

## 2. Configure the OAuth consent screen

1. **APIs & Services → OAuth consent screen**.
2. User type: **External** (this works fine even though only you'll ever
   actually authorize it — "External" just means it's not restricted to a
   Google Workspace org).
3. Fill in the required fields (app name, your email as support contact)
   — none of this is visitor-facing, it's only shown to you once during
   step 4 below.
4. Scopes: skip for now, added directly in step 4.
5. Test users: add the Google account whose calendar you want the agent
   booking on.
6. **Publish the app** (there's a "Publish App" button on this same screen)
   before generating a refresh token in step 4 below. This matters more than
   it looks: a refresh token obtained while the app is still in **Testing**
   status silently **expires after 7 days**, no matter how often it's used
   — the calendar tool will work fine for a week, then every booking
   request will start failing with a `calendar token 400` error in your
   logs, with no obvious cause unless you know to look for this. Publishing
   removes that expiry. You don't need Google's full verification review to
   publish for personal-scale use like this (that's only required to remove
   the "unverified app" warning shown during authorization) — just click
   Publish, accept the warning about unverified apps, and move on. Since
   you're the only person who will ever authorize this app, that warning is
   a non-issue.

## 3. Create an OAuth 2.0 Client ID

1. **APIs & Services → Credentials → Create Credentials → OAuth client ID**.
2. Application type: **Web application**.
3. Under **Authorized redirect URIs**, add:
   `https://developers.google.com/oauthplayground`
   (this is Google's own OAuth Playground tool — used in step 4 purely to
   *obtain* the refresh token once; it's not part of the running app).
4. Create it, then copy the **Client ID** and **Client Secret** shown —
   these are `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` directly.

## 4. Get a refresh token via OAuth Playground

The app itself has no login UI (there's no "connect your calendar" button
— by design, this is a one-person tool, not multi-tenant), so the refresh
token is obtained once, manually, via Google's own OAuth Playground:

1. Go to [developers.google.com/oauthplayground](https://developers.google.com/oauthplayground).
2. Click the gear icon (top right) → check **"Use your own OAuth
   credentials"** → paste in the Client ID and Client Secret from step 3.
3. In the left panel's scope input, enter exactly:
   `https://www.googleapis.com/auth/calendar`
   (this single scope covers everything `api/_calendar.js` needs —
   `freeBusy` lookups, creating events, and deleting/cancelling them).
4. Click **Authorize APIs**, sign in with the *same Google account* you
   added as a test user in step 2, and accept the consent screen (it'll
   show a Google "unverified app" warning — expected, since you haven't
   gone through Google's formal verification review; click through it).
5. Back in the Playground, click **Exchange authorization code for
   tokens**.
6. Copy the **Refresh token** field — this is `GOOGLE_CALENDAR_REFRESH_TOKEN`.
   (Ignore the Access token — `api/_calendar.js`'s `getAccessToken()`
   exchanges the refresh token for a fresh access token on every
   invocation itself; nothing from the Playground's access token is used.)

## 5. Set the env vars

Add all three to `.env.local` for local dev and to your deployment
platform's environment variables (Vercel: **Project Settings →
Environment Variables**):

```
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
GOOGLE_CALENDAR_REFRESH_TOKEN=...
```

Also set `RESEND_API_KEY`/`RESEND_FROM_EMAIL` if you haven't — as of the
confirmation-code fix in `api/_bookingConfirm.js`, cancelling/rescheduling
an existing booking requires email sending to be configured too (the tools
are simply not offered to the agent otherwise — see `LEAVE_MESSAGE_ENABLED`
in `api/_features.js`).

## 6. Verify it worked

Restart your dev server (env vars are read at process start) and ask the
agent something like *"what times are open this week?"* — if
`GOOGLE_CLIENT_ID`/`SECRET`/`REFRESH_TOKEN` are all correctly set, it
should call `check_availability` and return real open slots from your
calendar. If it instead says scheduling is unavailable, double check the
three env vars are present and that the refresh token's scope (step 4.3)
is exactly `https://www.googleapis.com/auth/calendar`.

**If it worked initially and then stopped** (server logs show
`check_availability error: Error: calendar token 400` at
`getAccessToken`), this is almost certainly the Testing-mode 7-day refresh
token expiry from step 2.6 above — check whether the OAuth consent screen
is still in Testing status. If so, publish it and regenerate the refresh
token (step 4); the old one is dead and won't come back on its own.

## Why a refresh token instead of a login flow

There's no per-visitor OAuth flow here on purpose — visitors never
authenticate with Google, only the site owner does, once, up front. The
long-lived refresh token means the deployed serverless functions can
always mint a fresh access token themselves (`getAccessToken()` in
`api/_calendar.js`, called on every invocation since serverless functions
are stateless between calls — nothing worth caching across invocations
either way). If this ever needs to become multi-tenant (one deployment,
many businesses' calendars), that's the point where a real per-tenant
OAuth flow would replace this single-owner refresh token — not before.
