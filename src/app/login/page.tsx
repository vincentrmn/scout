"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const [password, setPassword] = useState("");
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  async function submit() {
    setLoading(true);
    setErr("");
    const res = await fetch("/api/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password }),
    });
    setLoading(false);
    if (res.ok) router.push("/");
    else setErr("Mot de passe incorrect.");
  }

  return (
    <div className="center-screen">
      <div className="card login-card">
        <div className="brand" style={{ marginBottom: 18 }}>
          <span className="dot" />
          <h2>BBInvest</h2>
        </div>
        <p className="muted" style={{ marginTop: 0, marginBottom: 18 }}>
          Recherche &amp; scoring achat-revente atHome.
        </p>
        <label>Mot de passe</label>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          autoFocus
        />
        {err && <div className="error">{err}</div>}
        <button className="btn clay" style={{ width: "100%", marginTop: 16, justifyContent: "center" }} onClick={submit} disabled={loading}>
          {loading ? "..." : "Entrer"}
        </button>
      </div>
    </div>
  );
}
