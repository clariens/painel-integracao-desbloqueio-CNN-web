import { json, lerIdPaciente, requireAuth, requireMethod } from "../auth.js";
import { callN8n } from "../n8n.js";


export default async function handler(req, res) {
  if (!requireMethod(req, res, "GET")) return;
  if (!requireAuth(req, res)) return;

  const id = lerIdPaciente(req, res);
  if (id === null) return;

  const data = await callN8n(res, "leitura", { action: "paciente", id });
  if (!data) return;

  json(res, 200, data);
}
