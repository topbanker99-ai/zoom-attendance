// POST /api/voice  — 자동 음성전화(ARS) 발송 (관리자 전용, 솔라피)
// body: { recipients:[전화번호...], text, from, voiceType, headerMessage, tailMessage, dryRun }
// header: x-admin-key: <ADMIN_KEY>
import pkg from "solapi";
const { SolapiMessageService } = pkg;

const ADMIN_KEY = process.env.ADMIN_KEY || "";
const MAX_RECIPIENTS = 200; // 폭주/오발송 방지 상한

function normPhone(p) {
  let d = String(p || "").replace(/[^0-9]/g, "");
  if (d && !d.startsWith("0")) d = "0" + d; // 엑셀 앞자리 0 보정
  return d;
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-admin-key");
  if (req.method === "OPTIONS") { res.status(204).end(); return; }
  if (req.method !== "POST") { res.status(405).json({ error: "POST only" }); return; }

  // 돈이 나가는 기능 → 관리자 키 필수
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
  const voiceType = body.voiceType === "MALE" ? "MALE" : "FEMALE";
  const headerMessage = (body.headerMessage || "").trim();
  const tailMessage = (body.tailMessage || "").trim();
  const dryRun = !!body.dryRun;

  // 수신번호 정규화 + 중복 제거
  const seen = {};
  const list = [];
  (Array.isArray(body.recipients) ? body.recipients : []).forEach((r) => {
    const d = normPhone(r);
    if (d.length >= 9 && !seen[d]) { seen[d] = 1; list.push(d); }
  });

  if (!list.length) { res.status(400).json({ error: "유효한 수신번호가 없습니다." }); return; }
  if (!text) { res.status(400).json({ error: "음성 문구(text)가 비어 있습니다." }); return; }
  if (!from) { res.status(400).json({ error: "발신번호(from)가 없습니다. 솔라피에 등록한 번호를 입력하세요." }); return; }
  if (list.length > MAX_RECIPIENTS) {
    res.status(400).json({ error: `한 번에 최대 ${MAX_RECIPIENTS}명까지 발송할 수 있습니다. (요청 ${list.length}명)` });
    return;
  }

  // 대략적 비용 추정 (한글 약 5자/초, 기본 200원 + 초당 4원)
  const estSeconds = Math.max(5, Math.ceil([...text].length / 5));
  const estPerWon = 200 + 4 * estSeconds;
  const estTotalWon = list.length * estPerWon;

  if (dryRun) {
    res.status(200).json({
      ok: true, dryRun: true, count: list.length,
      sample: list.slice(0, 5), estPerWon, estTotalWon, estSeconds,
    });
    return;
  }

  const voiceOptions = { voiceType };
  if (headerMessage) voiceOptions.headerMessage = headerMessage;
  if (tailMessage) voiceOptions.tailMessage = tailMessage;

  const messages = list.map((to) => ({ to, from, text, type: "VOICE", voiceOptions }));

  try {
    const svc = new SolapiMessageService(process.env.SOLAPI_API_KEY, process.env.SOLAPI_API_SECRET);
    const result = await svc.send(messages);
    res.status(200).json({ ok: true, count: messages.length, estTotalWon, result });
  } catch (e) {
    console.error("voice send error:", e);
    res.status(500).json({
      ok: false,
      error: (e && e.message) || String(e),
      detail: e && e.failedMessageList ? e.failedMessageList : undefined,
    });
  }
}
