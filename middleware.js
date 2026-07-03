import { withAuth } from "next-auth/middleware";
import { NextResponse } from "next/server";
import { authEnabled, authMisconfiguredInProduction } from "./lib/authConfig";

const IMPERSONATE_COOKIE = "team_impersonate";

function authMisconfiguredResponse(req) {
  if (req.nextUrl.pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Authentication is not configured" }, { status: 503 });
  }
  return new NextResponse("Authentication is not configured", {
    status: 503,
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}

function isMemberAllowedPath(pathname) {
  return (
    pathname === "/my-leave.html" ||
    pathname.startsWith("/api/my-leave") ||
    pathname === "/api/impersonate" ||
    pathname === "/api/view-as-users" ||
    pathname.startsWith("/api/pay-stubs") ||
    pathname === "/api/payroll-unread"
  );
}

function isAdminToken(token) {
  return token?.role === "admin";
}

function isImpersonating(req) {
  const raw = req.cookies.get(IMPERSONATE_COOKIE)?.value;
  if (!raw) return false;
  const email = String(raw).trim().toLowerCase();
  return email.includes("@");
}

const authMiddleware = withAuth(
  function middleware(req) {
    const token = req.nextauth.token;
    const path = req.nextUrl.pathname;

    if (isImpersonating(req) && !isMemberAllowedPath(path)) {
      if (path.startsWith("/api/")) {
        return NextResponse.json({ error: "Forbidden while viewing as another user" }, { status: 403 });
      }
      return NextResponse.redirect(new URL("/my-leave.html", req.url));
    }

    if (isMemberAllowedPath(path)) {
      return NextResponse.next();
    }

    if (!isAdminToken(token)) {
      if (path.startsWith("/api/")) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
      return NextResponse.redirect(new URL("/my-leave.html", req.url));
    }

    return NextResponse.next();
  },
  {
    pages: {
      signIn: "/login",
    },
    callbacks: {
      authorized: ({ token }) => Boolean(token),
    },
  }
);

export default function middleware(req) {
  if (authMisconfiguredInProduction()) {
    return authMisconfiguredResponse(req);
  }
  if (!authEnabled) {
    return NextResponse.next();
  }
  if (req.nextUrl.pathname.startsWith("/api/internal/")) {
    return NextResponse.next();
  }
  return authMiddleware(req);
}

export const config = {
  matcher: [
    "/",
    "/index.html",
    "/payroll-data.html",
    "/rates.html",
    "/leave.html",
    "/my-leave.html",
    "/pay-stubs.html",
    "/api/employees/:path*",
    "/api/settings",
    "/api/leave-record",
    "/api/leave-ytd",
    "/api/leave-logs",
    "/api/leave-rollback",
    "/api/my-leave",
    "/api/impersonate",
    "/api/view-as-users",
    "/api/pay-stubs/:path*",
    "/api/payroll-unread",
    "/api/payroll-data",
    "/api/payroll-adj-resub",
    "/api/internal/team-access",
  ],
};
