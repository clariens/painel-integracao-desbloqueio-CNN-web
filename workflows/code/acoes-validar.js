// Nó "Validar" (workflow CNN Painel - Ações). A Vercel já validou; aqui valida de novo,
// porque o webhook é a fronteira do n8n. Fora do esperado vira 400 sem tocar no CNN.
const unwrap = (valor) => {
  if (typeof valor === 'string') {
    try {
      return JSON.parse(valor);
    } catch (erro) {
      return {};
    }
  }

  return valor && typeof valor === 'object' && !Array.isArray(valor) ? valor : {};
};

const item = unwrap($input.first().json);
const body = { ...item, ...unwrap(item.body) };

const invalido = (mensagem) => [{
  json: { valido: false, statusCode: 400, response: { error: mensagem } }
}];

const action = String(body.action || '').trim();
if (!['liberar', 'bloquear'].includes(action)) {
  return invalido('Ação desconhecida.');
}

const id = Number(body.id);
if (!Number.isSafeInteger(id) || id <= 0) {
  return invalido('Paciente inválido.');
}

// Unidade escolhida no painel (a Vercel conferiu que o usuário tem acesso). Sem CID configurado, nem chama o CNN.
const unidade = lerUnidade(body);
if (!unidade) {
  return invalido('Unidade inválida.');
}
if (!cidDaUnidade(unidade.codigoUnidade)) {
  return [{ json: { valido: false, statusCode: 500, response: { error: semCidMensagem(unidade.codigoUnidade) } } }];
}

// Liberação a partir de uma solicitação de desbloqueio: o motivo é o da solicitação (decidir confere
// se ela é deste paciente e desta falta). aprovar = "Aprovar e liberar" do admin (a Vercel conferiu o perfil).
let idSolicitacao = null;
if (body.idSolicitacao !== undefined && body.idSolicitacao !== null && body.idSolicitacao !== '') {
  idSolicitacao = Number(body.idSolicitacao);
  if (action !== 'liberar' || !Number.isSafeInteger(idSolicitacao) || idSolicitacao <= 0) {
    return invalido('Solicitação inválida.');
  }
}
const aprovar = idSolicitacao !== null && body.aprovar === true;

const motivo = String(body.motivo || '').replace(/\s+/g, ' ').trim();
const motivoDaSolicitacao = idSolicitacao !== null && motivo === '';
if (!motivoDaSolicitacao && (motivo.length < 5 || motivo.length > 500)) {
  return invalido('Informe o motivo (de 5 a 500 caracteres).');
}

const usuario = String(body.usuario || '').trim();
if (!/^[A-Za-z0-9._-]{2,50}$/.test(usuario)) {
  return invalido('Usuário da ação ausente.');
}

// Segunda chamada, depois que o painel avisou que o CNN já está no estado pedido:
// grava a ação no controle e na auditoria sem enviar PATCH.
const apenasRegistrar = body.apenasRegistrar === true;

return [{
  json: {
    valido: true,
    action,
    id,
    ...unidade,
    motivo,
    usuario,
    apenasRegistrar,
    idSolicitacao,
    aprovar,
    inicioCiclo: inicioCiclo(),
    hoje: hojeSp()
  }
}];
