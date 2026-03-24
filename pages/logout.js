import { signOut } from "next-auth/react";
import { useEffect } from "react";

export default function LogoutPage() {
  useEffect(() => {
    signOut({ callbackUrl: "/login" });
  }, []);

  return (
    <main
      style={{
        minHeight: "100vh",
        display: "grid",
        placeItems: "center",
        fontFamily: "Inter, system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
      }}
    >
      <p>Signing you out...</p>
    </main>
  );
}

