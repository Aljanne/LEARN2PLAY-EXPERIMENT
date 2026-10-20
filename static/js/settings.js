"use strict";

let currentSettingsAccount = null;

// ---------- Helper: Show Toast Notification ----------
function showSettingsToast(message, isError = false) {
    const toast = document.getElementById("settingsToast");
    if (!toast) return;
    toast.textContent = message;
    toast.style.borderColor = isError ? "var(--danger)" : "var(--purple)";
    toast.classList.add("show");
    setTimeout(() => {
        toast.classList.remove("show");
    }, 3500);
}

// ---------- 1. Tab Switching System ----------
(function initSettingsTabs() {
    const tabButtons = document.querySelectorAll(".settings-tab-btn");
    const tabPanels = document.querySelectorAll(".settings-tab-panel");

    function activateTab(tabId) {
        tabButtons.forEach(btn => {
            const isActive = btn.dataset.tab === tabId;
            btn.classList.toggle("active", isActive);
            btn.setAttribute("aria-selected", isActive ? "true" : "false");
        });

        tabPanels.forEach(panel => {
            const isTarget = panel.id === `tab-${tabId}`;
            panel.classList.toggle("active", isTarget);
        });

        // Update URL hash without forcing a jump
        if (history.replaceState) {
            history.replaceState(null, "", `#${tabId}`);
        }
    }

    tabButtons.forEach(button => {
        button.addEventListener("click", () => {
            activateTab(button.dataset.tab);
        });
    });

    // Check URL hash on page load (e.g. settings.html#security)
    const initialHash = window.location.hash.replace("#", "");
    if (initialHash && document.getElementById(`tab-${initialHash}`)) {
        activateTab(initialHash);
    }
})();

// ---------- 2. Load Account Details (/api/me) ----------
(async function loadAccountSettings() {
    try {
        const response = await fetch("/api/me", {
            credentials: "same-origin",
            headers: { Accept: "application/json" }
        });
        if (response.status === 401) {
            window.location.href = "/auth";
            return;
        }
        const data = await response.json();
        if (!response.ok || !data.ok || !data.user) {
            throw new Error("Could not load account details.");
        }

        const user = data.user;
        currentSettingsAccount = user;
        const name = user.name || "User";

        // Update profile card text & initials
        const nameEl = document.getElementById("settingsName");
        const emailEl = document.getElementById("settingsEmail");
        const avatarEl = document.getElementById("settingsAvatar");
        const topbarAvatarEl = document.getElementById("topbarAvatar");

        if (nameEl) nameEl.textContent = name;
        if (emailEl) emailEl.textContent = user.email || "";

        const initials = name.trim().split(/\s+/).filter(Boolean).map(part => part[0]).join("").slice(0, 2).toUpperCase() || "U";
        if (avatarEl) avatarEl.textContent = initials;
        if (topbarAvatarEl) topbarAvatarEl.textContent = initials.slice(0, 1);

        // Pre-fill form inputs
        const nameParts = name.trim().split(/\s+/).filter(Boolean);
        const firstNameInput = document.getElementById("settingsFirstName");
        const lastNameInput = document.getElementById("settingsLastName");
        const emailInput = document.getElementById("settingsProfileEmail");

        if (firstNameInput) firstNameInput.value = nameParts[0] || "";
        if (lastNameInput) lastNameInput.value = nameParts.slice(1).join(" ");
        if (emailInput) emailInput.value = user.email || "";

        // Populate Roles cleanly (avoids duplication)
        const rolesContainer = document.getElementById("settingsRoles");
        if (rolesContainer) {
            rolesContainer.innerHTML = "";
            const labels = { student: "Student", mentor: "Teacher", coach: "Gaming Coach" };
            (user.roles || []).forEach(role => {
                const pill = document.createElement("span");
                pill.className = "pill " + (role === "coach" ? "g" : "a");
                pill.textContent = labels[role] || role.charAt(0).toUpperCase() + role.slice(1);
                rolesContainer.appendChild(pill);
            });
        }
    } catch (error) {
        console.warn("Notice: /api/me endpoint response:", error.message);
    }
})();

// ---------- 3. Save Personal Information (/api/profile) ----------
const profileForm = document.getElementById("profileInformationForm");
if (profileForm) {
    profileForm.addEventListener("submit", async event => {
        event.preventDefault();
        const message = document.getElementById("profileInformationMessage");
        const button = document.getElementById("profileInformationSave");
        const firstName = document.getElementById("settingsFirstName").value.trim();
        const lastName = document.getElementById("settingsLastName").value.trim();

        if (!firstName || firstName.length < 2) {
            if (message) message.textContent = "First name must contain at least 2 characters.";
            return;
        }

        button.disabled = true;
        const originalText = button.textContent;
        button.textContent = "Saving…";
        if (message) message.textContent = "";

        try {
            const csrfResponse = await fetch("/api/csrf-token", { credentials: "same-origin" });
            const csrfData = await csrfResponse.json();
            if (!csrfResponse.ok || !csrfData.csrf_token) {
                throw new Error("Could not prepare profile update session.");
            }

            const fullName = [firstName, lastName].filter(Boolean).join(" ");
            const response = await fetch("/api/profile", {
                method: "POST",
                credentials: "same-origin",
                headers: {
                    "Content-Type": "application/json",
                    Accept: "application/json",
                    "X-CSRFToken": csrfData.csrf_token
                },
                body: JSON.stringify({
                    name: fullName,
                    bio: currentSettingsAccount?.bio || "",
                    profile_picture: currentSettingsAccount?.profile_picture || ""
                })
            });

            const data = await response.json();
            if (!response.ok || !data.ok) throw new Error(data.message || "Could not save profile.");

            currentSettingsAccount = { ...currentSettingsAccount, ...data.user };
            document.getElementById("settingsName").textContent = fullName;
            showSettingsToast("Profile information updated successfully.");
            if (message) message.textContent = "Changes saved!";
        } catch (error) {
            if (message) message.textContent = error.message || "Failed to update profile.";
            showSettingsToast(error.message || "Failed to update profile", true);
        } finally {
            button.disabled = false;
            button.textContent = originalText;
        }
    });
}

// ---------- 4. Password Strength & Rule Checklist ----------
const newPasswordInput = document.getElementById("newPassword");
if (newPasswordInput) {
    newPasswordInput.addEventListener("input", () => {
        const val = newPasswordInput.value;
        const meter = document.getElementById("passwordStrengthMeter");

        const hasLength = val.length >= 8;
        const hasUpper = /[A-Z]/.test(val);
        const hasLower = /[a-z]/.test(val);
        const hasNumber = /[0-9!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(val);

        document.getElementById("rule-length")?.classList.toggle("valid", hasLength);
        document.getElementById("rule-upper")?.classList.toggle("valid", hasUpper);
        document.getElementById("rule-lower")?.classList.toggle("valid", hasLower);
        document.getElementById("rule-number")?.classList.toggle("valid", hasNumber);

        let score = 0;
        if (hasLength) score++;
        if (hasUpper) score++;
        if (hasLower) score++;
        if (hasNumber) score++;

        if (meter) {
            meter.dataset.level = val.length === 0 ? "0" : score.toString();
        }
    });
}

// ---------- 5. Password Show/Hide Toggle Button ----------
document.querySelectorAll(".password-toggle-btn").forEach(btn => {
    btn.addEventListener("click", () => {
        const input = btn.closest(".input-wrap")?.querySelector("input");
        if (!input) return;
        const isPassword = input.type === "password";
        input.type = isPassword ? "text" : "password";
        btn.classList.toggle("active", isPassword);
    });
});

// ---------- 6. Update Password (/api/account/password) ----------
const passwordForm = document.getElementById("passwordForm");
if (passwordForm) {
    passwordForm.addEventListener("submit", async event => {
        event.preventDefault();
        const message = document.getElementById("passwordMessage");
        const button = document.getElementById("passwordSave");
        const currentPassword = document.getElementById("currentPassword").value;
        const newPassword = document.getElementById("newPassword").value;
        const confirmPassword = document.getElementById("confirmPassword").value;

        if (newPassword.length < 8) {
            if (message) message.textContent = "New password must be at least 8 characters.";
            return;
        }
        if (newPassword !== confirmPassword) {
            if (message) message.textContent = "The new passwords do not match.";
            return;
        }

        button.disabled = true;
        const originalText = button.textContent;
        button.textContent = "Updating…";
        if (message) message.textContent = "";

        try {
            const csrfResponse = await fetch("/api/csrf-token", { credentials: "same-origin" });
            const csrfData = await csrfResponse.json();
            if (!csrfResponse.ok || !csrfData.csrf_token) {
                throw new Error("Could not prepare password update.");
            }

            const response = await fetch("/api/account/password", {
                method: "POST",
                credentials: "same-origin",
                headers: {
                    "Content-Type": "application/json",
                    Accept: "application/json",
                    "X-CSRFToken": csrfData.csrf_token
                },
                body: JSON.stringify({ current_password: currentPassword, new_password: newPassword })
            });

            const data = await response.json();
            if (!response.ok || !data.ok) throw new Error(data.message || "Could not update password.");

            showSettingsToast("Password changed successfully!");
            if (message) message.textContent = data.message || "Password updated.";
            passwordForm.reset();
            const meter = document.getElementById("passwordStrengthMeter");
            if (meter) meter.dataset.level = "0";
            document.querySelectorAll(".rules-list li").forEach(li => li.classList.remove("valid"));
        } catch (error) {
            if (message) message.textContent = error.message || "Could not update password. Please verify current password.";
            showSettingsToast(error.message || "Password update failed.", true);
        } finally {
            button.disabled = false;
            button.textContent = originalText;
        }
    });
}

// ---------- 7. Preferences Storage Sync ----------
(function setupPreferences() {
    const storageKey = "l2_account_preferences";
    const defaults = {
        emailNotifications: true,
        bookingReminders: true,
        marketingOffers: false,
        soundEffects: true,
        twoFactor: false
    };

    let saved = {};
    try {
        saved = JSON.parse(localStorage.getItem(storageKey) || "{}");
    } catch (e) {
        saved = {};
    }

    document.querySelectorAll(".settings-toggle-input").forEach(input => {
        const preference = input.dataset.preference;
        if (!preference) return;

        input.checked = typeof saved[preference] === "boolean"
            ? saved[preference]
            : (defaults[preference] ?? false);

        input.addEventListener("change", () => {
            saved[preference] = input.checked;
            try {
                localStorage.setItem(storageKey, JSON.stringify(saved));
                showSettingsToast(`Preference updated.`);
            } catch (err) {
                console.error("Local storage error:", err);
            }
        });
    });
})();

// ---------- 8. Export & Danger Zone Handlers ----------
document.getElementById("exportDataBtn")?.addEventListener("click", () => {
    showSettingsToast("Preparing your archive... download will begin shortly.");
});

document.getElementById("deactivateBtn")?.addEventListener("click", () => {
    if (confirm("Are you sure you want to deactivate your Learn2Play account? You can reactivate by signing back in.")) {
        showSettingsToast("Deactivation request submitted.");
    }
});

document.getElementById("deleteAccountBtn")?.addEventListener("click", () => {
    const input = prompt("Type 'DELETE' to confirm permanent deletion of your account and all associated data:");
    if (input === "DELETE") {
        showSettingsToast("Account deletion in progress...", true);
    }
});