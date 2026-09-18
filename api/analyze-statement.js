// api/analyze-statement.js
//
// Vercel Serverless Function for VR FinSight.
// Receives one financial-statement PAGE image from the browser,
// sends it to Google's Gemini API using the server-side secret
// GEMINI_API_KEY, and returns structured financial data.
//
// Supports:
// - Multiple financial years on the same page
// - Finance terminology and synonyms
// - Profit & Loss / Income Statement
// - Balance Sheet
// - Cash Flow Statement
// - Strict transcription without guessing
// - Server-side API key only
//
// Vercel Environment Variable:
// GEMINI_API_KEY

var VISION_MODEL = "gemini-3.6-flash";

var EXTRACTION_PROMPT = [
  "You are an expert financial statement analyst and meticulous financial data transcription specialist.",
  "You are analyzing ONE PAGE of a company's financial statement.",
  "",
  "The page may be:",
  "- Profit & Loss / Income Statement",
  "- Balance Sheet / Statement of Financial Position",
  "- Cash Flow Statement",
  "- Another financial statement page",
  "",
  "IMPORTANT:",
  "The page may contain MULTIPLE FINANCIAL YEARS side by side.",
  "You MUST identify EVERY clearly visible financial year represented on this page.",
  "Do NOT return only the latest year.",
  "Each financial year must have its OWN separate fields object.",
  "",
  "Your job is to extract financial values that are explicitly and legibly printed on the page.",
  "You must NEVER estimate, infer, calculate, average, extrapolate, or guess a value.",
  "If a value is unclear, blurry, cropped, hidden, or not explicitly printed, return null.",
  "",
  "============================================================",
  "FINANCE EXPERT TERMINOLOGY RECOGNITION",
  "============================================================",
  "",
  "You must understand financial terminology, abbreviations, alternate names,",
  "and commonly used accounting terminology.",
  "",
  "Examples include:",
  "",
  "Revenue:",
  "- Revenue",
  "- Sales",
  "- Net Sales",
  "- Turnover",
  "- Operating Revenue",
  "- Revenue from Operations",
  "- Income from Operations",
  "",
  "EBITDA / operating earnings:",
  "- EBITDA",
  "- Earnings Before Interest, Tax, Depreciation and Amortization",
  "- PBITDA",
  "",
  "EBIT / operating profit:",
  "- EBIT",
  "- Earnings Before Interest and Tax",
  "- PBIT",
  "- Profit Before Interest and Tax",
  "- Operating Profit",
  "- Operating Income",
  "",
  "Profit before tax:",
  "- PBT",
  "- Profit Before Tax",
  "- Profit Before Income Tax",
  "- EBT",
  "- Earnings Before Tax",
  "",
  "Profit after tax:",
  "- PAT",
  "- Profit After Tax",
  "- Profit After Income Tax",
  "- Net Profit",
  "- Net Income",
  "  ",
  "Receivables:",
  "- Trade Receivables",
  "- Accounts Receivable",
  "- Receivables",
  "- Debtors",
  "- Sundry Debtors",
  "",
  "Payables:",
  "- Trade Payables",
  "- Accounts Payable",
  "- Payables",
  "- Creditors",
  "- Sundry Creditors",
  "",
  "Inventory:",
  "- Inventory",
  "- Inventories",
  "- Stock",
  "- Stock-in-Trade",
  "",
  "Property, plant and equipment:",
  "- PPE",
  "- Property, Plant and Equipment",
  "- Property Plant & Equipment",
  "- Fixed Assets",
  "",
  "Equity:",
  "- Shareholders' Equity",
  "- Shareholders Equity",
  "- Stockholders' Equity",
  "- Net Worth",
  "- Owners' Equity",
  "",
  "Debt / borrowings:",
  "- Debt",
  "- Total Debt",
  "- Borrowings",
  "- Loans",
  "- Interest-bearing Debt",
  "- Financial Borrowings",
  "",
  "Cash:",
  "- Cash",
  "- Cash and Cash Equivalents",
  "- Cash & Cash Equivalents",
  "- Bank Balances and Cash",
  "",
  "IMPORTANT TERMINOLOGY RULE:",
  "Do not match words blindly.",
  "Map a line item to the canonical field based on its actual financial meaning",
  "and the surrounding statement context.",
  "",
  "For example:",
  "- EBITDA and PBITDA may represent the same economic concept when the statement uses them that way.",
  "- EBIT, PBIT and Operating Profit may represent the same concept depending on the statement.",
  "- PAT, Net Profit and Profit After Tax may represent the same concept depending on the statement.",
  "",
  "However, NEVER invent a value merely because a synonym is expected.",
  "Only extract the number if the corresponding figure is actually printed.",
  "",
  "============================================================",
  "MULTIPLE FINANCIAL YEARS",
  "============================================================",
  "",
  "If the page contains columns such as:",
  "- FY 2025 and FY 2024",
  "- 2024-25 and 2023-24",
  "- 31 March 2025 and 31 March 2024",
  "- Current Year and Previous Year",
  "- 2025 and 2024",
  "",
  "return BOTH years separately.",
  "",
  "Example:",
  "",
  "Revenue     1,000     850",
  "EBITDA        200     160",
  "",
  "If the column headers clearly identify the values as FY 2025 and FY 2024,",
  "return two year objects.",
  "",
  "Never combine values from different years.",
  "Never copy the latest year's value into another year.",
  "",
  "If a year cannot be clearly identified, use null or an appropriate",
  "descriptive label only when the page explicitly provides that label.",
  "",
  "============================================================",
  "STATEMENT TYPE",
  "============================================================",
  "",
  "Identify the statement type:",
  "profit_loss",
  "balance_sheet",
  "cash_flow",
  "other",
  "",
  "============================================================",
  "OUTPUT FORMAT",
  "============================================================",
  "",
  "Respond with STRICT JSON ONLY.",
  "No markdown.",
  "No code fences.",
  "No explanation.",
  "No commentary.",
  "",
  "Return EXACTLY this structure:",
  "",
  "{",
  '  "statementType": "profit_loss" | "balance_sheet" | "cash_flow" | "other",',
  '  "currencyHint": string or null,',
  '  "years": [',
  "    {",
  '      "financialYear": string or null,',
  '      "fields": {',
  '        "revenue": number or null,',
  '        "cogs": number or null,',
  '        "operatingExpenses": number or null,',
  '        "interestExpense": number or null,',
  '        "taxExpense": number or null,',
  '        "grossProfit": number or null,',
  '        "operatingProfit": number or null,',
  '        "netProfit": number or null,',
  '        "cash": number or null,',
  '        "receivables": number or null,',
  '        "inventory": number or null,',
  '        "otherCurrentAssets": number or null,',
  '        "totalCurrentAssets": number or null,',
  '        "ppe": number or null,',
  '        "otherNonCurrentAssets": number or null,',
  '        "totalAssets": number or null,',
  '        "payables": number or null,',
  '        "shortTermBorrowings": number or null,',
  '        "otherCurrentLiabilities": number or null,',
  '        "totalCurrentLiabilities": number or null,',
  '        "longTermDebt": number or null,',
  '        "preferenceCapital": number or null,',
  '        "equityCapital": number or null,',
  '        "reserves": number or null,',
  '        "shareholdersEquity": number or null,',
  '        "totalDebt": number or null',
  "      }",
  "    }",
  "  ]",
  "}",
  "",
  "============================================================",
  "FIELD MAPPING",
  "============================================================",
  "",
  "Map printed line items into these canonical fields when the financial meaning clearly matches:",
  "",
  "revenue",
  "cogs",
  "operatingExpenses",
  "interestExpense",
  "taxExpense",
  "grossProfit",
  "operatingProfit",
  "netProfit",
  "cash",
  "receivables",
  "inventory",
  "otherCurrentAssets",
  "totalCurrentAssets",
  "ppe",
  "otherNonCurrentAssets",
  "totalAssets",
  "payables",
  "shortTermBorrowings",
  "otherCurrentLiabilities",
  "totalCurrentLiabilities",
  "longTermDebt",
  "preferenceCapital",
  "equityCapital",
  "reserves",
  "shareholdersEquity",
  "totalDebt",
  "",
  "Do not calculate these fields from other numbers.",
  "For example:",
  "- Do not calculate grossProfit = revenue - cogs.",
  "- Do not calculate operatingProfit from EBITDA.",
  "- Do not calculate netProfit from PBT and tax.",
  "- Do not calculate totalAssets by adding assets.",
  "- Do not calculate totalDebt by adding borrowings.",
  "",
  "Only populate a field when the corresponding value is explicitly printed",
  "or clearly represented by the exact financial line item on the page.",
  "",
  "============================================================",
  "NUMBERS AND UNITS",
  "============================================================",
  "",
  "Numbers must be plain JSON numbers.",
  "Do not include currency symbols.",
  "Do not include commas.",
  "Do not include Cr, Crore, Lakh, Lakhs, Mn, Million, Billion, etc. inside the number.",
  "",
  "If the statement explicitly says:",
  "- ₹ Lakhs → convert to base rupees using ×100000.",
  "- ₹ Crores → convert to base rupees using ×10000000.",
  "- ₹ Millions → convert using ×1000000.",
  "- $ Millions → convert using ×1000000.",
  "- $ Billions → convert using ×1000000000.",
  "",
  "Use the multiplier actually printed on the page.",
  "Do not guess a unit.",
  "",
  "If the unit is ambiguous, preserve the printed numerical value rather than inventing a multiplier.",
  "",
  "Negative values must remain negative.",
  "Losses must be negative numbers.",
  "",
  "============================================================",
  "YEAR HANDLING",
  "============================================================",
  "",
  "The financialYear must represent the year or period associated with that specific column.",
  "",
  "Examples:",
  "- FY 2024-25",
  "- FY 2023-24",
  "- Year ended 31 March 2025",
  "- Year ended 31 March 2024",
  "",
  "If multiple years are visible, create one object inside years[] for EACH year.",
  "",
  "The order should normally be the same order as the columns on the statement,",
  "usually latest/current year first.",
  "",
  "============================================================",
  "MISSING DATA",
  "============================================================",
  "",
  "If a line item is not present on this specific page, return null.",
  "",
  "If the value is unreadable, return null.",
  "",
  "If only one year contains a particular field and the other year does not,",
  "do NOT copy the value. Return null for the missing year.",
  "",
  "============================================================",
  "NO CALCULATIONS",
  "============================================================",
  "",
  "Do not calculate ratios.",
  "Do not calculate totals.",
  "Do not calculate subtotals.",
  "Do not derive missing values.",
  "Do not estimate.",
  "Do not infer.",
  "",
  "VR FinSight will perform all ratio calculations separately.",
  "",
  "============================================================",
  "FINAL REQUIREMENT",
  "============================================================",
  "",
  "Return ONLY the valid JSON object.",
  "No text before or after the JSON."
].join("\n");

var ALLOWED_MIME = /^image\/(png|jpe?g|webp|gif)$/i;

// ~11 MB of raw image data.
var MAX_BASE64_LENGTH = 15000000;

module.exports = async function handler(req, res) {

  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  // Browser preflight
  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }

  // Only POST
  if (req.method !== "POST") {
    res.status(405).json({
      error: "Method not allowed. Use POST."
    });
    return;
  }

  // Read API key from Vercel Environment Variables
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

                // Finance expert extraction instructions
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

    // Remove possible markdown fences
    var cleaned = textBlock
      .replace(/```json/gi, "")
      .replace(/```/g, "")
      .trim();

    // Find JSON object
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

    // Basic validation
    if (!parsed || typeof parsed !== "object") {

      res.status(502).json({
        error: "Gemini returned an invalid extraction structure."
      });

      return;
    }

    if (!Array.isArray(parsed.years)) {

      res.status(502).json({
        error: "Gemini did not return the required multi-year format."
      });

      return;
    }

    // Return extracted financial data
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
