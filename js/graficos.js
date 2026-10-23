// Gráficos do Dashboard com Chart.js (js/vendor/chart.umd.min.js, servido pelo próprio site).
// As cores vêm dos tokens do css/app.css, então seguem o tema; trocar o tema redesenha tudo.
// Cada função recebe o id de um <canvas>; desenhar de novo no mesmo id destrói o gráfico anterior.
const Chart = window.Chart;
const graficos = new Map(); // id -> { chart, montar }
const semMovimento = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

const css = (nome) => getComputedStyle(document.documentElement).getPropertyValue(nome).trim();
export const serie = (i) => css(`--serie-${(i % 6) + 1}`);
export const token = css;

// Cor com transparência (para áreas): hex do token + alfa.
const comAlfa = (cor, alfa) => {
  const hex = cor.replace("#", "");
  if (!/^[0-9a-f]{6}$/i.test(hex)) return cor;
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return `rgba(${r}, ${g}, ${b}, ${alfa})`;
};

const numeroBr = (valor) => Number(valor || 0).toLocaleString("pt-BR");

const base = () => {
  const texto = css("--text");
  const muted = css("--muted");
  const linha = css("--line");
  return {
    responsive: true,
    maintainAspectRatio: false,
    animation: semMovimento ? false : { duration: 450 },
    plugins: {
      legend: { labels: { color: texto, boxWidth: 12, boxHeight: 12, font: { size: 12 } } },
      tooltip: {
        backgroundColor: css("--tip-bg"),
        titleColor: css("--tip-text"),
        bodyColor: css("--tip-text"),
        borderColor: linha,
        borderWidth: 1,
        padding: 10,
        titleFont: { family: '"IBM Plex Mono", monospace', size: 12 },
        bodyFont: { family: '"IBM Plex Sans", system-ui, sans-serif', size: 12 },
        callbacks: {
          label: (ctx) => ` ${ctx.dataset.label ? `${ctx.dataset.label}: ` : ""}${ctx.formattedValue}`,
        },
      },
    },
    _eixo: {
      grid: { color: linha },
      border: { color: linha },
      ticks: { color: muted, font: { size: 11 } },
    },
  };
};

const eixos = (b, { empilhado = false, horizontal = false } = {}) => {
  const valor = { ...b._eixo, beginAtZero: true, stacked: empilhado, ticks: { ...b._eixo.ticks, precision: 0 } };
  const categoria = { ...b._eixo, stacked: empilhado, grid: { display: false } };
  return horizontal ? { x: valor, y: categoria } : { x: categoria, y: valor };
};

const limpar = (b) => {
  const { _eixo, ...resto } = b;
  return resto;
};

// Descreve o gráfico para leitores de tela (o canvas não tem texto).
const descrever = (canvas, texto) => {
  canvas.setAttribute("aria-label", texto);
  canvas.textContent = texto;
};

// Sem dados: troca o canvas por um aviso (e volta quando houver dados).
const vazio = (canvas, temDados) => {
  const area = canvas.parentElement;
  let aviso = area.querySelector(".painel-card__vazio");
  if (!temDados && !aviso) {
    aviso = document.createElement("p");
    aviso.className = "painel-card__vazio";
    aviso.textContent = "Sem dados no período.";
    area.append(aviso);
  }
  if (aviso) aviso.hidden = temDados;
  canvas.hidden = !temDados;
};

const desenhar = (id, montar) => {
  const canvas = document.getElementById(id);
  if (!canvas || !Chart) return;
  // Padrões globais do Chart.js: fonte do painel e cor do texto do tema atual.
  Chart.defaults.font.family = '"IBM Plex Sans", system-ui, sans-serif';
  Chart.defaults.color = css("--text");
  Chart.defaults.locale = "pt-BR";
  graficos.get(id)?.chart?.destroy();
  const { config, temDados, resumo } = montar();
  vazio(canvas, temDados);
  descrever(canvas, resumo);
  const chart = temDados ? new Chart(canvas, config) : null;
  graficos.set(id, { chart, montar });
};

const maior = (rotulos, valores) => {
  let i = 0;
  valores.forEach((v, j) => {
    if (v > valores[i]) i = j;
  });
  return valores.length ? `maior: ${rotulos[i]} (${numeroBr(valores[i])})` : "sem dados";
};

/** Linha (ou área). series: [{ rotulo, valores, cor?, area?, tracejado? }]. */
export const linha = (id, titulo, rotulos, series) =>
  desenhar(id, () => {
    const b = base();
    const temDados = series.some((s) => s.valores.some((v) => v > 0));
    return {
      temDados,
      resumo: `${titulo}: ${maior(rotulos, series[0]?.valores || [])}.`,
      config: {
        type: "line",
        data: {
          labels: rotulos,
          datasets: series.map((s, i) => {
            const cor = s.cor || serie(i);
            return {
              label: s.rotulo,
              data: s.valores,
              borderColor: cor,
              backgroundColor: s.area ? comAlfa(cor, 0.18) : cor,
              fill: Boolean(s.area),
              borderWidth: s.tracejado ? 1.5 : 2,
              borderDash: s.tracejado ? [6, 4] : [],
              pointRadius: rotulos.length > 45 ? 0 : 2.5,
              pointHoverRadius: 5,
              tension: 0.3,
            };
          }),
        },
        options: {
          ...limpar(b),
          interaction: { mode: "index", intersect: false },
          plugins: { ...b.plugins, legend: { ...b.plugins.legend, display: series.length > 1 } },
          scales: eixos(b),
        },
      },
    };
  });

/** Rosca. fatias: [{ rotulo, valor, cor? }]. */
export const rosca = (id, titulo, fatias) =>
  desenhar(id, () => {
    const b = base();
    const total = fatias.reduce((s, f) => s + f.valor, 0);
    return {
      temDados: total > 0,
      resumo: `${titulo}: ${fatias.map((f) => `${f.rotulo} ${numeroBr(f.valor)}`).join(", ")}.`,
      config: {
        type: "doughnut",
        data: {
          labels: fatias.map((f) => f.rotulo),
          datasets: [
            {
              data: fatias.map((f) => f.valor),
              backgroundColor: fatias.map((f, i) => f.cor || serie(i)),
              borderColor: css("--panel-2"),
              borderWidth: 2,
              hoverOffset: 6,
            },
          ],
        },
        options: {
          ...limpar(b),
          cutout: "62%",
          plugins: {
            ...b.plugins,
            legend: { ...b.plugins.legend, position: "bottom", labels: { ...b.plugins.legend.labels, boxWidth: 10, boxHeight: 10, padding: 10 } },
            tooltip: {
              ...b.plugins.tooltip,
              callbacks: {
                label: (ctx) => ` ${ctx.label}: ${numeroBr(ctx.raw)} (${total ? Math.round((ctx.raw / total) * 100) : 0}%)`,
              },
            },
          },
        },
      },
    };
  });

/** Barras (verticais por padrão; horizontal: true deita). series: [{ rotulo, valores, cor? }]; empilhado soma as séries. */
export const barras = (id, titulo, rotulos, series, { horizontal = false, empilhado = false } = {}) =>
  desenhar(id, () => {
    const b = base();
    const temDados = series.some((s) => s.valores.some((v) => v > 0));
    const totais = rotulos.map((_, i) => series.reduce((soma, s) => soma + (s.valores[i] || 0), 0));
    return {
      temDados,
      resumo: `${titulo}: ${maior(rotulos, totais)}.`,
      config: {
        type: "bar",
        data: {
          labels: rotulos,
          datasets: series.map((s, i) => ({
            label: s.rotulo,
            data: s.valores,
            backgroundColor: s.cor || serie(i),
            borderRadius: 3,
            maxBarThickness: horizontal ? 22 : 38,
          })),
        },
        options: {
          ...limpar(b),
          indexAxis: horizontal ? "y" : "x",
          interaction: { mode: "index", intersect: false },
          plugins: { ...b.plugins, legend: { ...b.plugins.legend, display: series.length > 1 } },
          scales: eixos(b, { empilhado, horizontal }),
        },
      },
    };
  });

/** Radar (ex.: faltas por dia da semana). */
export const radar = (id, titulo, rotulos, valores) =>
  desenhar(id, () => {
    const b = base();
    const cor = serie(1);
    return {
      temDados: valores.some((v) => v > 0),
      resumo: `${titulo}: ${maior(rotulos, valores)}.`,
      config: {
        type: "radar",
        data: {
          labels: rotulos,
          datasets: [
            { label: "Faltas", data: valores, borderColor: cor, backgroundColor: comAlfa(cor, 0.22), pointBackgroundColor: cor, borderWidth: 2 },
          ],
        },
        options: {
          ...limpar(b),
          plugins: { ...b.plugins, legend: { display: false } },
          scales: {
            r: {
              beginAtZero: true,
              angleLines: { color: css("--line") },
              grid: { color: css("--line") },
              pointLabels: { color: css("--text"), font: { size: 12 } },
              ticks: { display: false, precision: 0 },
            },
          },
        },
      },
    };
  });

// Trocou o tema: as cores dos tokens mudaram. A tela registra como se redesenhar (ela escolhe as cores pelos
// tokens na hora de montar cada gráfico); sem registro, redesenha os gráficos com os mesmos dados.
const aoTrocar = [];
export const aoTrocarTema = (fn) => aoTrocar.push(fn);
new MutationObserver(() => {
  if (aoTrocar.length) aoTrocar.forEach((fn) => fn());
  else for (const [id, { montar }] of graficos) desenhar(id, montar);
}).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
