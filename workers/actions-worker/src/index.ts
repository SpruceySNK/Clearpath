/**
 * actions-worker — Cloudflare Worker entry point.
 *
 * Handles all decision actions (approve, reject, flag-fraud, human-review,
 * human-feedback) and maintains the D1 audit trail for the ClearPath
 * pipeline.
 */

import { routeRequest } from "./router";
import type { Env } from "./types";

export default {
  /**
   * Main fetch handler.
   *
   * Delegates to the router which maps the incoming request to the correct
   * handler.  A top-level try/catch ensures that unhandled errors still
   * produce a valid JSON response rather than a bare 500.
   */
  async fetch(
    request: Request,
    env: Env,
    _ctx: ExecutionContext,
  ): Promise<Response> {
    // Handle CORS preflight so the worker is callable from browser clients.
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: corsHeaders(),
      });
    }

    try {
      const response = await routeRequest(request, env);

      // Attach CORS headers to every response.
      for (const [key, value] of Object.entries(corsHeaders())) {
        response.headers.set(key, value);
      }

      return response;
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "An unexpected error occurred.";

      return new Response(JSON.stringify({ ok: false, error: message }), {
        status: 500,
        headers: {
          "Content-Type": "application/json",
          ...corsHeaders(),
        },
      });
    }
  },
} satisfies ExportedHandler<Env>;

// ---------------------------------------------------------------------------
// CORS
// ---------------------------------------------------------------------------

function corsHeaders(): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "86400",
  };
}
