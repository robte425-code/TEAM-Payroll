export { default } from "next-auth/middleware";

export const config = {
  matcher: ["/", "/index.html", "/rates.html", "/api/employees/:path*"],
};

