import { signIn } from "next-auth/react";
import Head from "next/head";
import Image from "next/image";
import { useState } from "react";
import { useRouter } from "next/router";

export default function LoginPage() {
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const error = router.query.error;
  const callbackUrl = router.query.callbackUrl || "/";

  function handleSignIn(targetUrl) {
    setLoading(true);
    signIn("azure-ad", { callbackUrl: targetUrl });
  }

  return (
    <>
      <Head>
        <title>Sign in — TEAM Payroll</title>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap"
          rel="stylesheet"
        />
      </Head>
      <main
        style={{
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "1rem",
          fontFamily: '"Inter", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
          background: "#fafaf9",
          color: "#1c1917",
          WebkitFontSmoothing: "antialiased",
        }}
      >
        <section
          style={{
            width: "100%",
            maxWidth: "24rem",
            border: "1px solid #e7e5e4",
            borderRadius: "1rem",
            padding: "2rem",
            boxShadow: "0 1px 2px rgba(28, 25, 23, 0.05)",
            background: "#fff",
          }}
        >
          <div style={{ display: "flex", justifyContent: "center", marginBottom: "1.5rem" }}>
            <Image
              src="/assets/team-logo.png"
              alt="TEAM Vocational Services"
              width={200}
              height={72}
              style={{ height: "3.5rem", width: "auto", objectFit: "contain" }}
              priority
            />
          </div>
          <h1 style={{ margin: "0 0 0.5rem", fontSize: "1.25rem", fontWeight: 600, color: "#1c1917" }}>
            Payroll
          </h1>
          <p style={{ margin: "0 0 1.5rem", fontSize: "0.875rem", color: "#78716c", lineHeight: 1.5 }}>
            Sign in with your Microsoft 365 account (@team-voc.com) to view PTO and sick time balances.
          </p>
          {error === "AccessDenied" ? (
            <p
              style={{
                margin: "0 0 1rem",
                padding: "0.75rem",
                borderRadius: "0.5rem",
                background: "#fffbeb",
                color: "#92400e",
                fontSize: "0.875rem",
              }}
            >
              Your email domain is not allowed for this app.
            </p>
          ) : null}
          <button
            type="button"
            onClick={() => handleSignIn(callbackUrl)}
            disabled={loading}
            style={{
              width: "100%",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: "0.5rem",
              background: "#2f2f2f",
              color: "#fff",
              border: 0,
              borderRadius: "0.5rem",
              padding: "0.75rem 1rem",
              fontWeight: 500,
              fontSize: "1rem",
              cursor: loading ? "default" : "pointer",
              opacity: loading ? 0.65 : 1,
            }}
          >
            <MicrosoftIcon />
            {loading ? "Signing in…" : "Sign in with Microsoft"}
          </button>
          <button
            type="button"
            onClick={() => handleSignIn("/my-leave.html")}
            disabled={loading}
            style={{
              width: "100%",
              marginTop: "0.625rem",
              background: "transparent",
              color: "#57534e",
              border: "1px solid #e7e5e4",
              borderRadius: "0.5rem",
              padding: "0.75rem 1rem",
              fontWeight: 500,
              fontSize: "0.875rem",
              cursor: loading ? "default" : "pointer",
              opacity: loading ? 0.65 : 1,
            }}
          >
            Go to Payroll balances
          </button>
        </section>
      </main>
    </>
  );
}

function MicrosoftIcon() {
  return (
    <svg width="21" height="21" viewBox="0 0 21 21" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path d="M10.5 10.5H0V0H10.5V10.5Z" fill="#F25022" />
      <path d="M21 10.5H10.5V0H21V10.5Z" fill="#7FBA00" />
      <path d="M10.5 21H0V10.5H10.5V21Z" fill="#00A4EF" />
      <path d="M21 21H10.5V10.5H21V21Z" fill="#FFB900" />
    </svg>
  );
}
