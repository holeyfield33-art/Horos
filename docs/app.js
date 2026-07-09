"use strict";
/* Horos public router — GitHub Pages front-end.
   Talks to the free, unauthenticated POST /public/route on the Horos service.
   No secrets here: the server holds the signing key; this page only sends a
   repo URL (or a graph) plus a task, and renders what comes back. */

const HOROS_BACKEND_ORIGIN = "https://horos.onrender.com";

let lastReceipt = null;

function $(id) { return document.getElementById(id); }

function setStatus(msg, kind) {
  const el = $("status");
  el.textContent = msg || "";
  el.className = "status" + (kind ? " " + kind : "");
}

function renderList(label, arr) {
  if (!arr || !arr.length) return label + ":\n  (none)\n";
  return label + ":\n" + arr.map((x) => "  " + x).join("\n") + "\n";
}

async function runHoros() {
  const repoUrl = $("repo-input").value.trim();
  const ref = $("ref-input").value.trim();
  const graphText = $("graph-input").value.trim();
  const task = $("task-input").value.trim();

  if (!task) { setStatus("Describe your task first.", "err"); return; }

  const body = { task };
  // Graph wins if provided; otherwise fall back to the repo URL.
  if (graphText) {
    let graph;
    try {
      graph = JSON.parse(graphText);
    } catch (e) {
      setStatus("That graph isn't valid JSON: " + e.message, "err");
      return;
    }
    body.graph = graph;
  } else if (repoUrl) {
    if (!/^https:\/\/github\.com\/[^/]+\/[^/]+/.test(repoUrl)) {
      setStatus("Enter a full public GitHub URL, e.g. https://github.com/owner/name", "err");
      return;
    }
    body.repo_url = repoUrl;
    if (ref) body.ref = ref;
  } else {
    setStatus("Paste a GitHub repo URL (or a graph.json) to route.", "err");
    return;
  }

  const btn = $("run-btn");
  btn.disabled = true;
  setStatus(body.repo_url ? "Cloning and routing… (a fresh clone can take a moment)" : "Routing…", "busy");

  try {
    const res = await fetch(HOROS_BACKEND_ORIGIN + "/public/route", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    const text = await res.text();
    if (!res.ok) {
      let detail = text;
      try { detail = (JSON.parse(text).error) || text; } catch (e) { /* plain text */ }
      setStatus("Request failed (" + res.status + "): " + detail, "err");
      btn.disabled = false;
      return;
    }

    const data = JSON.parse(text);
    const s = data.summary || {};
    $("result-output").textContent =
      renderList("Selected files", s.selected_files) + "\n" +
      renderList("Excluded files", s.excluded_files) + "\n" +
      renderList("Unresolved symbols", s.unresolved_symbols);

    lastReceipt = data.receipt || null;
    $("receipt-output").textContent = lastReceipt
      ? JSON.stringify(lastReceipt, null, 2)
      : "(no receipt returned)";

    $("results").hidden = false;
    $("download-btn").disabled = !lastReceipt;
    setStatus("Done — " + ((s.selected_files && s.selected_files.length) || 0) + " file(s) selected.", "ok");
    $("results").scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (e) {
    // Network/CORS/parse failures land here.
    setStatus("Could not reach Horos: " + e.message, "err");
  } finally {
    btn.disabled = false;
  }
}

function downloadReceipt() {
  if (!lastReceipt) return;
  const blob = new Blob([JSON.stringify(lastReceipt, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "receipt.json";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function toggleGraph() {
  const wrap = $("graph-wrap");
  const btn = $("toggle-graph");
  const open = wrap.hidden;
  wrap.hidden = !open;
  btn.setAttribute("aria-expanded", String(open));
  btn.textContent = (open ? "▾" : "▸") + " Advanced: paste a graph.json instead of a repo";
}

document.addEventListener("DOMContentLoaded", () => {
  $("run-btn").addEventListener("click", runHoros);
  $("download-btn").addEventListener("click", downloadReceipt);
  $("toggle-graph").addEventListener("click", toggleGraph);
});
