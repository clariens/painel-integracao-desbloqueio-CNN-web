// Formatação compartilhada pelas páginas. Datas de falta chegam como "AAAA-MM-DD"; instantes, em ISO UTC.
export const escapeHtml = (value) =>
  String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

export const dataBr = (iso) => {
  const [ano, mes, dia] = String(iso || "").slice(0, 10).split("-");
  return ano && mes && dia ? `${dia}/${mes}/${ano}` : "—";
};

export const dataHoraBr = (iso) => {
  if (!iso) return "—";
  const data = new Date(iso);
  if (Number.isNaN(data.getTime())) return "—";
  return data.toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "America/Sao_Paulo",
  });
};

export const numero = (valor) => Number(valor || 0).toLocaleString("pt-BR");

// Diferença em dias entre duas datas "AAAA-MM-DD" (b - a).
export const diasEntre = (a, b) => {
  const ms = Date.parse(`${String(b).slice(0, 10)}T00:00:00Z`) - Date.parse(`${String(a).slice(0, 10)}T00:00:00Z`);
  return Number.isFinite(ms) ? Math.round(ms / 86_400_000) : null;
};

export const prazoTexto = (dataFim, hoje) => {
  const dias = diasEntre(hoje, dataFim);
  if (dias === null) return "";
  if (dias > 1) return `faltam ${dias} dias`;
  if (dias === 1) return "termina amanhã";
  if (dias === 0) return "termina hoje";
  if (dias === -1) return "venceu ontem";
  return `venceu há ${-dias} dias`;
};

export const STATUS = {
  pendente: "Aguardando bloqueio",
  bloqueado: "Bloqueado",
  apto: "Apto a liberar",
  liberado_antecipado: "Liberado antes do prazo",
  liberado: "Liberado",
};

export const selo = (status, texto = STATUS[status] || status) =>
  `<span class="selo selo--${escapeHtml(status)}">${escapeHtml(texto)}</span>`;

export const ACAO = { BLOQUEIO: "Bloqueio", LIBERACAO: "Liberação" };

export const PERFIL = { LEITOR: "Leitor", EDITOR: "Editor", ADMIN: "Admin" };
export const seloPerfil = (perfil) =>
  `<span class="selo selo--perfil-${escapeHtml(String(perfil).toLowerCase())}">${escapeHtml(PERFIL[perfil] || perfil)}</span>`;

export const EVENTO_USUARIO = {
  CRIADO: "Criado",
  PERFIL_ALTERADO: "Perfil alterado",
  NOME_ALTERADO: "Nome alterado",
  DESATIVADO: "Desativado",
  REATIVADO: "Reativado",
  SENHA_REDEFINIDA: "Senha redefinida",
  SENHA_TROCADA: "Senha trocada",
  LOGIN_FALHA: "Senha errada",
  LOGIN_BLOQUEADO: "Login bloqueado",
  UNIDADES_ALTERADAS: "Unidades alteradas",
};
export const ORIGEM = { AUTOMATICO: "Automático", PAINEL: "Painel", CARGA_INICIAL: "Carga inicial" };

// Solicitações de desbloqueio: situação e selo (cores em css/app.css, .selo--sol-*).
export const SOLICITACAO = {
  PENDENTE: "Aguardando aprovação",
  APROVADA: "Aprovada · falta liberar",
  LIBERADA: "Liberada",
  RECUSADA: "Recusada",
  CANCELADA: "Cancelada",
  ENCERRADA: "Encerrada",
};
// Verbo da decisão (quem aprovou, recusou, cancelou ou o sistema encerrou).
export const DECISAO_SOLICITACAO = { APROVADA: "Aprovada", LIBERADA: "Aprovada", RECUSADA: "Recusada", CANCELADA: "Cancelada", ENCERRADA: "Encerrada" };
export const seloSolicitacao = (status, texto = SOLICITACAO[status] || status) =>
  `<span class="selo selo--sol-${escapeHtml(String(status).toLowerCase())}">${escapeHtml(texto)}</span>`;

export const hojeSp = () =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());

// Mesma regra do ciclo de workflows/code/_regra.js (início em 1/10), usada só nos atalhos de período.
export const CICLO_MES = 10;
export const inicioCiclo = (hoje = hojeSp()) => {
  const [ano, mes] = hoje.split("-").map(Number);
  return `${mes >= CICLO_MES ? ano : ano - 1}-${String(CICLO_MES).padStart(2, "0")}-01`;
};

// Soma dias a uma data "AAAA-MM-DD" (negativo volta).
export const somarDiasIso = (iso, dias) => {
  const data = new Date(`${iso}T00:00:00Z`);
  data.setUTCDate(data.getUTCDate() + dias);
  return data.toISOString().slice(0, 10);
};

// Atalhos de período das telas Relatórios e Dashboard: [de, ate].
export const periodoDoAtalho = (atalho, hoje = hojeSp()) => {
  const inicio = inicioCiclo(hoje);
  const periodos = {
    ciclo: [inicio, hoje],
    anterior: [`${Number(inicio.slice(0, 4)) - 1}${inicio.slice(4)}`, somarDiasIso(inicio, -1)],
    mes: [`${hoje.slice(0, 7)}-01`, hoje],
    30: [somarDiasIso(hoje, -29), hoje],
  };
  return periodos[atalho] || periodos.ciclo;
};
