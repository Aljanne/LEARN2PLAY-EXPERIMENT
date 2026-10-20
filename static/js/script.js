"use strict";

/* ============================================================
   Learn2Play — dashboard script

   Part 1  User, roles and modes   (every page with the topbar)
   Part 2  Profile dropdown        (every page with the topbar)
   Part 3  Tutor grid, filters, search (database-driven)
   ============================================================ */

/* ---------- storage helpers (localStorage can throw, e.g. private mode) ---------- */
const store = {
  get(key)        { try { return localStorage.getItem(key); } catch (e) { return null; } },
  set(key, value) { try { localStorage.setItem(key, value); } catch (e) { /* ignore */ } },
  remove(key)     { try { localStorage.removeItem(key); } catch (e) { /* ignore */ } },
};

const KEYS = { user: "l2_user", mode: "l2_activeMode" };

function esc(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}


/* ============================================================
   PART 1 — user, roles and modes
   ============================================================ */
const MODES = {
  student: { label: "Learning" },
  mentor:  { label: "Mentoring" },
  coach:   { label: "Coaching" },
};

function getUser() {
  let user = null;
  try { user = JSON.parse(store.get(KEYS.user)); } catch (e) { /* ignore bad data */ }

  if (!user) {
    user = { name: "User", email: "", roles: ["student"] };
  }

  user.roles = (user.roles || []).filter((r) => MODES[r]);
  if (user.roles.length === 0) user.roles = ["student"];

  return user;
}

const user = getUser();
const availableModes = user.roles;

function pickInitialMode() {
  const saved = store.get(KEYS.mode);
  return availableModes.includes(saved) ? saved : availableModes[0];
}

let activeMode = pickInitialMode();

function applyMode() {
  document.querySelectorAll("[data-show-for]").forEach((el) => {
    const modes = el.dataset.showFor.split(/\s+/);
    el.classList.toggle("hidden", !modes.includes(activeMode));
  });

  const switcher = document.getElementById("modeSwitch");
  if (switcher) {
    switcher.classList.toggle("hidden", availableModes.length < 2);
    switcher.querySelectorAll(".mode-btn").forEach((btn) => {
      const mode = btn.dataset.mode;
      const isActive = mode === activeMode;
      btn.classList.toggle("hidden", !availableModes.includes(mode));
      btn.classList.toggle("active", isActive);
      btn.setAttribute("aria-pressed", String(isActive));
    });
  }
}

function setMode(mode) {
  if (!availableModes.includes(mode) || mode === activeMode) return;
  activeMode = mode;
  store.set(KEYS.mode, mode);
  applyMode();
  document.dispatchEvent(new CustomEvent("l2:modechange", { detail: { mode } }));
}

const modeSwitch = document.getElementById("modeSwitch");
if (modeSwitch) {
  modeSwitch.addEventListener("click", (e) => {
    const btn = e.target.closest(".mode-btn");
    if (btn) setMode(btn.dataset.mode);
  });
}

const signupCta = document.querySelector(".side-cta");
if (signupCta) signupCta.classList.add("hidden");

applyMode();

window.L2 = { user, getMode: () => activeMode, setMode };


/* ============================================================
   PART 2 — profile dropdown and real logged-in user
   ============================================================ */
(function () {
    const menu = document.getElementById("profileMenu");
    const avatar = document.getElementById("userAvatar");
    const dropdown = document.getElementById("profileDropdown");

    if (!menu || !avatar || !dropdown) return;

    function openMenu() {
        dropdown.classList.remove("hidden");
        avatar.setAttribute("aria-expanded", "true");
    }

    function closeMenu(returnFocus = false) {
        dropdown.classList.add("hidden");
        avatar.setAttribute("aria-expanded", "false");
        if (returnFocus) avatar.focus();
    }

    avatar.addEventListener("click", () => {
        if (dropdown.classList.contains("hidden")) {
            openMenu();
        } else {
            closeMenu();
        }
    });

    document.addEventListener("click", (event) => {
        if (!menu.contains(event.target)) closeMenu();
    });

    document.addEventListener("keydown", (event) => {
        if (event.key === "Escape" && !dropdown.classList.contains("hidden")) {
            closeMenu(true);
        }
    });

    function displayUser(account) {
        const name = account.name || "User";
        const roles = (account.roles || []).filter(role => Object.hasOwn(MODES, role));

        const initials = name
            .trim()
            .split(/\s+/)
            .filter(Boolean)
            .map(part => part[0])
            .join("")
            .slice(0, 2)
            .toUpperCase() || "U";

        // Don't overwrite if avatar contains an <img>
        if (!avatar.querySelector("img")) {
            avatar.textContent = initials.slice(0, 1);
        }

        const nameEl = document.getElementById("menuName");
        const emailEl = document.getElementById("menuEmail");
        const rolesEl = document.getElementById("menuRoles");

        if (nameEl) nameEl.textContent = name;
        if (emailEl) emailEl.textContent = account.email || "";

        if (rolesEl) {
            rolesEl.replaceChildren();
            const labels = { student: "Student", mentor: "Teacher", coach: "Gaming Coach" };
            roles.forEach(role => {
                const pill = document.createElement("span");
                pill.className = "pill " + (role === "coach" ? "g" : "a");
                pill.textContent = labels[role] || role;
                rolesEl.appendChild(pill);
            });
        }
    }

    async function loadLoggedInUser() {
        try {
            const response = await fetch("/api/me", {
                method: "GET",
                credentials: "same-origin",
                headers: { Accept: "application/json" }
            });

            if (response.status === 401) {
                store.remove(KEYS.user);
                window.location.href = "/auth";
                return;
            }

            const data = await response.json();
            if (!response.ok || !data.ok || !data.user) return;

            const account = data.user;
            user.name = account.name || "User";
            user.email = account.email || "";
            user.roles.splice(0, user.roles.length, ...(account.roles || []).filter(role => Object.hasOwn(MODES, role)));

            if (user.roles.length === 0) user.roles.push("student");

            store.set(KEYS.user, JSON.stringify(user));
            if (!user.roles.includes(activeMode)) activeMode = user.roles[0];

            store.set(KEYS.mode, activeMode);
            applyMode();
            displayUser(user);

        } catch (error) {
            console.error("Could not load logged-in user:", error);
        }
    }

    displayUser(user);
    loadLoggedInUser();

    // Log out through Flask
    const logout = document.getElementById("logoutBtn");
    if (logout) {
        logout.addEventListener("click", async (event) => {
            event.preventDefault();
            try {
                const tokenResponse = await fetch("/api/csrf-token", { credentials: "same-origin" });
                const tokenData = await tokenResponse.json();

                await fetch("/api/auth/logout", {
                    method: "POST",
                    credentials: "same-origin",
                    headers: {
                        Accept: "application/json",
                        "X-CSRFToken": tokenData.csrf_token || ""
                    }
                });

                store.remove(KEYS.user);
                store.remove(KEYS.mode);
                window.location.href = "/auth";
            } catch (error) {
                window.location.href = "/auth";
            }
        });
    }
})();


/* ============================================================
   PART 3 — database-driven tutor grid, filters & search
   ============================================================ */
(function () {
  const grid = document.getElementById("tutorGrid");
  const emptyState = document.getElementById("emptyState");
  const emptyMsg = document.getElementById("emptyStateMsg");
  const searchInput = document.getElementById("searchInput");

  if (!grid) return; // not on dashboard

  let TUTORS = []; // loaded from /api/tutors

  const AVATAR_GRADS = [
    ["#7c6cf5", "#f472b6"], ["#60a5fa", "#34d399"], ["#fbbf24", "#f472b6"],
    ["#22d3ee", "#6366f1"], ["#a78bfa", "#f472b6"], ["#34d399", "#60a5fa"]
  ];
  const NEON_SETS = [
    ["#f472b6", "#22d3ee"], ["#a78bfa", "#60a5fa"], ["#4ade80", "#22d3ee"],
    ["#f472b6", "#a78bfa"], ["#60a5fa", "#4ade80"], ["#fbbf24", "#f472b6"]
  ];
  const FORMULA_SETS = [
    [["∫ f(x) dx", 250, 42], ["a² + b² = c²", 34, 58], ["Δy / Δx", 272, 108], ["∑ n²", 56, 120]],
    [["H₂O", 60, 52], ["Na⁺ + Cl⁻", 218, 44], ["C₆H₁₂O₆", 46, 116], ["pH = 7", 262, 114]],
    [["thesis → intro", 36, 56], ["para. 2: evidence", 226, 44], ["draft no. 3", 52, 116], ["conclusion", 244, 114]]
  ];

  function academicSVG(variant) {
    const formulas = FORMULA_SETS[variant % FORMULA_SETS.length];
    const texts = formulas
      .map((t) => '<text x="' + t[1] + '" y="' + t[2] + '">' + t[0] + "</text>")
      .join("");
    return (
      '<svg viewBox="0 0 400 150" preserveAspectRatio="xMidYMid slice">' +
      '<rect width="400" height="150" fill="#0e1122"/>' +
      '<g stroke="#7c6cf5" fill="none" stroke-width="1" opacity="0.5">' +
      '<path d="M18 122 L118 26 L212 92 L158 142 Z"/>' +
      '<circle cx="118" cy="26" r="3" fill="#7c6cf5"/>' +
      '<circle cx="212" cy="92" r="3" fill="#7c6cf5"/>' +
      '<path d="M258 40 L346 22 L378 84 L300 108 Z"/>' +
      "</g>" +
      '<g fill="#ffffff" opacity="0.45" font-size="13">' + texts + "</g>" +
      "</svg>"
    );
  }

  function gamingSVG(variant) {
    const c = NEON_SETS[variant % NEON_SETS.length];
    const a = c[0], b = c[1];
    function screen(x, y, color) {
      return (
        '<rect x="' + x + '" y="' + y + '" width="72" height="42" rx="4" fill="' + color +
        '" fill-opacity="0.12" stroke="' + color + '" stroke-opacity="0.75"/>' +
        '<line x1="' + (x + 36) + '" y1="' + (y + 42) + '" x2="' + (x + 36) + '" y2="' + (y + 52) +
        '" stroke="' + color + '" stroke-opacity="0.5"/>'
      );
    }
    return (
      '<svg viewBox="0 0 400 150" preserveAspectRatio="xMidYMid slice">' +
      '<rect width="400" height="150" fill="#0c0e18"/>' +
      '<circle cx="330" cy="104" r="46" fill="' + b + '" fill-opacity="0.14"/>' +
      '<circle cx="52" cy="34" r="26" fill="' + a + '" fill-opacity="0.12"/>' +
      screen(36, 30, a) + screen(122, 30, b) + screen(208, 30, a) +
      screen(80, 88, b) + screen(166, 88, a) +
      "</svg>"
    );
  }

  function initialsOf(name) {
    return (name || "").split(/\s+/).filter(Boolean).map((w) => w.charAt(0)).join("").slice(0, 2).toUpperCase() || "U";
  }

  function starsSVG(rating) {
    const path = '<path d="M12 2l2.9 6.3 6.9.8-5.1 4.7 1.4 6.8L12 17.2 5.9 20.6l1.4-6.8L2.2 9.1l6.9-.8z"/>';
    let out = "";
    for (let i = 1; i <= 5; i++) {
      const filled = rating >= i - 0.5;
      out += '<svg class="star" viewBox="0 0 24 24"' + (filled ? "" : ' style="opacity:.25"') + ">" + path + "</svg>";
    }
    return out;
  }

  // ---------- Dynamic Sidebar Schedule Renderer ----------
function updateSidebarSchedule(upcomingSession, previousSession) {
    const emptyBox = document.getElementById("sideScheduleEmpty");
    const upcomingContainer = document.getElementById("sideUpcomingContainer");
    const previousContainer = document.getElementById("sidePreviousContainer");

    const hasUpcoming = Boolean(upcomingSession);
    const hasPrevious = Boolean(previousSession);

    // If no sessions, display empty state
    if (!hasUpcoming && !hasPrevious) {
        if (emptyBox) emptyBox.classList.remove("hidden");
        if (upcomingContainer) upcomingContainer.classList.add("hidden");
        if (previousContainer) previousContainer.classList.add("hidden");
        return;
    }

    if (emptyBox) emptyBox.classList.add("hidden");

    // Only render Upcoming if one actually exists
    if (upcomingContainer) {
        if (hasUpcoming) {
            upcomingContainer.classList.remove("hidden");
            upcomingContainer.innerHTML = `
                <div class="side-schedule-card">
                    <div class="side-sched-header">
                        <span class="sched-pill upcoming">NEXT UP</span>
                        <small class="sched-time-badge">${esc(upcomingSession.date_label)}</small>
                    </div>
                    <strong class="side-sched-title">${esc(upcomingSession.learner_name)}</strong>
                    <p class="side-sched-sub">${esc(upcomingSession.subject)}</p>
                    <div class="side-sched-meta">
                        <span>⏰ ${esc(upcomingSession.time)}</span>
                        <span>💰 ₱${esc(upcomingSession.price)}</span>
                    </div>
                    <a href="/sessions" class="side-sched-btn">View Session &rarr;</a>
                </div>
            `;
        } else {
            upcomingContainer.classList.add("hidden");
        }
    }

    // Only render Previous if one actually exists
    if (previousContainer) {
        if (hasPrevious) {
            previousContainer.classList.remove("hidden");
            previousContainer.innerHTML = `
                <div class="side-schedule-card">
                    <div class="side-sched-header">
                        <span class="sched-pill completed">PREVIOUS</span>
                        <small class="sched-time-badge">${esc(previousSession.date_label)}</small>
                    </div>
                    <strong class="side-sched-title">${esc(previousSession.learner_name)}</strong>
                    <p class="side-sched-sub">${esc(previousSession.subject)}</p>
                    <div class="side-sched-meta">
                        <span>✅ Completed Session</span>
                        <span>💰 +₱${esc(previousSession.earnings)} earned</span>
                    </div>
                </div>
            `;
        } else {
            previousContainer.classList.add("hidden");
        }
    }
}

// Initial state: No active sessions
updateSidebarSchedule(null, null);

  function cardHTML(t, i) {
    const grad = AVATAR_GRADS[i % AVATAR_GRADS.length];
    const isAcademic = t.category === "academic";
    const media = isAcademic ? academicSVG(i) : gamingSVG(i);
    const badge = isAcademic
      ? '<span class="badge academic">Academic</span>'
      : '<span class="badge gaming">Gaming</span>';
    const rating = Number(t.rating || 5.0);
    const price = t.price || 300;

    const topicsText = (t.topics && t.topics.length) ? t.topics.join(" • ") : (isAcademic ? "Academic Tutoring" : "Gaming Coaching");
    const searchTokens = (t.name + " " + topicsText + " " + (t.bio || "")).toLowerCase();

    const avatarMarkup = t.profile_picture 
      ? '<img src="' + esc(t.profile_picture) + '" alt="' + esc(t.name) + '" class="avatar-img">'
      : esc(initialsOf(t.name));

    return (
      '<article class="tutor-card" data-search="' + esc(searchTokens) + '" tabindex="0" role="link" aria-label="View profile for ' + esc(t.name) + '">' +
        '<div class="card-media">' + media + badge +
          '<div class="card-avatar" style="background:linear-gradient(135deg,' + grad[0] + "," + grad[1] + '); overflow: hidden;">' +
            avatarMarkup +
          "</div>" +
        "</div>" +
        '<div class="card-body">' +
          '<div class="card-name">' + esc(t.name) + "</div>" +
          '<div class="card-subject">' + esc(topicsText) + "</div>" +
          '<div class="card-stars"><span class="stars">' + starsSVG(rating) +
            '</span><span class="rating">' + rating.toFixed(1) + "</span>" +
            '<span class="reviews">(' + esc(t.reviews || 0) + " reviews)</span></div>" +
          '<p class="card-desc">' + esc(t.bio) + "</p>" +
          '<div class="card-footer">' +
            '<span class="price-lg">₱' + esc(price) + "/hr</span>" +
            '<a href="/tutors/' + esc(t.id) + '" class="view-btn">View Profile &rarr;</a>' +
          "</div>" +
        "</div>" +
      "</article>"
    );
  }

  const state = { category: "all", query: "" };

  function render() {
    const list = TUTORS.filter((t) => {
      if (state.category !== "all" && t.category !== state.category && t.category !== "both") return false;
      
      const q = state.query.toLowerCase();
      if (!q) return true;

      const topicsStr = (t.topics || []).join(" ").toLowerCase();
      return t.name.toLowerCase().includes(q) || (t.bio || "").toLowerCase().includes(q) || topicsStr.includes(q);
    });

    if (list.length === 0) {
      grid.innerHTML = "";
      if (emptyState) {
        emptyState.classList.remove("hidden");
        if (emptyMsg) {
          emptyMsg.textContent = TUTORS.length === 0
            ? "No registered tutors or coaches yet. Once verified educators register in Naga City, they will appear here!"
            : "No tutors match your search — try a different subject or keyword.";
        }
      }
      return;
    }

    if (emptyState) emptyState.classList.add("hidden");

    grid.innerHTML = list.map((t, i) => cardHTML(t, i)).join("");
        grid.querySelectorAll(".tutor-card").forEach((card, index) => {
      card.style.setProperty("--result-delay", `${Math.min(index, 5) * 70}ms`);
      card.classList.add("search-result-enter");

      // Clicking anywhere on the card navigates to that tutor's profile
      card.addEventListener("click", (e) => {
        if (e.target.closest("a")) return;
        const link = card.querySelector(".view-btn");
        if (link && link.href) window.location.href = link.href;
      });
    });
  }

  function setCategory(cat) {
    state.category = cat;
    document.querySelectorAll(".side-item[data-cat]").forEach((b) => {
      b.classList.toggle("active", b.dataset.cat === cat);
    });

    grid.classList.remove("category-switching");
    void grid.offsetWidth;
    grid.classList.add("category-switching");
    render();
  }

  // Sidebar category filter clicks
  document.querySelectorAll(".side-item[data-cat]").forEach((btn) => {
    btn.addEventListener("click", () => setCategory(btn.dataset.cat));
  });

  // Live search from the main page search bar
  if (searchInput) {
    searchInput.addEventListener("input", () => {
      state.query = searchInput.value.trim();
      render();
    });
  }

  // Fetch from the real backend API
  async function loadTutorsFromBackend() {
    try {
      const res = await fetch("/api/tutors", {
        credentials: "same-origin",
        headers: { Accept: "application/json" }
      });
      if (!res.ok) throw new Error("Could not load educators.");

      const data = await res.json();
      TUTORS = data.tutors || [];
      render();
    } catch (e) {
      console.warn("Could not fetch tutors:", e.message);
      TUTORS = [];
      render();
    }
  }

  loadTutorsFromBackend();
})();