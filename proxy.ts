import { NextResponse, type NextFetchEvent, type NextRequest } from "next/server";
import { writeVisitorLog } from "./lib/visitor-log";

function isPageNavigation(request: NextRequest): boolean {
  if (request.method !== "GET") return false;

  const pathname = request.nextUrl.pathname;
  if (
    pathname === "/api" ||
    pathname.startsWith("/api/") ||
    pathname === "/_next" ||
    pathname.startsWith("/_next/") ||
    /(?:^|\/)[^/]*\.[^/]+$/.test(pathname)
  ) {
    return false;
  }

  if (request.headers.get("purpose")?.toLowerCase() === "prefetch") {
    return false;
  }

  const accept = request.headers.get("accept")?.toLowerCase() ?? "";
  return accept.includes("text/html") || accept.includes("text/x-component");
}

export function proxy(request: NextRequest, event: NextFetchEvent) {
  if (isPageNavigation(request)) {
    event.waitUntil(
      writeVisitorLog(request.headers, request.nextUrl.pathname).catch((error: unknown) => {
        console.error("Unable to write visitor access log", error);
      }),
    );
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    {
      source: "/((?!api|_next/static|_next/image|favicon.ico|sitemap.xml|robots.txt).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
