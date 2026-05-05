/**
 * Goal-Oriented Link Scorer
 * ==========================
 * Uses an LLM to score discovered links based on how relevant
 * they are to the user's stated crawl goal. This replaces blind
 * BFS with intelligent, priority-based link traversal.
 */

import { aiComplete, isAIAvailable } from "./provider.js";
import { logger } from "../lib/logger.js";

export interface ScoredLink {
  url: string;
  title: string;
  score: number;       // 0.0 (irrelevant) to 1.0 (highly relevant)
  reasoning: string;   // Why the AI scored it this way
}

/**
 * Scores a batch of links based on how relevant they are to the user's goal.
 * Returns the same links sorted by relevance score (highest first).
 *
 * If no AI provider is available, returns all links with a neutral score of 0.5.
 */
export async function scoreLinks(
  links: { url: string; title: string }[],
  goal: string,
  pageContext?: string
): Promise<ScoredLink[]> {
  if (!isAIAvailable()) {
    logger.warn("Goal scoring skipped — no AI provider configured");
    return links.map((l) => ({ ...l, score: 0.5, reasoning: "No AI provider" }));
  }

  if (links.length === 0) return [];

  // Batch links into groups of 20 to avoid token limits
  const batchSize = 20;
  const allScored: ScoredLink[] = [];

  for (let i = 0; i < links.length; i += batchSize) {
    const batch = links.slice(i, i + batchSize);

    const linkList = batch
      .map((l, idx) => `${idx + 1}. URL: ${l.url} | Title: "${l.title}"`)
      .join("\n");

    try {
      const result = await aiComplete({
        systemPrompt: `You are a web crawl strategist. Your job is to evaluate which links are most likely to contain content relevant to the user's goal. Score each link 0.0 to 1.0 based on URL patterns, title keywords, and your understanding of typical website structures.

Rules:
- Score 0.8-1.0: Very likely to contain goal-relevant content
- Score 0.5-0.7: Might contain relevant content
- Score 0.2-0.4: Unlikely to be relevant
- Score 0.0-0.1: Definitely irrelevant (login pages, terms of service, cookie policies, social media links)
- Always deprioritize: /login, /signup, /privacy, /terms, /cookie, /careers, /jobs, social media share links`,

        prompt: `GOAL: "${goal}"

${pageContext ? `CURRENT PAGE CONTEXT: ${pageContext.slice(0, 500)}\n` : ""}
LINKS TO SCORE:
${linkList}

Return a JSON array where each element has:
- "index": the 1-based link number
- "score": float 0.0-1.0
- "reasoning": brief 1-sentence explanation

Example: [{"index": 1, "score": 0.9, "reasoning": "URL pattern suggests API documentation"}]`,
        jsonMode: true,
        temperature: 0.1,
        maxTokens: 2048,
      });

      try {
        const scores: Array<{ index: number; score: number; reasoning: string }> =
          JSON.parse(result.text);

        // Handle both array and object-with-array responses
        const scoreArray = Array.isArray(scores) ? scores : (scores as any).links || (scores as any).results || [];

        for (const s of scoreArray) {
          const linkIdx = s.index - 1;
          if (linkIdx >= 0 && linkIdx < batch.length) {
            allScored.push({
              url: batch[linkIdx].url,
              title: batch[linkIdx].title,
              score: Math.max(0, Math.min(1, s.score)),
              reasoning: s.reasoning || "",
            });
          }
        }

        // Add any links that weren't scored (LLM missed them)
        for (let j = 0; j < batch.length; j++) {
          if (!allScored.some((s) => s.url === batch[j].url)) {
            allScored.push({
              url: batch[j].url,
              title: batch[j].title,
              score: 0.5,
              reasoning: "Not scored by AI — assigned neutral score",
            });
          }
        }
      } catch {
        logger.warn("Failed to parse AI link scores — using neutral scores");
        for (const link of batch) {
          allScored.push({ ...link, score: 0.5, reasoning: "Parse error — neutral score" });
        }
      }
    } catch (err: any) {
      logger.error({ err: err.message }, "AI link scoring failed");
      for (const link of batch) {
        allScored.push({ ...link, score: 0.5, reasoning: "AI error — neutral score" });
      }
    }
  }

  // Sort by score descending
  allScored.sort((a, b) => b.score - a.score);

  logger.info(
    {
      goal,
      total: allScored.length,
      highRelevance: allScored.filter((l) => l.score >= 0.7).length,
      lowRelevance: allScored.filter((l) => l.score < 0.3).length,
    },
    "Link scoring complete"
  );

  return allScored;
}

/**
 * Filters out links below a minimum relevance threshold.
 */
export function filterByRelevance(
  scored: ScoredLink[],
  minScore: number = 0.3
): ScoredLink[] {
  return scored.filter((l) => l.score >= minScore);
}
