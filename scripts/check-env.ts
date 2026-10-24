import { runAllChecks } from "@/lib/status/checks";

async function main() {
  const results = await runAllChecks();
  const w = Math.max(...results.map((r) => r.name.length));
  console.log(`${"Service".padEnd(w)}  Result  Time     Detail`);
  for (const r of results) {
    const mark = r.ok ? "PASS" : r.optional ? "WARN" : "FAIL";
    console.log(`${r.name.padEnd(w)}  ${mark.padEnd(6)}  ${`${r.ms}ms`.padEnd(7)}  ${r.detail}`);
  }
  process.exit(results.some((r) => !r.ok && !r.optional) ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
