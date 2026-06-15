// IMPORT STATEMENTS
// Here, we import the 'NextResponse' class from Next.js server helpers.
// This utility class allows us to easily construct HTTP responses (such as JSON data or error pages) to return back to the user's web browser.
import { NextResponse } from 'next/server';

// Here, we import the 'getTelemetryData' function from our telemetry engine helper located inside 'src/lib/telemetry.ts'.
// This function contains the core logic that retrieves live coordinates and timings of subway trains and processes them.
import { getTelemetryData } from '@/lib/telemetry';

// ROUTE CONFIGURATION PARAMETERS
// 'dynamic' is exported as 'force-dynamic' to instruct Next.js to never save a static, pre-rendered version of this page.
// Because train positions are constantly changing, this API endpoint must run its logic freshly on every single page load request.
export const dynamic = 'force-dynamic';

// 'revalidate' is set to 0. This tells Next.js and Vercel edge routers to immediately bypass all levels of caching.
// This guarantees that any client query directly executes the GET handler function, ensuring the client receives the newest train updates.
export const revalidate = 0;

// HTTP GET HANDLER FUNCTION
// This function handles incoming HTTP GET requests to '/api/telemetry'. It is declared as asynchronous ('async')
// because it must wait for network calls to the external GCBA transit API to finish before responding.
export async function GET() {
  try {
    // We execute our telemetry parser and wait for the result.
    // 'getTelemetryData' fetches from GCBA API, clusters predictions, hashes IDs, and returns a processed telemetry object.
    const data = await getTelemetryData();

    // If the telemetry extraction succeeds, we return the parsed data as a structured JSON response.
    // 'NextResponse.json' handles serializing our JavaScript object into a JSON string that browsers can easily parse.
    return NextResponse.json(data, {
      headers: {
        // 'Cache-Control' header instructs the browser, proxy servers, and CDN edge routers to never store this response.
        // This is critical so that the browser does not show cached (stale) train coordinates when the map updates.
        'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
        // 'Pragma' header with value 'no-cache' is included for backwards compatibility with older HTTP/1.0 clients.
        'Pragma': 'no-cache',
        // 'Expires' header set to '0' ensures that the response is treated as immediately expired by the browser's local cache.
        'Expires': '0',
      },
    });
  } catch (error: unknown) {
    // EXCEPTION / ERROR HANDLING
    // In case the telemetry fetch or parsing fails (e.g. database offline or GCBA network issue), we catch the error here.
    // We determine the error message safely, checking if the caught exception is an instance of the standard Error class.
    const errorMessage = error instanceof Error ? error.message : 'Internal Server Error';

    // We output the detailed error stack trace to our server logs for debugging and developer diagnostics.
    console.error('API Telemetry Error:', error);

    // We construct and return a JSON response containing the error message along with an HTTP Status Code of 500 (Internal Server Error).
    return NextResponse.json(
      { error: errorMessage },
      { 
        status: 500,
        headers: {
          // We include the same strict cache-control instructions in the error response to prevent caching of errors.
          'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
          'Pragma': 'no-cache',
          'Expires': '0',
        },
      }
    );
  }
}
