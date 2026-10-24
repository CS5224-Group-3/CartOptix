/**
 * Polite HTTP for the retailers whose pages render on the server. Retries
 * transient failures; a 404 or 410 is an answer (the page is gone), anything
 * else that keeps failing is a collection failure and throws.
 */
export const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36";
const ATTEMPTS = 3;
const PAUSE_MS = 400;

export const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function fetchText(url: string): Promise<string | null> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= ATTEMPTS; attempt += 1) {
    await pause(PAUSE_MS * attempt);
    try {
      const response = await fetch(url, {
        headers: { "user-agent": USER_AGENT, "accept-language": "en-SG,en;q=0.9" },
        signal: AbortSignal.timeout(30_000),
      });
      if (response.status === 404 || response.status === 410) return null;
      if (response.ok) return await response.text();
      lastError = new Error(`HTTP ${response.status} for ${url}`);
    } catch (error) {
      lastError = error;
    }
  }
  throw new Error(`Could not fetch ${url}: ${String(lastError)}`);
}

/** The JSON object or array that starts at `start`, honouring strings and escapes. */
export function jsonAt(text: string, start: number): string {
  let depth = 0;
  let inString = false;
  for (let i = start; i < text.length; i += 1) {
    const char = text[i];
    if (inString) {
      if (char === "\\") i += 1;
      else if (char === '"') inString = false;
    } else if (char === '"') inString = true;
    else if (char === "{" || char === "[") depth += 1;
    else if (char === "}" || char === "]") {
      depth -= 1;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  throw new Error("Unbalanced JSON");
}
