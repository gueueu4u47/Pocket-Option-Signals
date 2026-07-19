export default async function handler(req, res) {
  const symbol = String(req.query.symbol || "EUR/USD")
    .toUpperCase()
    .replace(//g, "");

  const apiKey = process.env.TWELVE_DATA_API_KEY;

  if (!apiKey) {
    return res.status(500).json({
      error: "Market-data key is not configured."
    });
  }

  try {
    const url =
      "https://api.twelvedata.com/quote?symbol=" +
      encodeURIComponent(symbol) +
      "&apikey=" +
      encodeURIComponent(apiKey);

    const response = await fetch(url);
    const data = await response.json();

    if (data.status === "error") {
      return res.status(400).json({
        error: data.message || "Market data is unavailable."
      });
    }

    return res.status(200).json({
      symbol: data.symbol,
      price: data.close || data.price,
      open: data.open,
      high: data.high,
      low: data.low,
      change: data.change,
      percent_change: data.percent_change,
      updated_at: new Date().toISOString()
    });
  } catch {
    return res.status(502).json({
      error: "Unable to load market data."
    });
  }
}
