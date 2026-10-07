import { dataBr, escapeHtml, hojeSp, inicioCiclo, numero } from "./formato.js";
import { iniciarPagina } from "./pagina.js";
import { request } from "./session.js";

const $ = (selector) => document.querySelector(selector);
const MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const DIAS = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"];

const state = { dados: null, atalho: "ciclo" };

const els = {
  form: $("#filtros"),
  atalhos: $("#atalhos"),
  de: $("#de"),
  ate: $("#ate"),
  exportar: $("#exportar"),
  periodo: $("#periodo-texto"),
  kpiFaltas: $("#kpi-faltas"),
  kpiPacientes: $("#kpi-pacientes"),
  kpiMedia: $("#kpi-media"),
  kpiReincidentes: $("#kpi-reincidentes"),
  kpiTres: $("#kpi-tres"),
  mes: $("#grafico-mes"),
  dia: $("#grafico-dia"),
  profissional: $("#grafico-profissional"),
  reincidencia: $("#grafico-reincidencia"),
  reincidentes: $("#reincidentes"),
  truncado: $("#aviso-truncado"),
};

// ---------- período ----------
const somarDias = (iso, dias) => {
  const data = new Date(`${iso}T00:00:00Z`);
  data.setUTCDate(data.getUTCDate() + dias);
  return data.toISOString().slice(0, 10);
};

const aplicarAtalho = (atalho) => {
  const hoje = hojeSp();
  const inicio = inicioCiclo(hoje);
  const periodos = {
    ciclo: [inicio, hoje],
    anterior: [`${Number(inicio.slice(0, 4)) - 1}-08-01`, somarDias(inicio, -1)],
    mes: [`${hoje.slice(0, 7)}-01`, hoje],
    30: [somarDias(hoje, -29), hoje],
  };
  [els.de.value, els.ate.value] = periodos[atalho] || periodos.ciclo;
  state.atalho = atalho;
  els.atalhos.querySelectorAll("button").forEach((button) => {
    button.setAttribute("aria-pressed", String(button.dataset.atalho === atalho));
  });
};

// ---------- dica (hover) ----------
const dica = document.createElement("div");
dica.className = "dica";
dica.hidden = true;
dica.setAttribute("role", "tooltip");
document.body.append(dica);

const mostrarDica = (alvo, x, y) => {
  dica.textContent = alvo.dataset.dica;
  dica.hidden = false;
  const largura = dica.offsetWidth;
  dica.style.left = `${Math.min(window.innerWidth - largura - 8, Math.max(8, x - largura / 2))}px`;
  dica.style.top = `${Math.max(8, y - dica.offsetHeight - 12)}px`;
};

document.addEventListener("pointermove", (event) => {
  const alvo = event.target.closest("[data-dica]");
  if (alvo) mostrarDica(alvo, event.clientX, event.clientY);
  else dica.hidden = true;
});
document.addEventListener("focusin", (event) => {
  const alvo = event.target.closest("[data-dica]");
  if (!alvo) return;
  const caixa = alvo.getBoundingClientRect();
  mostrarDica(alvo, caixa.left + caixa.width / 2, caixa.top);
});
document.addEventListener("focusout", () => {
  dica.hidden = true;
});

// ---------- gráficos (série única, uma cor; valor no hover e no maior) ----------
const colunas = (alvo, pontos) => {
  if (!pontos.length || pontos.every((ponto) => !ponto.valor)) {
    alvo.innerHTML = '<p class="vazio">Sem faltas no período.</p>';
    return;
  }
  const maximo = Math.max(...pontos.map((ponto) => ponto.valor), 1);
  alvo.innerHTML = `<div class="colunas" role="list">${pontos
    .map((ponto) => {
      const altura = Math.round((ponto.valor / maximo) * 180);
      const destaque = ponto.valor === maximo;
      return `<button class="coluna" type="button" role="listitem" data-dica="${escapeHtml(ponto.dica)}" aria-label="${escapeHtml(ponto.dica)}">
        <span class="coluna__valor" aria-hidden="true"${destaque ? "" : ' style="visibility:hidden"'}>${numero(ponto.valor)}</span>
        <span class="coluna__barra" style="height:${Math.max(altura, 2)}px"></span>
        <span class="coluna__rotulo" aria-hidden="true">${escapeHtml(ponto.rotulo)}</span>
      </button>`;
    })
    .join("")}</div>`;
};

const barras = (alvo, itens) => {
  if (!itens.length) {
    alvo.innerHTML = '<li class="vazio">Sem dados no período.</li>';
    return;
  }
  const maximo = Math.max(...itens.map((item) => item.valor), 1);
  alvo.innerHTML = itens
    .map(
      (item) => `<li data-dica="${escapeHtml(item.dica)}">
        <span class="barras__nome" title="${escapeHtml(item.rotulo)}">${escapeHtml(item.rotulo)}</span>
        <span class="barras__trilho"><span class="barras__barra" style="width:${((item.valor / maximo) * 100).toFixed(1)}%"></span></span>
        <span class="barras__valor">${numero(item.valor)}</span>
      </li>`,
    )
    .join("");
};

const rotuloMes = (mes) => {
  const [ano, numeroMes] = mes.split("-");
  return `${MESES[Number(numeroMes) - 1]}/${ano.slice(2)}`;
};

const render = () => {
  const d = state.dados;
  const reincidentes = d.reincidencia.filter((item) => item.quantidade >= 2).reduce((soma, item) => soma + item.pacientes, 0);
  const tresOuMais = d.reincidencia.find((item) => item.quantidade >= d.maiorFaltaRegra)?.pacientes || 0;

  els.periodo.textContent = `${dataBr(d.periodo.de)} a ${dataBr(d.periodo.ate)}`;
  els.kpiFaltas.textContent = numero(d.total.faltas);
  els.kpiPacientes.textContent = numero(d.total.pacientes);
  els.kpiMedia.textContent = d.total.pacientes ? (d.total.faltas / d.total.pacientes).toFixed(2).replace(".", ",") : "—";
  els.kpiReincidentes.textContent = numero(reincidentes);
  els.kpiTres.textContent = `${numero(tresOuMais)} com ${d.maiorFaltaRegra} ou mais`;

  colunas(
    els.mes,
    d.porMes.map((ponto) => ({
      rotulo: rotuloMes(ponto.mes),
      valor: ponto.faltas,
      dica: `${rotuloMes(ponto.mes)}: ${numero(ponto.faltas)} faltas · ${numero(ponto.pacientes)} pacientes`,
    })),
  );

  const porDia = new Map(d.porDiaSemana.map((ponto) => [ponto.dia, ponto.faltas]));
  colunas(
    els.dia,
    DIAS.map((rotulo, indice) => ({
      rotulo,
      valor: porDia.get(indice) || 0,
      dica: `${rotulo}: ${numero(porDia.get(indice) || 0)} faltas`,
    })),
  );

  barras(
    els.profissional,
    d.porProfissional.map((item) => ({
      rotulo: item.profissional,
      valor: item.faltas,
      dica: `${item.profissional}: ${numero(item.faltas)} faltas · ${numero(item.pacientes)} pacientes`,
    })),
  );

  barras(
    els.reincidencia,
    d.reincidencia.map((item) => {
      const rotulo = item.quantidade >= d.maiorFaltaRegra ? `${item.quantidade} faltas ou mais` : `${item.quantidade} falta${item.quantidade > 1 ? "s" : ""}`;
      return { rotulo, valor: item.pacientes, dica: `${rotulo}: ${numero(item.pacientes)} pacientes` };
    }),
  );

  els.reincidentes.innerHTML = d.reincidentes.length
    ? d.reincidentes
        .map(
          (item) => `<tr>
            <td><a class="link-paciente" href="/pacientes?paciente=${item.idPaciente}">${escapeHtml(item.nome || "(sem nome)")}</a><span class="sub">ID ${item.idPaciente}</span></td>
            <td class="num">${item.faltas}</td>
            <td class="mono">${dataBr(item.ultimaFalta)}</td>
          </tr>`,
        )
        .join("")
    : '<tr><td colspan="3" class="sub">Nenhum paciente com 2 faltas ou mais no período.</td></tr>';

  els.truncado.hidden = !d.truncado;
  els.exportar.disabled = !d.linhas.length;
};

// ---------- CSV (sem CPF, e-mail ou telefone) ----------
const csvCampo = (valor) => {
  const texto = String(valor ?? "");
  const seguro = /^[=+\-@]/.test(texto) ? `'${texto}` : texto;
  return /[";\n]/.test(seguro) ? `"${seguro.replaceAll('"', '""')}"` : seguro;
};

const exportar = () => {
  const d = state.dados;
  if (!d?.linhas.length) return;
  const cabecalho = ["Data da falta", "Hora", "ID paciente", "Paciente", "Nº da falta no ciclo", "Profissional", "ID agendamento"];
  const linhas = d.linhas.map((linha) =>
    [dataBr(linha.dataFalta), linha.horaInicio || "", linha.idPaciente, linha.nome || "", linha.numeroFalta, linha.profissional || "", linha.idAgenda]
      .map(csvCampo)
      .join(";"),
  );
  const blob = new Blob([`﻿${[cabecalho.join(";"), ...linhas].join("\r\n")}`], { type: "text/csv;charset=utf-8" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `faltas_${d.periodo.de}_a_${d.periodo.ate}.csv`;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(link.href), 1000);
};

// ---------- carga ----------
const carregar = async () => {
  if (els.de.value && els.ate.value && els.de.value > els.ate.value) {
    throw new Error("A data inicial é depois da final.");
  }
  const params = new URLSearchParams({ de: els.de.value, ate: els.ate.value });
  state.dados = await request(`/api/faltas?${params}`);
  render();
};

aplicarAtalho("ciclo");
const recarregar = iniciarPagina(carregar);

els.atalhos.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-atalho]");
  if (!button) return;
  aplicarAtalho(button.dataset.atalho);
  void recarregar(true).catch(() => {});
});

[els.de, els.ate].forEach((campo) =>
  campo.addEventListener("change", () => {
    els.atalhos.querySelectorAll("button").forEach((button) => button.setAttribute("aria-pressed", "false"));
  }),
);

els.form.addEventListener("submit", (event) => {
  event.preventDefault();
  void recarregar(true).catch(() => {});
});

els.exportar.addEventListener("click", exportar);
