/**
 * Thin proxy: web/api/relay → localhost:7402
 * Lets the browser call the x402 relay without CORS issues.
 * Forwards PAYMENT-REQUIRED and PAYMENT-SIGNATURE headers transparently.
 */
import type { NextApiRequest, NextApiResponse } from "next";

const RELAY = process.env.RELAY_URL ?? "http://localhost:7402";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const path    = (req.query.path as string[])?.join("/") ?? "";
  const url     = `${RELAY}/${path}`;
  const method  = req.method ?? "GET";

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (req.headers["payment-signature"]) {
    headers["payment-signature"] = req.headers["payment-signature"] as string;
  }

  const upstream = await fetch(url, {
    method,
    headers,
    body: method !== "GET" ? JSON.stringify(req.body) : undefined,
  });

  // Forward all relevant headers back to the browser
  const payReq  = upstream.headers.get("payment-required");
  const payResp = upstream.headers.get("payment-response");
  if (payReq)  res.setHeader("payment-required",  payReq);
  if (payResp) res.setHeader("payment-response",   payResp);

  const data = await upstream.json().catch(() => ({}));
  // Also embed the payment envelope in the body so the browser can always read it
  // (fetch in some browser contexts can't access custom response headers)
  if (payReq)  data._paymentRequired  = payReq;
  if (payResp) data._paymentResponse  = payResp;
  res.status(upstream.status).json(data);
}

export const config = { api: { bodyParser: true } };
