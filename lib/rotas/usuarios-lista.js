import { LOGIN_PATTERN, PERFIS, gerarHash, json, lerCorpo, lerListaUnidades, requireAuth, senhaTemporaria } from "../auth.js";
import { callN8n } from "../n8n.js";
import { revalidarSessao } from "../usuarios.js";


// GET /api/usuarios → { usuarios, unidades, eventos } (unidades = catálogo, para a tela marcar as de cada um).
// POST { login, nome, perfil, unidades } → cria com senha temporária, devolvida só nesta resposta. Só ADMIN.
// unidades (lista de IdUnidade) é obrigatória para LEITOR e EDITOR; o ADMIN acessa todas.
export default async function handler(req, res) {
  if (req.method !== "GET" && req.method !== "POST") {
    json(res, 405, { error: "Método não permitido" }, { Allow: "GET, POST" });
    return;
  }

  const sessao = requireAuth(req, res, "ADMIN");
  if (!sessao) return;

  if (req.method === "GET") {
    const data = await callN8n(res, "usuarios", { action: "listar" });
    if (!data) return;
    json(res, 200, data);
    return;
  }

  const body = lerCorpo(req, res);
  if (!body) return;

  const login = String(body.login || "").trim().toLowerCase();
  const nome = String(body.nome || "").replace(/\s+/g, " ").trim();
  const perfil = String(body.perfil || "").toUpperCase();

  if (!LOGIN_PATTERN.test(login)) {
    json(res, 400, { error: "Login inválido: use letras, números, ponto, _ ou - (2 a 50 caracteres)." });
    return;
  }
  if (nome.length < 2 || nome.length > 100) {
    json(res, 400, { error: "Informe o nome (2 a 100 caracteres)." });
    return;
  }
  if (!PERFIS[perfil]) {
    json(res, 400, { error: "Perfil inválido." });
    return;
  }
  const unidades = perfil === "ADMIN" ? [] : lerListaUnidades(body.unidades);
  if (!unidades || (perfil !== "ADMIN" && !unidades.length)) {
    json(res, 400, { error: "Escolha ao menos uma unidade." });
    return;
  }

  if (!(await revalidarSessao(res, sessao, "ADMIN"))) return;

  const senha = senhaTemporaria();
  const data = await callN8n(res, "usuarios", { action: "criar", login, nome, perfil, unidades, por: sessao.login, ...gerarHash(senha) });
  if (!data) return;

  json(res, 201, { ok: true, login, senhaTemporaria: senha });
}
