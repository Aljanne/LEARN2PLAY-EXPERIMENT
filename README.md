# Learn2Play

## Run locally

1. Create and activate a Python virtual environment.
2. Install dependencies with `pip install -r requirements.txt`.
3. Run `python app.py` and open `http://127.0.0.1:5000`.

Without `DATABASE_URL`, the app uses the local `learn2play.db` SQLite file.

## Supabase database

This app uses SQLAlchemy with Supabase's PostgreSQL database. In the Supabase dashboard, open **Connect** and copy the database connection string. Use the **Session pooler** connection string for a Render service if the direct connection is unreachable over IPv6. Keep the password in the URL encoded if it contains characters such as `@`, `:`, `/`, or `#`.

Set that full connection string as `DATABASE_URL` in the Render service's environment variables. Do not commit it or put it in frontend JavaScript. The app creates the current SQLAlchemy tables on startup; `create_all()` does not migrate existing tables when models change.

## Deploy to Render

1. Push this repository to GitHub.
2. In Render, choose **New + → Blueprint** and connect this repository. Render reads `render.yaml` to create the web service.
3. When prompted, set `DATABASE_URL` to the Supabase connection string. Render generates `SECRET_KEY` for the service.
4. Deploy and open the service URL. The `/auth` route is used as the health check.

The service runs `gunicorn app:app` and installs dependencies from `requirements.txt`. Future pushes to the connected branch can deploy automatically through Render.
