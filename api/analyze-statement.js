// api/analyze-statement.js
//
// Vercel Serverless Function. Receives one financial-statement PAGE image from the browser,
// sends it to Anthropic's API using a server-side secret (ANTHROPIC_API_KEY), and returns the
// extracted JSON back to the browser.
//
// The API key lives only in this file's process.env — it is never sent to, stored by, or
// visible from the browser. Set ANTHROPIC_API_KEY in your Vercel project's Environment
// Variables (Project Settings -> Environment Variables). Do not hardcode it here.

var VISION_MODEL = "claude-sonnet-5";

var EXTRACTION_PROMPT = [
  "You are a meticulous financial data transcription assistant. You will be shown ONE PAGE of a",
  "company's financial statement (Profit & Loss / Income Statement, Balance Sheet, or Cash Flow Statement).",
  "",
  "Your ONLY job is to transcribe values that are explicitly and legibly printed on this page.",
  "You must NEVER estimate, infer, calculate, average, or guess a value that is not directly printed",
  "on the page. If a figure is unclear, cropped, blurry, covered, or simply not present on this page,",
  "its value MUST be null. Do not pull a number from memory or assume it matches a different page.",
  "",
  "Respond with STRICT JSON ONLY \u2014 no markdown fences, no commentary, no explanation before or after \u2014",
  "in exactly this shape:",
  "{",
  '  "statementType": "profit_loss" | "balance_sheet" | "cash_flow" | "other",',
  '  "financialYear": string or null,',
  '  "currencyHint": string or null,',
  '  "fields": {',
  '    "revenue": number or null, "cogs": number or null, "operatingExpenses": number or null,',
  '    "interestExpense": number or null, "taxExpense": number or null,',
  '    "grossProfit": number or null, "operatingProfit": number or null, "netProfit": number or null,',
  '    "cash": number or null, "receivables": number or null, "inventory": number or null,',
  '    "otherCurrentAssets": number or null, "totalCurrentAssets": number or null,',
  '    "ppe": number or null, "otherNonCurrentAssets": number or null, "totalAssets": number or null,',
  '    "payables": number or null, "shortTermBorrowings": number or null, "otherCurrentLiabilities": number or null,',
  '    "totalCurrentLiabilities": number or null, "longTermDebt": number or null, "preferenceCapital": number or null,',
  '    "equityCapital": number or null, "reserves": number or null, "shareholdersEquity": number or null,',
  '    "totalDebt": number or null',
  "  }",
  "}",
  "",
  "financialYear: the period/year label exactly as printed, e.g. \"FY 2023-24\" or \"Year ended 31 March 2024\".",
  "currencyHint: the currency printed, e.g. \"INR\", \"\u20b9\", \"USD\", \"$\".",
  "",
  "Rules:",
  "- Numbers must be plain numbers only (no currency symbols, no commas, no \"Cr\"/\"Lakh\"/\"Mn\" text).",
  "  Convert to the base unit using the multiplier actually printed on the statement",
  "  (e.g. figures stated in \"\u20b9 Lakhs\" \u00d7 100000, \"\u20b9 Crores\" \u00d7 10000000, \"$ millions\" \u00d7 1000000).",
  "  If the unit is ambiguous, transcribe the number as printed and do not guess the multiplier.",
  "- If a line item is not present on this specific page, its value is null.",
  "- Do not compute subtotals yourself (e.g. do not add individual expense lines to invent",
  "  \"operatingExpenses\" if it is not printed as a single line) \u2014 only use figures printed as a distinct line.",
  "- Negative values (losses) should be negative numbers.",
  "- Return ONLY the JSON object, nothing else."
].join("\n");

var ALLOWED_MIME = /^image\/(png|jpe?g|webp|gif)$/i;
var MAX_BASE64_LENGTH = 15000000; // ~11MB of raw image data, generous for a single statement page

module.exports = async function handler(req, res) {
  // Basic CORS support so this endpoint can also be called from a frontend hosted on a
  // different domain (e.g. if index.html stays on GitHub Pages while this function lives on
  // Vercel). If you deploy the whole site on Vercel, requests are same-origin and this is
  // just a harmless no-op. Once everything is working, consider replacing "*" with your exact
  // site origin (e.g. "https://your-username.github.io") to reduce abuse from other sites.
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed. Use POST." });
    return;
  }

  var apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: "Server is not configured: ANTHROPIC_API_KEY is missing." });
    return;
  }

  var body = req.body;
  if (typeof body === "string") {
    try { body = JSON.parse(body); } catch (e) { body = {}; }
  }
  body = body || {};

  var base64Data = body.base64;
  var mimeType = body.mimeType || "image/png";

  if (!base64Data || typeof base64Data !== "string") {
    res.status(400).json({ error: "Missing image data." });
    return;
  }
  if (!ALLOWED_MIME.test(mimeType)) {
    res.status(400).json({ error: "Unsupported image type: " + mimeType });
    return;
  }
  if (base64Data.length > MAX_BASE64_LENGTH) {
    res.status(413).json({ error: "Image is too large." });
    return;
  }

  try {
    var anthropicResp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model: VISION_MODEL,
        max_tokens: 1500,
        messages: [
          {
            role: "user",
            content: [
              { type: "image", source: { type: "base64", media_type: mimeType, data: base64Data } },
              { type: "text", text: EXTRACTION_PROMPT }
            ]
          }
        ]
      })
    });

    if (!anthropicResp.ok) {
      var errText = anthropicResp.statusText;
      try {
        var errJson = await anthropicResp.json();
        if (errJson && errJson.error && errJson.error.message) errText = errJson.error.message;
      } catch (e) {}
      res.status(anthropicResp.status).json({ error: "Anthropic API error: " + errText });
      return;
    }

    var data = await anthropicResp.json();
    var textBlock = (data.content || [])
      .filter(function (c) { return c.type === "text"; })
      .map(function (c) { return c.text; })
      .join("\n");
    var cleaned = textBlock.replace(/```json/gi, "").replace(/```/g, "").trim();
    var firstBrace = cleaned.indexOf("{");
    var lastBrace = cleaned.lastIndexOf("}");
    if (firstBrace > -1 && lastBrace > firstBrace) cleaned = cleaned.slice(firstBrace, lastBrace + 1);

    var parsed;
    try {
      parsed = JSON.parse(cleaned);
    } catch (e) {
      res.status(502).json({ error: "Could not parse the extraction result for this page." });
      return;
    }

    res.status(200).json(parsed);
  } catch (err) {
    res.status(500).json({ error: "Extraction failed: " + (err && err.message ? err.message : "unknown error") });
  }
};
