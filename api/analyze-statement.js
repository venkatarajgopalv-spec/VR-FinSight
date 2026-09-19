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
  "company's financial statement (Profit & Loss / Income Statement, Balance Sheet, or Cash Flow Statement,",
  "or a page containing more than one of these).",
  "",
  "READ THE ENTIRE PAGE. Carefully inspect every region of the image — every heading, every column,",
  "every row, every subtotal and total, every unit/currency label, and every note that affects how a",
  "number should be interpreted — before extracting anything. Do not extract only the handful of fields",
  "listed below and ignore the rest of the page; look at everything visibly printed.",
  "",
  "IMPORTANT: A single page can show MULTIPLE financial years side by side in separate columns",
  "(for example \"FY 2025 | FY 2024 | FY 2023\"). You must identify EVERY distinct year/period column",
  "printed on this page and report each one separately. Do not report only one year if more are shown.",
  "Read each year's column completely independently of the others:",
  "- Never copy, reuse, or infer a value in one year's column from another year's column.",
  "- Never merge, average, or blend numbers from different year columns together.",
  "- Never assume a blank or empty cell means zero — a blank cell means the value is not available (null).",
  "- If the same line item shows different numbers in different year columns, keep each year's number",
  "  exactly as printed under that year — do not reconcile, average, or 'correct' them against each other.",
  "- If this page contains more than one statement (e.g. P&L and Balance Sheet on the same page) or you",
  "  are shown multiple pages, correctly associate every value with both its correct statement type AND",
  "  its correct financial year — never mix values across statement types or across years.",
  "",
  "CASE-INSENSITIVE MATCHING: When identifying a line item, ignore capitalization entirely. \"Net Profit\",",
  "\"NET PROFIT\", \"net profit\", and \"Net profit\" are the exact same concept and must map to the same field —",
  "never treat different capitalization as a different line item, and never create duplicate entries because",
  "of a capitalization difference. Apply this to every label you read on the page (Revenue/REVENUE/revenue,",
  "Assets/ASSETS, Equity/equity, etc.) and to reasonable spacing/wording variants of the same term.",
  "",
  "Your job is to transcribe values that are explicitly and legibly printed on this page, for each year",
  "column separately. You must NEVER estimate, infer, calculate, average, or guess a value that is not",
  "directly printed under that specific year's column. If a figure is unclear, cropped, blurry, covered,",
  "or simply not present for that year, its value MUST be null. Never fill a blank year's value using a",
  "number from a different year's column, and never pull a number from memory.",
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
  "      },",
  '      "additionalLineItems": [ { "label": string, "value": number or null } ],',
  '      "notes": string or null',
  "    }",
  "  ]",
  "}",
  "",
  "financialYear: the period/year label exactly as printed for THAT column, e.g. \"FY 2023-24\", \"FY2025\", or",
  "\"Year ended 31 March 2024\". If this page shows only one year, \"years\" still contains exactly one entry —",
  "always use this array shape, even for a single-year page.",
  "currencyHint: the currency printed, e.g. \"INR\", \"₹\", \"USD\", \"$\" (reported once for the page, not per year).",
  "",
  "fields: the fixed set of normalized values listed above — always include every key, using null for",
  "anything not printed for that year. Map each line item on the page to the closest matching key from",
  "this list, case-insensitively (e.g. \"Cost of Materials Consumed\", \"Cost of Sales\", or \"Purchases\" all",
  "map to \"cogs\"; \"Profit After Tax\", \"PAT\", or \"Net Profit for the year\" all map to \"netProfit\").",
  "",
  "additionalLineItems: this page will often show real, meaningful line items that are NOT covered by the",
  "fixed \"fields\" list above — for example EBITDA, Depreciation & Amortisation, EBIT, Profit Before Tax,",
  "Employee Benefit Expenses, Other Operating Expenses (as their own printed line, separate from the",
  "operatingExpenses total), Finance Costs shown as a breakdown, Total Liabilities, or any other distinct",
  "line/subtotal/total visibly printed for this year. Capture EVERY such item here as its own",
  "{label, value} entry, using the label exactly as printed (light case/spacing cleanup is fine). Do not",
  "silently drop real financial information just because it doesn't fit the fixed fields list above.",
  "If truly nothing extra is visible for a year beyond the fixed fields, return an empty array for it.",
  "",
  "notes: use this for anything that affects interpretation but isn't a numeric line item — the unit/scale",
  "actually printed (e.g. \"figures in ₹ Crore\"), the statement's visible title, the visible period/date",
  "range, or a brief flag about anything ambiguous or hard to read on this page for this year. Use null if",
  "there is nothing worth noting.",
  "",
  "Rules:",
  "- Numbers must be plain numbers only (no currency symbols, no commas, no \"Cr\"/\"Lakh\"/\"Mn\" text).",
  "  Convert to the base unit using the multiplier actually printed on the statement",
  "  (e.g. figures stated in \"₹ Lakhs\" × 100000, \"₹ Crores\" × 10000000, \"$ millions\" × 1000000).",
  "  If the unit is ambiguous, transcribe the number as printed and do not guess the multiplier — instead",
  "  say so in \"notes\".",
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

// ---------------------------------------------------------------------------
// Retry wrapper for the Gemini call.
// Retries ONLY on transient HTTP statuses (429/500/502/503/504) — anything else
// (bad API key, malformed request, unsupported model, auth errors, etc.) fails
// immediately, exactly as before. Up to 3 total attempts. Respects a Retry-After
// response header when Gemini sends one (capped to a sane maximum so a single
// request can't stall the serverless function indefinitely); otherwise falls
// back to the suggested fixed delays (immediate, ~1s, ~2s).
// ---------------------------------------------------------------------------
var TRANSIENT_STATUS_CODES = [429, 500, 502, 503, 504];
var MAX_ATTEMPTS = 3;
var RETRY_DELAYS_MS = [0, 1000, 2000];
var MAX_RETRY_AFTER_MS = 5000;

function sleep(ms) {
  return new Promise(function (resolve) { setTimeout(resolve, ms); });
}

function parseRetryAfterMs(resp) {
  try {
    var headerValue = resp && resp.headers && typeof resp.headers.get === "function" ? resp.headers.get("retry-after") : null;
    if (!headerValue) return null;
    var asSeconds = Number(headerValue);
    if (!isNaN(asSeconds) && asSeconds >= 0) return asSeconds * 1000;
    var asDate = Date.parse(headerValue);
    if (!isNaN(asDate)) {
      var diff = asDate - Date.now();
      return diff > 0 ? diff : 0;
    }
  } catch (e) {}
  return null;
}

async function callGeminiWithRetry(url, options) {
  var lastResp = null;
  for (var attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    if (attempt > 1) {
      var retryAfterMs = parseRetryAfterMs(lastResp);
      var delay = retryAfterMs !== null ? Math.min(retryAfterMs, MAX_RETRY_AFTER_MS) : RETRY_DELAYS_MS[attempt - 1];
      await sleep(delay);
    }
    var resp = await fetch(url, options);
    if (resp.ok) return resp;
    lastResp = resp;
    if (TRANSIENT_STATUS_CODES.indexOf(resp.status) === -1) {
      // Permanent/non-retryable error (e.g. 401/400/404) — stop immediately.
      return resp;
    }
    // Otherwise loop and retry (if attempts remain); after the final attempt,
    // the loop ends naturally and the last (still-failed) response is returned below.
  }
  return lastResp;
}

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

    // Call Gemini Generate Content API (with automatic retry on transient errors)
    var geminiResp = await callGeminiWithRetry(
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
