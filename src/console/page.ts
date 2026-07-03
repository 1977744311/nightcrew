/**
 * The console frontend: one dependency-free static page. Fetches the JSON
 * API, subscribes to SSE, renders with plain DOM. No build step by design —
 * the console must never be the thing that breaks overnight.
 */
export function consoleHtml(actions = false): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>nightcrew console</title>
<style>
  :root {
    --bg: #0b0e14; --panel: #11151f; --panel2: #161b28; --line: #232a3b;
    --text: #d6dbe7; --dim: #7d8698; --green: #4ade80; --red: #f87171;
    --yellow: #fbbf24; --blue: #60a5fa; --purple: #c084fc;
  }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--text);
         font: 14px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace; }
  header { padding: 14px 22px; border-bottom: 1px solid var(--line);
           display: flex; align-items: baseline; gap: 12px; }
  header h1 { font-size: 16px; margin: 0; letter-spacing: .04em; }
  header .moon { color: var(--yellow); }
  header .sub { color: var(--dim); font-size: 12px; }
  main { padding: 18px 22px; max-width: 1180px; margin: 0 auto; }
  .cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 14px; }
  .card { background: var(--panel); border: 1px solid var(--line); border-radius: 10px;
          padding: 14px 16px; cursor: pointer; }
  .card:hover { border-color: #35405a; }
  .card h2 { margin: 0 0 6px; font-size: 15px; }
  .badge { display: inline-block; padding: 1px 8px; border-radius: 99px; font-size: 11px;
           border: 1px solid var(--line); color: var(--dim); margin-left: 6px; }
  .badge.ok { color: var(--green); border-color: #234432; }
  .badge.bad { color: var(--red); border-color: #4a2530; }
  .badge.warn { color: var(--yellow); border-color: #4a3d1f; }
  .kv { color: var(--dim); font-size: 12px; }
  .kv b { color: var(--text); font-weight: 600; }
  table { width: 100%; border-collapse: collapse; font-size: 12.5px; margin-top: 8px; }
  th { text-align: left; color: var(--dim); font-weight: 500; padding: 4px 8px;
       border-bottom: 1px solid var(--line); }
  td { padding: 4px 8px; border-bottom: 1px solid #1a2030; }
  .st-success { color: var(--green); } .st-failed { color: var(--red); }
  .st-idle { color: var(--yellow); } .st-quota { color: var(--purple); }
  section { margin-top: 22px; }
  section h3 { font-size: 13px; color: var(--dim); text-transform: uppercase;
               letter-spacing: .08em; margin: 0 0 8px; }
  .panel { background: var(--panel); border: 1px solid var(--line); border-radius: 10px; padding: 12px 16px; }
  #log { height: 260px; overflow-y: auto; font-size: 12px; }
  #log div { padding: 1px 0; color: var(--dim); }
  #log .k-iteration-started, #log .k-iteration-finished { color: var(--text); }
  #log .k-loop-stopped { color: var(--red); }
  a.back { color: var(--blue); text-decoration: none; font-size: 12px; }
  svg { display: block; }
  .spark path { fill: none; stroke: var(--blue); stroke-width: 1.5; }
  .spark rect { fill: #1d2434; }
  .muted { color: var(--dim); }
  .plans li { margin: 2px 0; }
  .plans .pid { color: var(--blue); }
  .actions { display: inline-flex; gap: 8px; margin-left: 12px; }
  .actions button { background: var(--panel2); color: var(--text); border: 1px solid var(--line);
                    border-radius: 6px; padding: 3px 10px; font: inherit; font-size: 12px; cursor: pointer; }
  .actions button:hover { border-color: #35405a; }
  .proposals { display: grid; gap: 12px; }
  .proposal + .proposal { border-top: 1px solid var(--line); padding-top: 12px; }
  .proposal-head { display: flex; justify-content: space-between; gap: 12px; align-items: baseline; }
  .proposal-title { font-size: 13px; font-weight: 700; }
  .proposal-items { list-style: none; margin: 8px 0 0; padding: 0; }
  .proposal-item { padding: 8px 0; border-top: 1px solid #1a2030; }
  .proposal-line { display: grid; grid-template-columns: 18px minmax(0, 1fr) auto; gap: 8px;
                   align-items: center; }
  .proposal-line input { width: 14px; height: 14px; accent-color: var(--blue); }
  .proposal-line input:disabled { opacity: .45; }
  .proposal-item-title { overflow-wrap: anywhere; }
  .proposal-body { margin: 6px 0 0 26px; white-space: pre-wrap; color: var(--text);
                   background: var(--panel2); border: 1px solid #1a2030; border-radius: 6px;
                   padding: 8px 10px; font: inherit; font-size: 12px; }
  .proposal-actions { display: flex; justify-content: flex-end; align-items: center; gap: 10px;
                      margin-top: 8px; }
  .proposal-actions button { background: var(--panel2); color: var(--text); border: 1px solid var(--line);
                             border-radius: 6px; padding: 3px 10px; font: inherit; font-size: 12px;
                             cursor: pointer; }
  .proposal-actions button:hover { border-color: #35405a; }
  .questions { display: grid; gap: 12px; }
  .question + .question { border-top: 1px solid var(--line); padding-top: 12px; }
  .question-text { font-size: 13px; font-weight: 700; overflow-wrap: anywhere; }
  .question-options { list-style: none; margin: 8px 0 0; padding: 0; }
  .question-options li { padding: 4px 0; }
  .question-line { display: flex; gap: 8px; align-items: baseline; }
  .question-line input { width: 14px; height: 14px; accent-color: var(--blue); flex: none; }
  .question-option-text { overflow-wrap: anywhere; }
  .question-actions { display: flex; align-items: center; gap: 10px; margin-top: 8px; }
  .question-actions input[type=text] { flex: 1; min-width: 0; background: var(--panel2);
                                       border: 1px solid var(--line); border-radius: 6px;
                                       color: var(--text); font: inherit; font-size: 12px;
                                       padding: 4px 8px; }
  .question-actions button { background: var(--panel2); color: var(--text); border: 1px solid var(--line);
                             border-radius: 6px; padding: 3px 10px; font: inherit; font-size: 12px;
                             cursor: pointer; white-space: nowrap; }
  .question-actions button:hover { border-color: #35405a; }
</style>
</head>
<body>
<header>
  <h1><span class="moon">☾</span> nightcrew</h1>
  <span class="sub">your coding agents on the night shift</span>
  <span class="sub" id="clock"></span>
</header>
<main id="app"><div class="muted">loading…</div></main>
<script>
var ACTIONS = ${actions ? "true" : "false"};
var app = document.getElementById("app");
var es = null;

function post(name, action) {
  fetch("/api/projects/" + encodeURIComponent(name) + "/" + action, { method: "POST" })
    .then(function () { route(); });
}

function approveProposal(name, proposalId, container) {
  var checked = Array.prototype.slice.call(
    container.querySelectorAll("input[type=checkbox]:checked")
  ).map(function (input) { return input.value; });
  var status = container.querySelector(".proposal-status");
  if (!checked.length) {
    if (status) status.textContent = "no items selected";
    return;
  }
  fetch("/api/projects/" + encodeURIComponent(name) + "/proposals/approve", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ proposalId: proposalId, ids: checked }),
  }).then(function (r) {
    if (!r.ok) throw new Error("http " + r.status);
    return r.json();
  }).then(function () {
    route();
  }).catch(function (e) {
    if (status) status.textContent = "approval failed: " + e.message;
  });
}

function postQuestion(name, action, payload, status) {
  fetch("/api/projects/" + encodeURIComponent(name) + "/questions/" + action, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  }).then(function (r) {
    if (!r.ok) return r.json().then(function (b) { throw new Error(b.error || ("http " + r.status)); });
    return r.json();
  }).then(function () {
    route();
  }).catch(function (e) {
    if (status) status.textContent = action + " failed: " + e.message;
  });
}

function answerQuestionEntry(name, key, container) {
  var chosen = container.querySelector("input[type=radio]:checked");
  var status = container.querySelector(".question-status");
  if (!chosen) {
    if (status) status.textContent = "pick an option first";
    return;
  }
  postQuestion(name, "answer", { key: key, answer: chosen.value }, status);
}

function sendQuestionFeedback(name, key, container) {
  var input = container.querySelector("input[type=text]");
  var status = container.querySelector(".question-status");
  var feedback = input ? input.value.trim() : "";
  if (!feedback) {
    if (status) status.textContent = "write feedback first";
    return;
  }
  postQuestion(name, "feedback", { key: key, feedback: feedback }, status);
}

function actionButtons(name, state) {
  if (!ACTIONS) return [];
  var buttons = [];
  if (state && state.paused) {
    buttons.push(h("button", { onclick: function (e) { e.stopPropagation(); post(name, "resume"); } }, ["resume"]));
  } else {
    buttons.push(h("button", { onclick: function (e) { e.stopPropagation(); post(name, "pause"); } }, ["pause"]));
  }
  if (state && state.stop) {
    buttons.push(h("button", { onclick: function (e) { e.stopPropagation(); post(name, "resume"); } }, ["clear stop"]));
  }
  buttons.push(h("button", { onclick: function (e) { e.stopPropagation(); post(name, "gc"); } }, ["gc"]));
  return [h("span", { class: "actions" }, buttons)];
}

function h(tag, attrs, children) {
  var el = document.createElement(tag);
  attrs = attrs || {};
  for (var k in attrs) {
    if (k === "onclick") el.onclick = attrs[k];
    else if (k === "html") el.innerHTML = attrs[k];
    else el.setAttribute(k, attrs[k]);
  }
  (children || []).forEach(function (c) {
    el.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
  });
  return el;
}

function fmtTime(iso) { return iso ? iso.slice(5, 16).replace("T", " ") : ""; }

function fmtDuration(ms) {
  var seconds = Math.max(0, Math.round((ms || 0) / 1000));
  var hours = Math.floor(seconds / 3600);
  var minutes = Math.floor((seconds % 3600) / 60);
  var rest = seconds % 60;
  if (hours) return hours + "h " + String(minutes).padStart(2, "0") + "m";
  if (minutes) return minutes + "m " + String(rest).padStart(2, "0") + "s";
  return seconds + "s";
}

function stateBadges(s) {
  var out = [];
  if (!s) return out;
  if (s.paused) out.push(h("span", { class: "badge warn" }, ["paused"]));
  if (s.resumeAt) out.push(h("span", { class: "badge warn" }, ["quota → " + fmtTime(s.resumeAt)]));
  if (s.stop) out.push(h("span", { class: "badge bad" }, ["stopped: " + s.stop.reason]));
  var repairs = s.pendingRepairs ? Object.keys(s.pendingRepairs) : [];
  if (repairs.length) out.push(h("span", { class: "badge warn" }, ["repair: " + repairs.join(", ")]));
  if (out.length === 0) out.push(h("span", { class: "badge ok" }, ["ready"]));
  return out;
}

function sparkline(records) {
  var pts = records.filter(function (r) { return r.usage; }).map(function (r) {
    return r.usage.inputTokens + r.usage.outputTokens + r.usage.reasoningOutputTokens;
  });
  var w = 560, ht = 60;
  var svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("width", w); svg.setAttribute("height", ht); svg.setAttribute("class", "spark");
  var bg = document.createElementNS("http://www.w3.org/2000/svg", "rect");
  bg.setAttribute("width", w); bg.setAttribute("height", ht); bg.setAttribute("rx", 6);
  svg.appendChild(bg);
  if (pts.length > 1) {
    var max = Math.max.apply(null, pts) || 1;
    var d = pts.map(function (v, i) {
      var x = 8 + (i * (w - 16)) / (pts.length - 1);
      var y = ht - 8 - (v / max) * (ht - 16);
      return (i === 0 ? "M" : "L") + x.toFixed(1) + "," + y.toFixed(1);
    }).join(" ");
    var path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", d);
    svg.appendChild(path);
  }
  return svg;
}

function renderQuestions(d) {
  var questions = d.questions || [];
  var body = questions.length ? h("div", { class: "questions" }, questions.map(function (q) {
    var section = h("div", { class: "question" }, []);
    var badges = [];
    if (q.feedback) badges.push(h("span", { class: "badge warn" }, ["awaiting new options"]));
    var head = h("div", {}, [
      h("div", { class: "question-text" }, [q.text].concat(badges)),
    ]);
    if (q.feedback) {
      head.appendChild(h("div", { class: "kv" }, ["feedback: " + q.feedback]));
    }
    var options = h("ul", { class: "question-options" }, q.options.map(function (opt) {
      var inputAttrs = { type: "radio", name: "q-" + q.key, value: opt.label };
      if (!ACTIONS) inputAttrs.disabled = "disabled";
      var optBadges = [];
      if (opt.recommended) optBadges.push(h("span", { class: "badge ok" }, ["recommended"]));
      if (opt.schedules) optBadges.push(h("span", { class: "badge" }, ["→ backlog"]));
      return h("li", {}, [
        h("label", { class: "question-line" }, [
          h("input", inputAttrs, []),
          h("span", { class: "question-option-text" }, [opt.label + ": " + opt.text].concat(optBadges)),
        ]),
      ]);
    }));
    section.appendChild(head);
    if (q.options.length) section.appendChild(options);
    else section.appendChild(h("div", { class: "kv" }, ["no options yet — leave feedback and the crew drafts some next run"]));
    if (ACTIONS) {
      var actions = h("div", { class: "question-actions" }, [
        h("input", { type: "text", placeholder: "none of these? tell the crew what to redraft…" }, []),
        h("button", { onclick: function () { sendQuestionFeedback(d.name, q.key, section); } }, ["send feedback"]),
      ]);
      if (q.options.length) {
        actions.appendChild(h("button", { onclick: function () { answerQuestionEntry(d.name, q.key, section); } }, ["answer"]));
      }
      section.appendChild(actions);
      section.appendChild(h("div", { class: "question-status kv" }, []));
    }
    return section;
  })) : h("span", { class: "muted" }, ["none"]);
  return h("section", {}, [
    h("h3", {}, ["open questions (" + questions.length + ")"]),
    h("div", { class: "panel" }, [body]),
  ]);
}

function renderProposals(d) {
  var proposals = d.proposals || [];
  var body = proposals.length ? h("div", { class: "proposals" }, proposals.map(function (p) {
    var section = h("div", { class: "proposal", "data-proposal-id": p.id }, []);
    var items = h("ul", { class: "proposal-items" }, p.items.map(function (item) {
      var inputAttrs = { type: "checkbox", value: item.id };
      if (!ACTIONS) inputAttrs.disabled = "disabled";
      return h("li", { class: "proposal-item" }, [
        h("label", { class: "proposal-line" }, [
          h("input", inputAttrs, []),
          h("span", { class: "proposal-item-title" }, [item.id + ". " + item.title]),
          h("span", { class: "badge" }, [item.lens]),
        ]),
        h("pre", { class: "proposal-body" }, [item.body]),
      ]);
    }));
    var children = [
      h("div", { class: "proposal-head" }, [
        h("div", {}, [
          h("div", { class: "proposal-title" }, [p.goal].concat(
            p.source === "qa" ? [h("span", { class: "badge warn" }, ["from qa.md"])] : [])),
          h("div", { class: "kv" }, [p.id + "  " + fmtTime(p.createdAt)]),
        ]),
      ]),
      items,
    ];
    if (ACTIONS) {
      children.push(h("div", { class: "proposal-actions" }, [
        h("span", { class: "proposal-status muted" }, []),
        h("button", { onclick: function () { approveProposal(d.name, p.id, section); } }, ["approve selected"]),
      ]));
    }
    children.forEach(function (child) { section.appendChild(child); });
    return section;
  })) : h("span", { class: "muted" }, ["none"]);
  return h("section", {}, [
    h("h3", {}, ["pending proposals (" + proposals.length + ")"]),
    h("div", { class: "panel" }, [body]),
  ]);
}

function renderPlanMetrics(d) {
  var plans = d.planMetrics || [];
  if (!plans.length) {
    return h("section", {}, [
      h("h3", {}, ["plan accounting"]),
      h("div", { class: "panel" }, [h("span", { class: "muted" }, ["none"])]),
    ]);
  }
  return h("section", {}, [
    h("h3", {}, ["plan accounting"]),
    h("table", {}, [
      h("thead", {}, [
        h("tr", {}, ["plan", "title", "iter", "tokens", "duration", "status"].map(function (t) {
          return h("th", {}, [t]);
        })),
      ]),
      h("tbody", {}, plans.map(function (p) {
        var status = p.status || (p.landed ? "landed" : "pending");
        return h("tr", {}, [
          h("td", { class: "muted" }, [p.planId]),
          h("td", {}, [p.title]),
          h("td", {}, [String(p.iterations)]),
          h("td", {}, [Number(p.totalTokens || 0).toLocaleString()]),
          h("td", { class: "muted" }, [fmtDuration(p.durationMs)]),
          h("td", { class: status === "landed" ? "st-success" : "muted" }, [status]),
        ]);
      })),
    ]),
  ]);
}

function renderBoard(projects) {
  if (es) { es.close(); es = null; }
  var cards = projects.map(function (p) {
    var last = p.lastIteration;
    return h("div", { class: "card", onclick: function () { location.hash = "#/p/" + encodeURIComponent(p.name); } }, [
      h("h2", {}, [p.name].concat(p.ok ? stateBadges(p.state) : [h("span", { class: "badge bad" }, ["error"])])),
      h("div", { class: "kv" }, p.ok
        ? ["plans: ", h("b", {}, [String(p.activePlans)]), " active / " + p.completedPlans + " done",
           last ? "  ·  last: " + last.operation + " " + last.status + " " + fmtTime(last.startedAt) : ""]
        : [p.error || "unreadable"]),
    ]);
  });
  app.replaceChildren(
    h("div", { class: "cards" }, cards.length ? cards : [h("div", { class: "muted" }, ["no projects registered — run 'nightcrew init' in a repo"])])
  );
}

function renderDetail(d) {
  if (es) { es.close(); es = null; }
  var rows = d.history.slice().reverse().slice(0, 40).map(function (r) {
    return h("tr", {}, [
      h("td", { class: "muted" }, [fmtTime(r.startedAt)]),
      h("td", {}, [r.operation]),
      h("td", { class: "st-" + r.status }, [r.status + (r.failure ? ":" + r.failure.kind : "")]),
      h("td", { class: "muted" }, [r.planId || ""]),
      h("td", {}, [String(r.commits.length) + (r.merged ? " ⬆" : "")]),
      h("td", { class: "muted" }, [r.usage ? String(r.usage.inputTokens + r.usage.outputTokens) : ""]),
    ]);
  });
  var planItems = d.plans.active.map(function (p) {
    return h("li", {}, [h("span", { class: "pid" }, [p.id]), (p.parallel ? " [parallel] " : " "), p.title]);
  });
  var log = h("div", { id: "log" }, []);

  app.replaceChildren(
    h("div", {}, [
      h("a", { class: "back", href: "#/" }, ["← all projects"]),
      h("h2", {}, [d.name].concat(stateBadges(d.state)).concat(actionButtons(d.name, d.state))),
      h("div", { class: "kv" }, [
        "streaks: failure=" + d.state.streaks.failure +
        " noCommit=" + d.state.streaks.noCommit +
        " controlOnly=" + d.state.streaks.controlOnly +
        "  ·  tokens total: " + d.budget.totalTokens.toLocaleString() +
        " over " + d.budget.iterations + " iterations",
      ]),
      h("section", {}, [h("h3", {}, ["active plans (" + d.plans.active.length + ")"]),
        h("div", { class: "panel" }, [d.plans.active.length ? h("ul", { class: "plans" }, planItems) : h("span", { class: "muted" }, ["none"])])]),
      renderQuestions(d),
      renderProposals(d),
      renderPlanMetrics(d),
      h("section", {}, [h("h3", {}, ["token curve"]), h("div", { class: "panel" }, [sparkline(d.history)])]),
      h("section", {}, [h("h3", {}, ["live events"]), h("div", { class: "panel" }, [log])]),
      h("section", {}, [h("h3", {}, ["iterations"]),
        h("table", {}, [
          h("thead", {}, [h("tr", {}, ["time", "op", "status", "plan", "commits", "tokens"].map(function (t) { return h("th", {}, [t]); }))]),
          h("tbody", {}, rows),
        ])]),
    ])
  );

  es = new EventSource("/api/projects/" + encodeURIComponent(d.name) + "/events");
  es.onmessage = function (msg) {
    try {
      var e = JSON.parse(msg.data);
      var line = h("div", { class: "k-" + (e.kind || "").replace(/\\./g, "-") },
        [fmtTime(e.at) + "  " + e.kind + "  " + JSON.stringify(e.data || {})]);
      log.appendChild(line);
      log.scrollTop = log.scrollHeight;
    } catch (err) { /* ignore */ }
  };
}

function route() {
  var hash = location.hash || "#/";
  var match = hash.match(/^#\\/p\\/(.+)$/);
  if (match) {
    fetch("/api/projects/" + match[1]).then(function (r) {
      if (!r.ok) throw new Error("http " + r.status);
      return r.json();
    }).then(renderDetail).catch(function (e) {
      app.replaceChildren(h("div", { class: "muted" }, ["failed to load project: " + e.message]));
    });
  } else {
    fetch("/api/projects").then(function (r) { return r.json(); }).then(renderBoard);
  }
}

window.addEventListener("hashchange", route);
setInterval(function () {
  document.getElementById("clock").textContent = new Date().toLocaleTimeString();
  if (!location.hash || location.hash === "#/") route();
}, 5000);
route();
</script>
</body>
</html>`;
}
