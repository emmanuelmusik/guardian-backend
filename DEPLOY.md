# Guardian Backend — Deploying to Railway

Same process as your other apps: create a GitHub repo, then connect it in
Railway's dashboard.

## 1. Create the GitHub repo

- Go to github.com > New repository
- Name it `guardian-backend`, set it Private, don't initialize with a README
- Click Create repository

## 2. Get the code into the repo

**Download the code as one file:**
- Click the `guardian-backend.zip` link below this message
- Save it somewhere you'll remember, like your Desktop or Downloads folder

**Unzip it:**
- Mac: double-click the zip file — it creates a `guardian-backend` folder next to it
- Windows: right-click the zip file > "Extract All" — same result

**Upload it to GitHub:**
- Go to your new empty repo's page on github.com
- You'll see a line of text that says something like "Get started by creating a new file" with a blue link "**uploading an existing file**" — click that link
- A new page opens with a big dashed box that says "Drag files here to add them to your repository"
- Open the `guardian-backend` folder you just unzipped in Finder (Mac) or File Explorer (Windows)
- Select everything **inside** that folder (all the files and the `src` folder — Ctrl+A / Cmd+A selects all)
- Drag that selection into the dashed box on the GitHub page
- Wait for the file list to finish appearing — this can take a few seconds
- Scroll down, you'll see a green "Commit changes" button — click it

That's it. Your repo now has all the code.

## 3. Connect Railway to the repo

- Go to railway.app > New Project > Deploy from GitHub repo
- Select `guardian-backend`
- Railway detects it's a Node app from `package.json` and builds it automatically

## 4. Set environment variables

In the Railway project > Variables tab, add everything from `.env.example`:

```
SUPABASE_URL=...
SUPABASE_SERVICE_ROLE_KEY=...
LIVEKIT_API_KEY=...
LIVEKIT_API_SECRET=...
LIVEKIT_URL=...
BIBLE_API_BASE=https://bible-api.com
```

Don't set `PORT` — Railway injects its own and Express already reads
`process.env.PORT` with a fallback.

## 5. Generate a public domain

Settings > Networking > Generate Domain. You'll get something like
`guardian-backend-production.up.railway.app`.

## 6. Point the testing guide at it

In `TESTING_GUIDE.md`, change:

```bash
export API="http://localhost:4000"
```

to:

```bash
export API="https://guardian-backend-production.up.railway.app"
```

Everything else in the testing guide stays the same.

## Notes

- CORS is currently wide open (`app.use(cors())`), fine for testing. Once
  the frontend is live, worth restricting to your Vercel domain.
- Any future change means re-uploading the updated files to the GitHub
  repo (same drag-and-drop as step 2) — Railway auto-redeploys on that push.
