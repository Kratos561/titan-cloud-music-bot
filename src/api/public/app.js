const healthGrid = document.getElementById("healthGrid");
const sessionsNode = document.getElementById("sessions");
const eventsNode = document.getElementById("events");
const settingsForm = document.getElementById("settingsForm");
const settingsResult = document.getElementById("settingsResult");
const adminTokenInput = document.getElementById("adminToken");

adminTokenInput.value = localStorage.getItem("dashboardAdminToken") ?? "";
adminTokenInput.addEventListener("change", () => {
  localStorage.setItem("dashboardAdminToken", adminTokenInput.value);
});

function renderHealth(health) {
  const entries = Object.entries(health)
    .map(
      ([key, value]) => `
        <div class="stat">
          <span>${key}</span>
          <strong>${String(value)}</strong>
        </div>
      `,
    )
    .join("");

  healthGrid.innerHTML = entries;
}

function renderSessions(sessions) {
  if (!sessions.length) {
    sessionsNode.innerHTML = `<p class="subtle">No hay sesiones activas.</p>`;
    return;
  }

  sessionsNode.innerHTML = sessions
    .map(
      (session) => `
        <article class="session">
          <h3>${session.guildId}</h3>
          <p><strong>Estado:</strong> ${session.state}</p>
          <p><strong>Pista actual:</strong> ${session.currentTrack?.name ?? "Sin pista"}</p>
          <p><strong>Cola:</strong> ${session.items?.length ?? 0} pistas</p>
          <p><strong>Volumen:</strong> ${session.volume}%</p>
        </article>
      `,
    )
    .join("");
}

function pushEvent(event) {
  const element = document.createElement("div");
  element.className = "event";
  element.innerHTML = `<strong>${event.type}</strong><span>${event.timestamp}</span><pre>${JSON.stringify(event.payload, null, 2)}</pre>`;
  eventsNode.prepend(element);

  while (eventsNode.children.length > 20) {
    eventsNode.removeChild(eventsNode.lastChild);
  }
}

async function loadHealth() {
  const response = await fetch("/api/system/health");
  const data = await response.json();
  renderHealth(data);
}

async function loadSessions() {
  const response = await fetch("/api/sessions");
  const data = await response.json();
  renderSessions(data.sessions ?? []);
}

settingsForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const guildId = document.getElementById("guildId").value.trim();

  if (!guildId) {
    return;
  }

  const payload = {};
  const defaultVolume = document.getElementById("defaultVolume").value.trim();
  const djRoleId = document.getElementById("djRoleId").value.trim();
  const commandChannelId = document.getElementById("commandChannelId").value.trim();

  if (defaultVolume) payload.defaultVolume = Number(defaultVolume);
  if (djRoleId) payload.djRoleId = djRoleId;
  if (commandChannelId) payload.commandChannelId = commandChannelId;

  const response = await fetch(`/api/guilds/${guildId}/settings`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      "x-admin-token": adminTokenInput.value,
    },
    body: JSON.stringify(payload),
  });

  const data = await response.json();
  settingsResult.textContent = JSON.stringify(data, null, 2);
});

const eventSource = new EventSource("/api/events");
eventSource.onmessage = (message) => {
  pushEvent(JSON.parse(message.data));
};

loadHealth();
loadSessions();
setInterval(loadHealth, 10000);
setInterval(loadSessions, 10000);
