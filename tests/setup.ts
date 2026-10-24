import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// Tests never call a real LLM: force the offline client and the in-memory database.
process.env.MUBIT_API_KEY = "";
process.env.DATABASE_URL = "";
process.env.POSTGRES_URL = "";

// Testing Library only auto-cleans when Vitest globals are on, so unmount rendered trees explicitly.
afterEach(() => cleanup());
