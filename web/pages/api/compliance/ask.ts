/**
 * POST /api/compliance/ask
 * SSE endpoint — streams an answer to a compliance question
 * grounded in VARA_compliance.md via the configured LLM.
 */
import type { NextApiRequest, NextApiResponse } from "next";
import fs from "fs";
import path from "path";

const DOC_PATH = path.join(process.cwd(), "public", "VARA_compliance.md");

const SYSTEM_PROMPT = `You are a regulatory compliance assistant for Lattice, a non-custodial Dual-Flow Batch Auction DEX on Solana.

Your role: answer compliance questions strictly based on the provided VARA 2026 compliance document.
- Be concise, direct, and precise (under 180 words per answer)
- Reference specific VARA Rulebook V2.0 sections where relevant
- Distinguish clearly between: (a) what the smart contract provides structurally, (b) what front-end operators must do, and (c) what requires legal opinion
- Always append: "This is not legal advice — consult qualified VARA counsel."
- If the document does not cover a question, say so clearly rather than speculating
- Do NOT use markdown headers or bullet points — plain prose only`;

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).end();

  res.setHeader("Content-Type",  "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection",    "keep-alive");
  res.flushHeaders();

  const emit = (data: object) => {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
    (res as any).flush?.();
  };

  const { question = "" } = req.body ?? {};
  if (!question.trim()) {
    emit({ type: "error", message: "No question provided" });
    return res.end();
  }

  let doc = "";
  try {
    doc = fs.readFileSync(DOC_PATH, "utf8");
  } catch {
    emit({ type: "error", message: "Could not load compliance document" });
    return res.end();
  }

  const openrouterKey = process.env.OPENROUTER_API_KEY ?? "";
  const anthropicKey  = process.env.ANTHROPIC_API_KEY  ?? "";
  const model         = process.env.OPENROUTER_MODEL ?? "minimax/minimax-01";

  const userMessage = `Compliance document:\n\n${doc}\n\n---\n\nQuestion: ${question}`;

  try {
    if (openrouterKey) {
      const r = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type":  "application/json",
          "Authorization": `Bearer ${openrouterKey}`,
          "HTTP-Referer":  "https://lattice.xyz",
          "X-Title":       "Lattice Compliance Agent",
        },
        body: JSON.stringify({
          model,
          max_tokens: 300,
          stream:     true,
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            { role: "user",   content: userMessage   },
          ],
        }),
      });

      const reader  = r.body!.getReader();
      const decoder = new TextDecoder();
      let buf = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const raw = line.slice(6).trim();
          if (raw === "[DONE]") { emit({ type: "done" }); break; }
          try {
            const j    = JSON.parse(raw);
            const text = j?.choices?.[0]?.delta?.content ?? "";
            if (text) emit({ type: "chunk", text });
          } catch { /* skip */ }
        }
      }
    } else if (anthropicKey) {
      const { default: Anthropic } = await import("@anthropic-ai/sdk");
      const client = new Anthropic({ apiKey: anthropicKey });
      const stream = await client.messages.stream({
        model:      "claude-haiku-4-5",
        max_tokens: 300,
        system:     SYSTEM_PROMPT,
        messages:   [{ role: "user", content: userMessage }],
      });
      for await (const chunk of stream) {
        if (chunk.type === "content_block_delta" && chunk.delta.type === "text_delta") {
          emit({ type: "chunk", text: chunk.delta.text });
        }
      }
      emit({ type: "done" });
    } else {
      emit({ type: "chunk", text: "No LLM key configured. Please set OPENROUTER_API_KEY or ANTHROPIC_API_KEY." });
      emit({ type: "done" });
    }
  } catch (e: any) {
    emit({ type: "error", message: e.message });
  } finally {
    res.end();
  }
}

export const config = { api: { bodyParser: true, responseLimit: false } };
