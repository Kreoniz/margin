import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = fileURLToPath(new URL("../", import.meta.url));
if (!existsSync(path.join(root, ".env"))) {
  console.error(
    "Create .env from .env.example and set POSTGRES_PASSWORD first.",
  );
  process.exit(1);
}
process.loadEnvFile(path.join(root, ".env"));
if (!process.env.POSTGRES_PASSWORD)
  throw new Error("POSTGRES_PASSWORD is required.");
const run = (command, args, cwd = root, extra = {}) =>
  spawn(command, args, {
    cwd,
    stdio: "inherit",
    env: { ...process.env, ...extra },
  });
const db = run("docker", [
  "compose",
  "-f",
  "compose.yaml",
  "-f",
  "compose.dev.yaml",
  "up",
  "-d",
  "db",
]);
const dbExit = await new Promise((resolve) => {
  db.once("error", () => resolve(1));
  db.once("exit", resolve);
});
if (dbExit !== 0) process.exit(1);
const children = [];
let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) {
    try {
      process.kill(-child.pid, "SIGTERM");
    } catch {
      child.kill("SIGTERM");
    }
  }
  setTimeout(() => process.exit(code), 500).unref();
}
for (const [command, args, cwd, extra] of [
  [
    "go",
    ["run", "-buildvcs=false", "./cmd/server"],
    "backend",
    {
      PORT: "8088",
      MARGIN_DEV_MODE: "1",
      STATIC_DIR: path.join(root, "web/dist"),
      DATABASE_URL: `postgres://margin:${process.env.POSTGRES_PASSWORD}@127.0.0.1:55439/margin?sslmode=disable`,
    },
  ],
  ["pnpm", ["dev"], "web", {}],
]) {
  const child = spawn(command, args, {
    cwd: path.join(root, cwd),
    stdio: "inherit",
    env: { ...process.env, ...extra },
    detached: true,
  });
  children.push(child);
  child.once("error", (error) => {
    console.error(error.message);
    stop(1);
  });
  child.once("exit", (code) => {
    if (!stopping) stop(code || 0);
  });
}
process.once("SIGINT", () => stop());
process.once("SIGTERM", () => stop());
