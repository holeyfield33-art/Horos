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

function hideErrorPanel() {
  $("error-panel").hidden = true;
}

/* Prominent, styled panel — the reason and a next step, never a bare status code
   that scrolls off. `kind` is "error" (red) or "info" (brass, benign). */
function showPanel(kind, title, codeLine, message) {
  const panel = $("error-panel");
  panel.classList.toggle("info", kind === "info");
  $("error-title").textContent = title;
  const out = $("error-output");
  out.textContent = "";
  if (codeLine) {
    const c = document.createElement("span");
    c.className = "ecode";
    c.textContent = codeLine;
    out.appendChild(c);
  }
  out.appendChild(document.createTextNode(message));
  panel.hidden = false;
  panel.scrollIntoView({ behavior: "smooth", block: "start" });
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
  hideErrorPanel();
  setStatus(body.repo_url ? "Cloning and routing… (a fresh clone can take a moment)" : "Routing…", "busy");

  try {
    const res = await fetch(HOROS_BACKEND_ORIGIN + "/public/route", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    const text = await res.text();
    if (!res.ok) {
      // Surface the server's `error` field prominently — reason + next step + status,
      // never a lone HTTP code. Fall back to the raw body if it isn't JSON.
      let detail = text;
      try { detail = (JSON.parse(text).error) || text; } catch (e) { /* plain text */ }
      $("results").hidden = true;
      showPanel("error", "Couldn't route this repository", "HTTP " + res.status,
        detail || "The request failed with no further detail.");
      setStatus("Request failed (" + res.status + ").", "err");
      btn.disabled = false;
      return;
    }

    const data = JSON.parse(text);
    const s = data.summary || {};
    const selected = s.selected_files || [];

    lastReceipt = data.receipt || null;
    $("receipt-output").textContent = lastReceipt
      ? JSON.stringify(lastReceipt, null, 2)
      : "(no receipt returned)";
    $("download-btn").disabled = !lastReceipt;

    if (!selected.length) {
      // Empty selection is a valid 200 (signed receipt and all) — but it is NOT a
      // success list. Show the server's note as an informational panel.
      $("results").hidden = true;
      showPanel("info", "No files matched", null,
        data.note || "No files matched this task. Try a more specific task — name a feature, file, or subsystem.");
      setStatus("No files matched — see the note above.", "");
      btn.disabled = false;
      return;
    }

    $("result-output").textContent =
      renderList("Selected files", selected) + "\n" +
      renderList("Excluded files", s.excluded_files) + "\n" +
      renderList("Unresolved symbols", s.unresolved_symbols);

    $("results").hidden = false;
    setStatus("Done — " + selected.length + " file(s) selected.", "ok");
    $("results").scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (e) {
    // Network/CORS/parse failures land here.
    $("results").hidden = true;
    showPanel("error", "Couldn't reach Horos", null,
      "Could not reach the Horos service: " + e.message + ". Check your connection and try again.");
    setStatus("Could not reach Horos.", "err");
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
