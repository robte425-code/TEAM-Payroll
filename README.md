# TEAM Payroll

Parser and web UI for LNI invoice verification spreadsheets, with employee pay rates stored in **Neon Postgres** (same database as TEAM Voc is OK — use a separate `payroll` schema).

## What it does now

- Reads `.xlsx` files (e.g. Gardiant / LNI invoice verification).
- Extracts key fields: `Work Done By`, `Provider ID`, `Rate Code`, `Units`, `Adj/ Resub`.
- Classifies each row into a rate category:
  - `case_work`
  - `travel_wait` (`0891V`, `0892V`)
  - `mileage` (`0893V`, `0894V`)
  - `report` (`0910V`)
  - `other` (anything not yet mapped)
- **Employee hourly rates** live in Postgres (`payroll.employees`) and appear on the analyzer when **Provider ID** matches.

## Database (Neon / Postgres)

1. **Create tables** (once per database). From the repo root, with `DATABASE_URL` set (Neon pooling URL is fine):

   ```bash
   psql "$DATABASE_URL" -f db/migrations/001_init_payroll.sql
   ```

   Or paste `db/migrations/001_init_payroll.sql` into the Neon SQL Editor.

2. **Environment variables**
   - Copy `.env.example` → `.env` locally (never commit `.env`).
   - In Vercel: Project → Settings → Environment Variables → add **`DATABASE_URL`** (same Neon project as TEAM Voc is allowed; TEAM Payroll only uses the `payroll` schema).

3. **Security**
   - Do **not** commit connection strings or paste them in chat.
   - If a secret was exposed, **rotate** the Neon password and update `DATABASE_URL` everywhere.

### Schema overview

| Object | Purpose |
|--------|---------|
| `payroll.employees` | `provider_id`, `display_name`, `hourly_rate`, timestamps |
| `payroll.app_kv` | Optional JSON key/value for future settings |

## API (Vercel serverless)

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/ping` | **No DB** — confirms Vercel is running this repo’s `api/` routes (`buildTag: team-payroll-v4`) |
| `GET` | `/api/build-info` | **No DB** — shows `VERCEL_GIT_COMMIT_SHA` so you can match GitHub |
| `GET` | `/api/health` | DB connectivity check |
| `GET` | `/api/employees` | List employees / rates |
| `POST` | `/api/employees` | Create (`providerId`, `displayName`, `hourlyRate`) |
| `PATCH` | `/api/employees` | Update by `id` + fields |
| `DELETE` | `/api/employees?id=<uuid>` | Delete |

**Note:** These routes are currently **unauthenticated**. Lock them down (e.g. Vercel auth, API key, or session) before storing sensitive payroll data in production.

### Troubleshooting: “`DATABASE_URL is not set`” (old message)

That message is **not** in current code. If you still see it:

1. Open **`/api/ping`** — must return `"buildTag": "team-payroll-v4"`. If you get **404** or an old tag, you’re on the **wrong Vercel project** or **Root Directory** is not the repo root.
2. Open **`/api/build-info`** — `vercelGitCommit` should match the latest commit on GitHub `main`. If it doesn’t, trigger **Redeploy** (or push a commit).
3. In Vercel: **Settings → General → Root Directory** must be **empty** (unless this app lives in a monorepo subfolder).
4. Env vars: add **`DATABASE_URL`** (or **`POSTGRES_URL`**) for **Production** *and* **Preview**, then **Redeploy**.

## Run locally

### CLI parser (no DB)

```bash
npm install
npm run parse:sample
```

Or:

```bash
npm start -- ./path/to/file.xlsx
```

### Website + API (needs `DATABASE_URL`)

```bash
npm install
cp .env.example .env
# Set DATABASE_URL in .env, run migration (see above), then:
npx vercel dev
```

Open the URL Vercel prints (often `http://localhost:3000`).

- **Analyze spreadsheet** — upload `.xlsx`, see category totals and hourly rates from the DB.
- **Employee pay rates** — view/edit rows in `payroll.employees`.

## Website upload workflow

- Deploy this project to Vercel (Hobby is fine) with `DATABASE_URL` set, or run `vercel dev` locally.
- Use the menu: **Analyze spreadsheet** | **Employee pay rates**.

## Deploy on Vercel (account **`robert-9282`**) + GitHub **`robte425-code`**

Two different things:

| Where | What it is |
|--------|------------|
| **Vercel** | Your login / dashboard — use account **`robert-9282`**. The project lives **here** after you import it. |
| **GitHub** | Where the code is hosted — e.g. **`robte425-code/your-repo`**. Vercel deploys **from** this repo. |

You add the project to **`robert-9282`** by logging into Vercel as that user and **importing** the GitHub repository (or running the CLI while logged in as that same Vercel user).

### 1. Put the code on GitHub under `robte425-code`

- Create a repository such as `https://github.com/robte425-code/TEAM-Payroll` (name is up to you).
- Push the code:

  ```bash
  git init   # if not already a repo
  git remote add origin git@github.com:robte425-code/<your-repo-name>.git
  git add .
  git commit -m "Initial commit"
  git push -u origin main
  ```

### 2. Add the project to Vercel as **`robert-9282`** (dashboard)

1. Sign out of Vercel if needed, then go to [vercel.com](https://vercel.com) and sign in as **`robert-9282`** (the email or GitHub/Google login that owns that Vercel profile).
2. Click **Add New… → Project** (or **Import Project**).
3. Under **Import Git Repository**, choose **GitHub**.
4. If asked, **install / authorize the Vercel GitHub App** and pick the GitHub account that can see **`robte425-code`** repos (often your personal GitHub user that owns or belongs to that org).
5. Select the **`robte425-code`** organization → choose this repository → **Import**.
6. **Framework preset:** **Other** (or leave default; static site + `/api` is fine).
7. **Environment variables:** add **`DATABASE_URL`** for Production (and Preview if previews should use the DB).
8. Click **Deploy**.

The new project appears under the **`robert-9282`** Vercel account’s dashboard. Pushes to the connected branch will auto-deploy.

### 3. CLI (optional, same Vercel user)

Use the CLI only after you’re logged in as **`robert-9282`** on Vercel:

```bash
npx vercel login
# Complete login in the browser — use the same identity as robert-9282

cd /path/to/TEAM-Payroll
npx vercel link
# When asked for scope, choose **robert-9282** (Hobby) unless you use a Team

npx vercel deploy --prod
```

If `vercel link` shows multiple scopes, pick the one labeled **`robert-9282`** (personal Hobby), not another team unless you intentionally created the project there.

### 4. Double-check

- **Vercel** → top-right avatar / account settings: you’re **`robert-9282`**.
- **Project → Settings → Git**: connected repo is **`robte425-code/<repo>`** (or your actual path).
- **GitHub** → repo → **Settings → Integrations**: Vercel is allowed for that repo.

**If GitHub doesn’t list `robte425-code`:** the GitHub user you authorize Vercel with must have access to that org’s repos (member of the org, or the org owner).

## Next planned step

Add payroll calculation rules on top of this parsed data (you said you will provide these next).
