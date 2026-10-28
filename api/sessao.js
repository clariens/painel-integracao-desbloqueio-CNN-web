import { LOGIN_PATTERN, assinarSessao, conferirSenha, json, lerCorpo, requireMethod } from "../lib/auth.js";
import { chamarN8n, responderFalha } from "../lib/n8n.js";

export const config = { runtime: "nodejs" };

const INVALIDO = "Usuário ou senha inválidos.";

const horaSp = (iso) =>
  new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" });

const bloqueado = (res, ate) => {
  json(res, 429, { error: `Muitas tentativas erradas. Tente de novo depois das ${horaSp(ate)}.`, codigo: "LOGIN_BLOQUEADO" });
};

// POST /api/sessao { usuario, senha } → { token, usuario: { login, nome, perfil, unidades }, trocarSenha }.
// unidades: [{ id, codigo, nome }] que a pessoa acessa (o admin, todas). O painel escolhe uma e manda em X-Unidade.
// Erro sempre genérico: não diz se o login existe, está desativado ou se a senha é que está errada.
export default async function handler(req, res) {
  if (!requireMethod(req, res, "POST")) return;

  const body = lerCorpo(req, res);
  if (!body) return;

  const login = String(body.usuario || "").trim();
  const senha = String(body.senha || "");
  if (!LOGIN_PATTERN.test(login) || !senha || senha.length > 200) {
    json(res, 401, { error: INVALIDO });
    return;
  }

  const busca = await chamarN8n("usuarios", { action: "login-buscar", login });
  if (!busca.ok) {
    responderFalha(res, busca);
    return;
  }

  const usuario = busca.data?.usuario;
  // Confere mesmo sem usuário (com hash fictício): o tempo de resposta não denuncia quais logins existem.
  const senhaOk = conferirSenha(senha, usuario?.salt, usuario?.hash);

  if (!usuario || !usuario.ativo) {
    json(res, 401, { error: INVALIDO });
    return;
  }

  if (usuario.bloqueado) {
    bloqueado(res, usuario.bloqueadoAte);
    return;
  }

  const resultado = await chamarN8n("usuarios", { action: "login-resultado", login: usuario.login, sucesso: senhaOk });

  if (!senhaOk) {
    const ate = resultado.ok ? resultado.data?.bloqueadoAte : null;
    if (ate) {
      bloqueado(res, ate);
      return;
    }
    json(res, 401, { error: INVALIDO });
    return;
  }

  const unidades = Array.isArray(usuario.unidades) ? usuario.unidades : [];
  if (!unidades.length) {
    json(res, 403, { error: "Seu usuário não tem nenhuma unidade liberada. Fale com o administrador.", codigo: "SEM_UNIDADE" });
    return;
  }

  json(res, 200, {
    token: assinarSessao(usuario),
    usuario: { login: usuario.login, nome: usuario.nome, perfil: usuario.perfil, unidades },
    trocarSenha: usuario.trocarSenha,
  });
}
