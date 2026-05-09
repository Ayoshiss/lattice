/**
 * GET /api/compliance/disclosure
 *
 * Returns Lattice's machine-readable VARA 2026 risk disclosure statement,
 * as required by VARA Virtual Asset Issuance Guidance § 4.3.
 *
 * The response is a JSON document suitable for:
 *   - Regulatory filing with VARA
 *   - Display in the Lattice compliance UI
 *   - Third-party risk-screening integrations
 */
import type { NextApiRequest, NextApiResponse } from "next";

export interface RiskFactor {
  id:          string;
  severity:    "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  description: string;
  mitigation:  string;
}

export interface ComplianceDisclosure {
  protocol:                string;
  version:                 string;
  programId:               string;
  network:                 string;
  riskDisclosureVersion:   string;
  lastUpdated:             string;
  riskFactors:             RiskFactor[];
  regulatoryStatus:        Record<string, string>;
  varaCompliance:          {
    ruleBookVersion:       string;
    classificationBasis:   string;
    nonCustodial:          boolean;
    marketAbuseControls:   string[];
    amlMitigations:        string[];
    upgradeAuthorityRisk:  string;
    auditStatus:           string;
    corporatePathway:      string;
  };
  aiAgentDisclosure:       {
    enabled:               boolean;
    model:                 string;
    paymentProtocol:       string;
    orderFragmentation:    string;
    humanOversight:        boolean;
    auditTrail:            boolean;
  };
  contactForCompliance:    string;
  legalDisclaimer:         string;
}

const DISCLOSURE: ComplianceDisclosure = {
  protocol:              "Lattice",
  version:               "2.0.0",
  programId:             "AW8zeS7iHmeAU5NUd2a57Uh9qzCUoshWV19oB1v8F6iV",
  network:               "solana-devnet",
  riskDisclosureVersion: "2026-05",
  lastUpdated:           new Date().toISOString().split("T")[0],

  riskFactors: [
    {
      id:          "SMART_CONTRACT_RISK",
      severity:    "HIGH",
      description: "Smart contract code has not been independently audited. Bugs may result in temporary lock of funds.",
      mitigation:  "Protocol is on devnet only. Pre-mainnet audit by Sec3/OShield required.",
    },
    {
      id:          "UPGRADE_AUTHORITY_RISK",
      severity:    "MEDIUM",
      description: "Program upgrade authority is held by the deployer keypair.",
      mitigation:  "Transfer to Squads Protocol multisig + 7-day timelock before mainnet deployment.",
    },
    {
      id:          "LIQUIDITY_RISK",
      severity:    "MEDIUM",
      description: "Batch auctions may fail to cross (NoCross error) if insufficient opposing orders exist in the same batch window.",
      mitigation:  "Unfilled orders are automatically refunded by the Settle instruction via SPL Token CPI. No user action required.",
    },
    {
      id:          "TIMING_RISK",
      severity:    "LOW",
      description: "Orders committed but not revealed within the reveal window will be slashed and excluded from clearing.",
      mitigation:  "Automated reveal bots (keepers) can submit reveals on behalf of users. Users retain their tokens minus the 0.001 SOL slash penalty.",
    },
    {
      id:          "ORACLE_DEPENDENCY",
      severity:    "LOW",
      description: "Clearing price is derived purely from submitted orders — no external oracle dependency.",
      mitigation:  "N/A — oracle-free Walrasian clearing by design.",
    },
    {
      id:          "REGULATORY_RISK",
      severity:    "MEDIUM",
      description: "DeFi regulatory landscape is evolving globally. Non-custodial exemption may not apply in all jurisdictions.",
      mitigation:  "Front-end operators must obtain jurisdiction-specific legal opinion. US user access blocked.",
    },
    {
      id:          "AI_AGENT_RISK",
      severity:    "LOW",
      description: "Autonomous TWAP fragmentation agent acts on behalf of users using LLM-based order sizing.",
      mitigation:  "Agent operates within user-specified parameters (amount, limit price, time horizon). Fully auditable on-chain.",
    },
  ],

  regulatoryStatus: {
    uae_vara:    "Protocol likely exempt (non-custodial); front-end operator may require VASP notification under VARA Rulebook V2.0",
    eu_mica:     "Monitoring — DeFi carve-out under MiCA Article 4(3); EC DeFi report expected",
    singapore:   "Exempt under MAS PS Act if no Singapore users are actively solicited",
    uk:          "Non-custodial DEXs under FCA review — legal opinion recommended pre-launch",
    usa:         "HIGH RISK — US user access restricted pending SEC/CFTC regulatory clarity",
  },

  varaCompliance: {
    ruleBookVersion:     "VARA Rulebook V2.0 (January 2026)",
    classificationBasis: "Non-custodial autonomous smart contract protocol — DeFi carve-out pathway",
    nonCustodial:        true,
    marketAbuseControls: [
      "SHA-256 commit-reveal: order parameters sealed until after commit window closes",
      "Walrasian uniform clearing price: all matched orders fill at identical p*",
      "SlashUnrevealed: 0.001 SOL penalty for unrevealed orders (anti-spoofing)",
      "Jito private relay: transactions bypass public mempool (zero pre-execution visibility)",
      "Batch window: intra-block manipulation impossible within a discrete batch",
    ],
    amlMitigations: [
      "All settled orders publicly attributable via RevealIntent transaction on-chain",
      "ClearBatch emits clearing price and matched volume in program logs",
      "Front-end operator recommended to integrate Chainalysis / TRM Labs screening",
      "No anonymous fiat on/off ramp — purely on-chain token-to-token",
    ],
    upgradeAuthorityRisk:  "MEDIUM — upgrade authority held by deployer. Recommend multisig + timelock pre-mainnet.",
    auditStatus:           "Pre-audit (hackathon prototype). Independent audit required before mainnet.",
    corporatePathway:      "DMCC Crypto Centre incorporation → VARA Preliminary Approval → Full Operating License (estimated 6–8 months)",
  },

  aiAgentDisclosure: {
    enabled:            true,
    model:              "Anthropic Claude Haiku (via claude-haiku-4-5)",
    paymentProtocol:    "x402 HTTP-native payment standard (Linux Foundation, Coinbase-originated)",
    orderFragmentation: "TWAP (Time-Weighted Average Price) with LLM-guided fragment count optimisation",
    humanOversight:     true,
    auditTrail:         true,
  },

  contactForCompliance: "compliance@lattice.xyz",
  legalDisclaimer:
    "This disclosure is prepared for the Frontier Hackathon 2026 NeosLegal VARA Compliance Prize and for regulatory filing purposes. It does not constitute legal advice. Lattice is experimental software deployed on Solana devnet. Obtain qualified legal counsel (recommended: NeosLegal, UAE) before any mainnet deployment or marketing to retail users.",
};

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") {
    res.setHeader("Allow", ["GET"]);
    return res.status(405).end("Method Not Allowed");
  }

  // Support ?format=summary for a compact version
  if (req.query.format === "summary") {
    return res.status(200).json({
      protocol:              DISCLOSURE.protocol,
      version:               DISCLOSURE.version,
      programId:             DISCLOSURE.programId,
      network:               DISCLOSURE.network,
      lastUpdated:           DISCLOSURE.lastUpdated,
      nonCustodial:          DISCLOSURE.varaCompliance.nonCustodial,
      auditStatus:           DISCLOSURE.varaCompliance.auditStatus,
      ruleBookVersion:       DISCLOSURE.varaCompliance.ruleBookVersion,
      highestRiskSeverity:   "HIGH",
      riskFactorCount:       DISCLOSURE.riskFactors.length,
      regulatoryStatusCount: Object.keys(DISCLOSURE.regulatoryStatus).length,
    });
  }

  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "s-maxage=3600, stale-while-revalidate");
  res.status(200).json(DISCLOSURE);
}
