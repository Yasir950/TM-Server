import http2 from "node:http2";
import { createSign } from "node:crypto";

// PushKit VoIP pushes straight to Apple (Expo's push service can't send them). They wake the iOS app so it can
// show the system call screen (CallKit), even when the app is closed or the phone is locked.
// Env: APNS_KEY_ID, APNS_TEAM_ID, APNS_PRIVATE_KEY (contents of the .p8 key, \n escapes allowed), APNS_TOPIC (bundle id).

export const voipConfigured = () => !!(process.env.APNS_KEY_ID && process.env.APNS_TEAM_ID && process.env.APNS_PRIVATE_KEY);

let jwt: { token: string; at: number } | null = null;

// Provider token, reused for 50 minutes (Apple accepts one for up to an hour)
function bearer() {
  if (jwt && Date.now() - jwt.at < 50 * 60_000) return jwt.token;
  const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const head = b64({ alg: "ES256", kid: process.env.APNS_KEY_ID });
  const claims = b64({ iss: process.env.APNS_TEAM_ID, iat: Math.floor(Date.now() / 1000) });
  const key = process.env.APNS_PRIVATE_KEY!.replace(/\\n/g, "\n");
  const sig = createSign("SHA256").update(`${head}.${claims}`).sign({ key, dsaEncoding: "ieee-p1363" }).toString("base64url");
  jwt = { token: `${head}.${claims}.${sig}`, at: Date.now() };
  return jwt.token;
}

type Result = { status: number; reason?: string };

function post(host: string, token: string, body: string, expiration: number): Promise<Result> {
  return new Promise((resolve) => {
    const client = http2.connect(`https://${host}`);
    const done = (r: Result) => {
      client.close();
      resolve(r);
    };
    client.on("error", () => done({ status: 0 }));
    const req = client.request({
      ":method": "POST",
      ":path": `/3/device/${token}`,
      authorization: `bearer ${bearer()}`,
      "apns-topic": `${process.env.APNS_TOPIC || "app.workchime.mobile"}.voip`,
      "apns-push-type": "voip",
      "apns-priority": "10",
      "apns-expiration": String(expiration),
    });
    let status = 0;
    let data = "";
    req.on("response", (h) => (status = Number(h[":status"])));
    req.on("data", (c) => (data += c));
    req.on("end", () => {
      let reason: string | undefined;
      try {
        reason = JSON.parse(data).reason;
      } catch {}
      done({ status, reason });
    });
    req.on("error", () => done({ status: 0 }));
    req.end(body);
  });
}

// Development builds get sandbox tokens and store builds production ones; a token is tried on production first
export async function sendVoip(tokens: string[], payload: Record<string, unknown>) {
  const gone: string[] = [];
  let sent = 0;
  if (!tokens.length || !voipConfigured()) return { sent, gone };
  const body = JSON.stringify(payload);
  // Rings last 30 seconds; an undelivered ring shouldn't arrive later
  const expiration = Math.floor(Date.now() / 1000) + 30;
  await Promise.all(
    tokens.map(async (t) => {
      let r = await post("api.push.apple.com", t, body, expiration);
      if (r.status === 400 && r.reason === "BadDeviceToken") r = await post("api.sandbox.push.apple.com", t, body, expiration);
      if (r.status === 200) sent++;
      else if (r.status === 410 || r.reason === "BadDeviceToken" || r.reason === "Unregistered") gone.push(t);
    }),
  );
  return { sent, gone };
}
