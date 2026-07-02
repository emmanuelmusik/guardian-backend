# Guardian Backend — Testing Guide (Dummy Data)

Walks through creating two test users (a mentor and an aspirant) and
exercising every route with curl. No frontend needed yet.

## 0. Prerequisites

- `schema.sql` has been run in your Supabase project's SQL Editor
- `.env` is filled in (Supabase URL/service key, LiveKit key/secret/url)
- Backend running locally: `npm install && npm run dev` (listens on :4000)
- You have your Supabase **anon key** too (Project Settings > API) — needed
  for the sign-in calls below, separate from the service role key

Set these as shell variables so the commands below stay copy-pasteable:

```bash
export SUPABASE_URL="https://your-project.supabase.co"
export ANON_KEY="your-anon-key"
export SERVICE_KEY="your-service-role-key"
export API="http://localhost:4000"
```

## 1. Create two dummy users (skip email confirmation)

Using the Admin API with your service role key creates pre-confirmed users,
so you can sign in immediately without checking an inbox.

```bash
curl -s -X POST "$SUPABASE_URL/auth/v1/admin/users" \
  -H "apikey: $SERVICE_KEY" \
  -H "Authorization: Bearer $SERVICE_KEY" \
  -H "Content-Type: application/json" \
  -d '{"email":"mentor@test.com","password":"Test1234!","email_confirm":true}'

curl -s -X POST "$SUPABASE_URL/auth/v1/admin/users" \
  -H "apikey: $SERVICE_KEY" \
  -H "Authorization: Bearer $SERVICE_KEY" \
  -H "Content-Type: application/json" \
  -d '{"email":"aspirant@test.com","password":"Test1234!","email_confirm":true}'
```

Each response includes an `id` (UUID) — save both. The `handle_new_user`
trigger will have already created a matching row in `profiles` for each.

## 2. Sign in as each user to get a JWT

This is the token your backend's `requireAuth` middleware expects.

```bash
MENTOR_TOKEN=$(curl -s -X POST "$SUPABASE_URL/auth/v1/token?grant_type=password" \
  -H "apikey: $ANON_KEY" -H "Content-Type: application/json" \
  -d '{"email":"mentor@test.com","password":"Test1234!"}' | jq -r .access_token)

ASPIRANT_TOKEN=$(curl -s -X POST "$SUPABASE_URL/auth/v1/token?grant_type=password" \
  -H "apikey: $ANON_KEY" -H "Content-Type: application/json" \
  -d '{"email":"aspirant@test.com","password":"Test1234!"}' | jq -r .access_token)

echo $MENTOR_TOKEN
echo $ASPIRANT_TOKEN
```

(No `jq`? Run without the `| jq -r .access_token` part and copy the
`access_token` value from the JSON by hand into `MENTOR_TOKEN=...`.)

## 3. Sanity check

```bash
curl -s "$API/health"
# {"status":"ok"}
```

## 4. Mentor creates a community

```bash
curl -s -X POST "$API/api/communities" \
  -H "Authorization: Bearer $MENTOR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"Morning Prayer Circle","description":"Daily reflections and dream sharing"}'
```

Save the returned `id` as `COMMUNITY_ID`.

## 5. Aspirant joins the community

```bash
curl -s -X POST "$API/api/communities/$COMMUNITY_ID/join" \
  -H "Authorization: Bearer $ASPIRANT_TOKEN"
```

## 6. Aspirant creates a private journal entry

```bash
curl -s -X POST "$API/api/entries" \
  -H "Authorization: Bearer $ASPIRANT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"type":"dream","title":"The narrow gate","content":"I dreamed of a narrow path through a forest...","visibility":"private"}'
```

Save the returned `id` as `ENTRY_ID`. Confirm it's private by fetching it
back — should only work with the aspirant's own token:

```bash
curl -s "$API/api/entries" -H "Authorization: Bearer $ASPIRANT_TOKEN"
```

## 7. Aspirant shares the entry with the community

```bash
curl -s -X PATCH "$API/api/entries/$ENTRY_ID" \
  -H "Authorization: Bearer $ASPIRANT_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"visibility\":\"community\",\"shared_community_id\":\"$COMMUNITY_ID\"}"
```

## 8. Mentor leaves feedback on the shared entry

```bash
curl -s -X POST "$API/api/comments/entry/$ENTRY_ID" \
  -H "Authorization: Bearer $MENTOR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"body":"This sounds like a season of discernment. Let'"'"'s talk more Sunday."}'
```

Then confirm the thread shows up for both sides:

```bash
curl -s "$API/api/comments/entry/$ENTRY_ID" -H "Authorization: Bearer $ASPIRANT_TOKEN"
```

## 9. Mentor adds a study material

```bash
curl -s -X POST "$API/api/study-materials" \
  -H "Authorization: Bearer $MENTOR_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"community_id\":\"$COMMUNITY_ID\",\"type\":\"youtube\",\"title\":\"On Discernment\",\"url\":\"https://youtube.com/watch?v=example\"}"
```

```bash
curl -s "$API/api/study-materials/community/$COMMUNITY_ID" -H "Authorization: Bearer $ASPIRANT_TOKEN"
```

## 10. Get a LiveKit call token

```bash
curl -s -X POST "$API/api/livekit/token" \
  -H "Authorization: Bearer $ASPIRANT_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"community_id\":\"$COMMUNITY_ID\"}"
```

You should get back `{ token, url, room }`. You can sanity-check the token
works by pasting it into LiveKit's [Meet example app](https://meet.livekit.io)
along with your project's `url`.

## 11. Bible passage lookup

```bash
curl -s "$API/api/bible/passage?ref=John+3:16&version=kjv" \
  -H "Authorization: Bearer $ASPIRANT_TOKEN"
```

## 12. Confirm privacy actually holds (the important one)

Create a *second* aspirant the same way as step 1–2, don't add them to the
community, and confirm they get an empty/forbidden result when trying to
read the shared entry or community data:

```bash
curl -s "$API/api/comments/entry/$ENTRY_ID" -H "Authorization: Bearer $OUTSIDER_TOKEN"
# should return [] — not the mentor's comment
```

If that comes back empty, your RLS policies are doing their job.

## Troubleshooting

- **401 Invalid or expired token** — access tokens expire in ~1hr by
  default; re-run step 2.
- **500 errors mentioning RLS/policy** — you're using the service-role
  client server-side, so RLS shouldn't block you; a policy error here
  usually means a typo in a policy name/column, worth re-checking
  `schema.sql` ran clean with no errors.
- **LiveKit token works but joining fails** — double check `LIVEKIT_URL`
  is the `wss://` URL, not the dashboard URL.
