// api/analyze-statement.js
//
// Vercel Serverless Function for VR FinSight.
// Receives one financial-statement PAGE image from the browser,
// sends it to Google's Gemini API using the server-side secret
// GEMINI_API_KEY, and returns the extracted JSON.
//
// IMPORTANT:
// The API key is stored only in Vercel Environment Variables.
// Never put the API key in this file, GitHub, or the frontend.
//
// Vercel Environment Variable:
// GEMINI_API_KEY

var VISION_MODEL = "gemini-3.6-flash";

var EXTRACTION_PROMPT = [
  "You are a meticulous financial data transcription assistant. You will be shown ONE PAGE of a",
  "company's financial statement (Profit & Loss / Income Statement, Balance Sheet, or Cash Flow Statement).",
  "",
  "IMPORTANT: A single page can show MULTIPLE financial years side by side in separate columns",
  "(for example \"FY 2025 | FY 2024 | FY 2023\"). You must identify EVERY distinct year/period column",
  "printed on this page and report each one separately. Do not report only one year if more are shown.",
  "Do not merge, average, or blend numbers from different year columns together — each year's figures",
  "must come ONLY from that year's own column. Read each column independently.",
  "",
  "Your ONLY job is to transcribe values that are explicitly and legibly printed on this page, for each",
  "year column separately. You must NEVER estimate, infer, calculate, average, or guess a value that is",
  "not directly printed under that specific year's column. If a figure is unclear, cropped, blurry,",
  "covered, or simply not present for that year, its value MUST be null. Never fill a blank year's value",
  "using a number from a different year's column, and never pull a number from memory.",
  "",
  "Respond with STRICT JSON ONLY — no markdown fences, no commentary, no explanation before or after —",
  "in exactly this shape:",
  "{",
  '  "statementType": "profit_loss" | "balance_sheet" | "cash_flow" | "other",',
  '  "currencyHint": string or null,',
  '  "years": [',
  "    {",
  '      "financialYear": string,',
  '      "fields": {',
  '        "revenue": number or null, "cogs": number or null, "operatingExpenses": number or null,',
  '        "interestExpense": number or null, "taxExpense": number or null,',
  '        "grossProfit": number or null, "operatingProfit": number or null, "netProfit": number or null,',
  '        "cash": number or null, "receivables": number or null, "inventory": number or null,',
  '        "otherCurrentAssets": number or null, "totalCurrentAssets": number or null,',
  '        "ppe": number or null, "otherNonCurrentAssets": number or null, "totalAssets": number or null,',
  '        "payables": number or null, "shortTermBorrowings": number or null, "otherCurrentLiabilities": number or null,',
  '        "totalCurrentLiabilities": number or null, "longTermDebt": number or null, "preferenceCapital": number or null,',
  '        "equityCapital": number or null, "reserves": number or null, "shareholdersEquity": number or null,',
  '        "totalDebt": number or null',
  "      }",
  "    }",
  "  ]",
  "}",
  "",
  "financialYear: the period/year label exactly as printed for THAT column, e.g. \"FY 2023-24\", \"FY2025\", or",
  "\"Year ended 31 March 2024\". If this page shows only one year, \"years\" still contains exactly one entry —",
  "always use this array shape, even for a single-year page.",
  "currencyHint: the currency printed, e.g. \"INR\", \"₹\", \"USD\", \"$\" (reported once for the page, not per year).",
  "",
  "Rules:",
  "- Numbers must be plain numbers only (no currency symbols, no commas, no \"Cr\"/\"Lakh\"/\"Mn\" text).",
  "  Convert to the base unit using the multiplier actually printed on the statement",
  "  (e.g. figures stated in \"₹ Lakhs\" × 100000, \"₹ Crores\" × 10000000, \"$ millions\" × 1000000).",
  "  If the unit is ambiguous, transcribe the number as printed and do not guess the multiplier.",
  "- If a line item is not present under a given year's column, that year's value for it is null.",
  "- Do not compute subtotals yourself.",
  "  For example, do not add individual expense lines to invent \"operatingExpenses\"",
  "  if it is not printed as a single line for that year.",
  "- Only use figures printed as a distinct line, under the correct year's own column.",
  "- Negative values (losses) should be negative numbers.",
  "- Return ONLY the JSON object, nothing else."
].join("\n");

var ALLOWED_MIME = /^image\/(png|jpe?g|webp|gif)$/i;

// ~11 MB of raw image data.
var MAX_BASE64_LENGTH = 15000000;

module.exports = async function handler(req, res) {

  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  // Handle browser preflight request
  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }

  // Only POST is allowed
  if (req.method !== "POST") {
    res.status(405).json({
      error: "Method not allowed. Use POST."
    });
    return;
  }

  // Read Gemini API key from Vercel Environment Variables
  var apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    res.status(500).json({
      error: "Server is not configured: GEMINI_API_KEY is missing."
    });
    return;
  }

  // Read request body
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

  // Prevent excessively large requests
  if (base64Data.length > MAX_BASE64_LENGTH) {
    res.status(413).json({
      error: "Image is too large."
    });
    return;
  }

  try {

    // Call Gemini Generate Content API
    var geminiResp = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/models/" +
      VISION_MODEL +
      ":generateContent",
      {
        method: "POST",

        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": apiKey
        },

        body: JSON.stringify({

          contents: [
            {
              parts: [

                // Financial statement image
                {
                  inline_data: {
                    mime_type: mimeType,
                    data: base64Data
                  }
                },

                // Extraction instructions
                {
                  text: EXTRACTION_PROMPT
                }

              ]
            }
          ],

          generationConfig: {
            temperature: 0,
            responseMimeType: "application/json"
          }

        })
      }
    );

    // Handle Gemini API errors
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

      res.status(geminiResp.status).json({
        error: "Gemini API error: " + errText
      });

      return;
    }

    // Read Gemini response
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
        error: "Gemini returned no readable extraction result."
      });
      return;
    }

    // Clean possible markdown fences
    var cleaned = textBlock
      .replace(/```json/gi, "")
      .replace(/```/g, "")
      .trim();

    // Extract JSON object if Gemini included extra text
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

    // Parse JSON
    var parsed;

    try {

      parsed = JSON.parse(cleaned);

    } catch (e) {

      res.status(502).json({
        error: "Could not parse the extraction result for this page."
      });

      return;
    }

    // Normalize the response shape defensively: the prompt above always asks for a
    // "years" array (even for a single-year page), but if the model ever drifts back
    // to the old flat single-year shape ("financialYear" + "fields" at the top level),
    // wrap it into the same array shape here so the frontend never has to special-case it.
    if (!parsed || typeof parsed !== "object") {
      parsed = { statementType: "other", currencyHint: null, years: [] };
    } else if (!Array.isArray(parsed.years)) {
      if (parsed.fields && typeof parsed.fields === "object") {
        parsed = {
          statementType: parsed.statementType || "other",
          currencyHint: parsed.currencyHint || null,
          years: [{ financialYear: parsed.financialYear || null, fields: parsed.fields }]
        };
      } else {
        parsed.years = [];
      }
    }

    // Return extracted financial data to frontend
    res.status(200).json(parsed);

  } catch (err) {

    res.status(500).json({
      error:
        "Extraction failed: " +
        (
          err &&
          err.message
            ? err.message
            : "unknown error"
        )
    });

  }
};
