#!/usr/bin/env node
/**
 * Starts local development: PostgreSQL, then the API and web app together.
 *
 * Reports each step so the database start is visible rather than hidden magic,
 * and fails with an actionable message when Docker is unavailable.
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function fail(message) {
  process.stderr.write(`\n${message}\n\n`);
  process.exit(1);
}

function run(command, args) {
  return spawnSync(command, args, { cwd: repoRoot, stdio: "inherit" });
}

if (!existsSync(resolve(repoRoot, ".env"))) {
  fail("Missing .env. Run: cp .env.example .env\nSee README.md for local setup.");
}

const dockerVersion = spawnSync("docker", ["info"], { stdio: "ignore" });
if (dockerVersion.status !== 0) {
  fail(
    "Docker is not available or not running.\n" +
      "Start Docker Desktop, then run this command again.\n" +
      "Docker is required for the local PostgreSQL database; see README.md.",
  );
}

process.stdout.write("Starting PostgreSQL (docker compose up --wait)…\n");
const database = run("docker", ["compose", "up", "--detach", "--wait"]);
if (database.status !== 0) {
  fail("Could not start PostgreSQL. Inspect the output above, then see README.md.");
}
process.stdout.write("PostgreSQL is ready on localhost:5433.\n");
process.stdout.write("Starting the API and web app. Stop with Ctrl+C.\n");
process.stdout.write("The database keeps running; stop it with: docker compose down\n\n");

const children = [
  spawn("pnpm", ["--filter", "@cartoptix/api", "dev"], { cwd: repoRoot, stdio: "inherit" }),
  spawn("pnpm", ["--filter", "@cartoptix/web", "dev"], { cwd: repoRoot, stdio: "inherit" }),
];

let shuttingDown = false;
function stopChildren() {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  for (const child of children) {
    child.kill("SIGTERM");
  }
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, stopChildren);
}

for (const child of children) {
  child.on("exit", (code) => {
    stopChildren();
    process.exitCode = code ?? 0;
  });
}
