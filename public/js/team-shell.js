/**
 * Shared TEAM shell for Payroll static HTML pages.
 * Renders impersonation banner, cross-app header, optional view-as, and greeting.
 */
(function (global) {
  const UPDATES_URL = "https://teamvoc-updates.vercel.app/";
  const PHONE_BOOK_URL = "https://teamvoc-updates.vercel.app/phone-book";
  const VOC_HOTLINE_URL = "https://voc-hotline-nine.vercel.app";
  const HR_URL = "https://team-hr.vercel.app";

  const ADMIN_LINKS = [
    { href: "./my-leave.html", label: "Check my balances", key: "my-leave" },
    { href: "./index.html", label: "Analyze spreadsheet", key: "index" },
    { href: "./rates.html", label: "Employee pay rates", key: "rates" },
    { href: "./access.html", label: "Access management", key: "access" },
    { href: "./leave.html", label: "PTO/Sick management", key: "leave" },
  ];

  function greetingPrefix() {
    const h = new Date().getHours();
    if (h < 12) return "Good morning,";
    if (h < 17) return "Good afternoon,";
    return "Good evening,";
  }

  function firstNameFromDisplayName(fullName) {
    const s = String(fullName ?? "").trim().replace(/\s+/g, " ");
    if (!s) return "there";
    return s.split(" ")[0] || "there";
  }

  function escapeHtml(s) {
    return String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function crossAppNav(currentApp) {
    const links = [
      { href: "https://team-requests.vercel.app", label: "Requests", key: "requests" },
      { href: PHONE_BOOK_URL, label: "Phone book", key: "phone-book" },
      { href: VOC_HOTLINE_URL, label: "Voc hotline", key: "voc-hotline" },
      { href: "./my-leave.html", label: "Payroll", key: "payroll" },
      { href: HR_URL, label: "HR", key: "hr" },
    ];
    return links
      .map((l) => {
        const current = l.key === currentApp ? ' aria-current="page"' : "";
        return `<a href="${escapeHtml(l.href)}"${current}>${escapeHtml(l.label)}</a>`;
      })
      .join("");
  }

  function adminSubNav(currentKey) {
    return ADMIN_LINKS.map((l) => {
      const current = l.key === currentKey ? ' aria-current="page"' : "";
      return `<a href="${escapeHtml(l.href)}"${current}>${escapeHtml(l.label)}</a>`;
    }).join("");
  }

  function renderShellHtml(options) {
    const mode = options.mode || "employee";
    const adminPage = options.adminPage || null;
    const showViewAs = Boolean(options.enableViewAs);

    const adminRow =
      mode === "admin"
        ? `<nav class="team-header-nav team-header-nav-secondary" aria-label="Payroll admin">${adminSubNav(adminPage)}</nav>`
        : "";

    const viewAsHtml = showViewAs
      ? `<div class="team-view-as" id="viewAsRoot" hidden>
          <button type="button" class="team-view-as-trigger" id="viewAsTrigger" aria-expanded="false" aria-haspopup="menu">
            <span>View as…</span>
            <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
            </svg>
          </button>
          <ul class="team-view-as-menu" id="viewAsMenu" role="menu" aria-label="View as" hidden></ul>
        </div>`
      : "";

    return `
      <div id="impersonationBanner" class="team-impersonation-banner" hidden>
        <span>
          Viewing as <strong id="impersonationBannerName"></strong>
          <span class="team-impersonation-banner-email" id="impersonationBannerEmail"></span>
          — you&apos;re seeing exactly what they see in this app.
        </span>
        <button type="button" id="impersonationBannerExit">Exit view-as</button>
      </div>
      <header class="team-header">
        <div class="team-header-border">
          <div class="team-header-bar">
            <div class="team-header-left">
              <a href="${escapeHtml(UPDATES_URL)}" class="team-header-logo">
                <img src="./assets/team-logo.png" alt="Team Vocational Services" width="220" height="80" />
              </a>
              <nav class="team-header-nav" aria-label="Main">${crossAppNav("payroll")}</nav>
              ${adminRow}
            </div>
            <div class="team-header-right">
              <span id="greetingLine" class="team-header-greeting" aria-live="polite"></span>
              ${viewAsHtml}
              <a href="/logout" class="team-header-signout">Sign out</a>
            </div>
          </div>
        </div>
      </header>`;
  }

  function createViewAsController(root, onChange) {
    const viewAsRoot = root.querySelector("#viewAsRoot");
    const viewAsTrigger = root.querySelector("#viewAsTrigger");
    const viewAsMenu = root.querySelector("#viewAsMenu");
    const impersonationBanner = root.querySelector("#impersonationBanner");
    const impersonationBannerName = root.querySelector("#impersonationBannerName");
    const impersonationBannerEmail = root.querySelector("#impersonationBannerEmail");
    const impersonationBannerExit = root.querySelector("#impersonationBannerExit");
    const greetEl = root.querySelector("#greetingLine");

    if (!viewAsRoot || !viewAsTrigger || !viewAsMenu) {
      return {
        setGreeting(name) {
          if (greetEl) greetEl.textContent = `${greetingPrefix()} ${firstNameFromDisplayName(name)}`;
        },
        updateBanner(data) {
          updateImpersonationBanner(data);
        },
        applyMyLeaveMeta() {},
        async refreshFromImpersonateApi() {
          try {
            const r = await fetch("/api/impersonate", { credentials: "same-origin", cache: "no-store" });
            const status = r.ok ? await r.json() : null;
            if (status?.impersonating && status.target) {
              updateImpersonationBanner({
                impersonating: true,
                employeeName: status.target.name,
                employeeLoginEmail: status.target.email,
              });
            } else {
              updateImpersonationBanner({ impersonating: false });
            }
            if (status?.effective?.name) {
              this.setGreeting(status.effective.name);
            } else if (status?.real?.name) {
              this.setGreeting(status.real.name);
            }
          } catch {
            /* ignore */
          }
        },
      };
    }

    let activeImpersonateId = "";
    let viewerEmployeeId = null;
    let viewerDisplayName = "Yourself";
    let employees = [];
    let employeesLoaded = false;
    let employeesLoading = false;
    let viewAsOpen = false;
    let busyEmployeeId = null;

    function setViewAsOpen(open) {
      viewAsOpen = open;
      viewAsTrigger.setAttribute("aria-expanded", open ? "true" : "false");
      viewAsMenu.hidden = !open;
    }

    function closeViewAsMenu() {
      setViewAsOpen(false);
    }

    function updateImpersonationBanner(data) {
      if (!impersonationBanner) return;
      if (data && data.impersonating) {
        if (impersonationBannerName) {
          impersonationBannerName.textContent = data.employeeName || data.target?.name || "employee";
        }
        const email = data.employeeLoginEmail || data.target?.email || "";
        if (impersonationBannerEmail) {
          impersonationBannerEmail.textContent = email ? `(${email})` : "";
        }
        impersonationBanner.hidden = false;
      } else {
        impersonationBanner.hidden = true;
      }
    }

    function renderViewAsMenu() {
      viewAsMenu.innerHTML = "";

      const heading = document.createElement("li");
      heading.setAttribute("role", "presentation");
      heading.className = "team-view-as-menu-heading";
      heading.textContent = "View as…";
      viewAsMenu.appendChild(heading);

      if (activeImpersonateId) {
        const selfItem = document.createElement("li");
        selfItem.setAttribute("role", "none");
        const selfBtn = document.createElement("button");
        selfBtn.type = "button";
        selfBtn.setAttribute("role", "menuitem");
        selfBtn.className = "team-view-as-item";
        selfBtn.textContent =
          busyEmployeeId === "__self__" ? "Switching…" : `Yourself (${viewerDisplayName})`;
        selfBtn.disabled = busyEmployeeId === "__self__";
        selfBtn.addEventListener("click", () => exitViewAs());
        selfItem.appendChild(selfBtn);
        viewAsMenu.appendChild(selfItem);
      }

      if (employeesLoading) {
        const status = document.createElement("li");
        status.className = "team-view-as-status";
        status.textContent = "Loading users…";
        viewAsMenu.appendChild(status);
        return;
      }

      const others = employees.filter((emp) => emp.id !== viewerEmployeeId);
      for (const emp of others) {
        const li = document.createElement("li");
        li.setAttribute("role", "none");
        const btn = document.createElement("button");
        btn.type = "button";
        btn.setAttribute("role", "menuitem");
        btn.className = "team-view-as-item";
        const isCurrent = activeImpersonateId && emp.id === activeImpersonateId;
        if (isCurrent) btn.classList.add("is-current");
        btn.disabled = Boolean(busyEmployeeId);

        const name = document.createElement("span");
        name.className = "team-view-as-item-name";
        name.textContent = emp.displayName || emp.providerId || emp.id;
        btn.appendChild(name);

        const email = String(emp.loginEmail || "").trim();
        if (email) {
          const emailEl = document.createElement("span");
          emailEl.className = "team-view-as-item-email";
          emailEl.textContent = email;
          btn.appendChild(emailEl);
        }

        if (busyEmployeeId === emp.id) {
          const busy = document.createElement("span");
          busy.className = "team-view-as-item-email";
          busy.textContent = "Switching…";
          btn.appendChild(busy);
        }

        btn.addEventListener("click", () => selectEmployee(emp.id));
        li.appendChild(btn);
        viewAsMenu.appendChild(li);
      }

      if (!employeesLoading && others.length === 0) {
        const status = document.createElement("li");
        status.className = "team-view-as-status";
        status.textContent = "No other users found.";
        viewAsMenu.appendChild(status);
      }
    }

    async function fetchEmployees() {
      const r = await fetch("/api/view-as-users", { credentials: "same-origin" });
      const text = await r.text();
      let data = {};
      try {
        data = text ? JSON.parse(text) : {};
      } catch {
        throw new Error("Could not load users");
      }
      if (!r.ok) throw new Error(data.error || "Could not load users");
      return Array.isArray(data.users) ? data.users : [];
    }

    async function ensureEmployeesLoaded() {
      if (employeesLoaded || employeesLoading) return;
      employeesLoading = true;
      renderViewAsMenu();
      try {
        employees = await fetchEmployees();
        employeesLoaded = true;
      } catch (e) {
        viewAsMenu.innerHTML = "";
        const heading = document.createElement("li");
        heading.setAttribute("role", "presentation");
        heading.className = "team-view-as-menu-heading";
        heading.textContent = "View as…";
        viewAsMenu.appendChild(heading);
        const status = document.createElement("li");
        status.className = "team-view-as-status is-error";
        status.textContent = e.message || "Could not load users";
        viewAsMenu.appendChild(status);
        employeesLoading = false;
        return;
      }
      employeesLoading = false;
      renderViewAsMenu();
    }

    async function selectEmployee(id) {
      busyEmployeeId = id;
      renderViewAsMenu();
      closeViewAsMenu();
      try {
        const r = await fetch("/api/impersonate", {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ employeeId: id }),
        });
        const data = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(data.error || "Could not switch user");
        if (typeof onChange === "function") await onChange();
      } catch (e) {
        console.error(e);
        throw e;
      } finally {
        busyEmployeeId = null;
      }
    }

    async function exitViewAs() {
      busyEmployeeId = "__self__";
      renderViewAsMenu();
      closeViewAsMenu();
      try {
        await fetch("/api/impersonate", { method: "DELETE", credentials: "same-origin" });
        activeImpersonateId = "";
        if (typeof onChange === "function") await onChange();
      } finally {
        busyEmployeeId = null;
      }
    }

    viewAsTrigger.addEventListener("click", () => {
      const next = !viewAsOpen;
      setViewAsOpen(next);
      if (next) {
        renderViewAsMenu();
        ensureEmployeesLoaded();
      }
    });

    document.addEventListener("mousedown", (e) => {
      if (viewAsRoot.hidden || !viewAsOpen) return;
      if (!viewAsRoot.contains(e.target)) closeViewAsMenu();
    });

    if (impersonationBannerExit) {
      impersonationBannerExit.addEventListener("click", () => exitViewAs());
    }

    return {
      setGreeting(name) {
        if (greetEl) greetEl.textContent = `${greetingPrefix()} ${firstNameFromDisplayName(name)}`;
      },
      updateBanner(data) {
        updateImpersonationBanner(data);
      },
      applyMyLeaveMeta(data) {
        if (data.isAdmin) {
          viewerEmployeeId = data.viewerEmployeeId || null;
          viewerDisplayName = data.viewerDisplayName || "Yourself";
          viewAsRoot.hidden = false;
        }
        if (data.impersonating && data.employeeId) {
          activeImpersonateId = data.employeeId;
        } else {
          activeImpersonateId = "";
        }
        updateImpersonationBanner(data);
      },
      async refreshFromImpersonateApi() {
        try {
          const r = await fetch("/api/impersonate", { credentials: "same-origin", cache: "no-store" });
          const status = r.ok ? await r.json() : null;
          if (status && status.canImpersonate) {
            viewAsRoot.hidden = false;
            if (status.impersonating && status.target) {
              updateImpersonationBanner({
                impersonating: true,
                employeeName: status.target.name,
                employeeLoginEmail: status.target.email,
              });
            } else {
              updateImpersonationBanner({ impersonating: false });
            }
            if (status.effective?.name) {
              this.setGreeting(status.effective.name);
            }
          }
        } catch {
          /* ignore */
        }
      },
    };
  }

  /**
   * @param {object} options
   * @param {'employee'|'admin'} [options.mode]
   * @param {string|null} [options.adminPage] - key for admin sub-nav highlight
   * @param {boolean} [options.enableViewAs]
   * @param {() => Promise<void>|void} [options.onViewAsChange]
   */
  function mount(options) {
    const root = document.getElementById("team-shell-root");
    if (!root) return null;

    root.innerHTML = renderShellHtml(options);
    const controller = createViewAsController(root, options.onViewAsChange);

    if (options.mode === "admin") {
      controller.refreshFromImpersonateApi();
    }

    return controller;
  }

  global.TeamShell = {
    mount,
    greetingPrefix,
    firstNameFromDisplayName,
  };
})(typeof window !== "undefined" ? window : globalThis);
