"use strict";

/* ============================================================
   Learn2Play — dashboard script

   Part 1  User, roles and modes   (every page with the topbar)
   Part 2  Profile dropdown        (every page with the topbar)
   Part 3  Tutor grid, filters, search (dashboard only)

   Login / sign up now lives in auth.js, not here.
   ============================================================ */

/* ---------- storage helpers (localStorage can throw, e.g. private mode) ---------- */
const store = {
  get(key)        { try { return localStorage.getItem(key); } catch (e) { return null; } },
  set(key, value) { try { localStorage.setItem(key, value); } catch (e) { /* ignore */ } },
  remove(key)     { try { localStorage.removeItem(key); } catch (e) { /* ignore */ } },
};

const KEYS = { user: "l2_user", mode: "l2_activeMode" };

function esc(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}


/* ============================================================
   PART 1 — user, roles and modes
   ============================================================ */

/* One mode per role. Add a role later by adding one entry here. */
const MODES = {
  student: { label: "Learning" },
  mentor:  { label: "Mentoring" },
  coach:   { label: "Coaching" },
};

function getUser() {
  // TODO(backend): replace with  const user = await (await fetch("/api/me")).json();
  // The server must also check roles on every request. This script only changes what is displayed.
  let user = null;
  try { user = JSON.parse(store.get(KEYS.user)); } catch (e) { /* ignore bad data */ }

  if (!user) {
    user = { name: "Juan Dela Cruz", email: "juan@example.com", roles: ["student", "coach"] };
  }

  // DEV ONLY: test role combinations with dashboard.html?roles=student,mentor
  // Remove this once the backend exists.
  const override = new URLSearchParams(location.search).get("roles");
  if (override) user.roles = override.split(",");

  // Keep only known roles; everyone is at least a student so the page is never empty.
  user.roles = (user.roles || []).filter((r) => MODES[r]);
  if (user.roles.length === 0) user.roles = ["student"];

  return user;
}

const user = getUser();
const availableModes = user.roles;                       // modes map 1:1 to roles

function pickInitialMode() {
  const saved = store.get(KEYS.mode);
  // A saved mode is only valid if the user still has that role.
  return availableModes.includes(saved) ? saved : availableModes[0];
}

let activeMode = pickInitialMode();

function applyMode() {
  // Show only elements whose data-show-for list includes the active mode.
  document.querySelectorAll("[data-show-for]").forEach((el) => {
    const modes = el.dataset.showFor.split(/\s+/);
    el.classList.toggle("hidden", !modes.includes(activeMode));
  });

  // Switcher: only visible with 2+ roles, only buttons for roles the user has.
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

// The "Get Started" card is for signed-out visitors, and this page assumes a signed-in user.
const signupCta = document.querySelector(".side-cta");
if (signupCta) signupCta.classList.add("hidden");

applyMode();

// Let page-specific scripts (sessions, settings, ...) read the same state.
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
        if (event.key === "Escape" &&
            !dropdown.classList.contains("hidden")) {
            closeMenu(true);
        }
    });

    function displayUser(account) {
        const name = account.name || "User";
        const roles = (account.roles || [])
            .filter(role => Object.hasOwn(MODES, role));

        const initials = name
            .trim()
            .split(/\s+/)
            .filter(Boolean)
            .map(part => part[0])
            .join("")
            .slice(0, 2)
            .toUpperCase();

        avatar.textContent = initials || "U";

        const nameEl = document.getElementById("menuName");
        const emailEl = document.getElementById("menuEmail");
        const rolesEl = document.getElementById("menuRoles");

        if (nameEl) nameEl.textContent = name;
        if (emailEl) emailEl.textContent = account.email || "";

        if (rolesEl) {
            rolesEl.replaceChildren();

            roles.forEach(role => {
                const pill = document.createElement("span");
                pill.className =
                    "pill " + (role === "coach" ? "g" : "a");
                pill.textContent = role;
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

            if (!response.ok || !data.ok || !data.user) {
                throw new Error(data.message || "Could not load your account.");
            }

            const account = data.user;

            // Update the existing shared user object.
            user.name = account.name || "User";
            user.email = account.email || "";
            user.roles.splice(
                0,
                user.roles.length,
                ...(account.roles || []).filter(
                    role => Object.hasOwn(MODES, role)
                )
            );

            if (user.roles.length === 0) {
                user.roles.push("student");
            }

            // Keep localStorage updated for other frontend code.
            store.set(KEYS.user, JSON.stringify(user));

            // Keep the selected mode valid for this account.
            if (!user.roles.includes(activeMode)) {
                activeMode = user.roles[0];
            }

            store.set(KEYS.mode, activeMode);
            applyMode();
            displayUser(user);

        } catch (error) {
            console.error("Could not load logged-in user:", error);
        }
    }

    // Show cached details first, then replace them with server data.
    displayUser(user);
    loadLoggedInUser();

    // Log out through Flask instead of just clearing localStorage.
    const logout = document.getElementById("logoutBtn");

    if (logout) {
        logout.addEventListener("click", async (event) => {
            event.preventDefault();

            try {
                const tokenResponse = await fetch("/api/csrf-token", {
                    credentials: "same-origin"
                });
                const tokenData = await tokenResponse.json();

                if (!tokenResponse.ok || !tokenData.csrf_token) {
                    throw new Error("Could not prepare logout.");
                }

                const response = await fetch("/api/auth/logout", {
                    method: "POST",
                    credentials: "same-origin",
                    headers: {
                        Accept: "application/json",
                        "X-CSRFToken": tokenData.csrf_token
                    }
                });

                if (!response.ok) {
                    throw new Error("Logout failed.");
                }

                store.remove(KEYS.user);
                store.remove(KEYS.mode);
                window.location.href = "/auth";

            } catch (error) {
                console.error("Logout error:", error);
                alert("Could not log out. Please try again.");
            }
        });
    }
})();



/* ============================================================
   PART 3 — tutor grid, filters, search (dashboard only)
   Cards render from the TUTORS array below. When the backend is
   ready, replace it with fetch("/api/tutors") and keep render().
   ============================================================ */
(function () {
  const grid = document.getElementById("tutorGrid");
  if (!grid) return; // not on the dashboard page

  /* ---------- data (swap for API later) ---------- */
  const TUTORS = [
    {
      slug: "sophia-reyes", name: "Sophia Reyes", subject: "Mathematics & Calculus",
      rating: 4.9, reviews: 143, price: 550, category: "academic", variant: 0,
      desc: "PhD candidate at MIT specializing in applied mathematics. I help students master calculus, linear algebra and exam strategy."
    },
    {
      slug: "marcus-chen", name: "Marcus Chen", subject: "Valorant & FPS Strategy",
      rating: 4.8, reviews: 211, price: 650, category: "gaming", variant: 1,
      desc: "Former pro Valorant player (Radiant rank). I coach players from Silver to Immortal on positioning, aim and team play."
    },
    {
      slug: "amara-osei", name: "Amara Osei", subject: "Chemistry & Biology",
      rating: 4.7, reviews: 98, price: 450, category: "academic", variant: 2,
      desc: "Pre-med student & STEM tutor with a passion for making science accessible. Specializing in organic chemistry and cell biology."
    },
    {
      slug: "kai-nakamura", name: "Kai Nakamura", subject: "League of Legends",
      rating: 4.9, reviews: 175, price: 750, category: "gaming", variant: 3,
      desc: "Grandmaster LoL player with 6 years of competitive play. I help mid to high-elo players climb with VOD reviews and macro coaching."
    },
    {
      slug: "elena-vasquez", name: "Elena Vasquez", subject: "English & Essay Writing",
      rating: 4.6, reviews: 67, price: 400, category: "academic", variant: 4,
      desc: "English Literature MA graduate with 4 years of tutoring experience. I specialize in college essay writing and critical reading."
    },
    {
      slug: "darius-bell", name: "Darius Bell", subject: "Apex Legends & Battle Royale",
      rating: 4.7, reviews: 132, price: 600, category: "gaming", variant: 5,
      desc: "Masters-rank Apex Legends player with 5000+ hours. I coach on movement, rotations, loot routes and endgame decisions."
    }
  ];

  const AVATAR_GRADS = [
    ["#f472b6", "#a855f7"], ["#60a5fa", "#34d399"], ["#fbbf24", "#f472b6"],
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

  /* ---------- decorative card artwork (offline SVG) ---------- */
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

  const editBtn = document.getElementById("editProfileBtn");

if(editBtn){
    editBtn.addEventListener("click", () => {
        alert("Edit Profile feature coming soon.");
    });
}

  /* ---------- card template ---------- */
  function initialsOf(name) {
    return name.split(/\s+/).filter(Boolean).map((w) => w.charAt(0)).join("").slice(0, 2).toUpperCase();
  }

  // Five stars; stars above the rating are dimmed so 4.6 doesn't look like a 5.
  function starsSVG(rating) {
    const path = '<path d="M12 2l2.9 6.3 6.9.8-5.1 4.7 1.4 6.8L12 17.2 5.9 20.6l1.4-6.8L2.2 9.1l6.9-.8z"/>';
    let out = "";
    for (let i = 1; i <= 5; i++) {
      const filled = rating >= i - 0.5;
      out += '<svg class="star" viewBox="0 0 24 24"' + (filled ? "" : ' style="opacity:.25"') + ">" + path + "</svg>";
    }
    return out;
  }

  function cardHTML(t, i) {
    const grad = AVATAR_GRADS[i % AVATAR_GRADS.length];
    const isAcademic = t.category === "academic";
    const media = isAcademic ? academicSVG(t.variant) : gamingSVG(t.variant);
    const badge = isAcademic
      ? '<span class="badge academic">Academic</span>'
      : '<span class="badge gaming">Gaming</span>';
    const rating = Number(t.rating);

    // Text fields go through esc() because they will come from the database later.
    return (
      '<article class="tutor-card" data-slug="' + esc(t.slug) + '" data-search="' + esc((t.name + " " + t.subject + " " + t.desc).toLowerCase()) + '" tabindex="0" role="link" aria-label="View profile for ' + esc(t.name) + '">' +
        '<div class="card-media">' + media + badge +
          '<div class="card-avatar" style="background:linear-gradient(135deg,' + grad[0] + "," + grad[1] + ')">' +
            esc(initialsOf(t.name)) +
          "</div>" +
        "</div>" +
        '<div class="card-body">' +
          '<div class="card-name">' + esc(t.name) + "</div>" +
          '<div class="card-subject">' + esc(t.subject) + "</div>" +
          '<div class="card-stars"><span class="stars">' + starsSVG(rating) +
            '</span><span class="rating">' + rating.toFixed(1) + "</span>" +
            '<span class="reviews">(' + esc(t.reviews) + " reviews)</span></div>" +
          '<p class="card-desc">' + esc(t.desc) + "</p>" +
          '<div class="card-footer">' +
            '<span class="price-lg">₱' + esc(t.price) + "/hr</span>" +
            '<button class="view-btn" type="button" data-slug="' + esc(t.slug) + '" data-tutor="' + esc(t.name) + '">View Profile &rarr;</button>' +
          "</div>" +
        "</div>" +
      "</article>"
    );
  }

  /* ---------- filtering state ---------- */
  const state = { category: "all", query: "" };
  const emptyState  = document.getElementById("emptyState");
  const searchInput = document.getElementById("searchInput");

  function applySearchFilter() {
    const q = state.query.toLowerCase();
    const cards = grid.querySelectorAll(".tutor-card");
    let visibleCount = 0;

    cards.forEach((card) => {
      const matches = !q || card.dataset.search.includes(q);
      card.hidden = false;
      card.setAttribute("aria-hidden", String(!matches));

      if (matches) {
        card.classList.remove("search-result-hidden");
        visibleCount += 1;
        return;
      }

      card.classList.add("search-result-hidden");
      window.setTimeout(() => {
        if (card.classList.contains("search-result-hidden")) card.hidden = true;
      }, 180);
    });

    if (emptyState) {
      const hasResults = visibleCount > 0;
      emptyState.classList.toggle("hidden", hasResults);
      if (!hasResults) {
        emptyState.classList.remove("search-empty-enter");
        requestAnimationFrame(() => emptyState.classList.add("search-empty-enter"));
      }
    }
  }

  function render() {
    const list = TUTORS.filter((t) => {
      if (state.category !== "all" && t.category !== state.category) return false;
      return true;
    });
    grid.innerHTML = list.map(cardHTML).join("");
    grid.querySelectorAll(".tutor-card").forEach((card, index) => {
      card.style.setProperty("--result-delay", `${Math.min(index, 5) * 70}ms`);
      card.classList.add("search-result-enter");
    });
    applySearchFilter();
  }

  function setCategory(cat) {
    state.category = cat;
    document.querySelectorAll(".side-item[data-cat]").forEach((b) => {
      b.classList.toggle("active", b.dataset.cat === cat);
      if (b.dataset.cat === cat) {
        b.classList.remove("filter-press");
        void b.offsetWidth;
        b.classList.add("filter-press");
        window.setTimeout(() => b.classList.remove("filter-press"), 300);
      }
    });

    grid.classList.remove("category-switching");
    void grid.offsetWidth;
    grid.classList.add("category-switching");
    render();
  }

  /* sidebar: category buttons */
  document.querySelectorAll(".side-item[data-cat]").forEach((btn) => {
    btn.addEventListener("click", () => setCategory(btn.dataset.cat));
  });

  /* navbar links double as quick filters */
  document.querySelectorAll(".tb-nav a[data-nav]").forEach((a) => {
    a.addEventListener("click", (e) => {
      e.preventDefault();
      setCategory(a.dataset.nav);
    });
  });

  /* live search */
  if (searchInput) {
    searchInput.addEventListener("input", () => {
      state.query = searchInput.value.trim();
      applySearchFilter();
    });
  }

  /* Open the dedicated mentor profile page from the whole card or button. */
  grid.addEventListener("click", (e) => {
    const card = e.target.closest(".tutor-card");
    if (card) {
      window.location.href = "/mentors/" + encodeURIComponent(card.dataset.slug);
    }
  });

  grid.addEventListener("keydown", (e) => {
    const card = e.target.closest(".tutor-card");
    if (card && (e.key === "Enter" || e.key === " ")) {
      e.preventDefault();
      window.location.href = "/mentors/" + encodeURIComponent(card.dataset.slug);
    }
  });

  render();
})();