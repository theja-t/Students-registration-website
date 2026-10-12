"use strict";

const form = document.querySelector("#registration-form");
const submitButton = form.querySelector('button[type="submit"]');
const formMessage = document.querySelector("#form-message");
const recordsBody = document.querySelector("#records-body");
const recordsEmpty = document.querySelector("#records-empty");
const tableWrap = document.querySelector("#table-wrap");
const recordCount = document.querySelector("#record-count");
const downloadButton = document.querySelector("#download-csv");
const clearButton = document.querySelector("#clear-records");

function showMessage(message, isError = false) {
  formMessage.textContent = message;
  if (isError) {
    formMessage.dataset.error = "true";
  } else {
    delete formMessage.dataset.error;
  }
}

async function requestRegistrations(method = "GET", registration) {
  const response = await fetch("/api/registrations", {
    method,
    headers: registration ? { "Content-Type": "application/json" } : {},
    body: registration ? JSON.stringify(registration) : undefined,
  });

  if (!response.ok) {
    const result = await response.json().catch(() => ({}));
    throw new Error(result.error || `Request failed (${response.status}).`);
  }

  if (response.status === 204) return null;
  return response.json();
}

function renderRegistrations(registrations) {
  recordsBody.replaceChildren();

  for (const registration of [...registrations].reverse()) {
    const row = document.createElement("tr");
    const dateAdded = new Date(registration.createdAt);
    const values = [
      registration.fullName,
      registration.course,
      registration.email,
      Number.isNaN(dateAdded.getTime())
        ? "Unknown"
        : dateAdded.toLocaleDateString(undefined, {
            year: "numeric",
            month: "short",
            day: "numeric",
          }),
    ];

    for (const value of values) {
      const cell = document.createElement("td");
      cell.textContent = value;
      row.append(cell);
    }
    recordsBody.append(row);
  }

  recordCount.textContent = String(registrations.length);
  recordsEmpty.hidden = registrations.length > 0;
  tableWrap.hidden = registrations.length === 0;
  downloadButton.disabled = registrations.length === 0;
  clearButton.disabled = registrations.length === 0;
}

function csvCell(value) {
  const safeValue = /^[\s]*[=+\-@]/.test(value) ? `'${value}` : value;
  return `"${safeValue.replaceAll('"', '""')}"`;
}

function downloadCsv(registrations) {
  const columns = [
    ["Full name", "fullName"],
    ["Email address", "email"],
    ["Phone number", "phone"],
    ["Date of birth", "birthDate"],
    ["Program of interest", "course"],
    ["Home address", "address"],
    ["Date added", "createdAt"],
  ];
  const rows = [
    columns.map(([heading]) => csvCell(heading)).join(","),
    ...registrations.map((registration) =>
      columns.map(([, key]) => csvCell(String(registration[key] ?? ""))).join(","),
    ),
  ];
  const file = new Blob(["\uFEFF", rows.join("\r\n")], {
    type: "text/csv;charset=utf-8",
  });
  const url = URL.createObjectURL(file);
  const link = document.createElement("a");
  link.href = url;
  link.download = "northstar-student-registrations.csv";
  link.click();
  URL.revokeObjectURL(url);
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!form.reportValidity()) return;

  const data = new FormData(form);
  const registration = Object.fromEntries(
    ["fullName", "email", "phone", "birthDate", "course", "address"].map(
      (key) => [key, String(data.get(key)).trim()],
    ),
  );

  submitButton.disabled = true;
  try {
    const savedRegistration = await requestRegistrations("POST", registration);
    form.reset();
    showMessage(
      `Registration saved to the server file (${savedRegistration.id}).`,
    );

    try {
      renderRegistrations(await requestRegistrations());
    } catch (error) {
      showMessage(
        `Registration was saved, but the list could not be refreshed: ${error.message}`,
        true,
      );
    }
  } catch (error) {
    showMessage(`Could not save your registration: ${error.message}`, true);
  } finally {
    submitButton.disabled = false;
  }
});

downloadButton.addEventListener("click", async () => {
  try {
    const registrations = await requestRegistrations();
    if (registrations.length > 0) downloadCsv(registrations);
  } catch (error) {
    showMessage(`Could not read saved registrations: ${error.message}`, true);
  }
});

clearButton.addEventListener("click", async () => {
  if (!window.confirm("Clear all registrations saved on the server?")) return;

  clearButton.disabled = true;
  try {
    await requestRegistrations("DELETE");
    renderRegistrations([]);
    showMessage("Saved registrations cleared from the server file.");
  } catch (error) {
    showMessage(`Could not clear saved registrations: ${error.message}`, true);
    clearButton.disabled = false;
  }
});

requestRegistrations()
  .then(renderRegistrations)
  .catch((error) => {
    showMessage(`Could not load saved registrations: ${error.message}`, true);
  });
