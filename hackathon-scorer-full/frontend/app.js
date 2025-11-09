const API = window.__API_BASE__ || "";

const el = (sel) => document.querySelector(sel);
const galleryInput = el("#galleryUrl");
const fetchBtn = el("#fetchProjectsBtn");
const projectsStatus = el("#projectsStatus");
const projectsList = el("#projectsList");

const rubricFile = el("#rubricFile");
const parseRubricBtn = el("#parseRubricBtn");
const rubricStatus = el("#rubricStatus");
const rubricPreview = el("#rubricPreview");

const scoreBtn = el("#scoreAllBtn");
const scoreStatus = el("#scoreStatus");
const scoreboard = el("#scoreboard");
const modelSel = el("#model");
const autoRerun = el("#autoRerun");

let state = {
  galleryUrl: "",
  projects: [],
  rubric: [],
  results: []
};

// --- persistence ---
function saveState(){
  localStorage.setItem("hackathon-scorer-state", JSON.stringify({
    galleryUrl: state.galleryUrl,
    projects: state.projects,
    rubric: state.rubric,
    results: state.results,
    model: modelSel.value,
    auto: autoRerun.checked
  }));
}

function loadState(){
  try{
    const raw = localStorage.getItem("hackathon-scorer-state");
    if(!raw) return;
    const s = JSON.parse(raw);
    state.galleryUrl = s.galleryUrl || "";
    state.projects = s.projects || [];
    state.rubric = s.rubric || [];
    state.results = s.results || [];
    galleryInput.value = state.galleryUrl;
    modelSel.value = s.model || "gemini-1.5-pro";
    autoRerun.checked = s.auto ?? true;
    renderProjects();
    renderRubric();
    renderScoreboard();
  }catch{}
}

window.addEventListener("beforeunload", saveState);

// --- UI helpers ---
function setBusy(el, msg){
  el.innerHTML = `<span class="spinner"></span> ${msg}`;
}
function setMsg(el, msg){
  el.textContent = msg;
}
function clear(elm){ elm.innerHTML = ""; }
function escapeHtml(s){
  return String(s)
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;");
}

// --- Fetch projects ---
fetchBtn.addEventListener("click", async ()=>{
  const url = galleryInput.value.trim();
  if(!url) return setMsg(projectsStatus, "Please paste a Devpost gallery URL.");
  state.galleryUrl = url;
  saveState();

  setBusy(projectsStatus, "Scraping gallery...");
  projectsList.innerHTML = "";
  try{
    const resp = await fetch(`${API}/api/scrape-devpost?url=` + encodeURIComponent(url));
    if(!resp.ok) throw new Error(await resp.text());
    const data = await resp.json();
    state.projects = data.projects || [];
    renderProjects();
    setMsg(projectsStatus, `Found ${state.projects.length} projects`);
  }catch(err){
    setMsg(projectsStatus, "Error: " + err.message);
  }
});

function renderProjects(){
  projectsList.innerHTML = "";
  if(!state.projects.length) return;
  state.projects.forEach((p,i)=>{
    const div = document.createElement("div");
    div.className = "item";
    div.innerHTML = `<strong>${i+1}. ${escapeHtml(p.name || "Untitled")}</strong><br>
      <a href="${p.url}" target="_blank" rel="noopener">Open project</a>`;
    projectsList.appendChild(div);
  });
}

// --- Parse rubric PDF ---
parseRubricBtn.addEventListener("click", async ()=>{
  const file = rubricFile.files?.[0];
  if(!file) return setMsg(rubricStatus, "Choose a rubric PDF first.");
  const fd = new FormData();
  fd.append("rubric", file);
  fd.append("model", modelSel.value);

  setBusy(rubricStatus, "Uploading & parsing rubric PDF with Gemini...");
  rubricPreview.innerHTML = "";
  try{
    const resp = await fetch(`${API}/api/parse-rubric`, { method:"POST", body: fd });
    if(!resp.ok) throw new Error(await resp.text());
    const data = await resp.json();
    state.rubric = data.rubric || [];
    renderRubric();
    setMsg(rubricStatus, `Parsed ${state.rubric.length} criteria.`);
    saveState();
  }catch(err){
    setMsg(rubricStatus, "Error: " + err.message);
  }
});

function renderRubric(){
  rubricPreview.innerHTML = "";
  if(!state.rubric.length) return;
  state.rubric.forEach((c)=>{
    const div = document.createElement("div");
    div.className = "item";
    div.innerHTML = `<strong>${escapeHtml(c.name)}</strong> &nbsp;
      <span class="badge">weight: ${Number(c.weight).toFixed(2)}</span>`;
    rubricPreview.appendChild(div);
  });
}

// --- Score all ---
scoreBtn.addEventListener("click", async ()=>{
  if(!state.projects.length) return setMsg(scoreStatus, "Fetch projects first.");
  if(!state.rubric.length) return setMsg(scoreStatus, "Parse a rubric first.");

  setBusy(scoreStatus, "Fetching project pages & scoring with Gemini...");
  scoreboard.innerHTML = "";
  try{
    const resp = await fetch(`${API}/api/score`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        projects: state.projects,
        rubric: state.rubric,
        model: modelSel.value
      })
    });
    if(!resp.ok) throw new Error(await resp.text());
    const data = await resp.json();
    state.results = data.results || [];
    renderScoreboard();
    setMsg(scoreStatus, `Scored ${state.results.length} projects.`);
    saveState();
  }catch(err){
    setMsg(scoreStatus, "Error: " + err.message);
  }
});

function renderScoreboard(){
  scoreboard.innerHTML = "";
  if(!state.results.length) return;
  // table
  const table = document.createElement("table");
  table.className = "table";
  const thead = document.createElement("thead");
  thead.innerHTML = `<tr>
    <th>#</th><th>Project</th><th>Total</th><th>Breakdown</th>
  </tr>`;
  table.appendChild(thead);
  const tbody = document.createElement("tbody");
  state.results
    .slice()
    .sort((a,b)=> b.total - a.total)
    .forEach((r, idx)=>{
      const tr = document.createElement("tr");
      const rank = idx+1;
      const breakdown = r.items.map(it => `${escapeHtml(it.name)}: ${Number(it.score).toFixed(1)}`).join(" • ");
      tr.innerHTML = `<td class="rank">${rank}</td>
        <td><a href="${r.url}" target="_blank" rel="noopener">${escapeHtml(r.name)}</a></td>
        <td>${Number(r.total).toFixed(1)}</td>
        <td>${breakdown}</td>`;
      tbody.appendChild(tr);
    });
  table.appendChild(tbody);
  scoreboard.appendChild(table);
}

// auto-run on load
loadState();
window.addEventListener("load", async ()=>{
  if(autoRerun.checked && state.galleryUrl && state.rubric.length){
    // Optional: re-scrape gallery (freshness) and re-score
    try{
      setBusy(projectsStatus, "Refreshing gallery...");
      const resp = await fetch(`${API}/api/scrape-devpost?url=` + encodeURIComponent(state.galleryUrl));
      if(resp.ok){
        const data = await resp.json();
        state.projects = data.projects || state.projects;
        renderProjects();
        setMsg(projectsStatus, `Found ${state.projects.length} projects`);
      }
    }catch{}
    // Re-run score
    if(state.projects.length){
      setBusy(scoreStatus, "Re-scoring projects...");
      try{
        const resp = await fetch(`${API}/api/score`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ projects: state.projects, rubric: state.rubric, model: modelSel.value })
        });
        if(resp.ok){
          const data = await resp.json();
          state.results = data.results || state.results;
          renderScoreboard();
          setMsg(scoreStatus, `Scored ${state.results.length} projects.`);
        }
      }catch{}
    }
  }
});
