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
  "You are a meticulous financial analyst's data-transcription assistant — read this page the way a",
  "financial analyst would, not like a narrow OCR tool. You will be shown ONE PAGE of a company's",
  "financial statement (Profit & Loss / Income Statement, Balance Sheet, or Cash Flow Statement,",
  "or a page containing more than one of these).",
  "",
  "READ THE ENTIRE PAGE. Carefully inspect every region of the image — every heading, every column,",
  "every row, every subtotal and total, every unit/currency label, and every note that affects how a",
  "number should be interpreted — before extracting anything. Look for (not limited to): Revenue/Sales,",
  "COGS/Cost of Materials Consumed/Purchases, Gross Profit, Employee Benefits Expense, Other Expenses,",
  "Operating Expenses, EBITDA, Depreciation, EBIT, Finance Cost/Interest Expense, Profit Before Tax, Tax",
  "Expense, Profit After Tax/Net Profit, Exceptional Items, Other Income, Cash & Cash Equivalents, Trade",
  "Receivables, Inventory, Other Current Assets, Total Current Assets, PPE, Other Non-current Assets,",
  "Total Assets, Trade Payables, Short-term Borrowings, Other Current Liabilities, Long-term Borrowings,",
  "Total Debt, Equity Share Capital, Preference Share Capital, Reserves, Retained Earnings, Shareholders'",
  "Equity, Total Liabilities, and any other relevant financial statement items. Do not extract only the",
  "fixed \"fields\" list below and ignore the rest of the page.",
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
  "FINANCIAL PERIOD FORMATS: report the period label exactly as printed — do not force it into any",
  "particular format, and do not assume every company's year-end is March. Statements legitimately use",
  "many formats, including (not limited to): \"Mar-26\", \"March 2026\", \"31-Mar-2026\", \"31 March 2026\",",
  "\"31/03/2026\", \"FY2025\", \"FY 2024-25\", \"2025\", \"Year ended March 31, 2026\", \"Year ended 31 March",
  "2026\", \"December 2025\" (December year-end), \"June 2025\" (June year-end), \"September 2025\"",
  "(September year-end). If the statement's year-end is December, June, September, or any other month,",
  "report that actual month — never substitute March. If it explicitly says \"FY2024-25\", preserve that",
  "exact meaning rather than collapsing it to a single year.",
  "",
  "CASE-INSENSITIVE MATCHING: When identifying a line item, ignore capitalization entirely. \"Net Profit\",",
  "\"NET PROFIT\", \"net profit\", \"Net profit\", \"Operating Profit\"/\"OPERATING PROFIT\"/\"operating profit\", are",
  "each the exact same concept and must map to the same field — never treat different capitalization as a",
  "different line item, and never create duplicate entries because of a capitalization difference. Apply",
  "this to every label you read on the page (Revenue/REVENUE/revenue, Assets/ASSETS, Equity/equity, etc.)",
  "and to reasonable spacing/wording variants of the same term.",
  "",
  "Your job is to transcribe values that are explicitly and legibly printed on this page, for each year",
  "column separately. You must NEVER estimate, infer, or guess a value that is not directly printed under",
  "that specific year's column, and never fill a blank year's value using a number from a different year's",
  "column or from memory. If a figure is unclear, cropped, blurry, covered, or simply not present for that",
  "year, its value MUST be null.",
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
  '      "derivedFields": { "<fieldKey>": { "formula": string, "inputs": [string, ...] } },',
  '      "additionalLineItems": [ { "label": string, "value": number or null } ],',
  '      "notes": string or null',
  "    }",
  "  ]",
  "}",
  "",
  "financialYear: the period/year label exactly as printed for THAT column (see FINANCIAL PERIOD FORMATS",
  "above). If this page shows only one year, \"years\" still contains exactly one entry — always use this",
  "array shape, even for a single-year page.",
  "currencyHint: the currency printed, e.g. \"INR\", \"₹\", \"USD\", \"$\" (reported once for the page, not per year).",
  "",
  "fields: the fixed set of normalized values listed above — always include every key, using null for",
  "anything not printed for that year AND not safely derivable (see derivedFields below). Map each line",
  "item on the page to the closest matching key from this list, case-insensitively (e.g. \"Cost of Materials",
  "Consumed\", \"Cost of Sales\", or \"Purchases\" all map to \"cogs\"; \"Profit After Tax\", \"PAT\", or \"Net Profit",
  "for the year\" all map to \"netProfit\").",
  "",
  "DERIVED VALUES — read this carefully, it is a common source of error:",
  "A value that is not printed as its own line may sometimes be safely CALCULATED from other values you",
  "have ALREADY confidently extracted from THIS SAME year's column, using one of these specific accounting",
  "relationships, and ONLY when every input the formula needs is a real, extracted (non-null) number:",
  "  grossProfit = revenue - cogs",
  "  operatingProfit = grossProfit - operatingExpenses",
  "  operatingExpenses = employee benefits expense + other operating expenses",
  "    (ONLY when those visible line items genuinely represent the COMPLETE set of operating expenses for",
  "    this statement — if there is any other operating-expense-like line you can see that isn't included,",
  "    do not derive this field; leave it null instead of under-counting it)",
  "  ebit = profitBeforeTax + financeCost/interestExpense   (equivalently: ebit = operatingProfit)",
  "  profitBeforeTax = netProfit(PAT) + taxExpense",
  "  totalCurrentAssets = cash + receivables + inventory + otherCurrentAssets",
  "  totalCurrentLiabilities = payables + shortTermBorrowings + otherCurrentLiabilities",
  "  shareholdersEquity = equityCapital + reserves   (do NOT add preferenceCapital into this — preference",
  "    capital is intentionally kept separate from shareholders' equity in this system's ratio analysis)",
  "  totalDebt = shortTermBorrowings + longTermDebt",
  "These are examples of valid relationships, not an exhaustive list — you may apply other clearly valid,",
  "unambiguous accounting relationships between values you have genuinely extracted from this same year's",
  "column, using the same discipline: never derive from a value that is itself missing, estimated, or",
  "uncertain, and never derive when the relationship is ambiguous for this specific statement's structure.",
  "If you derive a field's value this way, put it in \"fields\" as normal, AND add an entry for it in",
  "\"derivedFields\" for that year recording the formula you used and which extracted fields (by their exact",
  "key names above) fed into it — e.g. \"derivedFields\": { \"grossProfit\": { \"formula\": \"revenue - cogs\",",
  "\"inputs\": [\"revenue\",\"cogs\"] } }. Never mark a value that was directly printed on the page as derived.",
  "If a value is neither directly printed nor safely derivable this way, it MUST be null — never guess it.",
  "",
  "additionalLineItems: this page will often show real, meaningful line items that are NOT covered by the",
  "fixed \"fields\" list above — for example EBITDA, Depreciation & Amortisation, EBIT, Profit Before Tax,",
  "Employee Benefit Expenses, Other Operating Expenses (as their own printed line, separate from the",
  "operatingExpenses total), Finance Costs shown as a breakdown, Total Liabilities, or any other distinct",
  "line/subtotal/total visibly printed for this year. Capture EVERY such item here as its own",
  "{label, value} entry, using the label exactly as printed (light case/spacing cleanup is fine) — including",
  "items you also used as an input to a derivedFields calculation above (record them in both places). Do",
  "not silently drop real financial information just because it doesn't fit the fixed fields list above.",
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
  "- If a line item is not present under a given year's column, and cannot be safely derived per the rules",
  "  above, that year's value for it is null.",
  "- Only use figures printed as a distinct line, under the correct year's own column, or values legitimately",
  "  derived per the DERIVED VALUES rules above.",
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
