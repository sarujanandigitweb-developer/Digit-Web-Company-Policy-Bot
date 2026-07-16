const DOC_URL =
  "https://drive.google.com/uc?export=download&id=1T-0vewRXsK88rz_yBN7yQdPoEJYL9wLt";

let cache: { text: string; at: number } | null = null;
const TTL_MS = 5 * 60 * 1000;

export async function fetchTranscript(): Promise<string> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.text;
  const res = await fetch(DOC_URL, { redirect: "follow" });
  if (!res.ok) throw new Error(`Failed to fetch transcript: ${res.status}`);
  const text = await res.text();
  cache = { text, at: Date.now() };
  return text;
}