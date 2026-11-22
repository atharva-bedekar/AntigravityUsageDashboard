export interface GlossaryItem {
  key: string;
  term: string;
  definition: string;
}

export const GLOSSARY_ITEMS: GlossaryItem[] = [
  {
    key: "new_input",
    term: "New input",
    definition: "Text sent to the model that wasn't already cached. Billed at the full input price.",
  },
  {
    key: "cached_input",
    term: "Cached input",
    definition: "Earlier conversation context re-read from cache. Costs roughly 10% of the new input price.",
  },
  {
    key: "output",
    term: "Output",
    definition: "Everything the model generated, including reasoning (Thought process), tool calls, and code.",
  },
  {
    key: "cache_hit_rate",
    term: "Cache-hit rate",
    definition: "Cached input divided by (New input + Cached input). Higher means more context is reused cheaply.",
  },
  {
    key: "estimated_cost",
    term: "Estimated cost (≈)",
    definition: "Tokens multiplied by the API list price of the selected model. Not what you were charged on a subscription.",
  },
  {
    key: "subagent",
    term: "Subagent",
    definition: "A child agent run started by another agent. Its usage can be included or filtered separately on the Token Usage screen.",
  },
  {
    key: "unattributed",
    term: "Unattributed",
    definition: "Usage where no workspace or project folder was recorded in the local metadata.",
  },
  {
    key: "source",
    term: "Source",
    definition: "Which Antigravity product wrote the log: Antigravity App (APP) or Antigravity CLI (CLI).",
  },
];

export function getGlossaryItem(key: string): GlossaryItem | undefined {
  return GLOSSARY_ITEMS.find((item) => item.key === key);
}
