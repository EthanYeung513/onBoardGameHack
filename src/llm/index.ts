import { offlinePersona } from "@/data/personas";
import { offlineGenerate } from "@/tasks/offline-generate";
import { offlineGrade } from "@/tasks/offline-grade";
import { mubitConfigFromEnv } from "./env";
import { MubitClient } from "./mubit";
import { OfflineClient } from "./offline";
import type { LlmClient } from "./types";

let client: LlmClient | undefined;

/** Mubit when MUBIT_API_KEY is set, otherwise the offline rule-based client. */
export function getLlm(): LlmClient {
  if (!client) {
    const config = mubitConfigFromEnv();
    client = config ? new MubitClient(config) : new OfflineClient({ grade: offlineGrade, generate: offlineGenerate, persona: offlinePersona });
  }
  return client;
}

export function setLlm(llm: LlmClient | undefined): void {
  client = llm;
}
