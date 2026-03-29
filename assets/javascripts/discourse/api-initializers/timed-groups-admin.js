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

  async function bulkImport(groupId, days, note) {
    return apiFetch("/memberships/bulk_import", {
      method: "POST",
      body: JSON.stringify({ group_id: groupId, days, note }),
    });
  }

  async function getAutoTrack() {
    return apiFetch("/auto_track");
  }

  async function setAutoTrack(groupId, mode, opts = {}) {
    return apiFetch("/auto_track", {
      method: "PUT",
      body: JSON.stringify({ group_id: groupId, mode, ...opts }),
    });
  }

  async function getShopifyConfig() {
    return apiFetch("/shopify");
  }

  async function updateShopifyConfig(productMap, renewUrls) {
    return apiFetch("/shopify", {
      method: "PUT",
      body: JSON.stringify({ product_map: productMap, renew_urls: renewUrls }),
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
          className: "btn btn-primary tg-btn",
          onClick: () => showBulkImportModal(container),
        }, "Gruppe importieren"),
        el("button", {
          className: "btn btn-default tg-btn",
          onClick: () => showBulkModal(container),
        }, "Alle verlaengern"),
        el("button", {
          className: "btn btn-default tg-btn",
          onClick: () => showAutoTrackModal(container),
        }, "Auto-Track"),
        el("button", {
          className: "btn btn-default tg-btn",
          onClick: () => showShopifyModal(container),
        }, "Shopify"),
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

  function showBulkImportModal(container) {
    removeModal();

    const overlay = el("div", { className: "tg-modal-overlay", onClick: removeModal });
    const modal = el("div", { className: "tg-modal" });
    modal.addEventListener("click", (e) => e.stopPropagation());

    const groupSelect = el("select", { className: "tg-input tg-input--wide" },
      [el("option", { value: "" }, "Gruppe waehlen...")].concat(
        allGroups.map((g) => {
          const memberHint = g.full_name || g.name;
          return el("option", { value: String(g.id) }, memberHint);
        }),
      ),
    );

    const daysInput = el("input", {
      type: "number",
      className: "tg-input",
      value: "365",
      min: "1",
    });

    const noteInput = el("input", {
      type: "text",
      className: "tg-input tg-input--wide",
      placeholder: "z.B. Bulk Import Maerz 2026",
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

          if (!confirm(`Alle Mitglieder der Gruppe mit ${days} Tagen Laufzeit importieren?`)) return;

          try {
            const res = await bulkImport(parseInt(groupSelect.value), days, noteInput.value || null);
            removeModal();
            await loadData();
            render(container);
            alert(`${res.created} importiert, ${res.skipped} uebersprungen (bereits vorhanden).`);
          } catch (e) {
            errorDiv.textContent = "Fehler: " + e.message;
          }
        },
      }, "Importieren"),
      el("button", { className: "btn btn-default", onClick: removeModal }, "Abbrechen"),
    ]);

    modal.append(
      el("h3", {}, "Gruppe importieren"),
      el("p", { className: "tg-modal-desc" },
        "Alle aktuellen Mitglieder einer Gruppe als zeitlich begrenzte Mitgliedschaften anlegen. " +
        "Bereits vorhandene Eintraege werden uebersprungen."),
      el("div", { className: "tg-form-group" }, [el("label", {}, "Gruppe:"), groupSelect]),
      el("div", { className: "tg-form-group" }, [el("label", {}, "Laufzeit (Tage):"), daysInput]),
      el("div", { className: "tg-form-group" }, [el("label", {}, "Notiz:"), noteInput]),
      errorDiv,
      actions,
    );

    overlay.appendChild(modal);
    document.body.appendChild(overlay);
  }

  function showAutoTrackModal(container) {
    removeModal();

    const overlay = el("div", { className: "tg-modal-overlay", onClick: removeModal });
    const modal = el("div", { className: "tg-modal" });
    modal.addEventListener("click", (e) => e.stopPropagation());

    const errorDiv = el("div", { className: "tg-error" });
    const listDiv = el("div", { className: "tg-auto-track-list" });

    function getGroupMode(g) {
      if (!g.auto_track) return "off";
      return g.auto_track.mode || "off";
    }

    function renderList() {
      listDiv.innerHTML = "";
      for (const g of allGroups) {
        const mode = getGroupMode(g);

        // Mode select
        const modeSelect = el("select", { className: "tg-input tg-auto-track-mode" },
          [
            { v: "off", l: "Aus" },
            { v: "individual", l: "Individuell" },
            { v: "license", l: "Gruppenlizenz" },
          ].map(({ v, l }) => {
            const opt = el("option", { value: v }, l);
            if (v === mode) opt.selected = true;
            return opt;
          }),
        );

        // Days input (for individual mode)
        const daysInput = el("input", {
          type: "number",
          className: "tg-input tg-auto-track-days",
          value: String((g.auto_track && g.auto_track.days) || "365"),
          min: "1",
          placeholder: "Tage",
        });

        // Date input (for license mode)
        const dateInput = el("input", {
          type: "date",
          className: "tg-input tg-auto-track-date",
          value: (g.auto_track && g.auto_track.expires_at) || "",
        });

        // Show/hide based on mode
        daysInput.style.display = mode === "individual" ? "" : "none";
        dateInput.style.display = mode === "license" ? "" : "none";

        modeSelect.addEventListener("change", () => {
          daysInput.style.display = modeSelect.value === "individual" ? "" : "none";
          dateInput.style.display = modeSelect.value === "license" ? "" : "none";
        });

        const saveBtn = el("button", {
          className: `btn btn-small ${mode !== "off" ? "btn-primary" : "btn-default"}`,
          onClick: async () => {
            errorDiv.textContent = "";
            const selectedMode = modeSelect.value;
            try {
              if (selectedMode === "off") {
                await setAutoTrack(g.id, selectedMode, {});
                g.auto_track = null;
              } else if (selectedMode === "individual") {
                const days = parseInt(daysInput.value) || 0;
                if (days < 1) { errorDiv.textContent = "Bitte Tage eingeben"; return; }
                await setAutoTrack(g.id, selectedMode, { days });
                g.auto_track = { mode: "individual", days };
              } else if (selectedMode === "license") {
                if (!dateInput.value) { errorDiv.textContent = "Bitte Ablaufdatum eingeben"; return; }
                await setAutoTrack(g.id, selectedMode, { expires_at: dateInput.value });
                g.auto_track = { mode: "license", expires_at: dateInput.value };
              }
              renderList();
            } catch (e) {
              errorDiv.textContent = "Fehler: " + e.message;
            }
          },
        }, "Speichern");

        // Status label
        let statusText = "";
        if (mode === "individual") statusText = `${g.auto_track.days}d pro User`;
        if (mode === "license") statusText = `bis ${g.auto_track.expires_at}`;

        const row = el("div", { className: "tg-auto-track-row" }, [
          el("div", { className: "tg-auto-track-name" }, [
            el("strong", {}, g.full_name || g.name),
            statusText ? el("span", { className: "tg-auto-track-status" }, ` — ${statusText}`) : null,
          ].filter(Boolean)),
          el("div", { className: "tg-auto-track-controls" }, [
            modeSelect,
            daysInput,
            dateInput,
            saveBtn,
          ]),
        ]);
        listDiv.appendChild(row);
      }
    }
    renderList();

    const actions = el("div", { className: "tg-modal-actions" }, [
      el("button", { className: "btn btn-default", onClick: removeModal }, "Schliessen"),
    ]);

    modal.append(
      el("h3", {}, "Auto-Track Einstellungen"),
      el("p", { className: "tg-modal-desc" },
        "Individuell: Jeder User bekommt eigene X Tage ab Beitritt. " +
        "Gruppenlizenz: Festes Ablaufdatum — wer spaeter kommt, bekommt nur die Restzeit."),
      listDiv,
      errorDiv,
      actions,
    );

    overlay.appendChild(modal);
    document.body.appendChild(overlay);
  }

  function showShopifyModal(container) {
    removeModal();

    const overlay = el("div", { className: "tg-modal-overlay", onClick: removeModal });
    const modal = el("div", { className: "tg-modal tg-modal--wide" });
    modal.addEventListener("click", (e) => e.stopPropagation());

    const errorDiv = el("div", { className: "tg-error" });
    const contentDiv = el("div", {});

    // Load config
    (async () => {
      try {
        const config = await getShopifyConfig();

        // Webhook URL (copy-paste fuer Shopify Admin)
        const webhookUrl = el("div", { className: "tg-shopify-url" }, [
          el("label", {}, "Webhook-URL (in Shopify eintragen):"),
          el("div", { className: "tg-shopify-url-box" }, [
            el("code", {}, config.webhook_url),
            el("button", {
              className: "btn btn-small btn-default",
              onClick: () => {
                navigator.clipboard.writeText(config.webhook_url);
                alert("URL kopiert!");
              },
            }, "Kopieren"),
          ]),
        ]);

        // Secret status
        const secretStatus = el("div", { className: "tg-shopify-secret" }, [
          el("label", {}, "Webhook-Secret:"),
          el("span", {
            className: config.webhook_secret_configured ? "tg-badge tg-badge--active" : "tg-badge tg-badge--expired",
          }, config.webhook_secret_configured ? "Konfiguriert" : "Nicht gesetzt"),
          el("span", { className: "tg-shopify-hint" },
            " (unter Admin > Einstellungen > \"shopify\" suchen)"),
        ]);

        // Product mapping
        const mappingDiv = el("div", { className: "tg-shopify-mapping" });
        const mappings = Object.entries(config.product_map || {});

        function renderMappings(currentMappings) {
          mappingDiv.innerHTML = "";

          mappingDiv.appendChild(el("label", {}, "Produkt-ID → Gruppe Zuordnung:"));

          if (currentMappings.length === 0) {
            mappingDiv.appendChild(
              el("p", { className: "tg-shopify-hint" }, "Noch keine Zuordnungen. Klicke \"+\" um eine hinzuzufuegen."),
            );
          }

          for (const [idx, [productId, groupId]] of currentMappings.entries()) {
            const groupSelect = el("select", { className: "tg-input" },
              [el("option", { value: "" }, "Gruppe...")].concat(
                allGroups.map((g) => {
                  const opt = el("option", { value: String(g.id) }, g.full_name || g.name);
                  if (String(g.id) === String(groupId)) opt.selected = true;
                  return opt;
                }),
              ),
            );

            const prodInput = el("input", {
              type: "text",
              className: "tg-input tg-shopify-product-input",
              value: productId,
              placeholder: "Shopify Produkt-ID",
            });

            const removeBtn = el("button", {
              className: "btn btn-small btn-danger",
              onClick: () => {
                currentMappings.splice(idx, 1);
                renderMappings(currentMappings);
              },
            }, "×");

            // Update mapping on change
            prodInput.addEventListener("input", () => { currentMappings[idx][0] = prodInput.value; });
            groupSelect.addEventListener("change", () => { currentMappings[idx][1] = groupSelect.value; });

            mappingDiv.appendChild(
              el("div", { className: "tg-shopify-mapping-row" }, [prodInput, el("span", {}, "→"), groupSelect, removeBtn]),
            );
          }

          // Add button
          mappingDiv.appendChild(
            el("button", {
              className: "btn btn-small btn-default",
              onClick: () => {
                currentMappings.push(["", ""]);
                renderMappings(currentMappings);
              },
            }, "+ Zuordnung"),
          );
        }

        const currentMappings = mappings.map(([k, v]) => [k, v]);
        renderMappings(currentMappings);

        // Renew URLs (Shopify product links per group)
        const renewDiv = el("div", { className: "tg-shopify-mapping" });
        const renewUrls = Object.entries(config.renew_urls || {});
        const currentRenewUrls = {};
        for (const [gid, url] of renewUrls) currentRenewUrls[gid] = url;

        renewDiv.appendChild(el("label", {}, "Verlaengerungs-Links (in Ablauf-Benachrichtigungen):"));
        renewDiv.appendChild(el("p", { className: "tg-shopify-hint" },
          "Shopify-Produkt-URL pro Gruppe. Wird in der PM an User gezeigt wenn der Zugang bald ablaeuft."));

        for (const g of allGroups) {
          const urlInput = el("input", {
            type: "text",
            className: "tg-input tg-input--wide",
            value: currentRenewUrls[String(g.id)] || "",
            placeholder: "https://outoftheb-ox.de/products/...",
          });
          urlInput.addEventListener("input", () => {
            if (urlInput.value) {
              currentRenewUrls[String(g.id)] = urlInput.value;
            } else {
              delete currentRenewUrls[String(g.id)];
            }
          });

          renewDiv.appendChild(
            el("div", { className: "tg-shopify-renew-row" }, [
              el("span", { className: "tg-shopify-renew-group" }, g.full_name || g.name),
              urlInput,
            ]),
          );
        }

        // Save button
        const saveBtn = el("button", {
          className: "btn btn-primary",
          onClick: async () => {
            errorDiv.textContent = "";
            const map = {};
            for (const [pid, gid] of currentMappings) {
              if (pid && gid) map[pid] = gid;
            }
            try {
              await updateShopifyConfig(map, currentRenewUrls);
              alert("Shopify-Konfiguration gespeichert!");
            } catch (e) {
              errorDiv.textContent = "Fehler: " + e.message;
            }
          },
        }, "Speichern");

        contentDiv.append(webhookUrl, secretStatus, mappingDiv, renewDiv, errorDiv,
          el("div", { className: "tg-modal-actions" }, [
            saveBtn,
            el("button", { className: "btn btn-default", onClick: removeModal }, "Schliessen"),
          ]),
        );
      } catch (e) {
        contentDiv.innerHTML = `<div class="tg-error">Fehler beim Laden: ${e.message}</div>`;
      }
    })();

    modal.append(
      el("h3", {}, "Shopify-Integration"),
      el("p", { className: "tg-modal-desc" },
        "Verbindet Shopify-Kaeufe mit Discourse-Gruppenzugaengen. " +
        "Wenn ein Kunde ein zugeordnetes Produkt kauft, wird er automatisch zur Gruppe hinzugefuegt."),
      contentDiv,
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

    // Wait for Ember to render the template, then find our container
    const waitForContainer = (attempts = 0) => {
      return new Promise((resolve) => {
        const check = () => {
          const el = document.getElementById("timed-groups-admin");
          if (el) return resolve(el);
          if (attempts < 20) {
            setTimeout(() => { attempts++; check(); }, 150);
          } else {
            resolve(null);
          }
        };
        check();
      });
    };

    const container = await waitForContainer();
    if (!container) return;

    rendered = true;

    try {
      await loadData();
      render(container);
    } catch (e) {
      container.innerHTML = `<div class="tg-error">Fehler beim Laden: ${e.message}</div>`;
    }
  });
});
