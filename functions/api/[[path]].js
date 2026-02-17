/**
 * Cloudflare Pages Function — catches all /api/* requests and proxies them
 * to the TCL (Sytral) API, injecting the API key server-side.
 */
export async function onRequest(context) {
  const url = new URL(context.request.url)

  // Rewrite /api/... → /InstantCore/v3/...
  const upstream = url.pathname.replace(/^\/api/, '/InstantCore/v3')
  const target = new URL(upstream, 'https://sytral.api.instant-system.com')
  target.search = url.search

  // Forward the request to the upstream API
  const headers = new Headers(context.request.headers)
  headers.set('X-API-Key', 'e87bb053f0732c493db02eb4d0848cb6')
  headers.delete('host')

  const response = await fetch(target.toString(), {
    method: context.request.method,
    headers,
  })

  // Return the response with CORS headers so the browser accepts it
  const body = await response.arrayBuffer()
  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers: {
      'Content-Type': response.headers.get('Content-Type') || 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'no-cache',
    },
  })
}
