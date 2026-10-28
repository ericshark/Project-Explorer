# APIs, workers, and storage on Render

## Summary

Local use needs the application's runtime and any database/queue dependencies. Public hosting needs a Render Web Service for an HTTP server, a Background Worker for queue jobs, and persistent storage where the code writes durable data. Services are separate billable resources.

## Run locally

1. Follow the repository's dependency and environment setup. Use development databases and credentials.
2. Start each required database/queue, backend, worker, and frontend using its README. Local Docker Compose can orchestrate these dependencies; it is not automatically deployed as a group on Render.
3. Open the frontend and check its API connection. Stop every process you started with Ctrl+C or the documented Compose shutdown command.

## Deploy publicly

1. Create the database/Key Value resources actually required by the project. Place private backend dependencies in the same region. Copy connection settings into server environment variables, not browser builds.
2. Create a Web Service from GitHub. Choose the correct application root and runtime, or Docker build context/Dockerfile. Install production dependencies using the project's command.
3. Bind the HTTP server to `0.0.0.0` and Render's `PORT`. Example for FastAPI:

```bash
uvicorn app.main:app --host 0.0.0.0 --port "$PORT"
```

4. Run required migrations once before accepting traffic, using a pre-deploy command if supported by the selected plan, or a controlled release step. Never use a development reload server in production.
5. If jobs are required, create a separate Background Worker with the actual worker entrypoint and matching private connection variables.
6. For SQLite, mount a paid persistent disk and place the database under that path. Keep single-instance assumptions intact. Disk persistence is not an independent database backup; configure and test the project's recovery mechanism.
7. Set the documented health-check path. Deploy, inspect logs, test a real operation, restart, and verify durable data survives.
8. Configure frontend API URLs and server allowed origins. Use HTTPS/WSS; verify streaming without a development proxy. Add a domain only when useful: [Connect a domain](/hosting/domains).

## Cost

Checked October 28, 2026: Render bills workspace plans separately from per-service resources. Entry paid compute is `0.5c-512mb` (legacy Starter), $7 per web service or worker/month; Postgres `0.1c-256mb` is $6/month plus storage; persistent Key Value `256mb` is $10/month. App disks cost $0.25/GB-month, and Postgres storage $0.30/GB-month. These are individual resource prices, not a bundle. Verify selected sizes and bandwidth charges in the dashboard. [Official compute comparison](https://render.com/articles/production-rails-hosting-guide), [plan IDs](https://render.com/docs/compute-plans), [pricing](https://render.com/pricing).

Free web services sleep after 15 minutes of inactivity and have no persistent disk; free Postgres expires after 30 days. Use them for previews, not durable production storage. Paid instances provide resources/availability, not a guarantee of application speed. External backups and AI/email services add separate charges.

Sources: [FastAPI](https://render.com/docs/deploy-fastapi), [Docker](https://render.com/docs/docker), [disks](https://render.com/docs/disks), [free limitations](https://render.com/docs/free), [WebSockets](https://render.com/docs/websocket), [Key Value](https://render.com/docs/key-value).
