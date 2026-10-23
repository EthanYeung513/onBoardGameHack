export interface Chunk {
  ord: number;
  heading: string;
  text: string;
}

/** Splits a markdown doc into one chunk per `## ` section. Text before the first section is the intro chunk. */
export function chunkMarkdown(markdown: string): Chunk[] {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const chunks: Chunk[] = [];
  let heading = "Introduction";
  let body: string[] = [];

  const flush = () => {
    const text = body.join("\n").trim();
    if (text) chunks.push({ ord: chunks.length, heading, text });
    body = [];
  };

  for (const line of lines) {
    if (line.startsWith("## ")) {
      flush();
      heading = line.slice(3).trim();
    } else if (!line.startsWith("# ")) {
      body.push(line);
    }
  }
  flush();
  return chunks;
}

/** The doc title from its first `# ` heading, or a fallback. */
export function markdownTitle(markdown: string, fallback: string): string {
  const match = markdown.match(/^# (.+)$/m);
  return match ? match[1].trim() : fallback;
}
