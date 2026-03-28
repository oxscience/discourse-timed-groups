import { apiInitializer } from "discourse/lib/api";

export default apiInitializer("0.1", (api) => {
  // Only render for admin users
  if (!api.getCurrentUser()?.admin) return;

  const BASE = "/timed-groups/admin";

  function csrfToken() {
    return document.querySelector("meta[name='csrf-token']")?.content || "";
  }

  async function apiFetch(path, opts = {}) {
    const res = await fetch(`${BASE}${path}`, {
      headers: {
        "Content-Type": "application/json",
        "X-CSRF-Token": csrfToken(),
        "X-Requested-With": "XMLHttpRequest",
        ...opts.headers,
      },
      ...opts,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.errors?.join(", ") || `HTTP ${res.status}`);
    }
    return res.json();
  }

  // ── State ──────────────────────────────────────────────
  let allMemberships = [];
  let allGroups = [];
  let filterGroup = "";
  let filterStatus = "active";
  let editingId = null;

  // ── API calls ──────────────────────────────────────────
  async function loadData() {
    const [mData, gData] = await Promise.all([
      apiFetch("/memberships"),
      apiFetch("/groups"),
    ]);
    allMemberships = mData.memberships;
    allGroups = gData.groups;
  }

  async function createMembership(data) {
    return apiFetch("/memberships", {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  async function updateMembership(id, data) {
    return apiFetch(`/memberships/${id}`, {
      method: "PUT",
      body: JSON.stringify(data),
    });
  }

  async function deleteMembership(id) {
    return apiFetch(`/memberships/${id}`, { method: "DELETE" });
  }

  async function bulkExtend(groupId, days) {
    return apiFetch("/memberships/bulk_extend", {
      method: "POST",
      body: JSON.stringify({ group_id: groupId, days }),
    });
  }

  // ── User search (Discourse API) ───────────────────────
  let searchTimeout = null;
  async function searchUsers(term) {
    if (!term || term.length < 2) return [];
    const res = await fetch(`/u/search/users.json?term=${encodeURIComponent(term)}`);
    const data = await res.json();
    return data.users || [];
  }

  // ── Rendering ──────────────────────────────────────────
  function el(tag, attrs = {}, children = []) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === "className") node.className = v;
      else if (k.startsWith("on")) node.addEventListener(k.slice(2).toLowerCase(), v);
      else if (k === "innerHTML") node.innerHTML = v;
      else if (k === "value") node.value = v;
      else node.setAttribute(k, v);
    }
    for (const child of [].concat(children)) {
      if (typeof child === "string") node.appendChild(document.createTextNode(child));
      else if (child) node.appendChild(child);
    }
    return node;
  }

  function formatDate(iso) {
    if (!iso) return "–";
    return new Date(iso).toLocaleDateString("de-DE", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    });
  }

  function toInputDate(iso) {
    if (!iso) return "";
    return iso.slice(0, 10);
  }

  function statusBadge(m) {
    if (m.active) {
      if (m.days_remaining <= 7) {
        return el("span", { className: "tg-badge tg-badge--warning" }, `${m.days_remaining}d`);
      }
      return el("span", { className: "tg-badge tg-badge--active" }, `${m.days_remaining}d`);
    }
    return el("span", { className: "tg-badge tg-badge--expired" }, "Abgelaufen");
  }

  function filteredMemberships() {
    return allMemberships.filter((m) => {
      if (filterGroup && m.group.id !== parseInt(filterGroup)) return false;
      if (filterStatus === "active" && !m.active) return false;
      if (filterStatus === "expired" && m.active) return false;
      return true;
    });
  }

  // ── Main render ────────────────────────────────────────
  function render(container) {
    container.innerHTML = "";

    // Header
    const header = el("div", { className: "tg-header" }, [
      el("h2", {}, "Zeitlich begrenzte Gruppen"),
      el("div", { className: "tg-header-actions" }, [
        el("button", {
          className: "btn btn-primary tg-btn",
          onClick: () => showAddModal(container),
        }, "+ Mitgliedschaft"),
        el("button", {
          className: "btn btn-default tg-btn",
          onClick: () => showBulkModal(container),
        }, "Alle verlaengern"),
      ]),
    ]);

    // Filters
    const groupOpts = [el("option", { value: "" }, "Alle Gruppen")];
    for (const g of allGroups) {
      const opt = el("option", { value: String(g.id) }, g.full_name || g.name);
      if (String(g.id) === filterGroup) opt.selected = true;
      groupOpts.push(opt);
    }

    const groupSelect = el("select", {
      className: "tg-filter-select",
      onChange: (e) => { filterGroup = e.target.value; render(container); },
    }, groupOpts);

    const statusOpts = [
      { v: "active", l: "Aktiv" },
      { v: "expired", l: "Abgelaufen" },
      { v: "all", l: "Alle" },
    ].map(({ v, l }) => {
      const opt = el("option", { value: v }, l);
      if (v === filterStatus) opt.selected = true;
      return opt;
    });

    const statusSelect = el("select", {
      className: "tg-filter-select",
      onChange: (e) => { filterStatus = e.target.value; render(container); },
    }, statusOpts);

    const filters = el("div", { className: "tg-filters" }, [
      el("label", {}, ["Gruppe: ", groupSelect]),
      el("label", {}, ["Status: ", statusSelect]),
    ]);

    // Table
    const rows = filteredMemberships();

    const tableHead = el("thead", {}, [
      el("tr", {}, [
        el("th", {}, "Benutzer"),
        el("th", {}, "Gruppe"),
        el("th", {}, "Start"),
        el("th", {}, "Ablauf"),
        el("th", {}, "Status"),
        el("th", {}, "Notiz"),
        el("th", {}, "Aktionen"),
      ]),
    ]);

    const tableBody = el("tbody", {});
    if (rows.length === 0) {
      tableBody.appendChild(
        el("tr", {}, [
          el("td", { colspan: "7", className: "tg-empty" }, "Keine Mitgliedschaften gefunden."),
        ]),
      );
    } else {
      for (const m of rows) {
        if (editingId === m.id) {
          tableBody.appendChild(renderEditRow(m, container));
        } else {
          tableBody.appendChild(renderRow(m, container));
        }
      }
    }

    const table = el("table", { className: "tg-table" }, [tableHead, tableBody]);

    // Summary
    const activeCount = allMemberships.filter((m) => m.active).length;
    const expiredCount = allMemberships.filter((m) => !m.active).length;
    const summary = el("div", { className: "tg-summary" },
      `${activeCount} aktiv, ${expiredCount} abgelaufen, ${allMemberships.length} gesamt`,
    );

    container.append(header, filters, table, summary);
  }

  function renderRow(m, container) {
    const avatar = el("img", {
      src: m.user.avatar_url,
      className: "tg-avatar",
      width: "24",
      height: "24",
    });
    const userCell = el("td", { className: "tg-user-cell" }, [
      avatar,
      el("span", {}, [
        el("strong", {}, m.user.username),
        m.user.name ? el("span", { className: "tg-user-name" }, ` (${m.user.name})`) : null,
      ].filter(Boolean)),
    ]);

    return el("tr", { className: m.active ? "" : "tg-row-expired" }, [
      userCell,
      el("td", {}, m.group.full_name || m.group.name),
      el("td", {}, formatDate(m.starts_at)),
      el("td", {}, formatDate(m.expires_at)),
      el("td", {}, [statusBadge(m)]),
      el("td", { className: "tg-note" }, m.note || "–"),
      el("td", { className: "tg-actions" }, [
        el("button", {
          className: "btn btn-small btn-default",
          onClick: () => { editingId = m.id; render(container); },
        }, "Bearbeiten"),
        el("button", {
          className: "btn btn-small btn-danger",
          onClick: async () => {
            if (!confirm("Mitgliedschaft entfernen? Der Nutzer wird aus der Gruppe entfernt.")) return;
            try {
              await deleteMembership(m.id);
              await loadData();
              render(container);
            } catch (e) {
              alert("Fehler: " + e.message);
            }
          },
        }, "Entfernen"),
      ]),
    ]);
  }

  function renderEditRow(m, container) {
    const expiresInput = el("input", {
      type: "date",
      className: "tg-input",
      value: toInputDate(m.expires_at),
    });
    const noteInput = el("input", {
      type: "text",
      className: "tg-input tg-input--wide",
      value: m.note || "",
      placeholder: "Notiz...",
    });

    return el("tr", { className: "tg-row-editing" }, [
      el("td", {}, m.user.username),
      el("td", {}, m.group.full_name || m.group.name),
      el("td", {}, formatDate(m.starts_at)),
      el("td", {}, [expiresInput]),
      el("td", {}, [statusBadge(m)]),
      el("td", {}, [noteInput]),
      el("td", { className: "tg-actions" }, [
        el("button", {
          className: "btn btn-small btn-primary",
          onClick: async () => {
            try {
              await updateMembership(m.id, {
                expires_at: expiresInput.value,
                note: noteInput.value,
              });
              editingId = null;
              await loadData();
              render(container);
            } catch (e) {
              alert("Fehler: " + e.message);
            }
          },
        }, "Speichern"),
        el("button", {
          className: "btn btn-small btn-default",
          onClick: () => { editingId = null; render(container); },
        }, "Abbrechen"),
      ]),
    ]);
  }

  // ── Modals ─────────────────────────────────────────────
  function showAddModal(container) {
    removeModal();

    let selectedUser = null;

    const overlay = el("div", { className: "tg-modal-overlay", onClick: removeModal });
    const modal = el("div", { className: "tg-modal" });
    modal.addEventListener("click", (e) => e.stopPropagation());

    const title = el("h3", {}, "Mitgliedschaft hinzufuegen");

    // User search
    const userInput = el("input", {
      type: "text",
      className: "tg-input tg-input--wide",
      placeholder: "Benutzername suchen...",
    });
    const userResults = el("div", { className: "tg-user-results" });
    const userSelected = el("div", { className: "tg-user-selected" });

    userInput.addEventListener("input", () => {
      clearTimeout(searchTimeout);
      searchTimeout = setTimeout(async () => {
        const users = await searchUsers(userInput.value);
        userResults.innerHTML = "";
        for (const u of users.slice(0, 5)) {
          const item = el("div", {
            className: "tg-user-result",
            onClick: () => {
              selectedUser = u;
              userInput.value = u.username;
              userResults.innerHTML = "";
              userSelected.innerHTML = "";
              userSelected.appendChild(
                el("span", { className: "tg-badge tg-badge--active" },
                  `${u.username}${u.name ? ` (${u.name})` : ""}`),
              );
            },
          }, [
            el("img", {
              src: u.avatar_template.replace("{size}", "24"),
              width: "24",
              height: "24",
              className: "tg-avatar",
            }),
            el("span", {}, `${u.username}${u.name ? ` – ${u.name}` : ""}`),
          ]);
          userResults.appendChild(item);
        }
      }, 300);
    });

    // Group select
    const groupSelect = el("select", { className: "tg-input tg-input--wide" },
      [el("option", { value: "" }, "Gruppe waehlen...")].concat(
        allGroups.map((g) => el("option", { value: String(g.id) }, g.full_name || g.name)),
      ),
    );

    // Duration
    const durationRow = el("div", { className: "tg-duration-row" });
    const daysInput = el("input", {
      type: "number",
      className: "tg-input",
      value: "30",
      min: "1",
      max: "3650",
    });
    const expiresInput = el("input", {
      type: "date",
      className: "tg-input",
    });

    // Sync days → date
    function syncDaysToDate() {
      const d = new Date();
      d.setDate(d.getDate() + parseInt(daysInput.value || "30"));
      expiresInput.value = d.toISOString().slice(0, 10);
    }
    syncDaysToDate();
    daysInput.addEventListener("input", syncDaysToDate);
    expiresInput.addEventListener("input", () => {
      const diff = Math.ceil((new Date(expiresInput.value) - new Date()) / 86400000);
      daysInput.value = Math.max(1, diff);
    });

    durationRow.append(
      el("label", {}, ["Tage: ", daysInput]),
      el("label", {}, ["oder Datum: ", expiresInput]),
    );

    // Note
    const noteInput = el("input", {
      type: "text",
      className: "tg-input tg-input--wide",
      placeholder: "Optionale Notiz...",
    });

    // Actions
    const errorDiv = el("div", { className: "tg-error" });
    const actions = el("div", { className: "tg-modal-actions" }, [
      el("button", {
        className: "btn btn-primary",
        onClick: async () => {
          errorDiv.textContent = "";
          if (!selectedUser) { errorDiv.textContent = "Bitte Benutzer waehlen"; return; }
          if (!groupSelect.value) { errorDiv.textContent = "Bitte Gruppe waehlen"; return; }
          if (!expiresInput.value) { errorDiv.textContent = "Bitte Ablaufdatum waehlen"; return; }

          try {
            await createMembership({
              username: selectedUser.username,
              group_id: parseInt(groupSelect.value),
              expires_at: expiresInput.value,
              note: noteInput.value || null,
            });
            removeModal();
            await loadData();
            render(container);
          } catch (e) {
            errorDiv.textContent = "Fehler: " + e.message;
          }
        },
      }, "Hinzufuegen"),
      el("button", { className: "btn btn-default", onClick: removeModal }, "Abbrechen"),
    ]);

    modal.append(
      title,
      el("div", { className: "tg-form-group" }, [el("label", {}, "Benutzer:"), userInput, userResults, userSelected]),
      el("div", { className: "tg-form-group" }, [el("label", {}, "Gruppe:"), groupSelect]),
      el("div", { className: "tg-form-group" }, [el("label", {}, "Dauer:"), durationRow]),
      el("div", { className: "tg-form-group" }, [el("label", {}, "Notiz:"), noteInput]),
      errorDiv,
      actions,
    );

    overlay.appendChild(modal);
    document.body.appendChild(overlay);
  }

  function showBulkModal(container) {
    removeModal();

    const overlay = el("div", { className: "tg-modal-overlay", onClick: removeModal });
    const modal = el("div", { className: "tg-modal" });
    modal.addEventListener("click", (e) => e.stopPropagation());

    const groupSelect = el("select", { className: "tg-input tg-input--wide" },
      [el("option", { value: "" }, "Gruppe waehlen...")].concat(
        allGroups.map((g) => el("option", { value: String(g.id) }, g.full_name || g.name)),
      ),
    );

    const daysInput = el("input", {
      type: "number",
      className: "tg-input",
      value: "30",
      min: "1",
    });

    const errorDiv = el("div", { className: "tg-error" });

    const actions = el("div", { className: "tg-modal-actions" }, [
      el("button", {
        className: "btn btn-primary",
        onClick: async () => {
          errorDiv.textContent = "";
          if (!groupSelect.value) { errorDiv.textContent = "Bitte Gruppe waehlen"; return; }
          const days = parseInt(daysInput.value);
          if (!days || days < 1) { errorDiv.textContent = "Bitte gueltige Tagesanzahl eingeben"; return; }

          const activeInGroup = allMemberships.filter(
            (m) => m.active && m.group.id === parseInt(groupSelect.value),
          ).length;

          if (!confirm(`${activeInGroup} aktive Mitgliedschaft(en) um ${days} Tage verlaengern?`)) return;

          try {
            const res = await bulkExtend(parseInt(groupSelect.value), days);
            removeModal();
            await loadData();
            render(container);
            alert(`${res.updated} Mitgliedschaft(en) verlaengert.`);
          } catch (e) {
            errorDiv.textContent = "Fehler: " + e.message;
          }
        },
      }, "Verlaengern"),
      el("button", { className: "btn btn-default", onClick: removeModal }, "Abbrechen"),
    ]);

    modal.append(
      el("h3", {}, "Alle aktiven Mitgliedschaften verlaengern"),
      el("div", { className: "tg-form-group" }, [el("label", {}, "Gruppe:"), groupSelect]),
      el("div", { className: "tg-form-group" }, [el("label", {}, "Tage:"), daysInput]),
      errorDiv,
      actions,
    );

    overlay.appendChild(modal);
    document.body.appendChild(overlay);
  }

  function removeModal() {
    document.querySelector(".tg-modal-overlay")?.remove();
  }

  // ── Page change hook ───────────────────────────────────
  let rendered = false;

  api.onPageChange(async (url) => {
    if (!url.startsWith("/admin/plugins/timed-groups")) {
      rendered = false;
      return;
    }

    if (rendered) return;
    rendered = true;

    // Wait for DOM to settle after Ember transition
    await new Promise((r) => setTimeout(r, 150));

    const container =
      document.querySelector(".admin-plugin-config-area") ||
      document.querySelector(".admin-contents") ||
      document.querySelector("#main-outlet .container");

    if (!container) return;

    // Clear any Ember content and show loading
    container.innerHTML = '<div class="tg-loading">Lade Daten...</div>';

    try {
      await loadData();
      render(container);
    } catch (e) {
      container.innerHTML = `<div class="tg-error">Fehler beim Laden: ${e.message}</div>`;
    }
  });
});
