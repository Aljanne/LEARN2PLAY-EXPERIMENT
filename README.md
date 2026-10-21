# Learn2Play

## Run locally

1. Create and activate a Python virtual environment.
2. Install dependencies with `pip install -r requirements.txt`.
3. Run `python app.py` and open `http://127.0.0.1:5000`.

Without `DATABASE_URL`, the app uses the local `learn2play.db` SQLite file.

## Supabase database

This app uses SQLAlchemy with Supabase's PostgreSQL database. In the Supabase dashboard, open **Connect** and copy the database connection string. Use the **Session pooler** connection string for a Render service if the direct connection is unreachable over IPv6. Keep the password in the URL encoded if it contains characters such as `@`, `:`, `/`, or `#`.

Set that full connection string as `DATABASE_URL` in the Render service's environment variables. Do not commit it or put it in frontend JavaScript. The app creates the current SQLAlchemy tables on startup; `create_all()` does not migrate existing tables when models change.

## Google login

Create a Google OAuth web application in Google Cloud Console and add the callback URL below to its authorized redirect URIs:

`http://127.0.0.1:5000/auth/google/callback` for local development, or `https://YOUR-DOMAIN/auth/google/callback` in production.

Set `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` in the environment. Set `GOOGLE_REDIRECT_URI` only when the callback URL should be explicitly fixed; otherwise the app derives it from the current request.

## Deploy to Render

1. Push this repository to GitHub.
2. In Render, choose **New + → Blueprint** and connect this repository. Render reads `render.yaml` to create the web service.
3. When prompted, set `DATABASE_URL` to the Supabase connection string. Render generates `SECRET_KEY` for the service.
4. Deploy and open the service URL. The `/auth` route is used as the health check.

The service runs `gunicorn app:app` and installs dependencies from `requirements.txt`. Future pushes to the connected branch can deploy automatically through Render.

## Deploy to Vercel

Vercel detects the Flask application from `app.py`. The build script copies the
static files into `public/static`, which is Vercel's supported static-asset
directory for Flask deployments.

### 1. Create the Vercel project

Install the Vercel CLI, log in, and run these commands from the repository root:

```powershell
npm.cmd install --global vercel
vercel login
vercel link
vercel deploy
```

Use the preview URL printed by Vercel to test the deployment. When it is ready,
deploy production with:

```powershell
vercel deploy --prod
```

Alternatively, import the GitHub repository from the Vercel dashboard. Each
push to the production branch can then create a new production deployment,
while other branches create preview deployments.

### 2. Configure Vercel environment variables

In the Vercel project, open **Settings → Environment Variables** and add these
for the **Production** and **Preview** environments as needed:

- `SECRET_KEY`: a long random value; do not use the development fallback.
- `DATABASE_URL`: a hosted PostgreSQL/Supabase connection string. SQLite files
  are not persistent storage on Vercel.
- `GOOGLE_CLIENT_ID`: the Google OAuth web-client ID.
- `GOOGLE_CLIENT_SECRET`: the Google OAuth client secret.
- `GOOGLE_REDIRECT_URI`: the exact public callback URL, for example
  `https://YOUR-PROJECT.vercel.app/auth/google/callback`.

After adding or changing variables, create a new deployment; environment
variable changes do not affect deployments that already exist.

### 3. Configure Google OAuth for the deployed URL

In Google Cloud Console, open **Google Auth Platform → Clients**, edit the Web
application client, and add the exact Vercel callback URL under **Authorized
redirect URIs**:

```text
https://YOUR-PROJECT.vercel.app/auth/google/callback
```

The URL must match exactly, including `https`, hostname, path, and trailing
slash behavior. Keep the client secret only in Vercel environment variables.

Open the deployed site on the other device and select **Continue with Google**.
The callback returns to `/auth/google/callback`, creates or finds the local
Learn2Play account, and redirects to `/dashboard`.

### Vercel limitations to account for

- Use hosted PostgreSQL for persistent users and appointments.
- Files written to the function filesystem are not durable between requests;
  credential and avatar uploads should eventually move to object storage.
- The current build deploys the existing app, but booking/session creation is
  not implemented yet.
