import { json, requireAuth, requireMethod } from "../../lib/auth.js";
import { callN8n } from "../../lib/n8n.js";

export const config = { runtime: "nodejs" };

export default async function handler(req, res) {
  if (!requireMethod(req, res, "GET")) return;
  if (!requireAuth(req, res)) return;

  const data = await callN8n(res, "leitura", { action: "pacientes" });
  if (!data) return;

  json(res, 200, data);
}
