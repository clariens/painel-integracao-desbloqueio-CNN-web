// Nó "Montar resposta" (workflow CNN Painel - Leitura). Separa as linhas por _secao e devolve { statusCode, response }.
// Dado sensível (CPF, e-mail, telefone) não sai daqui: o CPF vai mascarado, o resto nem é consultado.
const meta = $('Preparar consulta').first().json;

if (meta.action === 'error') {
  return [{ json: { statusCode: meta.statusCode || 400, response: meta.response || { error: 'Requisição inválida.' } } }];
}

const sqlItens = $('Consultar').all();
const falha = erroSql(sqlItens);
if (falha) {
  return [{ json: { statusCode: 502, response: { error: `Falha na consulta ao banco: ${String(falha).slice(0, 300)}` } } }];
}

const porSecao = {};
for (const linha of linhasSql(sqlItens)) {
  const secao = linha._secao;
  if (!secao) {
    continue;
  }
  const { _secao, ...resto } = linha;
  (porSecao[secao] ||= []).push(resto);
}

const secao = (nome) => porSecao[nome] || [];
const num = (valor) => Number(valor || 0);
const bool = (valor) => valor === true || valor === 1 || valor === '1';
const iso = (valor) => {
  if (!valor) return null;
  const data = valor instanceof Date ? valor : new Date(String(valor).includes('T') || String(valor).endsWith('Z') ? valor : `${String(valor).replace(' ', 'T')}Z`);
  return Number.isNaN(data.getTime()) ? String(valor) : data.toISOString();
};
const ok = (response) => [{ json: { statusCode: 200, response: { asOf: new Date().toISOString(), ...response } } }];

const mascararCpf = (valor) => {
  const digitos = String(valor || '').replace(/\D/g, '');
  if (digitos.length === 11) return `***.${digitos.slice(3, 6)}.${digitos.slice(6, 9)}-**`;
  if (digitos.length === 14) return `**.${digitos.slice(2, 5)}.${digitos.slice(5, 8)}/****-**`;
  return digitos ? '***' : null;
};

// Situação do paciente: a tabela de controle vale enquanto aponta para a falta vigente.
// Sem registro para a falta vigente, ninguém confirmou o bloqueio no CNN -> PENDENTE ("Aguardando bloqueio"),
// com o prazo correndo ou não: toda falta do período bloqueia; o prazo 60/90/180 só diz quando pode liberar.
const situacaoDe = (vigente, controle) => {
  const controleVale = controle?.Situacao && String(controle.IdAgendaReferencia ?? '') === String(vigente.IdAgenda ?? '');
  const prazoCorrendo = Boolean(vigente.DataFimBloqueio) && vigente.DataFimBloqueio >= meta.hoje;

  if (!controleVale) {
    return { situacao: 'PENDENTE', status: 'pendente', controleVale };
  }

  if (controle.Situacao === 'LIBERADO') {
    return { situacao: 'LIBERADO', status: prazoCorrendo ? 'liberado_antecipado' : 'liberado', controleVale };
  }
  return { situacao: 'BLOQUEADO', status: prazoCorrendo ? 'bloqueado' : 'apto', controleVale };
};

if (meta.action === 'pacientes') {
  const items = secao('paciente').map((linha) => {
    const { situacao, status, controleVale } = situacaoDe(linha, linha);
    return {
      idPaciente: num(linha.IdPaciente),
      nome: linha.NomePaciente || null,
      idAgenda: linha.IdAgenda,
      dataFalta: dataIso(linha.DataFalta),
      numeroFalta: num(linha.NumeroFalta),
      profissional: linha.NomeExecutor || null,
      faltasCiclo: num(linha.FaltasCiclo),
      faltasTotal: num(linha.FaltasTotal),
      diasBloqueio: num(linha.DiasBloqueio),
      dataFimBloqueio: dataIso(linha.DataFimBloqueio),
      foraDoCiclo: dataIso(linha.DataFalta) < meta.inicio,
      situacao,
      status,
      ultimaAcao: linha.UltimaAcao
        ? {
            acao: linha.UltimaAcao,
            origem: linha.OrigemUltimaAcao,
            usuario: linha.UltimaAcaoPor,
            em: iso(linha.UltimaAcaoEm),
            vigente: controleVale
          }
        : null
    };
  });

  const contar = (filtro) => items.filter(filtro).length;
  const totais = secao('totais')[0] || {};

  return ok({
    ciclo: { inicio: meta.inicio, hoje: meta.hoje },
    resumo: {
      pendentes: contar((item) => item.status === 'pendente'),
      bloqueados: contar((item) => item.status === 'bloqueado'),
      aptos: contar((item) => item.status === 'apto'),
      liberadosAntecipados: contar((item) => item.status === 'liberado_antecipado'),
      liberados: contar((item) => item.status === 'liberado'),
      pacientesCiclo: contar((item) => item.faltasCiclo > 0),
      porFaltas: {
        1: contar((item) => item.faltasCiclo === 1),
        2: contar((item) => item.faltasCiclo === 2),
        3: contar((item) => item.faltasCiclo >= 3)
      },
      faltasCiclo: num(totais.FaltasCiclo),
      faltasMes: num(totais.FaltasMes),
      ultimaColeta: iso(totais.UltimaColeta),
      ultimoBloqueioAutomatico: iso(totais.UltimoBloqueioAutomatico),
      controleCarregado: num(totais.LinhasControle) > 0
    },
    total: items.length,
    items
  });
}

if (meta.action === 'paciente') {
  const faltas = secao('falta');
  const controle = secao('controle')[0] || null;

  if (!faltas.length && !controle) {
    return [{ json: { statusCode: 404, response: { error: 'Paciente sem faltas registradas.' } } }];
  }

  const noCiclo = faltas.filter((falta) => dataIso(falta.DataFalta) >= meta.inicio);
  const candidatas = noCiclo.length ? noCiclo : faltas;
  const vigenteLinha = [...candidatas].sort((a, b) =>
    num(b.NumeroFalta) - num(a.NumeroFalta) || String(b.DataFalta).localeCompare(String(a.DataFalta)) || num(b.IdAgenda) - num(a.IdAgenda)
  )[0] || null;

  let vigente = null;
  if (vigenteLinha) {
    const diasBloqueio = diasPorFalta(num(vigenteLinha.NumeroFalta));
    const base = {
      IdAgenda: vigenteLinha.IdAgenda,
      DataFimBloqueio: somarDias(dataIso(vigenteLinha.DataFalta), diasBloqueio)
    };
    const { situacao, status } = situacaoDe(base, controle);
    vigente = {
      idAgenda: vigenteLinha.IdAgenda,
      dataFalta: dataIso(vigenteLinha.DataFalta),
      numeroFalta: num(vigenteLinha.NumeroFalta),
      diasBloqueio,
      dataFimBloqueio: base.DataFimBloqueio,
      noCiclo: noCiclo.length > 0,
      situacao,
      status
    };
  }

  let cnn = { consultado: false, ativo: null, erro: null };
  try {
    const resposta = lerRespostaHttp($('GET paciente CNN').first().json);
    const body = resposta.body && typeof resposta.body === 'object' ? resposta.body : {};
    cnn = resposta.ok && body.id != null
      ? { consultado: true, ativo: typeof body.ativo === 'boolean' ? body.ativo : null, erro: null }
      : { consultado: true, ativo: null, erro: resposta.statusCode ? `HTTP ${resposta.statusCode}` : resposta.erro || 'sem resposta' };
  } catch (erro) {
    cnn = { consultado: false, ativo: null, erro: 'GET não executado' };
  }

  const primeira = faltas.find((falta) => falta.NomePaciente) || faltas[0] || {};

  return ok({
    idPaciente: meta.id,
    nome: primeira.NomePaciente || null,
    cpf: mascararCpf(faltas.find((falta) => falta.CpfCnpj)?.CpfCnpj),
    ciclo: { inicio: meta.inicio, hoje: meta.hoje },
    cnn,
    vigente,
    controle: controle
      ? {
          situacao: controle.Situacao,
          idAgendaReferencia: controle.IdAgendaReferencia,
          numeroFalta: controle.NumeroFalta,
          dataFimBloqueio: dataIso(controle.DataFimBloqueio),
          ultimaAcao: controle.UltimaAcao,
          origem: controle.OrigemUltimaAcao,
          usuario: controle.UltimaAcaoPor,
          motivo: controle.MotivoUltimaAcao,
          em: iso(controle.UltimaAcaoEm)
        }
      : null,
    faltas: faltas.map((falta) => ({
      idAgenda: falta.IdAgenda,
      dataFalta: dataIso(falta.DataFalta),
      horaInicio: falta.HoraInicio || null,
      numeroFalta: num(falta.NumeroFalta),
      profissional: falta.NomeExecutor || null,
      tipoProfissional: falta.TipoExecutor || null,
      noCiclo: dataIso(falta.DataFalta) >= meta.inicio,
      coletadaEm: iso(falta.DataColeta)
    })),
    acoes: secao('acao').map((acao) => ({
      id: acao.Id,
      acao: acao.Acao,
      origem: acao.Origem,
      usuario: acao.Usuario,
      motivo: acao.Motivo,
      idAgenda: acao.IdAgendaReferencia,
      numeroFalta: acao.NumeroFalta,
      dataFimBloqueio: dataIso(acao.DataFimBloqueio),
      antecipada: bool(acao.Antecipada),
      ativoAntes: acao.AtivoAntes === null || acao.AtivoAntes === undefined ? null : bool(acao.AtivoAntes),
      sucesso: bool(acao.Sucesso),
      httpStatus: acao.HttpStatus,
      respostaApi: acao.RespostaApi,
      em: iso(acao.CriadoEm)
    }))
  });
}

if (meta.action === 'faltas') {
  const total = secao('total')[0] || {};
  const linhas = secao('linha');
  const limite = 5000;

  return ok({
    periodo: { de: meta.de, ate: meta.ate, inicioCiclo: meta.inicio },
    total: { faltas: num(total.Faltas), pacientes: num(total.Pacientes) },
    porMes: secao('mes')
      .map((linha) => ({ mes: linha.Mes, faltas: num(linha.Faltas), pacientes: num(linha.Pacientes) }))
      .sort((a, b) => a.mes.localeCompare(b.mes)),
    porDiaSemana: secao('diaSemana')
      .map((linha) => ({ dia: num(linha.DiaSemana), faltas: num(linha.Faltas) }))
      .sort((a, b) => a.dia - b.dia),
    porProfissional: secao('profissional').map((linha) => ({
      profissional: linha.Profissional,
      faltas: num(linha.Faltas),
      pacientes: num(linha.Pacientes)
    })),
    reincidencia: secao('reincidencia')
      .map((linha) => ({ quantidade: num(linha.Quantidade), pacientes: num(linha.Pacientes) }))
      .sort((a, b) => a.quantidade - b.quantidade),
    maiorFaltaRegra,
    reincidentes: secao('reincidente').map((linha) => ({
      idPaciente: num(linha.IdPaciente),
      nome: linha.NomePaciente || null,
      faltas: num(linha.Faltas),
      ultimaFalta: dataIso(linha.UltimaFalta)
    })),
    truncado: linhas.length > limite,
    linhas: linhas.slice(0, limite).map((linha) => ({
      idAgenda: linha.IdAgenda,
      idPaciente: num(linha.IdPaciente),
      nome: linha.NomePaciente || null,
      dataFalta: dataIso(linha.DataFalta),
      horaInicio: linha.HoraInicio || null,
      numeroFalta: num(linha.NumeroFalta),
      profissional: linha.NomeExecutor || null
    }))
  });
}

if (meta.action === 'acoes') {
  const contagem = secao('contagem')[0] || {};

  return ok({
    page: meta.page,
    pageSize: meta.pageSize,
    total: num(contagem.Total),
    contagem: {
      bloqueios: num(contagem.Bloqueios),
      liberacoes: num(contagem.Liberacoes),
      antecipadas: num(contagem.Antecipadas),
      falhas: num(contagem.Falhas)
    },
    usuarios: secao('usuario').map((linha) => linha.Usuario),
    items: secao('acao').map((acao) => ({
      id: acao.Id,
      idPaciente: num(acao.IdPaciente),
      nome: acao.NomePaciente || null,
      acao: acao.Acao,
      origem: acao.Origem,
      usuario: acao.Usuario,
      motivo: acao.Motivo,
      idAgenda: acao.IdAgendaReferencia,
      numeroFalta: acao.NumeroFalta,
      dataFimBloqueio: dataIso(acao.DataFimBloqueio),
      antecipada: bool(acao.Antecipada),
      sucesso: bool(acao.Sucesso),
      httpStatus: acao.HttpStatus,
      respostaApi: acao.RespostaApi,
      execucao: acao.IdExecucaoN8n,
      em: iso(acao.CriadoEm)
    }))
  });
}

if (meta.action === 'parametros') {
  const status = secao('status')[0] || {};

  return ok({
    regra: {
      prazosDias: REGRA.prazosDias,
      maiorFalta: maiorFaltaRegra,
      cicloInicio: REGRA.cicloInicio,
      fuso: REGRA.fuso,
      horarioBloqueio: REGRA.horarioBloqueio,
      liberacaoAutomatica: REGRA.liberacaoAutomatica
    },
    ciclo: { inicio: meta.inicio, hoje: meta.hoje },
    status: {
      ultimaColeta: iso(status.UltimaColeta),
      ultimoBloqueioAutomatico: iso(status.UltimoBloqueioAutomatico),
      ultimaAcaoPainel: iso(status.UltimaAcaoPainel),
      linhasControle: num(status.LinhasControle),
      linhasFaltas: num(status.LinhasFaltas)
    }
  });
}

return [{ json: { statusCode: 400, response: { error: 'Ação desconhecida.' } } }];
