// Display names for the pipeline stages. Kept apart from the registry so client code can import it.
export const STAGE_LABELS = [
  { key: "crawl", label: "Crawl", short: "Crawl" },
  { key: "extract_design", label: "Extract design", short: "Design" },
  { key: "analyse", label: "Analyse", short: "Analyse" },
  { key: "awaiting_confirmation", label: "Review findings", short: "Review" },
  { key: "ask_questions", label: "Prepare questions", short: "Questions" },
  { key: "awaiting_answers", label: "Answer questions", short: "Answers" },
  { key: "generate_flows", label: "Generate flows", short: "Generate" },
  { key: "validate", label: "Validate", short: "Validate" },
  { key: "ready", label: "Ready", short: "Ready" },
] as const;
