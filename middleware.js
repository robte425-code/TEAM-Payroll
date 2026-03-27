import { withAuth } from "next-auth/middleware";
import { NextResponse } from "next/server";

const authEnabled = Boolean(
  process.env.NEXTAUTH_SECRET &&
    process.env.AZURE_AD_CLIENT_ID &&
    process.env.AZURE_AD_CLIENT_SECRET
);

function isMemberAllowedPath(pathname) {
  return pathname === "/my-leave.html" || pathname.startsWith("/api/my-leave");
}

function isAdminToken(token) {
  return token?.role === "admin";
}

const authMiddleware = withAuth(
  function middleware(req) {
    const token = req.nextauth.token;
    const path = req.nextUrl.pathname;

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
  if (!authEnabled) {
    return NextResponse.next();
  }
  return authMiddleware(req);
}

export const config = {
  matcher: [
    "/",
    "/index.html",
    "/rates.html",
    "/access.html",
    "/leave.html",
    "/my-leave.html",
    "/api/employees/:path*",
    "/api/settings",
    "/api/access",
    "/api/leave-record",
    "/api/leave-ytd",
    "/api/leave-logs",
    "/api/leave-rollback",
    "/api/my-leave",
  ],
};
