import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

export const config = {
  api: { bodyParser: false },
  supportsResponseStreaming: true,
  maxDuration: 60,
};

// متغیر محیطی جدید برای رد گم کنی
const WEATHER_API_URL = (process.env.WEATHER_API_URL || "").replace(/\/$/, "");

const BLOCKED_HEADERS = new Set([
  "host",
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "forwarded",
  "x-forwarded-host",
  "x-forwarded-proto",
  "x-forwarded-port",
]);

export default async function handleWeatherRequest(req, res) {
  if (!WEATHER_API_URL) {
    res.statusCode = 500;
    return res.end("Weather Service Config Missing");
  }

  try {
    const targetUrl = WEATHER_API_URL + req.url;
    const headers = {};
    let userClientIp = null;

    for (const [key, value] of Object.entries(req.headers)) {
      const lowerKey = key.toLowerCase();
      if (BLOCKED_HEADERS.has(lowerKey)) continue;
      if (lowerKey.startsWith("x-vercel-")) continue;
      
      if (lowerKey === "x-real-ip") { userClientIp = value; continue; }
      if (lowerKey === "x-forwarded-for") { 
          if (!userClientIp) userClientIp = value; 
          continue; 
      }
      headers[lowerKey] = Array.isArray(value) ? value.join(", ") : value;
    }
    
    if (userClientIp) headers["x-forwarded-for"] = userClientIp;

    const reqMethod = req.method;
    const hasPayload = reqMethod !== "GET" && reqMethod !== "HEAD";

    const fetchOptions = { method: reqMethod, headers, redirect: "manual" };
    if (hasPayload) {
      fetchOptions.body = Readable.toWeb(req);
      fetchOptions.duplex = "half";
    }

    const upstreamStream = await fetch(targetUrl, fetchOptions);
    res.statusCode = upstreamStream.status;

    for (const [k, v] of upstreamStream.headers) {
      if (k.toLowerCase() === "transfer-encoding") continue;
      try { res.setHeader(k, v); } catch (e) {}
    }

    if (upstreamStream.body) {
      await pipeline(Readable.fromWeb(upstreamStream.body), res);
    } else {
      res.end();
    }
  } catch (error) {
    console.error("Weather Gateway Timeout:", error);
    if (!res.headersSent) {
      res.statusCode = 502;
      res.end("Weather Upstream Error");
    }
  }
}
