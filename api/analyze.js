module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Use POST request" });
  }

  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    return res.status(500).json({
      error: "GEMINI_API_KEY is not configured"
    });
  }

  try {
    const { image, mimeType = "image/jpeg", language = "ru" } = req.body || {};

    if (!image || typeof image !== "string") {
      return res.status(400).json({
        error: "Image is required"
      });
    }

    const base64Image = image.includes(",")
      ? image.split(",").pop()
      : image;

    const prompt = language === "ru"
      ? `Ты анализируешь только загруженный пользователем скриншот торгового графика.
Не утверждай, что результат гарантирован, и не обещай прибыль.
Не выдумывай цену, индикаторы, пару или таймфрейм, если их не видно.
Если на изображении недостаточно информации, выбери NO_SIGNAL.

Верни только JSON без Markdown в таком формате:
{
  "direction": "BUY | SELL | NO_SIGNAL",
  "confidence": "низкая | средняя | высокая",
  "entryWindow": "краткое время или условие входа",
  "expiry": "предполагаемый интервал",
  "asset": "распознанный актив или Не распознан",
  "timeframe": "распознанный таймфрейм или Не распознан",
  "summary": "краткий анализ графика в 1–2 предложениях",
  "reasons": ["наблюдение 1", "наблюдение 2"],
  "risk": "Это анализ изображения, а не гарантия результата."
}`
      : `Analyze only the trading-chart screenshot uploaded by the user.
Never guarantee a result or profit.
Do not invent a price, indicators, asset, or timeframe if they are not visible.
If the image has insufficient information, use NO_SIGNAL.

Return JSON only, without Markdown:
{
  "direction": "BUY | SELL | NO_SIGNAL",
  "confidence": "low | medium | high",
  "entryWindow": "short entry timing or condition",
  "expiry": "suggested interval",
  "asset": "recognized asset or Not recognized",
  "timeframe": "recognized timeframe or Not recognized",
  "summary": "brief chart analysis in 1–2 sentences",
  "reasons": ["observation 1", "observation 2"],
  "risk": "This is image analysis, not a guarantee of any result."
}`;

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                { text: prompt },
                {
                  inline_data: {
                    mime_type: mimeType,
                    data: base64Image
                  }
                }
              ]
            }
          ],
          generationConfig: {
            temperature: 0.2,
            response_mime_type: "application/json"
          }
        })
      }
    );

    const data = await response.json();

    if (!response.ok) {
      console.error("Gemini error:", data);
      return res.status(response.status).json({
        error: data?.error?.message || "Gemini request failed"
      });
    }

    const text = data?.candidates?.[0]?.content?.parts
      ?.map((part) => part.text || "")
      .join("")
      .trim();

    if (!text) {
      return res.status(502).json({
        error: "AI returned no analysis"
      });
    }

    const cleanJson = text
      .replace(/^```json\s*/i, "")
      .replace(/^```\s*/i, "")
      .replace(/\s*```$/i, "");

    return res.status(200).json(JSON.parse(cleanJson));
  } catch (error) {
    console.error("Analyze error:", error);

    return res.status(500).json({
      error: "Unable to analyze the image"
    });
  }
};
