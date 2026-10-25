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
import type * as crons from "../crons.js";
import type * as http from "../http.js";
import type * as ingest from "../ingest.js";
import type * as lib_access from "../lib/access.js";
import type * as lib_errors from "../lib/errors.js";
import type * as lib_slug from "../lib/slug.js";
import type * as lib_stages from "../lib/stages.js";
import type * as lib_worker from "../lib/worker.js";
import type * as pipeline from "../pipeline.js";
import type * as scans from "../scans.js";
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
  crons: typeof crons;
  http: typeof http;
  ingest: typeof ingest;
  "lib/access": typeof lib_access;
  "lib/errors": typeof lib_errors;
  "lib/slug": typeof lib_slug;
  "lib/stages": typeof lib_stages;
  "lib/worker": typeof lib_worker;
  pipeline: typeof pipeline;
  scans: typeof scans;
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
