import { withAuth } from "next-auth/middleware";
import { NextResponse } from "next/server";

const authEnabled = Boolean(
  process.env.NEXTAUTH_SECRET &&
    process.env.AZURE_AD_CLIENT_ID &&
    process.env.AZURE_AD_CLIENT_SECRET
);

const authMiddleware = withAuth({
  pages: {
    signIn: "/login",
  },
});

export default function middleware(req) {
  if (!authEnabled) {
    return NextResponse.next();
  }
  return authMiddleware(req);
}

export const config = {
  matcher: ["/", "/index.html", "/rates.html", "/api/employees/:path*"],
};

