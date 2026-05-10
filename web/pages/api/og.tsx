import { ImageResponse } from "next/og";
import type { NextRequest } from "next/server";

export const config = { runtime: "edge" };

export default function handler(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const title = searchParams.get("title") ?? "Stop Bots from Stealing Your Trades";
  const sub   = searchParams.get("sub")   ?? "Sealed-bid batch auction DEX on Solana";

  return new ImageResponse(
    (
      <div
        style={{
          width: "1200px",
          height: "630px",
          display: "flex",
          flexDirection: "column",
          background: "#05050f",
          fontFamily: "monospace",
          position: "relative",
          overflow: "hidden",
        }}
      >
        {/* Ambient glow blobs */}
        <div style={{
          position: "absolute", top: "-160px", left: "-160px",
          width: "500px", height: "500px", borderRadius: "50%",
          background: "radial-gradient(circle, #f0b42918 0%, transparent 70%)",
        }} />
        <div style={{
          position: "absolute", bottom: "-120px", right: "-120px",
          width: "420px", height: "420px", borderRadius: "50%",
          background: "radial-gradient(circle, #00ff8812 0%, transparent 70%)",
        }} />

        {/* Border frame */}
        <div style={{
          position: "absolute", inset: "32px",
          border: "1px solid #1a1a2e",
          borderRadius: "20px",
          display: "flex",
        }} />

        {/* Content */}
        <div style={{
          position: "absolute", inset: "32px",
          display: "flex", flexDirection: "column",
          justifyContent: "space-between",
          padding: "52px 64px",
        }}>
          {/* Logo row */}
          <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
            <svg width="36" height="36" viewBox="0 0 32 32" fill="none">
              <rect x="4" y="4" width="24" height="24" rx="3"
                transform="rotate(45 16 16)" stroke="#f0b429" strokeWidth="2" opacity="0.7"/>
              <rect x="8" y="8" width="16" height="16" rx="2"
                transform="rotate(45 16 16)" stroke="#f0b429" strokeWidth="1.2" opacity="0.4"/>
              <rect x="12" y="12" width="8" height="8" rx="1.5"
                transform="rotate(45 16 16)" fill="#f0b429"/>
            </svg>
            <span style={{ color: "#f1f0f7", fontSize: "22px", fontWeight: 700, letterSpacing: "0.12em" }}>
              LATTICE
            </span>
            <div style={{
              marginLeft: "16px", fontSize: "11px", color: "#f0b429",
              border: "1px solid #f0b42944", borderRadius: "20px",
              padding: "4px 14px", letterSpacing: "0.15em", textTransform: "uppercase",
            }}>
              Frontier Hackathon 2026
            </div>
          </div>

          {/* Main headline */}
          <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
            <div style={{
              fontSize: "62px", fontWeight: 900, color: "#f1f0f7",
              lineHeight: 1.05, letterSpacing: "-0.02em", maxWidth: "900px",
            }}>
              {title}
            </div>
            <div style={{ fontSize: "22px", color: "#6b6b8a", fontFamily: "monospace" }}>
              {sub}
            </div>
          </div>

          {/* Stats row */}
          <div style={{ display: "flex", gap: "24px" }}>
            <div style={{
              background: "#ff3b5c0c", border: "1px solid #ff3b5c33",
              borderRadius: "12px", padding: "16px 24px", display: "flex", flexDirection: "column", gap: "4px",
            }}>
              <div style={{ fontSize: "11px", color: "#ff3b5c88", letterSpacing: "0.15em", textTransform: "uppercase" }}>Regular DEX</div>
              <div style={{ fontSize: "28px", fontWeight: 800, color: "#ff3b5c" }}>$99.74 stolen</div>
            </div>
            <div style={{
              display: "flex", alignItems: "center",
              fontSize: "20px", color: "#a5a5a5", fontWeight: 700,
            }}>vs</div>
            <div style={{
              background: "#00ff880a", border: "1px solid #00ff8833",
              borderRadius: "12px", padding: "16px 24px", display: "flex", flexDirection: "column", gap: "4px",
            }}>
              <div style={{ fontSize: "11px", color: "#00ff8888", letterSpacing: "0.15em", textTransform: "uppercase" }}>Lattice</div>
              <div style={{ fontSize: "28px", fontWeight: 800, color: "#00ff88" }}>$0.00 extracted</div>
            </div>
            <div style={{
              background: "#a78bfa0a", border: "1px solid #a78bfa33",
              borderRadius: "12px", padding: "16px 24px", display: "flex", flexDirection: "column", gap: "4px",
            }}>
              <div style={{ fontSize: "11px", color: "#a78bfa88", letterSpacing: "0.15em", textTransform: "uppercase" }}>You keep</div>
              <div style={{ fontSize: "28px", fontWeight: 800, color: "#a78bfa" }}>+2.97 SOL</div>
            </div>
          </div>
        </div>
      </div>
    ),
    { width: 1200, height: 630 }
  );
}
