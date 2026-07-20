import crypto from "crypto";

function validateTelegramInitData(initData, botToken) {
  if (!initData || !botToken) {
    return null;
  }

  const params = new URLSearchParams(initData);
  const receivedHash = params.get("hash");

  if (!receivedHash) {
    return null;
  }

  params.delete("hash");

  const dataCheckString = [...params.entries()]
    .sort(([firstKey], [secondKey]) => firstKey.localeCompare(secondKey))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");

  const secretKey = crypto
    .createHmac("sha256", "WebAppData")
    .update(botToken)
    .digest();

  const calculatedHash = crypto
    .createHmac("sha256", secretKey)
    .update(dataCheckString)
    .digest("hex");

  const receivedBuffer = Buffer.from(receivedHash, "hex");
  const calculatedBuffer = Buffer.from(calculatedHash, "hex");

  if (
    receivedBuffer.length !== calculatedBuffer.length ||
    !crypto.timingSafeEqual(receivedBuffer, calculatedBuffer)
  ) {
    return null;
  }

  const authDate = Number(params.get("auth_date") || 0);
  const now = Math.floor(Date.now() / 1000);

  if (!authDate || now - authDate > 86400) {
    return null;
  }

  try {
    return JSON.parse(params.get("user") || "{}");
  } catch {
    return null;
  }
}

function text(value, maxLength = 500) {
  return String(value || "").trim().slice(0, maxLength);
}

function validIsoDate(value) {
  if (!value) {
    return null;
  }

  const date = new Date(value);

  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

async function supabaseRequest(path, options = {}) {
  const baseUrl = process.env.SUPABASE_URL;
  const secretKey = process.env.SUPABASE_SECRET_KEY;

  if (!baseUrl || !secretKey) {
    throw new Error("Supabase is not configured");
  }

  const response = await fetch(`${baseUrl}/rest/v1${path}`, {
    ...options,
    headers: {
      apikey: secretKey,
      Authorization: `Bearer ${secretKey}`,
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  });

  if (!response.ok) {
    throw new Error(`Supabase request failed: ${response.status}`);
  }

  if (response.status === 204) {
    return null;
  }

  return response.json();
}

async function upsertUser(user) {
  await supabaseRequest("/pulse_users?on_conflict=telegram_id", {
    method: "POST",
    headers: {
      Prefer: "resolution=merge-duplicates,return=minimal"
    },
    body: JSON.stringify({
      telegram_id: user.id,
      username: text(user.username, 100) || null,
      first_name: text(user.first_name, 100) || null,
      last_seen_at: new Date().toISOString()
    })
  });
}

async function addEvent(telegramId, eventType, details = {}) {
  await supabaseRequest("/pulse_events", {
    method: "POST",
    headers: {
      Prefer: "return=minimal"
    },
    body: JSON.stringify({
      telegram_id: telegramId,
      event_type: text(eventType, 80),
      details
    })
  });
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Use POST request" });
  }

  try {
    const body =
      typeof req.body === "string"
        ? JSON.parse(req.body || "{}")
        : req.body || {};

    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    const ownerId = String(process.env.OWNER_TELEGRAM_ID || "");
    const user = validateTelegramInitData(body.initData, botToken);

    if (!user || !user.id) {
      return res.status(401).json({ error: "Telegram verification failed" });
    }

    await upsertUser(user);

    const action = text(body.action, 40);
    const payload = body.payload || {};
    const isOwner = String(user.id) === ownerId;

    if (action === "save_result") {
      const mode = payload.mode === "quick" ? "quick" : "vision";
      const direction = ["UP", "DOWN", "NONE"].includes(payload.direction)
        ? payload.direction
        : "NONE";

      const result = {
        telegram_id: user.id,
        mode,
        direction,
        asset: text(payload.asset, 80) || "OTC",
        duration_seconds: Number(payload.durationSeconds) || 30,
        entry_time: validIsoDate(payload.entryTime),
        outcome_time: validIsoDate(payload.outcomeTime),
        confidence: text(payload.confidence, 60) || null,
        summary: text(payload.summary, 1500) || null,
        outcome: ["win", "loss", "skip"].includes(payload.outcome)
          ? payload.outcome
          : "skip"
      };

      await supabaseRequest("/pulse_results", {
        method: "POST",
        headers: {
          Prefer: "return=minimal"
        },
        body: JSON.stringify(result)
      });

      await addEvent(user.id, "result_saved", {
        mode,
        direction,
        asset: result.asset
      });

      return res.status(200).json({ saved: true });
    }

    if (action === "track_event") {
      const eventType = text(payload.eventType, 80);

      if (!eventType) {
        return res.status(400).json({ error: "Event type is required" });
      }

      await addEvent(user.id, eventType, {
        mode: text(payload.mode, 20),
        source: text(payload.source, 40)
      });

      return res.status(200).json({ tracked: true });
    }

    if (action === "dashboard") {
      if (!isOwner) {
        return res.status(403).json({ error: "Owner access required" });
      }

      const [users, results, events] = await Promise.all([
        supabaseRequest("/pulse_users?select=telegram_id"),
        supabaseRequest("/pulse_results?select=mode,outcome,created_at"),
        supabaseRequest("/pulse_events?select=event_type,created_at")
      ]);

      const today = new Date().toISOString().slice(0, 10);
      const todayUsers = new Set(
        results
          .filter((item) => String(item.created_at || "").startsWith(today))
          .map((item) => item.telegram_id)
      );

      return res.status(200).json({
        isOwner: true,
        metrics: {
          usersTotal: users.length,
          usersToday: todayUsers.size,
          resultsTotal: results.length,
          visionTotal: results.filter((item) => item.mode === "vision").length,
          quickTotal: results.filter((item) => item.mode === "quick").length,
          wins: results.filter((item) => item.outcome === "win").length,
          losses: results.filter((item) => item.outcome === "loss").length,
          eventsTotal: events.length
        }
      });
    }

    return res.status(400).json({ error: "Unknown action" });
  } catch (error) {
    console.error("Pulse API error:", error);
    return res.status(500).json({ error: "Pulse service is temporarily unavailable" });
  }
                   }
