"use strict";

let currentSettingsAccount = null;

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
        if (!response.ok || !data.ok || !data.user) throw new Error("Could not load account details.");

        const user = data.user;
        currentSettingsAccount = user;
        const name = user.name || "User";
        document.getElementById("settingsName").textContent = name;
        document.getElementById("settingsEmail").textContent = user.email || "";
        document.getElementById("settingsAvatar").textContent = name.trim()
            .split(/\s+/).filter(Boolean).map(part => part[0]).join("").slice(0, 2).toUpperCase() || "U";

        const nameParts = name.trim().split(/\s+/).filter(Boolean);
        document.getElementById("settingsFirstName").value = nameParts[0] || "";
        document.getElementById("settingsLastName").value = nameParts.slice(1).join(" ");
        document.getElementById("settingsProfileEmail").value = user.email || "";

        const labels = { student: "Student", mentor: "Mentor", coach: "Gaming Coach" };
        const roles = document.getElementById("settingsRoles");
        (user.roles || []).forEach(role => {
            const pill = document.createElement("span");
            pill.className = "pill " + (role === "coach" ? "g" : "a");
            pill.textContent = labels[role] || role;
            roles.appendChild(pill);
        });
    } catch (error) {
        document.getElementById("settingsName").textContent = "Unable to load account";
        console.error("Settings account loading error:", error);
    }
})();

document.getElementById("profileInformationForm").addEventListener("submit", async event => {
    event.preventDefault();
    const message = document.getElementById("profileInformationMessage");
    const button = document.getElementById("profileInformationSave");
    const firstName = document.getElementById("settingsFirstName").value.trim();
    const lastName = document.getElementById("settingsLastName").value.trim();

    if (!firstName || firstName.length < 2) {
        message.textContent = "First name must contain at least 2 characters.";
        return;
    }

    button.disabled = true;
    message.textContent = "Saving profile…";
    try {
        const csrfResponse = await fetch("/api/csrf-token", { credentials: "same-origin" });
        const csrfData = await csrfResponse.json();
        if (!csrfResponse.ok || !csrfData.csrf_token) throw new Error("Could not prepare profile update.");

        const response = await fetch("/api/profile", {
            method: "POST",
            credentials: "same-origin",
            headers: {
                "Content-Type": "application/json",
                Accept: "application/json",
                "X-CSRFToken": csrfData.csrf_token
            },
            body: JSON.stringify({
                name: [firstName, lastName].filter(Boolean).join(" "),
                bio: currentSettingsAccount?.bio || "",
                profile_picture: currentSettingsAccount?.profile_picture || ""
            })
        });
        const data = await response.json();
        if (!response.ok || !data.ok) throw new Error(data.message || "Could not save profile.");

        currentSettingsAccount = { ...currentSettingsAccount, ...data.user };
        document.getElementById("settingsName").textContent = data.user.name;
        message.textContent = "Profile saved successfully.";
    } catch (error) {
        message.textContent = error.message || "Could not save your profile. Please try again.";
    } finally {
        button.disabled = false;
    }
});

document.getElementById("passwordForm").addEventListener("submit", async event => {
    event.preventDefault();
    const message = document.getElementById("passwordMessage");
    const button = document.getElementById("passwordSave");
    const currentPassword = document.getElementById("currentPassword").value;
    const newPassword = document.getElementById("newPassword").value;
    const confirmPassword = document.getElementById("confirmPassword").value;

    if (newPassword !== confirmPassword) {
        message.textContent = "The new passwords do not match.";
        return;
    }

    button.disabled = true;
    message.textContent = "Updating password…";
    try {
        const csrfResponse = await fetch("/api/csrf-token", { credentials: "same-origin" });
        const csrfData = await csrfResponse.json();
        if (!csrfResponse.ok || !csrfData.csrf_token) throw new Error("Could not prepare password update.");

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

        message.textContent = data.message;
        event.currentTarget.reset();
    } catch (error) {
        message.textContent = error.message || "Could not update password. Please try again.";
    } finally {
        button.disabled = false;
    }
});

// Keep the preference controls usable until notification preferences are
// connected to the account API. The values persist for this browser only.
(function setupPreferences() {
    const storageKey = "l2_account_preferences";
    const defaults = {
        emailNotifications: true,
        bookingReminders: true,
        marketingOffers: false,
        twoFactor: false
    };
    let saved = {};

    try {
        saved = JSON.parse(localStorage.getItem(storageKey) || "{}");
    } catch (error) {
        saved = {};
    }

    document.querySelectorAll(".settings-toggle-input").forEach(input => {
        const preference = input.dataset.preference;
        input.checked = typeof saved[preference] === "boolean"
            ? saved[preference]
            : defaults[preference];

        input.addEventListener("change", () => {
            saved[preference] = input.checked;
            try {
                localStorage.setItem(storageKey, JSON.stringify(saved));
            } catch (error) {
                // Preferences still work for the current page if storage is unavailable.
            }
        });
    });
})();
