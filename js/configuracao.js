import { dataBr, dataHoraBr, escapeHtml, numero } from "./formato.js";
import { iniciarPagina } from "./pagina.js";
import { request } from "./session.js";

const $ = (selector) => document.querySelector(selector);
const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];

const carregar = async () => {
  const { regra, ciclo, status } = await request("/api/parametros");

  const chaves = Object.keys(regra.prazosDias).map(Number).sort((a, b) => a - b);
  $("#prazos").innerHTML = chaves
    .map((chave) => {
      const rotulo = chave === regra.maiorFalta ? `${chave}ª falta ou mais` : `${chave}ª falta`;
      return `<tr><td>${escapeHtml(rotulo)}</td><td>${numero(regra.prazosDias[chave])} dias</td></tr>`;
    })
    .join("");

  $("#ciclo-regra").textContent = `${regra.cicloInicio.dia} de ${MESES[regra.cicloInicio.mes - 1]}`;
  $("#ciclo-inicio").textContent = dataBr(ciclo.inicio);
  $("#fuso").textContent = regra.fuso;
  $("#horario").textContent = `todo dia às ${regra.horarioBloqueio}`;
  $("#liberacao-auto").textContent = regra.liberacaoAutomatica ? "ligada" : "desligada · liberação manual pelo painel";
  $("#ultima-coleta").textContent = dataHoraBr(status.ultimaColeta);
  $("#ultimo-bloqueio").textContent = dataHoraBr(status.ultimoBloqueioAutomatico);
  $("#ultima-acao").textContent = dataHoraBr(status.ultimaAcaoPainel);
  $("#linhas-controle").textContent = numero(status.linhasControle);
  $("#linhas-faltas").textContent = numero(status.linhasFaltas);
};

iniciarPagina(carregar);
