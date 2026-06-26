import {
  solveLogAgeQuadratureIcm,
  solvePlayerLogAgeQuadratureIcm,
} from "../src/log-age-quadrature-icm.js";

const exampleSelect = document.querySelector("#example-select");
const heroSeatInput = document.querySelector("#hero-seat");
const nodeCountInput = document.querySelector("#node-count");
const chipCountsInput = document.querySelector("#chip-counts");
const payoutsInput = document.querySelector("#payouts");
const form = document.querySelector("#calculator-form");
const statusEl = document.querySelector("#status");
const metricsEl = document.querySelector("#metrics");
const resultsBody = document.querySelector("#results-body");

function formatInteger(value) {
  return Math.round(Number(value)).toLocaleString("en-US");
}

function formatMoney(value) {
  return Number(value).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
}

function formatPercent(value) {
  return `${(Number(value) * 100).toLocaleString("en-US", {
    minimumFractionDigits: 4,
    maximumFractionDigits: 4,
  })}%`;
}

function setStatus(message) {
  statusEl.textContent = message;
}

function parseNumericTextarea(value) {
  return String(value)
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => Number(line.replace(/[$,\s]/g, "")))
    .filter((number) => Number.isFinite(number) && number > 0);
}

function setTextareaValues(textarea, values) {
  textarea.value = values.map((value) => formatInteger(value)).join("\n");
}

async function loadJson(path) {
  const response = await fetch(path);
  if (!response.ok) {
    throw new Error(`Could not load ${path}`);
  }
  return response.json();
}

async function loadExamples() {
  const examples = await loadJson("/examples/index.json");
  exampleSelect.innerHTML = examples
    .map((example) => `<option value="${example.file}">${example.label}</option>`)
    .join("");
  await loadExample(examples[0].file);
}

async function loadExample(path) {
  const example = await loadJson(`/${path}`);
  setTextareaValues(chipCountsInput, example.chipCounts);
  setTextareaValues(payoutsInput, example.payouts);
  heroSeatInput.max = String(example.chipCounts.length);
  heroSeatInput.value = "1";
  setStatus(`${example.chipCounts.length} players, ${example.payouts.length} payouts`);
  renderEmpty();
}

function selectedMode() {
  return new FormData(form).get("mode") || "hero";
}

function metric(label, value) {
  return `<div class="metric"><span>${label}</span><strong>${value}</strong></div>`;
}

function renderMetrics({ playerCount, payoutCount, prizePool, runtimeMs }) {
  metricsEl.innerHTML = [
    metric("Players", formatInteger(playerCount)),
    metric("Payout rows", formatInteger(payoutCount)),
    metric("Prize pool", formatMoney(prizePool)),
    metric("Runtime", `${runtimeMs.toFixed(1)} ms`),
  ].join("");
}

function renderEmpty() {
  metricsEl.innerHTML = [
    metric("Players", "-"),
    metric("Payout rows", "-"),
    metric("Prize pool", "-"),
    metric("Runtime", "-"),
  ].join("");
  resultsBody.innerHTML = "";
}

function renderRows(players, heroSeat) {
  const maxValue = Math.max(...players.map((player) => player.value), 1);
  resultsBody.innerHTML = players
    .map((player) => {
      const width = Math.max(2, (player.value / maxValue) * 100);
      const heroClass = player.playerIndex === heroSeat ? " class=\"hero\"" : "";
      return `
        <tr${heroClass}>
          <td>${player.playerIndex}</td>
          <td>${formatInteger(player.chips)}</td>
          <td>${formatPercent(player.chipFraction)}</td>
          <td>${formatPercent(player.equity)}</td>
          <td>${formatMoney(player.value)}</td>
          <td class="bar-cell"><div class="bar" style="width: ${width}%"></div></td>
        </tr>
      `;
    })
    .join("");
}

async function runCalculation() {
  const chipCounts = parseNumericTextarea(chipCountsInput.value);
  const payouts = parseNumericTextarea(payoutsInput.value);
  const heroSeat = Math.max(1, Math.min(chipCounts.length, Number(heroSeatInput.value) || 1));
  const options = {
    logAgeNodeCount: Math.max(48, Number(nodeCountInput.value) || 192),
  };
  const startedAt = performance.now();
  const mode = selectedMode();

  if (chipCounts.length < 2) {
    throw new Error("At least two chip counts are required.");
  }
  if (!payouts.length) {
    throw new Error("At least one payout is required.");
  }

  await new Promise((resolve) => requestAnimationFrame(resolve));

  if (mode === "field") {
    const result = solveLogAgeQuadratureIcm(chipCounts, payouts, options);
    renderMetrics({
      playerCount: chipCounts.length,
      payoutCount: payouts.length,
      prizePool: result.totalPrizePool,
      runtimeMs: performance.now() - startedAt,
    });
    renderRows(result.players, heroSeat);
    setStatus("Full field complete");
    return;
  }

  const result = solvePlayerLogAgeQuadratureIcm(chipCounts, payouts, heroSeat - 1, options);
  renderMetrics({
    playerCount: chipCounts.length,
    payoutCount: payouts.length,
    prizePool: result.totalPrizePool,
    runtimeMs: performance.now() - startedAt,
  });
  renderRows([result.player], heroSeat);
  setStatus("Selected player complete");
}

exampleSelect.addEventListener("change", async () => {
  try {
    await loadExample(exampleSelect.value);
  } catch (error) {
    setStatus(error.message);
  }
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  setStatus("Running...");
  resultsBody.innerHTML = "";
  try {
    await runCalculation();
  } catch (error) {
    setStatus(error.message);
  }
});

loadExamples().catch((error) => {
  setStatus(error.message);
});
