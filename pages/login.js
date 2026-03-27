import { signIn } from "next-auth/react";
import { useState } from "react";
import { useRouter } from "next/router";

export default function LoginPage() {
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const error = router.query.error;
  const callbackUrl = router.query.callbackUrl || "/";

  function handleSignIn() {
    setLoading(true);
    signIn("azure-ad", { callbackUrl });
  }

  return (
    <main
      style={{
        minHeight: "100vh",
        display: "grid",
        placeItems: "center",
        padding: 16,
        fontFamily: "Inter, system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
      }}
    >
      <section
        style={{
          width: "100%",
          maxWidth: 420,
          border: "1px solid #e7e5e4",
          borderRadius: 16,
          padding: 24,
          boxShadow: "0 2px 10px rgba(0,0,0,0.04)",
          background: "#fff",
        }}
      >
        <h1 style={{ margin: 0, fontSize: 24 }}>Sign in</h1>
        <p style={{ color: "#57534e", marginTop: 8 }}>
          Use your Microsoft 365 account to access TEAM Payroll.
        </p>
        {error === "AccessDenied" ? (
          <p style={{ color: "#b45309", background: "#fffbeb", padding: 10, borderRadius: 8 }}>
            Your email domain is not allowed for this app.
          </p>
        ) : null}
        <button
          onClick={handleSignIn}
          disabled={loading}
          style={{
            width: "100%",
            marginTop: 12,
            background: "#2f2f2f",
            color: "#fff",
            border: 0,
            borderRadius: 10,
            padding: "12px 16px",
            fontWeight: 600,
            cursor: "pointer",
            opacity: loading ? 0.65 : 1,
          }}
        >
          {loading ? "Signing in..." : "Sign in with Microsoft"}
        </button>
        <button
          type="button"
          onClick={() => {
            setLoading(true);
            signIn("azure-ad", { callbackUrl: "/my-leave.html" });
          }}
          disabled={loading}
          style={{
            width: "100%",
            marginTop: 10,
            background: "#fafaf9",
            color: "#292524",
            border: "1px solid #e7e5e4",
            borderRadius: 10,
            padding: "12px 16px",
            fontWeight: 600,
            cursor: "pointer",
            opacity: loading ? 0.65 : 1,
          }}
        >
          Check my balances
        </button>
      </section>
    </main>
  );
}

