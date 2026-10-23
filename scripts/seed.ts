// Wipes and re-seeds the local database directly. Stop `npm run dev` first (PGlite is single-process),
// or use `npm run demo:reset`, which goes through the running app.
import { acmePay } from "../content/acme-pay/world";
import { closeDb, getDb } from "../src/db/client";
import { resetDemo } from "../src/services/demo";

const result = await resetDemo(await getDb());
console.log(`Seeded ${acmePay.company.name}: company ${result.companyId}, demo learner ${result.learnerId}`);
await closeDb();
process.exit(0);
