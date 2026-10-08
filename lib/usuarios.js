import { json, temPerfil } from "./auth.js";
import { chamarN8n, responderFalha } from "./n8n.js";

/**
 * Antes de uma escrita (liberar, bloquear, gerenciar usuários), confere no banco se a sessão ainda vale:
 * usuário ativo, perfil suficiente e mesma VersaoSessao (sobe quando o admin muda perfil, desativa ou redefine a senha).
 * Leituras confiam no token até ele expirar (8 h). Devolve true, ou responde e devolve false.
 */
export const revalidarSessao = async (res, sessao, perfilMinimo) => {
  const resultado = await chamarN8n("usuarios", { action: "sessao", login: sessao.login });
  if (!resultado.ok) {
    responderFalha(res, resultado);
    return false;
  }

  const atual = resultado.data?.usuario;
  if (!atual || !atual.ativo || atual.versaoSessao !== sessao.ver) {
    json(res, 401, { error: "Seu acesso mudou desde o login. Entre de novo." });
    return false;
  }

  if (!temPerfil(atual, perfilMinimo)) {
    json(res, 403, { error: "Seu perfil não permite esta ação.", codigo: "SEM_PERMISSAO" });
    return false;
  }

  return true;
};
