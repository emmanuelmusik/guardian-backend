# Guardian Backend

Express API over Supabase, with LiveKit call tokens and a Bible passage proxy.
Mirrors the FXAngel/Sent pattern: Node/Express backend, deployable to Railway,
paired with a React/Vite frontend on Vercel.

## Setup

1. **Create the Supabase project**, then run `schema.sql` in the SQL Editor.
   This creates all tables, enums, and Row Level Security policies.

2. **Enable Google OAuth** in Supabase: Authentication > Providers > Google.
   The `handle_new_user` trigger auto-creates a `profiles` row on first sign-in.

3. **Create a LiveKit Cloud project** at livekit.io. Grab the API key, secret,
   and WebSocket URL from Settings > Keys.

4. **Copy `.env.example` to `.env`** and fill in your Supabase and LiveKit values.

5. **Install and run:**
   ```
   npm install
   npm run dev
   ```
   Server starts on `http://localhost:4000`. Check `/health` to confirm it's up.

## How auth works

The frontend authenticates directly with Supabase (Google OAuth) and gets a
JWT. Every API request sends that JWT as `Authorization: Bearer <token>`.
The backend verifies it via `requireAuth` middleware and uses the Supabase
service-role client to perform the actual query, manually scoping each query
to `req.user.id` where needed.

## Routes

- `GET/POST/PATCH/DELETE /api/entries` — journal entries (dreams, visions, notes)
- `GET /api/entries/shared-with-me` — entries shared with the caller as mentor
- `GET/POST /api/communities`, `POST /api/communities/:id/join`
- `GET/POST/PATCH /api/connections` — mentor connections
- `GET/POST /api/comments/entry/:entryId` — feedback threads
- `GET/POST /api/study-materials` — pdf/audiobook/video/youtube/voice_note
- `POST /api/livekit/token` — join a community's video/audio call
- `GET /api/bible/passage?ref=John+3:16&version=kjv`

## Not included yet (next steps)

- Voice-to-text: handle client-side with the Web Speech API (same pattern as
  BrightPath's mic feature), or add a Whisper API route if you want
  server-side transcription for higher accuracy.
- File uploads for study materials: wire up Supabase Storage buckets and
  return signed URLs; the `study_materials.url` column is ready for this.
- Push notifications for new comments/mentor requests.
