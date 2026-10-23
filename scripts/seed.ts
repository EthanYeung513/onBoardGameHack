import path from "node:path";
import { acmePay } from "../content/acme-pay/world";
import { getDb } from "../src/db/client";
import { resetDb, seedWorld } from "../src/db/seed";

const db = await getDb();
await resetDb(db);
const result = await seedWorld(db, acmePay, path.join(process.cwd(), "content", "acme-pay"), process.env.MUBIT_MODEL || "offline-baseline");
console.log(`Seeded ${acmePay.company.name}: company ${result.companyId}, demo learner ${result.learnerId}`);
process.exit(0);
