// Nó "Montar resposta" (workflow CNN Painel - Usuários). Devolve { statusCode, response }.
// Salt e hash só saem em login-buscar, que a Vercel usa para conferir a senha; listar nunca os devolve.
const meta = $('Preparar').first().json;

if (meta.action === 'error') {
  return [{ json: { statusCode: meta.statusCode || 400, response: meta.response || { error: 'Requisição inválida.' } } }];
}

const sqlItens = $('Executar').all();
const falha = erroSql(sqlItens);
if (falha) {
  return [{ json: { statusCode: 502, response: { error: `Falha no banco de usuários: ${String(falha).slice(0, 300)}` } } }];
}

const linhas = linhasSql(sqlItens);
const bool = (valor) => valor === true || valor === 1 || valor === '1';
const iso = (valor) => {
  if (!valor) return null;
  const data = valor instanceof Date ? valor : new Date(String(valor).includes('T') || String(valor).endsWith('Z') ? valor : `${String(valor).replace(' ', 'T')}Z`);
  return Number.isNaN(data.getTime()) ? String(valor) : data.toISOString();
};
const responder = (statusCode, response) => [{ json: { statusCode, response } }];
// Unidades que o usuário acessa (login-buscar e sessao): [{ id, codigo, nome }].
const unidades = linhas
  .filter((linha) => linha._secao === 'unidade')
  .map((u) => ({ id: Number(u.IdUnidade), codigo: u.Codigo, nome: u.Nome, ...(u.Ativa !== undefined ? { ativa: bool(u.Ativa) } : {}) }));

if (meta.action === 'login-buscar') {
  const u = linhas.find((linha) => linha.Login);
  return responder(200, {
    usuario: u
      ? {
          login: u.Login,
          nome: u.Nome,
          perfil: u.Perfil,
          ativo: bool(u.Ativo),
          salt: String(u.SenhaSalt || '').trim(),
          hash: String(u.SenhaHash || '').trim(),
          trocarSenha: bool(u.TrocarSenha),
          versaoSessao: Number(u.VersaoSessao || 1),
          bloqueado: bool(u.Bloqueado),
          bloqueadoAte: iso(u.BloqueadoAte),
          unidades,
        }
      : null,
  });
}

if (meta.action === 'sessao') {
  const u = linhas.find((linha) => linha.Login);
  return responder(200, {
    usuario: u ? { login: u.Login, nome: u.Nome, perfil: u.Perfil, ativo: bool(u.Ativo), versaoSessao: Number(u.VersaoSessao || 1), unidades } : null,
  });
}

if (meta.action === 'login-resultado') {
  const r = linhas[0] || {};
  return responder(200, { bloqueadoAte: iso(r.BloqueadoAte) });
}

if (meta.action === 'listar') {
  // Unidades de cada LEITOR/EDITOR (o ADMIN acessa todas: a tela mostra "Todas").
  const vinculos = new Map();
  for (const v of linhas.filter((linha) => linha._secao === 'vinculo')) {
    vinculos.set(v.Login, [...(vinculos.get(v.Login) || []), Number(v.IdUnidade)]);
  }
  const usuarios = linhas
    .filter((linha) => linha._secao === 'usuario')
    .map((u) => ({
      login: u.Login,
      nome: u.Nome,
      perfil: u.Perfil,
      ativo: bool(u.Ativo),
      trocarSenha: bool(u.TrocarSenha),
      bloqueadoAte: iso(u.BloqueadoAte),
      ultimoAcessoEm: iso(u.UltimoAcessoEm),
      criadoEm: iso(u.CriadoEm),
      criadoPor: u.CriadoPor || null,
      alteradoEm: iso(u.AlteradoEm),
      alteradoPor: u.AlteradoPor || null,
      unidades: (vinculos.get(u.Login) || []).sort((a, b) => a - b),
    }))
    .sort((a, b) => Number(b.ativo) - Number(a.ativo) || String(a.nome).localeCompare(String(b.nome), 'pt-BR'));
  const eventos = linhas
    .filter((linha) => linha._secao === 'evento')
    .map((e) => ({ id: Number(e.Id), login: e.Login, evento: e.Evento, detalhe: e.Detalhe || null, por: e.Por || null, em: iso(e.CriadoEm) }));
  return responder(200, { asOf: new Date().toISOString(), usuarios, unidades, eventos });
}

// Escritas: criar, alterar, redefinir-senha, trocar-senha.
const r = linhas.find((linha) => linha.Resultado) || {};
const RESULTADOS = {
  OK: [200, null],
  LOGIN_EXISTE: [409, 'Já existe um usuário com esse login.'],
  NAO_ENCONTRADO: [404, 'Usuário não encontrado (ou desativado).'],
  ULTIMO_ADMIN: [409, 'Este é o único admin ativo: crie ou promova outro admin antes.'],
  UNIDADE_INVALIDA: [400, 'Unidade inexistente ou desativada.'],
  SEM_UNIDADE: [409, 'Escolha ao menos uma unidade para este usuário (só o admin acessa todas sem escolher).'],
};
const [statusCode, mensagem] = RESULTADOS[r.Resultado] || [502, 'O banco não confirmou a alteração.'];

if (statusCode !== 200) {
  return responder(statusCode, { error: mensagem, codigo: r.Resultado || 'SEM_RESULTADO' });
}

return responder(200, { ok: true, login: meta.login, ...(r.VersaoSessao !== undefined && r.VersaoSessao !== null ? { versaoSessao: Number(r.VersaoSessao) } : {}) });
