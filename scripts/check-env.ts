import { exitCode, formatTable, runAllChecks } from "@/lib/status/checks";

// One real, read-only call per provisioned service. PASS / FAIL / WARN (optional) / SKIP (not
// configured → offline stand-in). Exits 1 only when a configured required service fails.
async function main() {
  const results = await runAllChecks();
  console.log(formatTable(results));
  process.exit(exitCode(results));
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
