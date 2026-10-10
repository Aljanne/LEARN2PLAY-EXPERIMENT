"use strict";

(function () {
  var form = document.getElementById("form");
  if (!form) return; // not on the login page

  var mode = "login";
  var title      = document.getElementById("title");
  var subtitle   = document.getElementById("subtitle");
  var nameField  = document.getElementById("nameField");
  var btnLabel   = document.getElementById("btnLabel");
  var submit     = document.getElementById("submit");
  var note       = document.getElementById("note");
  var pwd        = document.getElementById("password");
  var email      = document.getElementById("email");
  var eyeBtn     = document.getElementById("eyeBtn");
  var eyeOpen    = document.getElementById("eyeOpen");
  var eyeClosed  = document.getElementById("eyeClosed");
  var forgot     = document.getElementById("forgot");
  var tabLogin   = document.getElementById("tabLogin");
  var tabSignup  = document.getElementById("tabSignup");

  function setMode(m) {
    mode = m;
    var login = m === "login";

    tabLogin.classList.toggle("active", login);
    tabSignup.classList.toggle("active", !login);
    tabLogin.setAttribute("aria-selected", login);
    tabSignup.setAttribute("aria-selected", !login);

    title.textContent    = login ? "Welcome back" : "Create your account";
    subtitle.textContent = login
      ? "Log in to pick up where you left off."
      : "Join 12k+ learners and start booking sessions.";

    nameField.classList.toggle("hidden", login);
    btnLabel.textContent = login ? "Log in" : "Create account";

    document.getElementById("switchLine").innerHTML = login
      ? 'New to Learn2Play? <a id="switchLink">Get started</a>'
      : 'Already have an account? <a id="switchLink">Log in</a>';
    document.getElementById("switchLink").addEventListener("click", function () {
      setMode(login ? "signup" : "login");
    });

    pwd.setAttribute("autocomplete", login ? "current-password" : "new-password");
    note.textContent = "";
  }

  tabLogin.addEventListener("click", function () { setMode("login"); });
  tabSignup.addEventListener("click", function () { setMode("signup"); });
  document.getElementById("switchLink").addEventListener("click", function () { setMode("signup"); });

  eyeBtn.addEventListener("click", function () {
    var show = pwd.type === "password";
    pwd.type = show ? "text" : "password";
    eyeOpen.classList.toggle("hidden-svg", show);
    eyeClosed.classList.toggle("hidden-svg", !show);
  });

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    note.style.color = "#f87171";

    if (!email.value || email.value.indexOf("@") < 0) {
      note.textContent = "Please enter a valid email address.";
      return;
    }
    if (pwd.value.length < 6) {
      note.textContent = "Password must be at least 6 characters.";
      return;
    }

    submit.disabled = true;
    btnLabel.innerHTML =
      '<span class="spinner"></span>' +
      (mode === "login" ? "Signing in…" : "Creating account…");
    note.textContent = "";

    /* DEMO ONLY — replace this timeout with a real auth request, e.g.:
       fetch("/api/auth/login", {
         method: "POST",
         headers: { "Content-Type": "application/json" },
         body: JSON.stringify({ email: email.value, password: pwd.value })
       }) */
    setTimeout(function () {
      btnLabel.innerHTML =
        '<svg class="check" viewBox="0 0 24 24"><path d="M4.5 12.5l5 5 10-11"/></svg>' +
        (mode === "login" ? "Welcome back!" : "Account created!");
      note.style.color = "#4ade80";
      note.textContent = "Redirecting to your dashboard…";

      setTimeout(function () {
        submit.disabled = false;
        btnLabel.textContent = mode === "login" ? "Log in" : "Create account";
        note.textContent = "";
        form.reset();
        window.location.href = "dashboard.html"; // send them into the app
      }, 1200);
    }, 1000);
  });

  forgot.addEventListener("click", function () {
    note.style.color = "#a99dff";
    note.textContent = "Password reset link sent — check your inbox (demo).";
  });
})();

/* ============================================================
   Dashboard page — tutor grid, filters, search
   Cards render from the TUTORS array below; when the backend is
   ready, replace it with fetch("/api/tutors") and keep render().
   ============================================================ */
(function () {
  var grid = document.getElementById("tutorGrid");
  if (!grid) return; // not on the dashboard page

  /* ---------- data (swap for API later) ---------- */
  var TUTORS = [
    {
      name: "Sophia Reyes", subject: "Mathematics & Calculus",
      rating: 4.9, reviews: 143, price: 35, category: "academic",
      tags: ["mathematics"], variant: 0,
      desc: "PhD candidate at MIT specializing in applied mathematics. I help students master calculus,…"
    },
    {
      name: "Marcus Chen", subject: "Valorant & FPS Strategy",
      rating: 4.8, reviews: 211, price: 40, category: "gaming",
      tags: ["valorant"], variant: 1,
      desc: "Former pro Valorant player (Radiant rank). I coach players from Silver to Immortal on positioning,…"
    },
    {
      name: "Amara Osei", subject: "Chemistry & Biology",
      rating: 4.7, reviews: 98, price: 30, category: "academic",
      tags: ["chemistry", "biology"], variant: 2,
      desc: "Pre-med student & STEM tutor with a passion for making science accessible. Specializing in…"
    },
    {
      name: "Kai Nakamura", subject: "League of Legends",
      rating: 4.9, reviews: 175, price: 45, category: "gaming",
      tags: ["league of legends"], variant: 3,
      desc: "Grandmaster LoL player with 6 years of competitive play. I help mid to high-…"
    },
    {
      name: "Elena Vasquez", subject: "English & Essay Writing",
      rating: 4.6, reviews: 67, price: 28, category: "academic",
      tags: ["english"], variant: 4,
      desc: "English Literature MA graduate with 4 years of tutoring experience. I specialize in college essay-…"
    },
    {
      name: "Darius Bell", subject: "Apex Legends & Battle Royale",
      rating: 4.7, reviews: 132, price: 38, category: "gaming",
      tags: ["apex legends"], variant: 5,
      desc: "Masters-rank Apex Legends player with 5000+ hours. I coach on movement, rotation, loot routin…"
    }
  ];

  var AVATAR_GRADS = [
    ["#f472b6", "#a855f7"], ["#60a5fa", "#34d399"], ["#fbbf24", "#f472b6"],
    ["#22d3ee", "#6366f1"], ["#a78bfa", "#f472b6"], ["#34d399", "#60a5fa"]
  ];
  var NEON_SETS = [
    ["#f472b6", "#22d3ee"], ["#a78bfa", "#60a5fa"], ["#4ade80", "#22d3ee"],
    ["#f472b6", "#a78bfa"], ["#60a5fa", "#4ade80"], ["#fbbf24", "#f472b6"]
  ];
  var FORMULA_SETS = [
    [["∫ f(x) dx", 250, 42], ["a² + b² = c²", 34, 58], ["Δy / Δx", 272, 108], ["∑ n²", 56, 120]],
    [["H₂O", 60, 52], ["Na⁺ + Cl⁻", 218, 44], ["C₆H₁₂O₆", 46, 116], ["pH = 7", 262, 114]],
    [["thesis → intro", 36, 56], ["para. 2: evidence", 226, 44], ["draft no. 3", 52, 116], ["conclusion", 244, 114]]
  ];

  /* ---------- decorative card artwork (offline SVG) ---------- */
  function academicSVG(variant) {
    var f = FORMULA_SETS[variant % FORMULA_SETS.length];
    var texts = f.map(function (t) {
      return '<text x="' + t[1] + '" y="' + t[2] + '">' + t[0] + "</text>";
    }).join("");
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
    var c = NEON_SETS[variant % NEON_SETS.length];
    var a = c[0], b = c[1];
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

  /* ---------- card template ---------- */
  function initials(name) {
    return name.split(" ").map(function (w) { return w.charAt(0); }).join("");
  }

  function starsSVG() {
    var star = '<svg class="star" viewBox="0 0 24 24"><path d="M12 2l2.9 6.3 6.9.8-5.1 4.7 1.4 6.8L12 17.2 5.9 20.6l1.4-6.8L2.2 9.1l6.9-.8z"/></svg>';
    return star + star + star + star + star;
  }

  function cardHTML(t, i) {
    var grad = AVATAR_GRADS[i % AVATAR_GRADS.length];
    var media = t.category === "academic" ? academicSVG(t.variant) : gamingSVG(t.variant);
    var badge = t.category === "academic"
      ? '<span class="badge academic">Academic</span>'
      : '<span class="badge gaming">Gaming</span>';
    return (
      '<article class="tutor-card">' +
        '<div class="card-media">' + media + badge +
          '<div class="card-avatar" style="background:linear-gradient(135deg,' + grad[0] + "," + grad[1] + ')">' +
            initials(t.name) +
          "</div>" +
        "</div>" +
        '<div class="card-body">' +
          '<div class="card-name">' + t.name + "</div>" +
          '<div class="card-subject">' + t.subject + "</div>" +
          '<div class="card-stars"><span class="stars">' + starsSVG() +
            '</span><span class="rating">' + t.rating.toFixed(1) + "</span>" +
            '<span class="reviews">(' + t.reviews + " reviews)</span></div>" +
          '<p class="card-desc">' + t.desc + "</p>" +
          '<div class="card-footer">' +
            '<span class="price-lg">$' + t.price + "/hr</span>" +
            '<button class="view-btn" data-tutor="' + t.name + '">View Profile &rarr;</button>' +
          "</div>" +
        "</div>" +
      "</article>"
    );
  }

  /* ---------- filtering state ---------- */
  var state = { category: "all", subject: null, query: "" };
  var emptyState = document.getElementById("emptyState");
  var searchInput = document.getElementById("searchInput");

  function render() {
    var q = state.query.toLowerCase();
    var list = TUTORS.filter(function (t) {
      if (state.category !== "all" && t.category !== state.category) return false;
      if (state.subject && t.tags.indexOf(state.subject) < 0) return false;
      if (q && (t.name + " " + t.subject + " " + t.desc).toLowerCase().indexOf(q) < 0) return false;
      return true;
    });
    grid.innerHTML = list.map(cardHTML).join("");
    emptyState.classList.toggle("hidden", list.length > 0);
  }

  /* sidebar: category + subject buttons */
  document.querySelectorAll(".side-item").forEach(function (btn) {
    btn.addEventListener("click", function () {
      if (btn.dataset.cat) {
        state.category = btn.dataset.cat;
        document.querySelectorAll(".side-item[data-cat]").forEach(function (b) {
          b.classList.toggle("active", b === btn);
        });
      } else if (btn.dataset.subject) {
        var s = btn.dataset.subject;
        state.subject = state.subject === s ? null : s; // click again to clear
        document.querySelectorAll(".side-item[data-subject]").forEach(function (b) {
          b.classList.toggle("active", b.dataset.subject === state.subject);
        });
      }
      render();
    });
  });

  /* navbar links double as quick filters */
  document.querySelectorAll(".tb-nav a[data-nav]").forEach(function (a) {
    a.addEventListener("click", function (e) {
      e.preventDefault();
      var cat = a.dataset.nav;
      state.category = cat;
      document.querySelectorAll(".side-item[data-cat]").forEach(function (b) {
        b.classList.toggle("active", b.dataset.cat === cat);
      });
      render();
    });
  });

  /* live search */
  searchInput.addEventListener("input", function () {
    state.query = searchInput.value.trim();
    render();
  });

  /* View Profile — wired for routing later (e.g. /tutor.html?id=...) */
  grid.addEventListener("click", function (e) {
    var btn = e.target.closest(".view-btn");
    if (btn) {
      // TODO(backend): navigate to the tutor's profile page
      console.log("Open profile:", btn.dataset.tutor);
    }
  });

  render();
})();