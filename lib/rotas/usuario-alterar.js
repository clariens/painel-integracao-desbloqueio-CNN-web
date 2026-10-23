import { LOGIN_PATTERN, PERFIS, gerarHash, json, lerCorpo, requireAuth, requireMethod, senhaTemporaria } from "../auth.js";
import { callN8n } from "../n8n.js";
import { revalidarSessao } from "../usuarios.js";


// PATCH /api/usuarios/:login { nome?, perfil?, ativo?, redefinirSenha? }. Só ADMIN.
// redefinirSenha gera uma senha temporária nova, devolvida só nesta resposta.
export default async function handler(req, res) {
  if (!requireMethod(req, res, "PATCH")) return;
  const sessao = requireAuth(req, res, "ADMIN");
  if (!sessao) return;

  const login = String(req.query.login || "").trim();
  if (!LOGIN_PATTERN.test(login)) {
    json(res, 400, { error: "Login inválido." });
    return;
  }

  const body = lerCorpo(req, res);
  if (!body) return;

  const proprio = login.toLowerCase() === sessao.login.toLowerCase();

  if (body.redefinirSenha === true) {
    if (proprio) {
      json(res, 400, { error: "Para mudar a sua própria senha, use Trocar senha no menu." });
      return;
    }
    if (!(await revalidarSessao(res, sessao, "ADMIN"))) return;

    const senha = senhaTemporaria();
    const data = await callN8n(res, "usuarios", { action: "redefinir-senha", login, por: sessao.login, ...gerarHash(senha) });
    if (!data) return;
    json(res, 200, { ok: true, login, senhaTemporaria: senha });
    return;
  }

  const alteracao = {};
  if (body.nome !== undefined) {
    const nome = String(body.nome || "").replace(/\s+/g, " ").trim();
    if (nome.length < 2 || nome.length > 100) {
      json(res, 400, { error: "Informe o nome (2 a 100 caracteres)." });
      return;
    }
    alteracao.nome = nome;
  }
  if (body.perfil !== undefined) {
    const perfil = String(body.perfil || "").toUpperCase();
    if (!PERFIS[perfil]) {
      json(res, 400, { error: "Perfil inválido." });
      return;
    }
    alteracao.perfil = perfil;
  }
  if (body.ativo !== undefined) {
    if (typeof body.ativo !== "boolean") {
      json(res, 400, { error: "ativo precisa ser true ou false." });
      return;
    }
    alteracao.ativo = body.ativo;
  }
  if (!Object.keys(alteracao).length) {
    json(res, 400, { error: "Nada para alterar." });
    return;
  }

  // O admin não se tranca para fora: o perfil e o acesso dele só outro admin muda.
  if (proprio && ((alteracao.perfil && alteracao.perfil !== "ADMIN") || alteracao.ativo === false)) {
    json(res, 400, { error: "Você não pode tirar o seu próprio acesso de admin.", codigo: "PROPRIO_ADMIN" });
    return;
  }

  if (!(await revalidarSessao(res, sessao, "ADMIN"))) return;

  const data = await callN8n(res, "usuarios", { action: "alterar", login, ...alteracao, por: sessao.login });
  if (!data) return;
  json(res, 200, { ok: true, login });
}
