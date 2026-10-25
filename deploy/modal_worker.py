"""The production pipeline worker on Modal: polls the cloud Convex deployment and runs scan, brain,
course and deploy jobs (src/worker/main.ts). The Next app (Vercel) only enqueues jobs; without this
worker a published space never finishes Generate → deploy.

Runs in shifts: a cron starts a fresh worker every 6 hours and each shift exits just before the next
one, so one is always polling (job claims are atomic in Convex, so a short overlap is harmless).

Secret "orthogonal-worker" (Modal): CONVEX_URL, WORKER_SECRET (must match the Convex deployment's
WORKER_SECRET), MUBIT_API_KEY, MUBIT_BASE_URL, MUBIT_EMBED_MODEL, APP_URL, optional VERCEL_TOKEN.
Deploy: `npm run deploy:worker` (modal deploy + start the first shift now).
"""

from pathlib import Path

import modal

APP_NAME = "orthogonal-worker"
ROOT = Path(__file__).resolve().parent.parent
SHIFT_SECONDS = 6 * 60 * 60

secret = modal.Secret.from_name(APP_NAME)

image = (
    modal.Image.debian_slim(python_version="3.12")
    .apt_install("curl", "ca-certificates", "gnupg")
    .run_commands(
        "curl -fsSL https://deb.nodesource.com/setup_22.x | bash -",
        "apt-get install -y nodejs",
    )
    .add_local_file(ROOT / "package.json", "/app/package.json", copy=True)
    .add_local_file(ROOT / "package-lock.json", "/app/package-lock.json", copy=True)
    .add_local_file(ROOT / ".npmrc", "/app/.npmrc", copy=True)
    .run_commands("cd /app && npm ci --no-audit --no-fund")
    # dembrandt (rendered-page brand extraction) drives its own playwright-core Chromium.
    .run_commands("cd /app && node node_modules/dembrandt/node_modules/playwright-core/cli.js install --with-deps chromium")
    .add_local_dir(
        ROOT,
        "/app",
        copy=True,
        ignore=["node_modules", ".next", ".git", "artifacts", "test-results", "playwright-report", ".env*", ".data", ".convex-local", "public/world", "deploy/__pycache__"],
    )
    # The world bundle the deploy stage links company sites to (public/world).
    .run_commands("cd /app && npm run build:world")
    .env({"NODE_ENV": "production", "DEMBRANDT_ENABLED": "true"})
)

app = modal.App(APP_NAME, image=image)


@app.function(secrets=[secret], cpu=2, memory=4096, timeout=SHIFT_SECONDS + 600, schedule=modal.Cron("0 */6 * * *"))
def worker():
    import subprocess

    proc = subprocess.Popen(["node", "scripts/run-ts.mjs", "src/worker/main.ts"], cwd="/app")
    try:
        proc.wait(timeout=SHIFT_SECONDS)
    except subprocess.TimeoutExpired:
        # Graceful stop: the worker finishes its slices' bookkeeping on SIGTERM.
        proc.terminate()
        try:
            proc.wait(timeout=120)
        except subprocess.TimeoutExpired:
            proc.kill()
