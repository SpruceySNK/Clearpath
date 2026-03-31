/**
 * search-worker
 *
 * Cloudflare Worker exposed via service binding to the orchestrator.
 * Acts as a web search tool for the agentic pipeline.
 *
 * MVP: returns simulated / mock search results so the orchestrator can
 * exercise its full tool-calling flow without a live search API.
 * When a real search provider is integrated, replace `simulatedSearch()`
 * with the actual API call — the request/response contract stays the same.
 */

import type {
  Env,
  SearchRequest,
  SearchResult,
  SearchResponse,
  SearchErrorResponse,
} from "./types";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Maximum number of results the caller can request. */
const MAX_LIMIT = 20;

/** Default number of results when limit is not specified. */
const DEFAULT_LIMIT = 5;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Return a JSON Response with the given status code. */
function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** Type-guard: check that the incoming body looks like a valid SearchRequest. */
function isValidRequest(body: unknown): body is SearchRequest {
  if (typeof body !== "object" || body === null) return false;
  const obj = body as Record<string, unknown>;
  if (typeof obj.query !== "string" || obj.query.trim().length === 0)
    return false;
  if (
    obj.limit !== undefined &&
    (typeof obj.limit !== "number" || obj.limit < 1)
  )
    return false;
  return true;
}

// ---------------------------------------------------------------------------
// Simulated Search (MVP stub)
// ---------------------------------------------------------------------------

/**
 * Returns mock search results seeded from the query string.
 *
 * The results are deterministic for a given query so that tests and demos
 * produce repeatable output. Replace this function with a real search
 * provider call (e.g., Brave Search, SerpAPI, Bing) when ready.
 */
function simulatedSearch(query: string, limit: number): SearchResult[] {
  const lowerQuery = query.toLowerCase();

  // -----------------------------------------------------------------------
  // Domain-agnostic mock knowledge base
  // Covers compliance, fraud, identity, and regulatory topics applicable
  // across any industry (finance, insurance, legal, etc.).
  // Replace with a real search API when ready.
  // -----------------------------------------------------------------------
  const knowledgeBase: SearchResult[] = [
    {
      title: "Anti-Money Laundering (AML) Compliance Requirements",
      url: "https://www.gov.uk/guidance/money-laundering-regulations",
      snippet:
        "All regulated entities must conduct identity verification and source-of-funds checks in line with the Money Laundering Regulations 2017 (as amended). Enhanced due diligence is required for high-risk customers.",
    },
    {
      title: "Know Your Customer (KYC) — Global Best Practices",
      url: "https://www.fatf-gafi.org/recommendations.html",
      snippet:
        "FATF recommendations require customer identification, verification of beneficial ownership, and ongoing monitoring of business relationships. Risk-based approaches should be applied proportionally.",
    },
    {
      title: "Document Fraud Detection — Common Indicators",
      url: "https://www.cifas.org.uk/insight/reports/fraud-trends",
      snippet:
        "Application fraud accounts for a significant share of reported fraud in the UK. Common indicators include income misrepresentation, forged supporting documents, undisclosed liabilities, and identity fraud.",
    },
    {
      title: "FCA Handbook — Treating Customers Fairly (TCF)",
      url: "https://www.fca.org.uk/firms/treating-customers-fairly",
      snippet:
        "Regulated firms must demonstrate that they deliver fair outcomes for consumers. Products and services must be designed to meet the needs of identified customer groups and targeted accordingly.",
    },
    {
      title: "UK Data Protection and GDPR Compliance",
      url: "https://ico.org.uk/for-organisations/guide-to-data-protection/",
      snippet:
        "Organisations processing personal data must comply with UK GDPR principles: lawfulness, fairness, transparency, purpose limitation, data minimisation, accuracy, storage limitation, integrity, and accountability.",
    },
    {
      title: "Risk Assessment Frameworks for Regulated Industries",
      url: "https://www.iso.org/iso-31000-risk-management.html",
      snippet:
        "ISO 31000 provides guidelines for risk management applicable to any organisation. Risk assessments should identify, analyse, and evaluate risks with appropriate treatment plans and ongoing monitoring.",
    },
    {
      title: "Insurance Claims Processing — Regulatory Requirements",
      url: "https://www.abi.org.uk/products-and-issues/claiming-on-your-insurance/",
      snippet:
        "Insurers must handle claims fairly, promptly, and transparently. The FCA requires clear communication of decisions, timely settlement of valid claims, and fair treatment of vulnerable customers.",
    },
    {
      title: "Financial Affordability Assessment Guidelines",
      url: "https://www.fca.org.uk/publications/guidance/affordability-assessment",
      snippet:
        "Lenders and credit providers must conduct thorough affordability assessments including income verification, expenditure analysis, and stress testing against adverse scenarios before approving applications.",
    },
    {
      title: "Environmental, Social, and Governance (ESG) Due Diligence",
      url: "https://www.greenfinanceinstitute.co.uk/programmes/",
      snippet:
        "Regulated firms are increasingly required to assess ESG risks as part of their underwriting and investment processes. Environmental risk disclosures may become mandatory across multiple sectors.",
    },
    {
      title: "Sanctions Screening and Politically Exposed Persons (PEP) Checks",
      url: "https://www.gov.uk/government/publications/financial-sanctions",
      snippet:
        "All regulated entities must screen customers against UK, EU, and UN sanctions lists. Enhanced due diligence is required for PEPs and their associates, including ongoing monitoring of transactions.",
    },
  ];

  // -----------------------------------------------------------------------
  // Simple keyword relevance scoring
  // -----------------------------------------------------------------------
  const queryTerms = lowerQuery.split(/\s+/).filter((t) => t.length > 2); // ignore very short words

  const scored = knowledgeBase.map((result) => {
    const haystack = `${result.title} ${result.snippet}`.toLowerCase();
    let score = 0;
    for (const term of queryTerms) {
      if (haystack.includes(term)) score += 1;
    }
    return { result, score };
  });

  // Sort by relevance then take the top `limit` results
  scored.sort((a, b) => b.score - a.score);

  // Always return at least one result so the orchestrator has something to work with
  return scored.slice(0, limit).map((s) => s.result);
}

// ---------------------------------------------------------------------------
// Fetch Handler
// ---------------------------------------------------------------------------

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // -----------------------------------------------------------------------
    // Only POST is accepted
    // -----------------------------------------------------------------------
    if (request.method !== "POST") {
      return jsonResponse(
        {
          error: "Method not allowed. Use POST.",
        } satisfies SearchErrorResponse,
        405,
      );
    }

    // -----------------------------------------------------------------------
    // Parse & validate body
    // -----------------------------------------------------------------------
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return jsonResponse(
        { error: "Invalid JSON body." } satisfies SearchErrorResponse,
        400,
      );
    }

    if (!isValidRequest(body)) {
      return jsonResponse(
        {
          error:
            "Invalid request. Expected { query: string, limit?: number (>= 1) }.",
        } satisfies SearchErrorResponse,
        400,
      );
    }

    const { query } = body;
    const limit = Math.min(body.limit ?? DEFAULT_LIMIT, MAX_LIMIT);

    // -----------------------------------------------------------------------
    // Perform search
    // -----------------------------------------------------------------------
    try {
      // MVP: simulated results. Replace with real API call when ready:
      //
      // const results = await realSearchApi(query, limit, env.SEARCH_API_KEY);
      //
      const results = simulatedSearch(query, limit);

      const response: SearchResponse = { results };
      return jsonResponse(response, 200);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[search-worker] Search failed:", message);
      return jsonResponse(
        { error: `Search failed: ${message}` } satisfies SearchErrorResponse,
        502,
      );
    }
  },
} satisfies ExportedHandler<Env>;
