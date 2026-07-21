import crypto from "crypto";

function validateTelegramInitData(initData, botToken) {
  if (!initData || !botToken) return null;

  const params = new URLSearchParams(initData);
  const receivedHash = params.get("hash");

  if (!receivedHash) return null;

  params.delete("hash");

  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
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

  if (!authDate || now - authDate > 86400) return null;

  try {
    return JSON.parse(params.get("user") || "{}");
  } catch {
    return null;
  }
}

const RATE = new Map();
function rateLimit(key, limit, windowMs) {
  const now = Date.now();
  const hits = (RATE.get(key) || []).filter((t) => now - t < windowMs);
  if (hits.length >= limit) {
    RATE.set(key, hits);
    return false;
  }
  hits.push(now);
  RATE.set(key, hits);
  if (RATE.size > 5000) {
    for (const [k, v] of RATE) {
      if (!v.length || now - v[v.length - 1] > windowMs) RATE.delete(k);
    }
  }
  return true;
}

function text(value, maxLength = 500) {
  return String(value || "").trim().slice(0, maxLength);
}

function validIsoDate(value) {
  if (!value) return null;

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function validOutcome(value) {
  return ["win", "loss", "skip"].includes(value) ? value : "skip";
}

function validDirection(value) {
  return ["UP", "DOWN", "NONE"].includes(value) ? value : "NONE";
}

function validMode(value) {
  return value === "quick" ? "quick" : "vision";
}

function validResultId(value) {
  const id = text(value, 100);

  if (!id) return null;

  return id;
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

  const contentType = response.headers.get("content-type") || "";

  if (!contentType.includes("application/json")) {
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

async function saveResult(user, payload) {
  const entryTime = validIsoDate(payload.entryTime);
  const outcomeTime = validIsoDate(payload.outcomeTime);

  if (!entryTime || !outcomeTime) {
    return {
      ok: false,
      status: 400,
      body: { error: "Result timing is required" }
    };
  }

  if (new Date(outcomeTime).getTime() <= new Date(entryTime).getTime()) {
    return {
      ok: false,
      status: 400,
      body: { error: "Result timing is invalid" }
    };
  }

  const result = {
    telegram_id: user.id,
    mode: validMode(payload.mode),
    direction: validDirection(payload.direction),
    asset: text(payload.asset, 80) || "OTC",
    duration_seconds: Math.max(1, Math.min(86400, Number(payload.durationSeconds) || 30)),
    entry_time: entryTime,
    outcome_time: outcomeTime,
    confidence: text(payload.confidence, 60) || null,
    summary: text(payload.summary, 1500) || null,
    outcome: validOutcome(payload.outcome)
  };

  const inserted = await supabaseRequest("/pulse_results", {
    method: "POST",
    headers: {
      Prefer: "return=representation"
    },
    body: JSON.stringify(result)
  });

  const savedResult = Array.isArray(inserted) ? inserted[0] : inserted;

  await addEvent(user.id, "result_saved", {
    result_id: savedResult?.id || null,
    mode: result.mode,
    direction: result.direction,
    asset: result.asset
  });

  return {
    ok: true,
    status: 200,
    body: {
      saved: true,
      resultId: savedResult?.id || null,
      result: savedResult || null
    }
  };
}

async function updateResultOutcome(user, payload) {
  const resultId = validResultId(payload.resultId);
  const outcome = validOutcome(payload.outcome);

  if (!resultId) {
    return {
      ok: false,
      status: 400,
      body: { error: "Result ID is required" }
    };
  }

  const encodedResultId = encodeURIComponent(resultId);
  const encodedTelegramId = encodeURIComponent(String(user.id));

  const updated = await supabaseRequest(
    `/pulse_results?id=eq.${encodedResultId}&telegram_id=eq.${encodedTelegramId}`,
    {
      method: "PATCH",
      headers: {
        Prefer: "return=representation"
      },
      body: JSON.stringify({
        outcome
      })
    }
  );

  const result = Array.isArray(updated) ? updated[0] : updated;

  if (!result) {
    return {
      ok: false,
      status: 404,
      body: { error: "Result was not found" }
    };
  }

  await addEvent(user.id, "result_outcome_updated", {
    result_id: result.id,
    outcome
  });

  return {
    ok: true,
    status: 200,
    body: {
      updated: true,
      resultId: result.id,
      outcome: result.outcome
    }
  };
}

async function getDashboard() {
  const [users, results, events] = await Promise.all([
    supabaseRequest("/pulse_users?select=telegram_id"),
    supabaseRequest("/pulse_results?select=telegram_id,mode,outcome,created_at"),
    supabaseRequest("/pulse_events?select=event_type,created_at")
  ]);

  const today = new Date().toISOString().slice(0, 10);

  const todayUsers = new Set(
    (results || [])
      .filter((item) => String(item.created_at || "").startsWith(today))
      .map((item) => item.telegram_id)
      .filter(Boolean)
  );

  return {
    usersTotal: (users || []).length,
    usersToday: todayUsers.size,
    resultsTotal: (results || []).length,
    visionTotal: (results || []).filter((item) => item.mode === "vision").length,
    quickTotal: (results || []).filter((item) => item.mode === "quick").length,
    wins: (results || []).filter((item) => item.outcome === "win").length,
    losses: (results || []).filter((item) => item.outcome === "loss").length,
    skipped: (results || []).filter((item) => item.outcome === "skip").length,
    eventsTotal: (events || []).length
  };
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

    if (!rateLimit("pulse:" + user.id, 40, 60000)) {
      return res.status(429).json({ error: "Too many requests. Please slow down." });
    }

    const action = text(body.action, 40);
    const payload = body.payload || {};
    const isOwner = String(user.id) === ownerId;

    if (
      (action === "save_result" || action === "track_event") &&
      !rateLimit("write:" + user.id, 15, 60000)
    ) {
      return res.status(429).json({ error: "Too many requests. Please slow down." });
    }

    await upsertUser(user);

    if (action === "save_result") {
      const saved = await saveResult(user, payload);
      return res.status(saved.status).json(saved.body);
    }

    if (action === "update_result") {
      const updated = await updateResultOutcome(user, payload);
      return res.status(updated.status).json(updated.body);
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

      const metrics = await getDashboard();

      return res.status(200).json({
        isOwner: true,
        metrics
      });
    }

    return res.status(400).json({ error: "Unknown action" });
  } catch (error) {
    console.error("Pulse API error:", error);

    return res.status(500).json({
      error: "Pulse service is temporarily unavailable"
    });
  }
      }
