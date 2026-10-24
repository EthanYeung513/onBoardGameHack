"""Serves the app on Modal: the constructor at / and the studio at /studio.

Runtime and build settings come from the Modal secret "onboarding-studio". Create it in the Modal
dashboard, or let the deploy workflow create it from repository secrets. Deploy with
`modal deploy deploy/modal_app.py`.
"""

from pathlib import Path

import modal

APP_NAME = "onboarding-studio"
ROOT = Path(__file__).resolve().parent.parent
PORT = 3000

secret = modal.Secret.from_name(APP_NAME)

image = (
    modal.Image.debian_slim(python_version="3.12")
    .apt_install("curl", "ca-certificates", "gnupg")
    .run_commands(
        "curl -fsSL https://deb.nodesource.com/setup_22.x | bash -",
        "apt-get install -y nodejs",
    )
    # Install dependencies before copying the rest so source edits reuse this layer.
    .add_local_file(ROOT / "package.json", "/app/package.json", copy=True)
    .add_local_file(ROOT / "package-lock.json", "/app/package-lock.json", copy=True)
    .add_local_file(ROOT / ".npmrc", "/app/.npmrc", copy=True)
    .run_commands("cd /app && npm ci --no-audit --no-fund")
    # dembrandt drives its own copy of playwright-core, so its Chromium build is the one installed.
    .run_commands("cd /app && node node_modules/dembrandt/node_modules/playwright-core/cli.js install --with-deps chromium")
    .add_local_dir(
        ROOT,
        "/app",
        copy=True,
        ignore=["node_modules", ".next", ".git", "artifacts", "test-results", "playwright-report", ".env*", ".data", "deploy/__pycache__"],
    )
    # NEXT_PUBLIC_* values are inlined at build time, so the build sees the same secret as runtime.
    .run_commands("cd /app && npm run build", secrets=[secret])
    .env({"NODE_ENV": "production", "DEMBRANDT_ENABLED": "true", "NEXT_TELEMETRY_DISABLED": "1"})
)

app = modal.App(APP_NAME, image=image)


@app.function(secrets=[secret], cpu=2, memory=4096, timeout=3600, min_containers=1, scaledown_window=900)
@modal.concurrent(max_inputs=100)
@modal.web_server(PORT, startup_timeout=180)
def web():
    import subprocess

    subprocess.Popen(["npx", "next", "start", "-p", str(PORT), "-H", "0.0.0.0"], cwd="/app")
