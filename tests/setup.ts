import "@testing-library/jest-dom/vitest";

// Tests never call a real LLM: force the offline client and the in-memory database.
process.env.MUBIT_API_KEY = "";
process.env.DATABASE_URL = "";
