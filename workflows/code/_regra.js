// ===== Regra do bloqueio por falta (fonte única: workflows/code/_regra.js) =====
// O inject.mjs copia este bloco para o início de todo nó Code que usa prazo ou ciclo.
// Para mudar a regra: edite aqui, rode `npm run inject` e publique os workflows no n8n.
const REGRA = {
  // Prazo (dias) a partir da falta vigente do ciclo para o paciente poder ser LIBERADO. A maior chave vale para
  // "essa ou mais". Não decide o bloqueio: toda falta do período (ciclo) bloqueia quem está ativo no CNN.
  prazosDias: { 1: 60, 2: 90, 3: 180 },
  // Início do ciclo: de agosto a dezembro, 1/8 do ano corrente; de janeiro a julho, 1/8 do ano anterior.
  cicloInicio: { mes: 8, dia: 1 },
  fuso: 'America/Sao_Paulo',
  // Só informativos (o cron fica no nó "Todo dia 01:00" do workflow de bloqueio).
  horarioBloqueio: '01:00',
  liberacaoAutomatica: false,
};

const pad2 = (valor) => String(valor).padStart(2, '0');
const agoraSp = () => $now.setZone(REGRA.fuso);
const hojeSp = () => agoraSp().toFormat('yyyy-MM-dd');

const inicioCiclo = () => {
  const agora = agoraSp();
  const { mes, dia } = REGRA.cicloInicio;
  const jaComecou = agora.month > mes || (agora.month === mes && agora.day >= dia);
  const ano = jaComecou ? agora.year : agora.year - 1;
  return `${ano}-${pad2(mes)}-${pad2(dia)}`;
};

const maiorFaltaRegra = Math.max(...Object.keys(REGRA.prazosDias).map(Number));

const diasPorFalta = (numeroFalta) => {
  const numero = Math.min(Math.max(Number(numeroFalta) || 1, 1), maiorFaltaRegra);
  return REGRA.prazosDias[numero];
};

// Mesmo cálculo em SQL: CASE WHEN col >= 3 THEN 180 WHEN col = 2 THEN 90 ELSE 60 END.
const sqlDiasCase = (coluna) => {
  const chaves = Object.keys(REGRA.prazosDias).map(Number).sort((a, b) => b - a);
  const partes = chaves
    .filter((chave) => chave !== 1)
    .map((chave) => `WHEN ${coluna} ${chave === maiorFaltaRegra ? '>=' : '='} ${chave} THEN ${REGRA.prazosDias[chave]}`);
  return `CASE ${partes.join(' ')} ELSE ${REGRA.prazosDias[1]} END`;
};

const dataIso = (valor) => {
  if (!valor) {
    return null;
  }

  if (valor instanceof Date) {
    return Number.isNaN(valor.getTime()) ? null : valor.toISOString().slice(0, 10);
  }

  const texto = String(valor).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(texto) ? texto : null;
};

const somarDias = (valor, dias) => {
  const inicio = dataIso(valor);
  if (!inicio || !dias) {
    return null;
  }

  const [ano, mes, dia] = inicio.split('-').map(Number);
  const data = new Date(Date.UTC(ano, mes - 1, dia));
  if (Number.isNaN(data.getTime())) {
    return null;
  }

  data.setUTCDate(data.getUTCDate() + dias);
  return data.toISOString().slice(0, 10);
};
// ===== fim da regra =====
