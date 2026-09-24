/* Edit only this URL if the source sheet changes. This app never writes to Google Sheets. */
const SHEET_ID = "1KTCzUMMRuZY5Grn0Q3Ffk1_OhHRNQqII_Ij13VApuMA";
const SHEET_GID = "0";
const SOURCE_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?gid=${SHEET_GID}&tqx=out:json%3BresponseHandler:dailyRhythmSheetCallback`;

const weights = { sleep: 25, bedtime: 15, wake: 10, study: 30, screen: 20 };
const $ = (id) => document.getElementById(id);
let tablePage = 1;
let tablePageSize = 10;
let heatmapMonth = null;

function clamp(number, minimum, maximum) { return Math.min(Math.max(number, minimum), maximum); }
function parseClock(value) {
  if (value == null || value === "") return null;
  const match = String(value).trim().match(/^(\d{1,2})\s*:\s*(\d{2})/);
  if (!match) return null;
  const hours = Number(match[1]); const minutes = Number(match[2]);
  return hours <= 23 && minutes <= 59 ? hours * 60 + minutes : null;
}
function parseDuration(value) {
  if (value == null || value === "") return null;
  if (/^\d{1,2}\s*:\s*\d{2}$/.test(String(value).trim())) return parseClock(value);
  const text = String(value).toLowerCase();
  const hours = Number((text.match(/(\d+)\s*(?:hour|hr|h)/) || [])[1] || 0);
  const minutes = Number((text.match(/(\d+)\s*(?:minute|min|m)/) || [])[1] || 0);
  return hours || minutes ? hours * 60 + minutes : null;
}
function parseDate(value) {
  if (value == null || value === "") return null;
  const gviz = String(value).match(/^Date\((\d+),(\d+),(\d+)\)$/);
  if (gviz) return new Date(Number(gviz[1]), Number(gviz[2]), Number(gviz[3]));
  const parts = String(value).trim().split("/");
  if (parts.length === 3) return new Date(Number(parts[2]), Number(parts[1]) - 1, Number(parts[0]));
  const parsed = new Date(value); return Number.isNaN(parsed.valueOf()) ? null : parsed;
}
function displayDate(date) { return new Intl.DateTimeFormat("en-GB", { day:"numeric", month:"short", year:"numeric" }).format(date); }
function displayTime(minutes) { if (minutes == null) return "—"; const hour = Math.floor(minutes / 60) % 24; return `${String(hour).padStart(2,"0")}:${String(minutes % 60).padStart(2,"0")}`; }
function displayDuration(minutes) { if (minutes == null) return "—"; return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2,"0")}m`; }
function intervalScore(value, fullStart, fullEnd, zeroLow, zeroHigh) {
  if (value == null) return null;
  if (value >= fullStart && value <= fullEnd) return 1;
  if (value < fullStart) return clamp((value - zeroLow) / (fullStart - zeroLow), 0, 1);
  return clamp((zeroHigh - value) / (zeroHigh - fullEnd), 0, 1);
}
function circularBedtimeScore(value) {
  if (value == null) return null;
  if (value >= 0 && value <= 60) return 1;
  const circularDistance = (a, b) => Math.min(Math.abs(a - b), 1440 - Math.abs(a - b));
  const distance = Math.min(circularDistance(value, 0), circularDistance(value, 60));
  return clamp(1 - distance / 120, 0, 1);
}
function calculateRecord(record) {
  const bedtime = parseClock(record.bedtime); const wake = parseClock(record.wake);
  const sleep = bedtime != null && wake != null ? (wake - bedtime + 1440) % 1440 : null;
  const study = parseDuration(record.study); const screen = parseDuration(record.screen);
  const factors = {
    sleep: intervalScore(sleep, 450, 510, 330, 630),
    bedtime: circularBedtimeScore(bedtime),
    wake: intervalScore(wake, 480, 540, 390, 630),
    study: study == null ? null : clamp(study / 390, 0, 1),
    screen: screen == null ? null : clamp(1 - Math.max(screen - 120, 0) / 240, 0, 1)
  };
  const complete = Object.values(factors).every((value) => value != null);
  const score = complete ? Math.round(Object.entries(weights).reduce((total, [name, weight]) => total + factors[name] * weight, 0)) : null;
  return { ...record, bedtimeMinutes: bedtime, wakeMinutes: wake, sleep, studyMinutes: study, screenMinutes: screen, factors, score };
}
function scoreCategory(score) {
  if (score >= 90) return { label: "Strong routine alignment", tone: "strong" };
  if (score >= 75) return { label: "Mostly on track", tone: "on-track" };
  if (score >= 50) return { label: "Mixed day", tone: "mixed" };
  return { label: "Routine off target", tone: "off-target" };
}
function scoreLabel(score) { return scoreCategory(score).label; }
function normaliseHeader(value) { return String(value || "").trim().toLowerCase().replace(/[^a-z]/g, ""); }
function parseGviz(text) {
  const start = text.indexOf("{"); const end = text.lastIndexOf("}");
  if (start < 0 || end < 0) throw new Error("Google Sheets returned an unexpected response.");
  const table = JSON.parse(text.slice(start, end + 1)).table;
  const headers = table.cols.map((column) => normaliseHeader(column.label));
  return table.rows.map((row) => {
    const values = row.c || [];
    const valueAt = (names) => { const index = headers.findIndex((header) => names.includes(header)); return index < 0 ? "" : (values[index] && (values[index].f ?? values[index].v)) || ""; };
    return { date:valueAt(["date"]), bedtime:valueAt(["bedtime"]), wake:valueAt(["wakeuptime", "waketime"]), screen:valueAt(["mobilescreentime", "screentime"]), study:valueAt(["studyhours", "studytime"]), context:valueAt(["abnormalityreason", "dailycontext", "context", "notes"]) };
  }).filter((row) => row.date);
}
function loadGvizJsonp() {
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    const timeout = window.setTimeout(() => finish(new Error("Google Sheets did not respond in time.")), 12000);
    const finish = (error, data) => {
      window.clearTimeout(timeout); delete window.dailyRhythmSheetCallback; script.remove();
      if (error) reject(error); else resolve(data);
    };
    window.dailyRhythmSheetCallback = (data) => finish(null, data);
    script.onerror = () => finish(new Error("The shared sheet could not be read. Confirm that anyone with the link can view it."));
    script.src = SOURCE_URL; document.head.append(script);
  });
}
async function loadRecords() {
  const response = await loadGvizJsonp();
  const table = response.table;
  if (!table) throw new Error("Google Sheets returned an unexpected response.");
  const headers = table.cols.map((column) => normaliseHeader(column.label));
  const rawRecords = table.rows.map((row) => {
    const values = row.c || [];
    const valueAt = (names) => { const index = headers.findIndex((header) => names.includes(header)); return index < 0 ? "" : (values[index] && (values[index].f ?? values[index].v)) || ""; };
    return { date:valueAt(["date"]), bedtime:valueAt(["bedtime"]), wake:valueAt(["wakeuptime", "waketime"]), screen:valueAt(["mobilescreentime", "screentime"]), study:valueAt(["studyhours", "studytime"]), context:valueAt(["abnormalityreason", "dailycontext", "context", "notes"]) };
  }).filter((row) => row.date);
  return rawRecords.map((record) => ({ ...record, date:parseDate(record.date) })).filter((record) => record.date).sort((a,b) => a.date - b.date).map(calculateRecord);
}
function points(factor, weight) { return factor == null ? "—" : `${Math.round(factor * weight)}/${weight}`; }
function explainLatestRecord(record) {
  const reasons = [];
  if (record.sleep != null && (record.sleep < 450 || record.sleep > 510)) {
    reasons.push(`Sleep was ${displayDuration(record.sleep)}, which sits outside the ideal 7h 30m–8h 30m window.`);
  }
  if (record.bedtimeMinutes != null && !(record.bedtimeMinutes >= 0 && record.bedtimeMinutes <= 60)) {
    reasons.push(`Bedtime was ${displayTime(record.bedtimeMinutes)}, outside the preferred night routine window.`);
  }
  if (record.wakeMinutes != null && !(record.wakeMinutes >= 480 && record.wakeMinutes <= 540)) {
    reasons.push(`Wake time was ${displayTime(record.wakeMinutes)}, which was outside the ideal 08:00–09:00 range.`);
  }
  if (record.studyMinutes != null && record.studyMinutes < 390) {
    reasons.push(`Study time was ${displayDuration(record.studyMinutes)}, below the 6h 30m target.`);
  }
  if (record.screenMinutes != null && record.screenMinutes > 120) {
    reasons.push(`Screen time was ${displayDuration(record.screenMinutes)}, so the screen score was ${points(record.factors.screen, weights.screen)} because it exceeded the 2-hour target.`);
  }
  if (reasons.length === 0) {
    reasons.push("This day was well aligned across the key routine goals, so there was no major penalty.");
  }
  return reasons;
}
function renderBreakdown(record) {
  const labels = [["Sleep duration", "sleep"], ["Bedtime", "bedtime"], ["Wake time", "wake"], ["Study time", "study"], ["Screen time", "screen"]];
  const toneForValue = (value) => {
    if (value == null) return "neutral";
    if (value >= 0.75) return "strong";
    if (value >= 0.55) return "on-track";
    if (value >= 0.35) return "mixed";
    return "off-target";
  };
  $("breakdown").innerHTML = labels.map(([label, key]) => {
    const value = record.factors[key];
    const tone = toneForValue(value);
    return `<div class="breakdown-row"><span>${label}</span><div class="track"><div class="fill tone-fill-${tone}" style="width:${value == null ? 0 : value * 100}%"></div></div><strong>${points(value, weights[key])}</strong></div>`;
  }).join("");
  $("score-reasons").innerHTML = explainLatestRecord(record).map((reason) => `<p>${reason}</p>`).join("");
}
function rollingAverage(records, index) { const values = records.slice(Math.max(0, index - 6), index + 1).map((record) => record.score).filter(Number.isFinite); return values.length ? values.reduce((a,b) => a + b, 0) / values.length : null; }
function renderChart(records) {
  const completed = records.filter((record) => record.score != null); const width = 900, height = 285, left = 42, right = 16, top = 18, bottom = 37;
  const x = (index) => left + index * ((width - left - right) / Math.max(completed.length - 1, 1)); const y = (score) => top + (100 - score) * ((height - top - bottom) / 100);
  const grid = [0,25,50,75,100].map((value) => `<line class="grid-line" x1="${left}" x2="${width-right}" y1="${y(value)}" y2="${y(value)}"/><text class="axis" x="4" y="${y(value)+4}">${value}</text>`).join("");
  const path = completed.map((record,index) => `${index ? "L" : "M"}${x(index)},${y(record.score)}`).join(" ");
  const averagePath = completed.map((_,index) => { const average = rollingAverage(completed,index); return `${index ? "L" : "M"}${x(index)},${y(average)}`; }).join(" ");
  const threshold = `<line class="threshold-line" x1="${left}" x2="${width-right}" y1="${y(90)}" y2="${y(90)}"/><text class="threshold-label" x="${width-right-4}" y="${y(90)-6}" text-anchor="end">90 · good</text>`;
  const pointsSvg = completed.map((record,index) => `<circle class="score-point" cx="${x(index)}" cy="${y(record.score)}" r="4"><title>${displayDate(record.date)}: ${record.score}/100</title></circle>`).join("");
  const labels = completed.map((record,index) => (index === 0 || index === completed.length - 1 || index % Math.ceil(completed.length / 5) === 0) ? `<text class="axis" text-anchor="middle" x="${x(index)}" y="${height-12}">${new Intl.DateTimeFormat("en-GB", {day:"numeric",month:"short"}).format(record.date)}</text>` : "").join("");
  $("trend-chart").innerHTML = `<svg viewBox="0 0 ${width} ${height}" aria-hidden="true">${grid}${threshold}<path class="average-line" d="${averagePath}"/><path class="score-line" d="${path}"/>${pointsSvg}${labels}</svg>`;
}
function monthKey(date) { return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`; }
function monthDate(key) { const [year, month] = key.split("-").map(Number); return new Date(year, month - 1, 1); }
function shiftMonth(key, amount) { const date = monthDate(key); date.setMonth(date.getMonth() + amount); return monthKey(date); }
function renderHeatmap(records) {
  const datedRecords = records.filter((record) => record.date);
  const availableMonths = datedRecords.map((record) => monthKey(record.date));
  const firstMonth = availableMonths.sort()[0];
  const lastMonth = availableMonths.sort().at(-1);
  heatmapMonth = heatmapMonth || lastMonth;
  if (heatmapMonth < firstMonth) heatmapMonth = firstMonth;
  if (heatmapMonth > lastMonth) heatmapMonth = lastMonth;
  const date = monthDate(heatmapMonth);
  const year = date.getFullYear(); const month = date.getMonth();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const firstDay = new Date(year, month, 1).getDay();
  const recordByDate = new Map(datedRecords.map((record) => [monthKey(record.date) === heatmapMonth ? record.date.getDate() : null, record]));
  const cells = Array.from({ length: firstDay + daysInMonth }, (_, index) => {
    if (index < firstDay) return `<span class="heatmap-empty" aria-hidden="true"></span>`;
    const day = index - firstDay + 1; const record = recordByDate.get(day);
    if (!record) return `<span class="heatmap-day heatmap-missing" title="${day} ${date.toLocaleString("en-GB", { month: "long" })}: No entry" aria-label="${day}: No entry"></span>`;
    const tone = record.score == null ? "incomplete" : scoreCategory(record.score).tone;
    const label = record.score == null ? "Incomplete" : `${record.score}/100, ${scoreCategory(record.score).label}`;
    return `<span class="heatmap-day heatmap-${tone}" title="${day} ${date.toLocaleString("en-GB", { month: "long" })}: ${label}" aria-label="${day}: ${label}">${day}</span>`;
  }).join("");
  $("heatmap-title").textContent = date.toLocaleString("en-GB", { month: "long", year: "numeric" });
  $("heatmap-grid").innerHTML = cells;
  $("heatmap-previous").disabled = heatmapMonth === firstMonth;
  $("heatmap-next").disabled = heatmapMonth === lastMonth;
  $("heatmap-previous").onclick = () => { heatmapMonth = shiftMonth(heatmapMonth, -1); renderHeatmap(records); };
  $("heatmap-next").onclick = () => { heatmapMonth = shiftMonth(heatmapMonth, 1); renderHeatmap(records); };
}
function renderInsights(records) {
  const recent = records.filter((record) => record.score != null).slice(-7); const statements = [];
  const screenOver = recent.filter((record) => record.screenMinutes > 120).length; const studyTarget = recent.filter((record) => record.studyMinutes >= 390).length; const sleepTarget = recent.filter((record) => record.sleep >= 450 && record.sleep <= 510).length;
  if (!recent.length) statements.push("Add complete daily entries to begin identifying patterns.");
  else { statements.push(`${studyTarget} of the last ${recent.length} completed days met the 6h 30m study target.`); statements.push(`${screenOver} of the last ${recent.length} completed days exceeded 2 hours of screen time.`); statements.push(`${sleepTarget} of the last ${recent.length} completed days landed in the 7h 30m–8h 30m sleep range.`); }
  $("insights").innerHTML = statements.map((text) => `<div class="insight"><span class="insight-mark">•</span><span>${text}</span></div>`).join("");
}
function renderTable(records) {
  const sortedRecords = [...records].reverse();
  const totalPages = Math.max(1, Math.ceil(sortedRecords.length / tablePageSize));
  tablePage = Math.min(tablePage, totalPages);
  const start = (tablePage - 1) * tablePageSize;
  const pageRecords = sortedRecords.slice(start, start + tablePageSize);
  $("daily-log").innerHTML = pageRecords.map((record) => { const category = record.score == null ? null : scoreCategory(record.score); return `<tr><td>${displayDate(record.date)}</td><td class="score-cell${category ? ` tone-${category.tone}` : ""}">${record.score == null ? "Incomplete" : `${record.score} · ${category.label}`}</td><td>${displayDuration(record.sleep)}</td><td>${displayTime(record.bedtimeMinutes)}</td><td>${displayTime(record.wakeMinutes)}</td><td>${displayDuration(record.studyMinutes)}</td><td>${displayDuration(record.screenMinutes)}</td><td class="context" title="${record.context || ""}">${record.context || "—"}</td></tr>`; }).join("");
  $("table-pagination").innerHTML = `<label for="table-page-size">Rows per page</label><select id="table-page-size"><option value="5"${tablePageSize === 5 ? " selected" : ""}>5</option><option value="10"${tablePageSize === 10 ? " selected" : ""}>10</option></select><span>Page ${tablePage} of ${totalPages}</span><button class="page-button" type="button" data-page="${tablePage - 1}"${tablePage === 1 ? " disabled" : ""}>Previous</button><button class="page-button" type="button" data-page="${tablePage + 1}"${tablePage === totalPages ? " disabled" : ""}>Next</button>`;
  $("table-page-size").addEventListener("change", (event) => { tablePageSize = Number(event.target.value); tablePage = 1; renderTable(records); });
  $("table-pagination").querySelectorAll("[data-page]").forEach((button) => button.addEventListener("click", () => { tablePage = Number(button.dataset.page); renderTable(records); }));
}
function renderDashboard(records) {
  const completed = records.filter((record) => record.score != null); if (!completed.length) throw new Error("No complete daily entries were found yet.");
  const latest = completed.at(-1); const recent = completed.slice(-7); const average = Math.round(recent.reduce((total,record) => total + record.score, 0) / recent.length); const best = completed.reduce((best,record) => record.score > best.score ? record : best);
  const latestCategory = scoreCategory(latest.score);
  $("latest-score").textContent = latest.score; $("latest-date").textContent = displayDate(latest.date); $("score-label").textContent = latestCategory.label; $("score-label").className = `pill tone-${latestCategory.tone}`;
  $("latest-score").className = `score-value tone-${latestCategory.tone}`;
  $("latest-score").closest(".score-card").className = `card score-card tone-${latestCategory.tone}`;
  $("seven-day-score").textContent = `${average}/100`; $("best-score").textContent = `${best.score}/100`; $("best-score-date").textContent = displayDate(best.date); $("on-track-days").textContent = `${completed.filter((record) => record.score >= 75).length}/${completed.length}`;
  heatmapMonth = monthKey(latest.date); renderBreakdown(latest); renderChart(records); renderHeatmap(records); renderInsights(records); renderTable(records); $("dashboard").hidden = false; $("status").hidden = true;
}
async function refresh() { $("status").hidden = false; $("status").className = "status"; $("status").textContent = "Loading your sheet…"; try { renderDashboard(await loadRecords()); } catch (error) { $("dashboard").hidden = true; $("status").className = "status error"; $("status").textContent = error.message; } }
$("refresh-button").addEventListener("click", refresh); refresh();
