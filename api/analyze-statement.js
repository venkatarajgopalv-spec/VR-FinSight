// api/analyze-statement.js
//
// Vercel Serverless Function.
// Receives one financial-statement page image from the browser,
// sends it to Google Gemini using a server-side secret (GEMINI_API_KEY),
// and returns the extracted JSON back to the browser.
//
// NEVER hardcode the API key here.
// Set GEMINI_API_KEY in Vercel Environment Variables.

var VISION_MODEL = "gemini-2.5-flash";

var EXTRACTION_PROMPT = [
  "You are a meticulous financial data transcription assistant. You will be shown ONE PAGE of a",
  "company's financial statement (Profit & Loss / Income Statement, Balance Sheet, or Cash Flow Statement).",
  "",
  "Your ONLY job is to transcribe values that are explicitly and legibly printed on this page.",
  "You must NEVER estimate, infer, calculate, average, or guess a value that is not directly printed",
  "on the page. If a figure is unclear, cropped, blurry, covered, or simply not present on this page,",
  "its value MUST be null. Do not pull a number from memory or assume it matches a different page.",
  "",
  "Respond with STRICT JSON ONLY — no markdown fences, no commentary, no explanation before or after —",
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
  "currencyHint: the currency printed, e.g. \"INR\", \"₹\", \"USD\", \"$\".",
  "",
  "Rules:",
  "- Numbers must be plain numbers only (no currency symbols, no commas, no \"Cr\"/\"Lakh\"/\"Mn\" text).",
  "  Convert to the base unit using the multiplier actually printed on the statement",
  "  (e.g. figures stated in \"₹ Lakhs\" × 100000, \"₹ Crores\" × 10000000, \"$ millions\" × 1000000).",
  "  If the unit is ambiguous, transcribe the number as printed and do not guess the multiplier.",
  "- If a line item is not present on this specific page, its value is null.",
  "- Do not compute subtotals yourself.",
  "- Only use figures printed as a distinct line.",
  "- Negative values (losses) should be negative numbers.",
  "- Return ONLY the JSON object, nothing else."
].join("\n");

var ALLOWED_MIME = /^image\/(png|jpe?g|webp|gif)$/i;
var MAX_BASE64_LENGTH = 15000000;

module.exports = async function handler(req, res) {

  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  // OPTIONS request
  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }

  // Only POST allowed
  if (req.method !== "POST") {
    res.status(405).json({
      error: "Method not allowed. Use POST."
    });
    return;
  }

  // Gemini API key from Vercel environment variable
  var apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    res.status(500).json({
      error: "Server is not configured: GEMINI_API_KEY is missing."
    });
    return;
  }

  var body = req.body;

  if (typeof body === "string") {
    try {
      body = JSON.parse(body);
    } catch (e) {
      body = {};
    }
  }

  body = body || {};

  var base64Data = body.base64;
  var mimeType = body.mimeType || "image/png";

  // Validate image data
  if (!base64Data || typeof base64Data !== "string") {
    res.status(400).json({
      error: "Missing image data."
    });
    return;
  }

  // Validate MIME type
  if (!ALLOWED_MIME.test(mimeType)) {
    res.status(400).json({
      error: "Unsupported image type: " + mimeType
    });
    return;
  }

  // Validate image size
  if (base64Data.length > MAX_BASE64_LENGTH) {
    res.status(413).json({
      error: "Image is too large."
    });
    return;
  }

  try {

    // Call Google Gemini API
    var geminiResp = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/models/" +
      VISION_MODEL +
      ":generateContent?key=" +
      encodeURIComponent(apiKey),
      {
        method: "POST",

        headers: {
          "Content-Type": "application/json"
        },

        body: JSON.stringify({
          contents: [
            {
              parts: [
                {
                  inline_data: {
                    mime_type: mimeType,
                    data: base64Data
                  }
                },
                {
                  text: EXTRACTION_PROMPT
                }
              ]
            }
          ],

          generationConfig: {
            temperature: 0,
            maxOutputTokens: 1500,
            responseMimeType: "application/json"
          }
        })
      }
    );

    // Gemini API error
    if (!geminiResp.ok) {

      var errText = geminiResp.statusText;

      try {
        var errJson = await geminiResp.json();

        if (
          errJson &&
          errJson.error &&
          errJson.error.message
        ) {
          errText = errJson.error.message;
        }

      } catch (e) {}

      // Never expose the API key
      res.status(geminiResp.status).json({
        error: "Gemini API error: " + errText
      });

      return;
    }

    // Parse Gemini response
    var data = await geminiResp.json();

    var textBlock = "";

    if (
      data &&
      data.candidates &&
      data.candidates.length > 0 &&
      data.candidates[0].content &&
      data.candidates[0].content.parts
    ) {

      textBlock = data.candidates[0].content.parts
        .filter(function (part) {
          return part.text;
        })
        .map(function (part) {
          return part.text;
        })
        .join("\n");
    }

    if (!textBlock) {
      res.status(502).json({
        error: "Gemini returned no extraction result for this page."
      });

      return;
    }

    // Clean possible markdown fences just in case
    var cleaned = textBlock
      .replace(/```json/gi, "")
      .replace(/```/g, "")
      .trim();

    // Extract JSON object
    var firstBrace = cleaned.indexOf("{");
    var lastBrace = cleaned.lastIndexOf("}");

    if (
      firstBrace > -1 &&
      lastBrace > firstBrace
    ) {
      cleaned = cleaned.slice(
        firstBrace,
        lastBrace + 1
      );
    }

    var parsed;

    try {
      parsed = JSON.parse(cleaned);
    } catch (e) {

      res.status(502).json({
        error: "Could not parse the Gemini extraction result for this page."
      });

      return;
    }

    // Return exactly the structure expected by index.html
    res.status(200).json(parsed);

  } catch (err) {

    res.status(500).json({
      error:
        "Extraction failed: " +
        (
          err && err.message
            ? err.message
            : "unknown error"
        )
    });

  }
};
