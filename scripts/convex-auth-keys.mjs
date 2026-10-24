// Idempotently sets the Convex Auth signing keys (JWT_PRIVATE_KEY, JWKS) and SITE_URL on the
// current Convex deployment. Values are piped to `convex env set`, never printed.
import { execFileSync, spawnSync } from "node:child_process";
import { exportJWK, exportPKCS8, generateKeyPair } from "jose";

const npx = process.platform === "win32" ? "npx.cmd" : "npx";

function envList() {
  const out = spawnSync(npx, ["convex", "env", "list"], { encoding: "utf8" });
  if (out.status !== 0) throw new Error(`convex env list failed: ${out.stderr}`);
  return new Set(out.stdout.split("\n").map((l) => l.split("=")[0].trim()).filter(Boolean));
}

function set(name, value) {
  // `--` keeps PEM/JSON values that start with "-" or "{" from being parsed as flags.
  execFileSync(npx, ["convex", "env", "set", "--", name, value], { stdio: ["ignore", "ignore", "inherit"] });
}

const have = envList();
const siteUrl = process.env.SITE_URL ?? process.env.APP_URL ?? "http://localhost:3000";

if (!have.has("JWT_PRIVATE_KEY") || !have.has("JWKS")) {
  const keys = await generateKeyPair("RS256", { extractable: true });
  const privateKey = await exportPKCS8(keys.privateKey);
  const jwks = JSON.stringify({ keys: [{ use: "sig", ...(await exportJWK(keys.publicKey)) }] });
  set("JWT_PRIVATE_KEY", privateKey.trimEnd().replace(/\n/g, " "));
  set("JWKS", jwks);
  console.log("convex-auth: generated signing keys");
} else {
  console.log("convex-auth: signing keys already set");
}
if (!have.has("SITE_URL")) {
  set("SITE_URL", siteUrl);
  console.log(`convex-auth: SITE_URL=${siteUrl}`);
}
