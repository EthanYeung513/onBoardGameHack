import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// Stall detection within 60 s (PRD success metrics): silent running jobs become `stalled`.
crons.interval("pipeline watchdog", { seconds: 20 }, internal.pipeline.watchdog, {});

// F34: ready connectors re-sync after their interval (15 min default; the website re-scans daily).
crons.interval("connector sync scheduler", { minutes: 1 }, internal.connectors.scheduleSyncs, {});

export default crons;
