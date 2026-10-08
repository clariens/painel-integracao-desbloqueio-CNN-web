import { assinarSessao, conferirSenha, gerarHash, json, lerCorpo, requireAuth, requireMethod, validarSenha } from "../lib/auth.js";
import { chamarN8n, responderFalha } from "../lib/n8n.js";

export const config = { runtime: "nodejs" };

// POST /api/senha { atual, nova } → troca a própria senha e devolve um token novo.
// Também é a saída da senha temporária: passa mesmo com trocarSenha na sessão.
export default async function handler(req, res) {
  if (!requireMethod(req, res, "POST")) return;
  const sessao = requireAuth(req, res, "LEITOR", { permitirTrocaSenha: true });
  if (!sessao) return;

  const body = lerCorpo(req, res);
  if (!body) return;

  const atual = String(body.atual || "");
  const nova = String(body.nova || "");
  const problema = validarSenha(nova);
  if (problema) {
    json(res, 400, { error: problema });
    return;
  }
  if (nova === atual) {
    json(res, 400, { error: "A nova senha precisa ser diferente da atual." });
    return;
  }

  const busca = await chamarN8n("usuarios", { action: "login-buscar", login: sessao.login });
  if (!busca.ok) {
    responderFalha(res, busca);
    return;
  }

  const usuario = busca.data?.usuario;
  if (!usuario || !usuario.ativo || usuario.versaoSessao !== sessao.ver) {
    json(res, 401, { error: "Seu acesso mudou desde o login. Entre de novo." });
    return;
  }
  if (!conferirSenha(atual, usuario.salt, usuario.hash)) {
    json(res, 400, { error: "A senha atual não confere.", codigo: "SENHA_ATUAL" });
    return;
  }

  const troca = await chamarN8n("usuarios", { action: "trocar-senha", login: usuario.login, ...gerarHash(nova) });
  if (!troca.ok) {
    responderFalha(res, troca);
    return;
  }

  json(res, 200, {
    token: assinarSessao({ ...usuario, trocarSenha: false, versaoSessao: troca.data.versaoSessao }),
    usuario: { login: usuario.login, nome: usuario.nome, perfil: usuario.perfil },
    trocarSenha: false,
  });
}
