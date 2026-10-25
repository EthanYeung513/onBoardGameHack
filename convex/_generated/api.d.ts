/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as auth from "../auth.js";
import type * as authInfo from "../authInfo.js";
import type * as brain from "../brain.js";
import type * as brainWorker from "../brainWorker.js";
import type * as crons from "../crons.js";
import type * as dashboard from "../dashboard.js";
import type * as editor from "../editor.js";
import type * as facts from "../facts.js";
import type * as hires from "../hires.js";
import type * as http from "../http.js";
import type * as ingest from "../ingest.js";
import type * as lib_access from "../lib/access.js";
import type * as lib_brainWrite from "../lib/brainWrite.js";
import type * as lib_errors from "../lib/errors.js";
import type * as lib_insights from "../lib/insights.js";
import type * as lib_partitions from "../lib/partitions.js";
import type * as lib_progress from "../lib/progress.js";
import type * as lib_reset from "../lib/reset.js";
import type * as lib_slug from "../lib/slug.js";
import type * as lib_stages from "../lib/stages.js";
import type * as lib_worker from "../lib/worker.js";
import type * as pipeline from "../pipeline.js";
import type * as rewards from "../rewards.js";
import type * as scanWorker from "../scanWorker.js";
import type * as scans from "../scans.js";
import type * as search from "../search.js";
import type * as seed from "../seed.js";
import type * as spaces from "../spaces.js";
import type * as users from "../users.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  auth: typeof auth;
  authInfo: typeof authInfo;
  brain: typeof brain;
  brainWorker: typeof brainWorker;
  crons: typeof crons;
  dashboard: typeof dashboard;
  editor: typeof editor;
  facts: typeof facts;
  hires: typeof hires;
  http: typeof http;
  ingest: typeof ingest;
  "lib/access": typeof lib_access;
  "lib/brainWrite": typeof lib_brainWrite;
  "lib/errors": typeof lib_errors;
  "lib/insights": typeof lib_insights;
  "lib/partitions": typeof lib_partitions;
  "lib/progress": typeof lib_progress;
  "lib/reset": typeof lib_reset;
  "lib/slug": typeof lib_slug;
  "lib/stages": typeof lib_stages;
  "lib/worker": typeof lib_worker;
  pipeline: typeof pipeline;
  rewards: typeof rewards;
  scanWorker: typeof scanWorker;
  scans: typeof scans;
  search: typeof search;
  seed: typeof seed;
  spaces: typeof spaces;
  users: typeof users;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
