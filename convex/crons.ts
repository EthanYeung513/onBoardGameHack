import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// Stall detection within 60 s (PRD success metrics): silent running jobs become `stalled`.
crons.interval("pipeline watchdog", { seconds: 20 }, internal.pipeline.watchdog, {});

export default crons;
