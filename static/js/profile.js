"use strict";

let cachedUser = null;
let cropperInstance = null;

// ---------- 1. Unified User Data Loader ----------
async function loadUserData() {
    const nameEl = document.getElementById("profileName");
    const rolesEl = document.getElementById("profileRoles");
    const heroAvatarEl = document.getElementById("profileAvatar");
    const navAvatarEl = document.getElementById("userAvatar");
    const emailEl = document.getElementById("profileEmail");
    const bioEl = document.getElementById("profileBio");
    const topicsListEl = document.getElementById("profileTopicsList");
    const menuName = document.getElementById("menuName");
    const menuEmail = document.getElementById("menuEmail");
    const menuRoles = document.getElementById("menuRoles");

    const statSessions = document.getElementById("statSessions");
    const statMentors = document.getElementById("statMentors");
    const statHours = document.getElementById("statHours");
    const statRating = document.getElementById("statRating");

    const teachingRateEl = document.getElementById("profileTeachingRate");
    const coachingRateEl = document.getElementById("profileCoachingRate");

    try {
        const response = await fetch("/api/me", {
            method: "GET",
            credentials: "same-origin",
            headers: { Accept: "application/json" }
        });

        if (response.status === 401) {
            window.location.href = "/auth";
            return;
        }

        const data = await response.json();
        if (!response.ok || !data.ok || !data.user) {
            throw new Error(data.message || "Could not load profile.");
        }

        const user = data.user;
        cachedUser = user;
        const name = user.name || "User";

        const initials = name
            .trim()
            .split(/\s+/)
            .filter(Boolean)
            .map(part => part[0])
            .join("")
            .slice(0, 2)
            .toUpperCase() || "U";

        // Text updates
        if (nameEl) nameEl.innerHTML = `${escapeHtml(name)} <span class="badge-verified">Verified User</span>`;
        if (emailEl) emailEl.textContent = user.email || "";
        if (bioEl) {
            bioEl.textContent = user.bio || "No introduction added yet. Click 'Edit Profile' to introduce yourself!";
        }
        if (menuName) menuName.textContent = name;
        if (menuEmail) menuEmail.textContent = user.email || "";

        // Rates display update
        if (teachingRateEl) {
            if (user.teaching_rate !== null && user.teaching_rate !== undefined) {
                teachingRateEl.textContent = `₱${Number(user.teaching_rate).toFixed(2)} / hr`;
            } else {
                teachingRateEl.innerHTML = `<em style="color: var(--txt3); font-weight: normal;">Not set</em>`;
            }
        }
        if (coachingRateEl) {
            if (user.coaching_rate !== null && user.coaching_rate !== undefined) {
                coachingRateEl.textContent = `₱${Number(user.coaching_rate).toFixed(2)} / hr`;
            } else {
                coachingRateEl.innerHTML = `<em style="color: var(--txt3); font-weight: normal;">Not set</em>`;
            }
        }

        // Avatars
        renderAvatar(heroAvatarEl, user.profile_picture, initials);
        renderAvatar(navAvatarEl, user.profile_picture, initials.slice(0, 1));

        // Stats
        if (statSessions) statSessions.textContent = user.stats?.sessions_count ?? 0;
        if (statMentors) statMentors.textContent = user.stats?.mentors_count ?? 0;
        if (statHours) statHours.textContent = user.stats?.hours_count ?? 0;
        if (statRating) {
            statRating.textContent = user.stats?.avg_rating && user.stats.avg_rating > 0 
                ? user.stats.avg_rating.toFixed(1) 
                : "—";
        }

        // Topics
        if (topicsListEl) {
            topicsListEl.replaceChildren();
            const topics = user.topics || [];
            if (topics.length > 0) {
                topics.forEach(t => {
                    const pill = document.createElement("span");
                    pill.className = "topic-pill user-topic";
                    pill.textContent = t;
                    topicsListEl.appendChild(pill);
                });
            } else {
                const empty = document.createElement("p");
                empty.className = "empty-hint";
                empty.textContent = "No topics or games added yet. Click 'Edit Profile' to add them!";
                topicsListEl.appendChild(empty);
            }
        }

        // Role Badges
        const roleLabels = { student: "Student Learner", mentor: "Academic Teacher", coach: "Gaming Coach" };
        if (rolesEl) {
            rolesEl.replaceChildren();
            (user.roles || []).forEach(role => {
                const pill = document.createElement("span");
                pill.className = "role-pill " + (role === "coach" ? "gaming" : "academic");
                pill.textContent = roleLabels[role] || (role.charAt(0).toUpperCase() + role.slice(1));
                rolesEl.appendChild(pill);
            });
        }

        if (menuRoles) {
            menuRoles.replaceChildren();
            (user.roles || []).forEach(role => {
                const pill = document.createElement("span");
                pill.className = "pill " + (role === "coach" ? "g" : "a");
                pill.textContent = roleLabels[role] || role;
                menuRoles.appendChild(pill);
            });
        }

        // Pre-fill edit form inputs
        const nameInput = document.getElementById("editName");
        const bioInput = document.getElementById("editBio");
        const topicsInput = document.getElementById("editTopics");
        const teachingRateInput = document.getElementById("editTeachingRate");
        const coachingRateInput = document.getElementById("editCoachingRate");

        if (nameInput) nameInput.value = user.name || "";
        if (bioInput) {
            bioInput.value = user.bio || "";
            updateBioCount();
        }
        if (topicsInput) topicsInput.value = (user.topics || []).join(", ");
        if (teachingRateInput) {
            teachingRateInput.value = (user.teaching_rate !== null && user.teaching_rate !== undefined) ? user.teaching_rate : "";
        }
        if (coachingRateInput) {
            coachingRateInput.value = (user.coaching_rate !== null && user.coaching_rate !== undefined) ? user.coaching_rate : "";
        }

    } catch (error) {
        console.error("Profile loading error:", error);
    }
}

function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
}

function renderAvatar(element, picture, initials) {
    if (!element) return;
    element.replaceChildren();

    if (picture) {
        const image = document.createElement("img");
        image.src = picture;
        image.alt = "Profile avatar";
        image.onerror = () => { element.textContent = initials; };
        element.appendChild(image);
    } else {
        element.textContent = initials;
    }
}

function updateBioCount() {
    const input = document.getElementById("editBio");
    const count = document.getElementById("bioCount");
    if (input && count) count.textContent = String(input.value.length);
}

// ---------- 2. Drag & Drop + Image Cropper System ----------
(function setupAvatarCropper() {
    const dropzone = document.getElementById("avatarDropzone");
    const fileInput = document.getElementById("avatarFileInput");
    const cropModal = document.getElementById("cropModal");
    const cropperImageSrc = document.getElementById("cropperImageSrc");
    const saveCropBtn = document.getElementById("saveCropBtn");
    const cancelCropBtn = document.getElementById("cancelCropBtn");
    const closeCropBtn = document.getElementById("closeCropBtn");

    if (!dropzone || !fileInput) return;

    dropzone.addEventListener("click", () => fileInput.click());

    ["dragenter", "dragover"].forEach(event => {
        dropzone.addEventListener(event, (e) => {
            e.preventDefault();
            dropzone.classList.add("dragover");
        });
    });

    ["dragleave", "drop"].forEach(event => {
        dropzone.addEventListener(event, (e) => {
            e.preventDefault();
            dropzone.classList.remove("dragover");
        });
    });

    dropzone.addEventListener("drop", (e) => {
        const files = e.dataTransfer.files;
        if (files.length > 0) handleSelectedImage(files[0]);
    });

    fileInput.addEventListener("change", (e) => {
        if (e.target.files && e.target.files[0]) {
            handleSelectedImage(e.target.files[0]);
        }
    });

    function handleSelectedImage(file) {
        if (!file.type.startsWith("image/")) {
            alert("Please select an image file (PNG, JPG, or WEBP).");
            return;
        }

        const reader = new FileReader();
        reader.onload = (e) => {
            cropperImageSrc.src = e.target.result;
            cropModal.classList.remove("hidden");

            if (cropperInstance) cropperInstance.destroy();

            cropperInstance = new Cropper(cropperImageSrc, {
                aspectRatio: 1,
                viewMode: 1,
                dragMode: 'move',
                autoCropArea: 0.9,
                responsive: true,
                guides: true
            });
        };
        reader.readAsDataURL(file);
    }

    document.getElementById("zoomInBtn")?.addEventListener("click", () => cropperInstance?.zoom(0.1));
    document.getElementById("zoomOutBtn")?.addEventListener("click", () => cropperInstance?.zoom(-0.1));
    document.getElementById("rotateLeftBtn")?.addEventListener("click", () => cropperInstance?.rotate(-90));

    function closeCropper() {
        cropModal.classList.add("hidden");
        if (cropperInstance) {
            cropperInstance.destroy();
            cropperInstance = null;
        }
        fileInput.value = "";
    }

    cancelCropBtn?.addEventListener("click", closeCropper);
    closeCropBtn?.addEventListener("click", closeCropper);

    saveCropBtn?.addEventListener("click", async () => {
        if (!cropperInstance) return;

        saveCropBtn.disabled = true;
        saveCropBtn.textContent = "Uploading…";

        const canvas = cropperInstance.getCroppedCanvas({
            width: 320,
            height: 320,
            imageSmoothingQuality: "high"
        });

        canvas.toBlob(async (blob) => {
            try {
                const csrfResp = await fetch("/api/csrf-token", { credentials: "same-origin" });
                const csrfData = await csrfResp.json();

                const formData = new FormData();
                formData.append("avatar", blob, "avatar.jpg");

                const response = await fetch("/api/profile/avatar", {
                    method: "POST",
                    credentials: "same-origin",
                    headers: {
                        "X-CSRFToken": csrfData.csrf_token
                    },
                    body: formData
                });

                const data = await response.json();
                if (!response.ok || !data.ok) throw new Error(data.message || "Failed to upload avatar.");

                const heroAvatar = document.getElementById("profileAvatar");
                const navAvatar = document.getElementById("userAvatar");
                if (heroAvatar) heroAvatar.innerHTML = `<img src="${data.profile_picture}" alt="Avatar">`;
                if (navAvatar) navAvatar.innerHTML = `<img src="${data.profile_picture}" alt="Avatar" class="avatar-img">`;

                closeCropper();
            } catch (err) {
                alert(err.message || "Could not upload cropped image.");
            } finally {
                saveCropBtn.disabled = false;
                saveCropBtn.textContent = "Apply & Save Photo";
            }
        }, "image/jpeg", 0.9);
    });
})();

// ---------- 3. Edit Profile Form (Functional for Teachers & Coaches) ----------
(function setupProfileEditor() {
    const form = document.getElementById("profileEditForm");
    const editBtn = document.getElementById("editProfileBtn");
    const cancelBtn = document.getElementById("cancelEditBtn");
    const closeBtn = document.getElementById("closeEditBtn");
    const message = document.getElementById("profileFormMessage");
    const bioInput = document.getElementById("editBio");
    const topicsInput = document.getElementById("editTopics");
    const teachingRateInput = document.getElementById("editTeachingRate");
    const coachingRateInput = document.getElementById("editCoachingRate");

    if (!form || !editBtn) return;

    editBtn.addEventListener("click", () => {
        form.classList.remove("hidden");
        form.scrollIntoView({ behavior: "smooth", block: "center" });
        document.getElementById("editName")?.focus();
        if (message) {
            message.textContent = "";
            message.style.color = "var(--lavender)";
        }
    });

    const closeForm = () => {
        form.classList.add("hidden");
        if (message) message.textContent = "";
        // Revert form fields to cached user data (Cancel behavior)
        if (cachedUser) {
            document.getElementById("editName").value = cachedUser.name || "";
            if (bioInput) bioInput.value = cachedUser.bio || "";
            if (topicsInput) topicsInput.value = (cachedUser.topics || []).join(", ");
            if (teachingRateInput) {
                teachingRateInput.value = (cachedUser.teaching_rate !== null && cachedUser.teaching_rate !== undefined) ? cachedUser.teaching_rate : "";
            }
            if (coachingRateInput) {
                coachingRateInput.value = (cachedUser.coaching_rate !== null && cachedUser.coaching_rate !== undefined) ? cachedUser.coaching_rate : "";
            }
            updateBioCount();
        }
    };

    cancelBtn?.addEventListener("click", closeForm);
    closeBtn?.addEventListener("click", closeForm);
    bioInput?.addEventListener("input", updateBioCount);

    form.addEventListener("submit", async (event) => {
        event.preventDefault();
        const saveBtn = document.getElementById("saveProfileBtn");
        const newName = document.getElementById("editName").value.trim();
        const newBio = bioInput ? bioInput.value.trim() : "";
        const newTopics = topicsInput ? topicsInput.value.trim() : "";

        if (!newName || newName.length < 2) {
            if (message) {
                message.style.color = "var(--danger)";
                message.textContent = "Display name must be at least 2 characters.";
            }
            return;
        }

        // Construct clean payload
        const payload = {
            name: newName,
            bio: newBio,
            topics: newTopics
        };

        // Attach rate values only when corresponding inputs are present
        if (teachingRateInput) {
            const raw = teachingRateInput.value.trim();
            payload.teaching_rate = raw === "" ? null : raw;
        }
        if (coachingRateInput) {
            const raw = coachingRateInput.value.trim();
            payload.coaching_rate = raw === "" ? null : raw;
        }

        saveBtn.disabled = true;
        saveBtn.textContent = "Saving…";
        if (message) {
            message.style.color = "var(--lavender)";
            message.textContent = "Saving your changes…";
        }

        try {
            const tokenResp = await fetch("/api/csrf-token", { credentials: "same-origin" });
            const tokenData = await tokenResp.json();

            const response = await fetch("/api/profile", {
                method: "POST",
                credentials: "same-origin",
                headers: {
                    "Content-Type": "application/json",
                    Accept: "application/json",
                    "X-CSRFToken": tokenData.csrf_token
                },
                body: JSON.stringify(payload)
            });

            const data = await response.json();
            if (!response.ok || !data.ok) {
                throw new Error(data.message || "Could not save profile.");
            }

            if (message) {
                message.style.color = "var(--green)";
                message.textContent = "Profile updated successfully!";
            }

            // Immediately update on-page data without page reload
            await loadUserData();

            setTimeout(() => {
                form.classList.add("hidden");
                if (message) message.textContent = "";
            }, 600);

        } catch (error) {
            if (message) {
                message.style.color = "var(--danger)";
                message.textContent = error.message || "Failed to save profile.";
            }
        } finally {
            saveBtn.disabled = false;
            saveBtn.textContent = "Save Changes";
        }
    });
})();

// ---------- 4. Dropdown & Logout ----------
(function setupDropdownAndLogout() {
    const menu = document.getElementById("profileMenu");
    const avatar = document.getElementById("userAvatar");
    const dropdown = document.getElementById("profileDropdown");
    const logoutBtn = document.getElementById("logoutBtn");

    if (!menu || !avatar || !dropdown) return;

    function closeMenu() {
        dropdown.classList.add("hidden");
        avatar.setAttribute("aria-expanded", "false");
    }

    avatar.addEventListener("click", (e) => {
        e.stopPropagation();
        const isOpen = !dropdown.classList.contains("hidden");
        dropdown.classList.toggle("hidden", isOpen);
        avatar.setAttribute("aria-expanded", String(!isOpen));
    });

    document.addEventListener("click", (e) => {
        if (!menu.contains(e.target)) closeMenu();
    });

    document.addEventListener("keydown", (e) => {
        if (e.key === "Escape") closeMenu();
    });

    if (logoutBtn) {
        logoutBtn.addEventListener("click", async (e) => {
            e.preventDefault();
            try {
                const tokenResp = await fetch("/api/csrf-token", { credentials: "same-origin" });
                const tokenData = await tokenResp.json();

                await fetch("/api/auth/logout", {
                    method: "POST",
                    credentials: "same-origin",
                    headers: {
                        "X-CSRFToken": tokenData.csrf_token || "",
                        Accept: "application/json"
                    }
                });
                window.location.href = "/auth";
            } catch (error) {
                window.location.href = "/auth";
            }
        });
    }
})();

loadUserData();