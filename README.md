# Project Explorer

A local dashboard for your Git repositories. Browse project docs, see branches and worktrees, review changes, and start or stop development servers from one place.

## Quick start

You need **Node.js 24 or newer**, **npm**, **Git**, and **Bash**. Use Linux or Windows with WSL; run all commands inside your Linux/WSL terminal. Native Windows is not supported. macOS has not been verified.

```bash
git clone https://github.com/ericshark/Project-Explorer.git
cd Project-Explorer
npm ci
npm start
```

Open **http://localhost:4600** in your browser. By default, Project Explorer finds repositories under `~/GitHub`. An empty dashboard usually means your repositories are in a different folder; follow the next section.

Press **Ctrl+C** in the terminal to stop Project Explorer and the development servers it started. After an unexpected shutdown, the next startup attempts to clean up recorded servers using `.hub/pids.json`.

## Choose your projects folder

Create your own local settings:

```bash
cp private.env.example private.env
cp hub.config.json hub.local.json
```

Edit `hub.local.json`, changing `roots` to the folders containing your repositories:

```json
{
  "roots": ["~/Projects"],
  "ignore": [],
  "projects": {}
}
```

`private.env` already contains `HUB_CONFIG=hub.local.json`. Both local files are ignored by Git. Keep personal paths, email addresses, project overrides, and credentials in these files rather than tracked examples. No API key is required to run Project Explorer.

Optional settings in `private.env`:

```dotenv
HUB_CONFIG=hub.local.json
HUB_PORT=4600
WEB_PORT=4610
```

Existing shell environment variables take precedence. The file is loaded automatically by the server and Vite; restart after changing it. Relative `HUB_CONFIG` paths are resolved from the directory where you run the command. Changes to the selected JSON configuration are picked up without restarting.

Keep credentials out of `VITE_*` variables: Vite exposes those variables to browser code. Development servers launched by the dashboard inherit its environment, so prefer each project's own private environment files for project-specific credentials.

## What you can do

- See repositories needing attention, recent activity, contribution heatmaps, and running services.
- Browse each repository's README, docs, branches, commits, and worktrees.
- Review file changes and commit selected files; fetch, pull with fast-forward only, or push branches.
- Install dependencies and start, restart, or stop project development servers, with live logs.
- Open checkouts in VS Code when `code` is available. Explorer and Windows Terminal buttons require WSL and the corresponding Windows tools.
- Change theme and default panel expansion in Settings; preferences stay in your browser.

Git must be configured for commits (`git config user.name` and `git config user.email`). Your configured Git email determines which commits count as yours in activity charts. Optionally install and sign in to the GitHub CLI with `gh auth login` to distinguish public and private repositories in activity charts. GitHub authentication is not required for the dashboard itself; fetching and pushing use your existing Git credentials.

## Configure development servers

Repositories with a root `package.json` containing a `dev` script are detected automatically. The package manager is selected from the lockfile. Vite and Next.js get automatic port allocation; other scripts can report their URL in their logs.

For a backend, multiple services, or custom commands, add an entry under `projects` in your **local** `hub.local.json`. Keys are repository paths relative to a configured root:

```json
{
  "roots": ["~/Projects"],
  "ignore": ["archived"],
  "projects": {
    "my-app": {
      "services": [
        {
          "name": "backend",
          "cwd": "backend",
          "command": ".venv/bin/python -m uvicorn app.main:app --reload --port {port}",
          "defaultPort": 8000
        },
        {
          "name": "frontend",
          "cwd": "frontend",
          "command": "npm run dev -- --port {port} --strictPort",
          "defaultPort": 5173,
          "env": { "BACKEND_PORT": "{ports.backend}" },
          "open": true
        }
      ],
      "setup": [
        {
          "name": "backend dependencies",
          "cwd": "backend",
          "command": "python3 -m venv .venv && .venv/bin/pip install -r requirements.txt",
          "creates": "backend/.venv"
        },
        {
          "name": "frontend dependencies",
          "cwd": "frontend",
          "command": "npm install",
          "creates": "frontend/node_modules"
        }
      ]
    }
  }
}
```

Install the runtimes required by your projects separately (for example, Python for this example). `cwd` is relative to the selected checkout; `creates` is relative to the checkout root. Ports are allocated starting at `defaultPort + 1`, allowing multiple worktrees to run alongside one another. `{port}` means the service's own port and `{ports.backend}` means the backend's allocated port.

Project overrides also support `name`, `description`, `hidden`, and `stackCategory`. Top-level `activity.authorEmails` can include additional Git author email addresses for your activity charts. Keep these in local configuration.

## Local access and permissions

Project Explorer listens on `127.0.0.1`, checks loopback Host headers, and rejects writes from other origins. Run it locally and keep it off public hosting and public tunnels. It can execute configured commands, install or remove configured dependency folders, commit changes, and push branches using your account's permissions. Only configure repositories and commands you trust. Repositories are fetched in the background on startup.

## Troubleshooting

- **No projects listed:** check `roots` in `hub.local.json` and confirm those folders contain Git repositories.
- **Port already in use:** set `HUB_PORT=4601` in `private.env`, restart, and open http://localhost:4601. Set `WEB_PORT` separately if the development UI port is busy.
- **Fetch or push fails:** check that Git can access the repository from the same terminal. Use your normal SSH or HTTPS authentication setup.
- **A project will not start:** check its logs and install its dependencies and required runtime. Add explicit services for projects without a root `dev` script.
- **Node reports unsupported syntax:** check `node --version`; Node 24+ is required.

## Development

```bash
npm ci
npm run dev
```

Open http://localhost:4610 (or your `WEB_PORT`). This runs the API and Vite with automatic reload. For a production build, use `npm run build`; `npm run serve` serves the existing build. `npm start` builds and serves in one command.

Run checks:

```bash
npm run typecheck
npm run lint
npm test
npm run format:check
npm run build
```

## License

[MIT](LICENSE). You may use, modify, and redistribute the code, including commercially, under that license.
