"use strict";

const http = require("node:http");
const fs = require("node:fs/promises");
const path = require("node:path");
const { randomUUID } = require("node:crypto");

const ROOT = __dirname;
const DATA_DIRECTORY = path.join(ROOT, "data");
const DATA_FILE = path.join(DATA_DIRECTORY, "registrations.json");
const HOST = process.env.HOST || "127.0.0.1";
const PORT = Number(process.env.PORT || 3000);
const MAX_BODY_BYTES = 16 * 1024;
const COURSES = new Set([
  "Arts & Design",
  "Business & Leadership",
  "Computer Science",
  "Education",
  "Health Sciences",
  "Social Sciences",
]);
const STATIC_FILES = new Map([
  ["/", ["index.html", "text/html; charset=utf-8"]],
  ["/index.html", ["index.html", "text/html; charset=utf-8"]],
  ["/styles.css", ["styles.css", "text/css; charset=utf-8"]],
  ["/app.js", ["app.js", "text/javascript; charset=utf-8"]],
]);

let writeQueue = Promise.resolve();

function sendJson(response, statusCode, value) {
  const body = JSON.stringify(value);
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "X-Content-Type-Options": "nosniff",
    "Cache-Control": "no-store",
  });
  response.end(body);
}

function sendError(response, statusCode, message) {
  sendJson(response, statusCode, { error: message });
}

async function readRegistrations() {
  try {
    const contents = await fs.readFile(DATA_FILE, "utf8");
    const registrations = JSON.parse(contents);
    if (!Array.isArray(registrations)) {
      throw new Error("Registration data must be a JSON array.");
    }
    return registrations;
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}

function updateRegistrations(update) {
  const operation = writeQueue.then(async () => {
    const registrations = await readRegistrations();
    const result = await update(registrations);
    await fs.mkdir(DATA_DIRECTORY, { recursive: true });
    const temporaryFile = `${DATA_FILE}.tmp`;
    await fs.writeFile(
      temporaryFile,
      `${JSON.stringify(registrations, null, 2)}\n`,
      { encoding: "utf8", mode: 0o600 },
    );
    await fs.rename(temporaryFile, DATA_FILE);
    return result;
  });
  writeQueue = operation.catch(() => {});
  return operation;
}

function validateRegistration(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return "Registration must be an object.";
  }

  const limits = {
    fullName: 100,
    email: 254,
    phone: 30,
    birthDate: 10,
    course: 60,
    address: 200,
  };

  for (const [field, maxLength] of Object.entries(limits)) {
    if (typeof value[field] !== "string") {
      return `${field} is required.`;
    }
    if (value[field].trim().length === 0 || value[field].length > maxLength) {
      return `${field} must be non-empty and no longer than ${maxLength} characters.`;
    }
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.email)) {
    return "Enter a valid email address.";
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value.birthDate)) {
    return "Enter a valid date of birth.";
  }
  const birthDate = new Date(`${value.birthDate}T00:00:00Z`);
  if (
    Number.isNaN(birthDate.getTime()) ||
    birthDate.toISOString().slice(0, 10) !== value.birthDate
  ) {
    return "Enter a valid date of birth.";
  }
  if (!COURSES.has(value.course)) {
    return "Select a valid program.";
  }
  return null;
}

async function readRequestBody(request) {
  const chunks = [];
  let size = 0;

  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) {
      const error = new Error("Request body is too large.");
      error.statusCode = 413;
      throw error;
    }
    chunks.push(chunk);
  }

  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    const error = new Error("Request body must be valid JSON.");
    error.statusCode = 400;
    throw error;
  }
}

async function handleApi(request, response) {
  if (request.method === "GET") {
    sendJson(response, 200, await readRegistrations());
    return;
  }

  if (request.method === "POST") {
    const payload = await readRequestBody(request);
    const validationError = validateRegistration(payload);
    if (validationError) {
      sendError(response, 400, validationError);
      return;
    }

    const registration = {
      id: randomUUID(),
      ...Object.fromEntries(
        ["fullName", "email", "phone", "birthDate", "course", "address"].map(
          (key) => [key, payload[key].trim()],
        ),
      ),
      createdAt: new Date().toISOString(),
    };
    await updateRegistrations((registrations) => {
      registrations.push(registration);
    });
    sendJson(response, 201, registration);
    return;
  }

  if (request.method === "DELETE") {
    await updateRegistrations((registrations) => {
      registrations.length = 0;
    });
    response.writeHead(204, {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    });
    response.end();
    return;
  }

  response.setHeader("Allow", "GET, POST, DELETE");
  sendError(response, 405, "Method not allowed.");
}

async function handleRequest(request, response) {
  const requestUrl = new URL(request.url, `http://${request.headers.host || HOST}`);
  try {
    if (requestUrl.pathname === "/api/registrations") {
      await handleApi(request, response);
      return;
    }

    if (request.method !== "GET" && request.method !== "HEAD") {
      response.setHeader("Allow", "GET, HEAD");
      sendError(response, 405, "Method not allowed.");
      return;
    }

    const staticFile = STATIC_FILES.get(requestUrl.pathname);
    if (!staticFile) {
      sendError(response, 404, "Not found.");
      return;
    }

    const [filename, contentType] = staticFile;
    const contents = await fs.readFile(path.join(ROOT, filename));
    response.writeHead(200, {
      "Content-Type": contentType,
      "Content-Length": contents.length,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "no-cache",
    });
    response.end(request.method === "HEAD" ? undefined : contents);
  } catch (error) {
    if (error.statusCode) {
      sendError(response, error.statusCode, error.message);
      return;
    }
    console.error("Request failed:", error);
    if (!response.headersSent) {
      sendError(response, 500, "The server could not complete the request.");
    } else {
      response.destroy(error);
    }
  }
}

const server = http.createServer((request, response) => {
  void handleRequest(request, response);
});

server.listen(PORT, HOST, () => {
  console.log(`Student registration site running at http://${HOST}:${PORT}`);
  console.log(`Registration file: ${DATA_FILE}`);
});

server.on("error", (error) => {
  console.error("Could not start the student registration server:", error);
  process.exitCode = 1;
});
