# Learn2Play

## Run locally

1. Create and activate a Python virtual environment.
2. Install dependencies with `pip install -r requirements.txt`.
3. Run `python app.py` and open `http://127.0.0.1:5000`.

Without `DATABASE_URL`, the app uses the local `learn2play.db` SQLite file.
Google login also requires `SUPABASE_URL` and `SUPABASE_ANON_KEY` in the app
environment. The Supabase Google provider and the app's `/auth` redirect URL
must already be configured in Supabase.

## Supabase database

This app uses SQLAlchemy with Supabase's PostgreSQL database. In the Supabase dashboard, open **Connect** and copy the database connection string. Use the **Session pooler** connection string for hosted services if the direct connection is unreachable over IPv6. Keep the password in the URL encoded if it contains characters such as `@`, `:`, `/`, or `#`.

Set that full connection string as `DATABASE_URL` in the hosting provider's environment variables. Do not commit it or put it in frontend JavaScript. Apply database changes with the included Flask-Migrate migrations; the app does not migrate the database automatically at startup.

## Deploy to Vercel

1. Push this repository to GitHub, then import it as a new project in Vercel. Vercel detects the Flask app in `app.py`, installs the Python dependencies, and runs the build command in `pyproject.toml` to prepare static assets.
2. In the Vercel project's **Settings → Environment Variables**, set:
   - `DATABASE_URL`: the Supabase PostgreSQL connection string.
   - `SECRET_KEY`: a private random value of at least 32 characters.
   - `SUPABASE_URL`: the Supabase Project URL.
   - `SUPABASE_ANON_KEY`: the Supabase publishable key (not a secret key).
   - `SUPABASE_SERVICE_ROLE_KEY`: the Supabase secret/service-role key, required for credential-file uploads. Keep it server-side and never expose it in frontend code.
3. Select the environments where the variables apply, save, and deploy. Vercel uses Python 3.12 as pinned by `.python-version`.
4. Once Vercel provides the deployment URL, ensure that URL plus `/auth` is allowed as a redirect URL in Supabase Auth. Also set the Supabase Auth site URL to your production deployment URL.
5. If the Supabase database has not already been migrated to the current schema, apply the included migrations against it before using the app.

The Vercel Function filesystem is not persistent. Avatar uploads currently save to the local `static/uploads/avatars` folder, so avatar uploads need to be moved to persistent object storage before relying on that feature in production. Existing static assets are prepared under `public/static` during the Vercel build.

The `render.yaml` file remains available for an optional Render deployment; it is not used by Vercel.
