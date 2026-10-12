
"use strict";

// Learn2Play: Login and registration connected to Flask
(() => {
  const $ = (id) => document.getElementById(id);

  const el = {
    title: $("title"),
    subtitle: $("subtitle"),
    tabLogin: $("tabLogin"),
    tabSignup: $("tabSignup"),
    form: $("form"),
    nameField: $("nameField"),
    confirmField: $("confirmField"),
    rolesField: $("rolesField"),
    rememberRow: $("rememberRow"),
    name: $("name"),
    email: $("email"),
    password: $("password"),
    confirm: $("confirmPassword"),
    submit: $("submit"),
    btnLabel: $("btnLabel"),
    switchLine: $("switchLine"),
    note: $("note"),
    heroTitle: $("heroTitle"),
    heroText: $("heroText"),
    eyeBtn: $("eyeBtn"),
    eyeOpen: $("eyeOpen"),
    eyeClosed: $("eyeClosed"),
    forgot: $("forgot"),
  };

  const COPY = {
    login: {
      pageTitle: "Learn2Play — Log in",
      title: "Welcome back",
      subtitle: "Log in to pick up where you left off.",
      button: "Log in",
      switchHtml:
        'New to Learn2Play? <a href="#signup" id="switchLink">Get started</a>',
      heroTitle: "Every legend<br>needs a <em>coach</em>.",
      heroText:
        "Book top-rated academic tutors and pro gaming coaches for live 1-on-1 sessions.",
      passwordPlaceholder: "••••••••",
      passwordAutocomplete: "current-password",
    },
    signup: {
      pageTitle: "Learn2Play — Sign up",
      title: "Create your account",
      subtitle: "Join Learn2Play and start learning or mentoring.",
      button: "Create account",
      switchHtml:
        'Already have an account? <a href="#login" id="switchLink">Log in</a>',
      heroTitle: "Level up<br>with the <em>right people</em>.",
      heroText:
        "Learn new skills, share what you know, and find your next academic tutor or gaming coach.",
      passwordPlaceholder: "At least 6 characters",
      passwordAutocomplete: "new-password",
    },
  };

  let mode = "login";

  // ---------- API helpers ----------

  async function getCsrfToken() {
    const response = await fetch("/api/csrf-token", {
      method: "GET",
      credentials: "same-origin",
      headers: {
        Accept: "application/json",
      },
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok || !data.csrf_token) {
      throw new Error("Unable to start a secure request. Please reload the page.");
    }

    return data.csrf_token;
  }

  async function apiPost(url, payload) {
    const csrfToken = await getCsrfToken();

    const response = await fetch(url, {
      method: "POST",
      credentials: "same-origin",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "X-CSRFToken": csrfToken,
      },
      body: JSON.stringify(payload),
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok || !data.ok) {
      throw new Error(
        data.message || `Request failed (${response.status}). Please try again.`
      );
    }

    return data;
  }

  // ---------- Mode switching ----------

  function setMode(next, { updateHash = true } = {}) {
    mode = next;

    const copy = COPY[mode];
    const isSignup = mode === "signup";

    document.title = copy.pageTitle;
    el.title.textContent = copy.title;
    el.subtitle.textContent = copy.subtitle;
    el.btnLabel.textContent = copy.button;
    el.switchLine.innerHTML = copy.switchHtml;
    el.heroTitle.innerHTML = copy.heroTitle;
    el.heroText.textContent = copy.heroText;

    el.tabLogin.classList.toggle("active", !isSignup);
    el.tabSignup.classList.toggle("active", isSignup);

    el.tabLogin.setAttribute("aria-selected", String(!isSignup));
    el.tabSignup.setAttribute("aria-selected", String(isSignup));

    el.nameField.classList.toggle("hidden", !isSignup);
    el.confirmField.classList.toggle("hidden", !isSignup);
    el.rolesField.classList.toggle("hidden", !isSignup);
    el.rememberRow.classList.toggle("hidden", isSignup);

    el.password.placeholder = copy.passwordPlaceholder;
    el.password.autocomplete = copy.passwordAutocomplete;

    clearNote();
    el.form.reset();

    const remember = $("remember");
    if (remember) remember.checked = true;

    setPasswordVisible(false);

    if (updateHash) {
      history.replaceState(null, "", "#" + mode);
    }
  }

  // ---------- Password visibility ----------

  function setPasswordVisible(visible) {
    const type = visible ? "text" : "password";

    el.password.type = type;
    el.confirm.type = type;

    el.eyeOpen.classList.toggle("hidden-svg", visible);
    el.eyeClosed.classList.toggle("hidden-svg", !visible);

    el.eyeBtn.setAttribute(
      "aria-label",
      visible ? "Hide password" : "Show password"
    );
  }

  el.eyeBtn.addEventListener("click", () => {
    setPasswordVisible(el.password.type === "password");
  });

  // ---------- Messages ----------

  function showNote(message, type = "error") {
    el.note.textContent = message;
    el.note.style.color =
      type === "error" ? "var(--danger)" : "var(--green)";
  }

  function clearNote() {
    el.note.textContent = "";
  }

  // ---------- Roles ----------

  function getRoles() {
    return [
      ...el.form.querySelectorAll('input[name="roles"]:checked'),
    ].map((input) => input.value);
  }

  el.rolesField.addEventListener("change", clearNote);

  // ---------- Client-side validation ----------

  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  function validate() {
    const email = el.email.value.trim();
    const password = el.password.value;

    if (mode === "signup" && !el.name.value.trim()) {
      return "Please enter a display name.";
    }

    if (!EMAIL_RE.test(email)) {
      return "Please enter a valid email address.";
    }

    if (!password) {
      return "Please enter your password.";
    }

    if (mode === "signup") {
      if (el.name.value.trim().length < 2) {
        return "Your display name must contain at least 2 characters.";
      }

      if (el.name.value.trim().length > 80) {
        return "Your display name cannot exceed 80 characters.";
      }

      if (password.length < 6) {
        return "Password must be at least 6 characters.";
      }

      if (password !== el.confirm.value) {
        return "Passwords do not match.";
      }

      const roles = getRoles();
      const allowedRoles = ["student", "mentor", "coach"];

      if (
        roles.length === 0 ||
        roles.some((role) => !allowedRoles.includes(role))
      ) {
        return "Please choose at least one valid role.";
      }
    }

    return null;
  }

  // ---------- Loading state ----------

  function setLoading(loading, submittedMode = mode) {
    el.submit.disabled = loading;
    el.tabLogin.disabled = loading;
    el.tabSignup.disabled = loading;

    el.btnLabel.textContent = loading
      ? submittedMode === "signup"
        ? "Creating account…"
        : "Logging in…"
      : COPY[mode].button;
  }

  // ---------- Real Flask requests ----------

  async function login({ email, password, remember }) {
    return apiPost("/api/auth/login", {
      email,
      password,
      remember,
    });
  }

  async function register({ name, email, password, roles }) {
    return apiPost("/api/auth/register", {
      name,
      email,
      password,
      roles,
    });
  }

  // ---------- Form submission ----------

  el.form.addEventListener("submit", async (event) => {
    event.preventDefault();
    clearNote();

    const error = validate();

    if (error) {
      showNote(error);
      return;
    }

    const submittedMode = mode;
    setLoading(true, submittedMode);

    try {
      const email = el.email.value.trim();
      const password = el.password.value;

      let result;

      if (submittedMode === "signup") {
        result = await register({
          name: el.name.value.trim(),
          email,
          password,
          roles: getRoles(),
        });
      } else {
        const remember = $("remember")?.checked ?? false;

        result = await login({
          email,
          password,
          remember,
        });
      }

      // Store the user information returned by Flask for the dashboard.
      if (result.user) {
        try {
          localStorage.setItem("l2_user", JSON.stringify(result.user));
        } catch (error) {
          // The Flask session still works if localStorage is unavailable.
        }
      }

      showNote(
        submittedMode === "signup"
          ? "Account created successfully!"
          : "Logged in successfully!",
        "success"
      );

      // The Flask session has been created. Open the protected dashboard.
      window.location.assign("/dashboard");
    } catch (error) {
      showNote(
        error.message || "Something went wrong. Please try again."
      );
    } finally {
      setLoading(false, submittedMode);
    }
  });

  // ---------- Navigation between login and signup ----------

  el.tabLogin.addEventListener("click", () => setMode("login"));
  el.tabSignup.addEventListener("click", () => setMode("signup"));

  el.switchLine.addEventListener("click", (event) => {
    if (event.target.id === "switchLink") {
      event.preventDefault();
      setMode(mode === "login" ? "signup" : "login");
    }
  });

  el.forgot.addEventListener("click", (event) => {
    event.preventDefault();
    showNote("Password reset isn't available yet.");
  });

  window.addEventListener("hashchange", () => {
    const next = location.hash === "#signup" ? "signup" : "login";

    if (next !== mode) {
      setMode(next, { updateHash: false });
    }
  });

  // Start in the correct mode based on the URL hash.
  setMode(location.hash === "#signup" ? "signup" : "login", {
    updateHash: false,
  });
})();
