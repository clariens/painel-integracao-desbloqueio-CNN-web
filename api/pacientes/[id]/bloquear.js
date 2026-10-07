import { handleAcao } from "../../../lib/acao.js";

export const config = { runtime: "nodejs" };

export default async function handler(req, res) {
  await handleAcao(req, res, "bloquear");
}
