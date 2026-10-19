"use strict";

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
        const name = user.name || "User";
        document.getElementById("settingsName").textContent = name;
        document.getElementById("settingsEmail").textContent = user.email || "";
        document.getElementById("settingsAvatar").textContent = name.trim()
            .split(/\s+/).filter(Boolean).map(part => part[0]).join("").slice(0, 2).toUpperCase() || "U";

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
