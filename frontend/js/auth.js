// Learn2Play — combined login / sign up page
(() => {
  const $ = (id) => document.getElementById(id);

  const el = {
    title: $('title'), subtitle: $('subtitle'),
    tabLogin: $('tabLogin'), tabSignup: $('tabSignup'),
    form: $('form'),
    nameField: $('nameField'), confirmField: $('confirmField'), rolesField: $('rolesField'), rememberRow: $('rememberRow'),
    name: $('name'), email: $('email'), password: $('password'), confirm: $('confirmPassword'),
    submit: $('submit'), btnLabel: $('btnLabel'),
    switchLine: $('switchLine'), note: $('note'),
    heroTitle: $('heroTitle'), heroText: $('heroText'),
    eyeBtn: $('eyeBtn'), eyeOpen: $('eyeOpen'), eyeClosed: $('eyeClosed'),
    forgot: $('forgot'),
  };

  const COPY = {
    login: {
      pageTitle: 'Learn2Play — Log in',
      title: 'Welcome back',
      subtitle: 'Log in to pick up where you left off.',
      button: 'Log in',
      switchHtml: 'New to Learn2Play? <a href="#signup" id="switchLink">Get started</a>',
      heroTitle: 'Every legend<br>needs a <em>coach</em>.',
      heroText: 'Book top-rated academic tutors and pro gaming coaches for live 1-on-1 sessions.',
      passwordPlaceholder: '••••••••',
      passwordAutocomplete: 'current-password',
    },
    signup: {
      pageTitle: 'Learn2Play — Sign up',
      title: 'Create your account',
      subtitle: 'Join Learn2Play and start learning or mentoring.',
      button: 'Create account',
      switchHtml: 'Already have an account? <a href="#login" id="switchLink">Log in</a>',
      heroTitle: 'Level up<br>with the <em>right people</em>.',
      heroText: 'Learn new skills, share what you know, and find your next academic tutor or gaming coach.',
      passwordPlaceholder: 'At least 6 characters',
      passwordAutocomplete: 'new-password',
    },
  };

  let mode = 'login';

  function setMode(next, { updateHash = true } = {}) {
    mode = next;
    const c = COPY[mode];
    const isSignup = mode === 'signup';

    document.title = c.pageTitle;
    el.title.textContent = c.title;
    el.subtitle.textContent = c.subtitle;
    el.btnLabel.textContent = c.button;
    el.switchLine.innerHTML = c.switchHtml;
    el.heroTitle.innerHTML = c.heroTitle;
    el.heroText.textContent = c.heroText;

    el.tabLogin.classList.toggle('active', !isSignup);
    el.tabSignup.classList.toggle('active', isSignup);
    el.tabLogin.setAttribute('aria-selected', String(!isSignup));
    el.tabSignup.setAttribute('aria-selected', String(isSignup));

    el.nameField.classList.toggle('hidden', !isSignup);
    el.confirmField.classList.toggle('hidden', !isSignup);
    el.rolesField.classList.toggle('hidden', !isSignup);
    el.rememberRow.classList.toggle('hidden', isSignup);

    el.password.placeholder = c.passwordPlaceholder;
    el.password.autocomplete = c.passwordAutocomplete;

    clearNote();
    el.form.reset();
    el.remember && (el.remember.checked = true);
    setPasswordVisible(false);

    if (updateHash) history.replaceState(null, '', '#' + mode);
  }

  // ---------- password visibility ----------
  function setPasswordVisible(visible) {
    const type = visible ? 'text' : 'password';
    el.password.type = type;
    el.confirm.type = type;
    el.eyeOpen.classList.toggle('hidden-svg', visible);
    el.eyeClosed.classList.toggle('hidden-svg', !visible);
    el.eyeBtn.setAttribute('aria-label', visible ? 'Hide password' : 'Show password');
  }
  el.eyeBtn.addEventListener('click', () => setPasswordVisible(el.password.type === 'password'));

  // ---------- notes ----------
  function showNote(msg, type = 'error') {
    el.note.textContent = msg;
    el.note.style.color = type === 'error' ? 'var(--danger)' : 'var(--green)';
  }
  function clearNote() {
    el.note.textContent = '';
  }

  // ---------- roles ----------
  // Returns e.g. ['student', 'coach']
  function getRoles() {
    return [...el.form.querySelectorAll('input[name="roles"]:checked')].map((i) => i.value);
  }
  el.rolesField.addEventListener('change', clearNote);

  // ---------- validation ----------
  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  function validate() {
    const email = el.email.value.trim();
    const password = el.password.value;

    if (mode === 'signup') {
      if (!el.name.value.trim()) return 'Please enter a display name.';
    }
    if (!EMAIL_RE.test(email)) return 'Please enter a valid email address.';
    if (!password) return 'Please enter your password.';

    if (mode === 'signup') {
      if (password.length < 6) return 'Password must be at least 6 characters.';
      if (password !== el.confirm.value) return 'Passwords do not match.';
      if (getRoles().length === 0) return 'Please choose at least one role.';
    }
    return null;
  }

  // ---------- submit ----------
  function setLoading(loading) {
    el.submit.disabled = loading;
    el.btnLabel.textContent = loading
      ? (mode === 'signup' ? 'Creating account…' : 'Logging in…')
      : COPY[mode].button;
  }

  // TODO: replace these with real fetch() calls once the backend exists.
  async function login({ email, password, remember }) {
    await new Promise((r) => setTimeout(r, 700));
    return { ok: true };
  }
  async function register({ name, email, password, roles }) {
    await new Promise((r) => setTimeout(r, 700));
    return { ok: true };
  }

  el.form.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearNote();

    const error = validate();
    if (error) return showNote(error);

    setLoading(true);
    try {
      const email = el.email.value.trim();
      const password = el.password.value;
      const result = mode === 'signup'
        ? await register({ name: el.name.value.trim(), email, password, roles: getRoles() })
        : await login({ email, password, remember: $('remember').checked });

      if (!result.ok) throw new Error(result.message || 'Something went wrong.');
      showNote(mode === 'signup' ? 'Account created!' : 'Logged in!', 'success');
      // TODO: redirect, e.g. window.location.href = 'dashboard.html';
    } catch (err) {
      showNote(err.message || 'Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  });

  // ---------- navigation between modes ----------
  el.tabLogin.addEventListener('click', () => setMode('login'));
  el.tabSignup.addEventListener('click', () => setMode('signup'));

  // switch link is re-rendered on each mode change, so delegate
  el.switchLine.addEventListener('click', (e) => {
    if (e.target.id === 'switchLink') {
      e.preventDefault();
      setMode(mode === 'login' ? 'signup' : 'login');
    }
  });

  el.forgot.addEventListener('click', (e) => {
    e.preventDefault();
    showNote('Password reset isn\u2019t available yet.', 'error');
  });

  // Support direct links: auth.html#signup
  window.addEventListener('hashchange', () => {
    const next = location.hash === '#signup' ? 'signup' : 'login';
    if (next !== mode) setMode(next, { updateHash: false });
  });

  setMode(location.hash === '#signup' ? 'signup' : 'login', { updateHash: false });
})();