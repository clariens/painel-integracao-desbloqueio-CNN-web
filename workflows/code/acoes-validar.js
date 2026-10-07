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

const motivo = String(body.motivo || '').replace(/\s+/g, ' ').trim();
if (motivo.length < 5 || motivo.length > 500) {
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
    motivo,
    usuario,
    apenasRegistrar,
    inicioCiclo: inicioCiclo(),
    hoje: hojeSp()
  }
}];
