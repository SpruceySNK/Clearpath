/**
 * Request router for the actions-worker.
 *
 * Maps HTTP method + pathname combinations to the appropriate handler.
 * Keeps routing logic separate from handler implementations for clarity.
 */

import {
  handleApprove,
  handleAuditById,
  handleAuditList,
  handleFlagFraud,
  handleHealth,
  handleHumanFeedback,
  handleHumanReview,
  handleReject,
} from "./handlers";
import type { Env } from "./types";

/**
 * Route an incoming request to the correct handler.
 *
 * Returns a Response for matched routes, or a 404/405 if no match is found.
 */
export async function routeRequest(
  request: Request,
  env: Env,
): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method.toUpperCase();

  // -------------------------------------------------------------------------
  // POST action endpoints
  // -------------------------------------------------------------------------
  if (method === "POST") {
    switch (path) {
      case "/approve":
        return handleApprove(request, env);
      case "/reject":
        return handleReject(request, env);
      case "/flag-fraud":
        return handleFlagFraud(request, env);
      case "/human-review":
        return handleHumanReview(request, env);
      case "/human-feedback":
        return handleHumanFeedback(request, env);
      default:
        return notFound(path);
    }
  }

  // -------------------------------------------------------------------------
  // GET read endpoints
  // -------------------------------------------------------------------------
  if (method === "GET") {
    // Health check
    if (path === "/health") {
      return handleHealth(env);
    }

    // Audit list: GET /audit
    if (path === "/audit") {
      return handleAuditList(request, env);
    }

    // Audit by ID: GET /audit/:id
    const auditMatch = path.match(/^\/audit\/([^/]+)$/);
    if (auditMatch) {
      const id = decodeURIComponent(auditMatch[1]);
      return handleAuditById(request, env, id);
    }

    return notFound(path);
  }

  // -------------------------------------------------------------------------
  // Method not allowed
  // -------------------------------------------------------------------------
  return new Response(
    JSON.stringify({ ok: false, error: `Method ${method} not allowed.` }),
    {
      status: 405,
      headers: {
        "Content-Type": "application/json",
        Allow: "GET, POST",
      },
    },
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function notFound(path: string): Response {
  return new Response(
    JSON.stringify({ ok: false, error: `No route matched: ${path}` }),
    {
      status: 404,
      headers: { "Content-Type": "application/json" },
    },
  );
}
