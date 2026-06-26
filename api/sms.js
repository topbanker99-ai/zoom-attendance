// POST /api/sms  — 문자(SMS/LMS) 발송 (관리자 전용, 솔라피)
// body: { recipients:[전화번호...], text, from, dryRun }
// header: x-admin-key: <ADMIN_KEY>
import pkg from "solapi";
const { SolapiMessageService } = pkg;

const ADMIN_KEY = process.env.ADMIN_KEY || "";
const MAX_RECIPIENTS = 500;

function normPhone(p) {
  let d = String(p || "").replace(/[^0-9]/g, "");
  if (d && !d.startsWith("0")) d = "0" + d;
  return d;
}
// CP949 기준 대략 바이트 수 (한글 2, 그 외 1)
function byteLen(s) {
  let n = 0;
  for (const ch of String(s)) n += ch.charCodeAt(0) > 0x7f ? 2 : 1;
  return n;
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-admin-key");
  if (req.method === "OPTIONS") { res.status(204).end(); return; }
  if (req.method !== "POST") { res.status(405).json({ error: "POST only" }); return; }

  if (!ADMIN_KEY) {
    res.status(500).json({ error: "서버에 ADMIN_KEY가 설정되지 않았습니다. Vercel 환경변수를 확인하세요." });
    return;
  }
  if ((req.headers["x-admin-key"] || "") !== ADMIN_KEY) {
    res.status(401).json({ error: "관리자 키가 올바르지 않습니다." });
    return;
  }

  let body = req.body;
  if (typeof body === "string") { try { body = JSON.parse(body); } catch { body = {}; } }
  body = body || {};

  const text = (body.text || "").trim();
  const from = normPhone(body.from);
  const dryRun = !!body.dryRun;

  const seen = {};
  const list = [];
  (Array.isArray(body.recipients) ? body.recipients : []).forEach((r) => {
    const d = normPhone(r);
    if (d.length >= 9 && !seen[d]) { seen[d] = 1; list.push(d); }
  });

  if (!list.length) { res.status(400).json({ error: "유효한 수신번호가 없습니다." }); return; }
  if (!text) { res.status(400).json({ error: "문자 내용(text)이 비어 있습니다." }); return; }
  if (!from) { res.status(400).json({ error: "발신번호(from)가 없습니다. 솔라피에 등록한 번호를 입력하세요." }); return; }
  if (list.length > MAX_RECIPIENTS) {
    res.status(400).json({ error: `한 번에 최대 ${MAX_RECIPIENTS}명까지 발송할 수 있습니다. (요청 ${list.length}명)` });
    return;
  }

  const bytes = byteLen(text);
  const isLMS = bytes > 90;
  const type = isLMS ? "LMS" : "SMS";
  const perWon = isLMS ? 40 : 20; // 대략 단가
  const estTotalWon = list.length * perWon;

  if (dryRun) {
    res.status(200).json({
      ok: true, dryRun: true, count: list.length, sample: list.slice(0, 5),
      type, bytes, perWon, estTotalWon,
    });
    return;
  }

  const messages = list.map((to) => {
    const m = { to, from, text, type };
    if (isLMS) m.subject = "한국농어촌공사 교육 안내";
    return m;
  });

  try {
    const svc = new SolapiMessageService(process.env.SOLAPI_API_KEY, process.env.SOLAPI_API_SECRET);
    const result = await svc.send(messages);
    res.status(200).json({ ok: true, count: messages.length, type, estTotalWon, result });
  } catch (e) {
    console.error("sms send error:", e);
    res.status(500).json({
      ok: false,
      error: (e && e.message) || String(e),
      detail: e && e.failedMessageList ? e.failedMessageList : undefined,
    });
  }
}
