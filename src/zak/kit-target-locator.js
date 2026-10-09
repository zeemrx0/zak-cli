// Generated from the authoritative kit target contract; do not edit.
/** Canonical host paths shared by kit installers and generated CLI lookup. */
const fs = require("node:fs");
const path = require("node:path");
function absolute(value, label) {
  if (typeof value !== "string" || !value || !path.isAbsolute(value)) throw new Error(`${label} must be an absolute path`);
  return path.resolve(value);
}
function profileName(value) {
  const name = value?.trim();
  if (!name || name === "default") return "";
  if (!/^[a-z0-9][a-z0-9._-]{0,63}$/.test(name) || name.endsWith(".") || /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\..*)?$/i.test(name))
    throw new Error("invalid OMP profile name");
  return name;
}
function globalTarget(name, env = process.env) {
  if (!["omp", "pi", "codex", "claude"].includes(name)) throw new Error(`unsupported host: ${name}`);
  const home = absolute(env.HOME, "HOME");
  let rootDir, skillsRoot;
  if (name === "omp") {
    const raw = env.PI_CONFIG_DIR || ".omp";
    if (path.isAbsolute(raw) || raw.split(/[\\/]/).some((part) => part === "..")) throw new Error("PI_CONFIG_DIR must be relative without traversal");
    const config = path.resolve(home, raw);
    const profileValue = env.OMP_PROFILE !== undefined ? env.OMP_PROFILE : env.PI_PROFILE;
    const profile = profileName(profileValue);
    const derived = profile ? path.join(config, "profiles", profile, "agent") : path.join(config, "agent");
    let override = !profile && env.PI_CODING_AGENT_DIR ? absolute(env.PI_CODING_AGENT_DIR, "PI_CODING_AGENT_DIR") : "";
    let inheritedProfile;
    try { inheritedProfile = profileName(env.PI_PROFILE); } catch { inheritedProfile = ""; }
    if (!profile && inheritedProfile && override === path.join(config, "profiles", inheritedProfile, "agent")) override = "";
    rootDir = profile ? derived : override || derived;
    skillsRoot = path.join(rootDir, "skills");
  } else if (name === "pi") {
    rootDir = env.PI_CODING_AGENT_DIR ? absolute(env.PI_CODING_AGENT_DIR, "PI_CODING_AGENT_DIR") : path.join(home, ".pi", "agent");
    skillsRoot = path.join(rootDir, "skills");
  } else if (name === "codex") {
    rootDir = env.CODEX_HOME ? absolute(env.CODEX_HOME, "CODEX_HOME") : path.join(home, ".codex");
    skillsRoot = path.join(home, ".agents", "skills");
    if (skillsRoot === rootDir || skillsRoot.startsWith(rootDir + path.sep) || rootDir.startsWith(skillsRoot + path.sep))
      throw new Error("Codex skills root aliases control root");
  } else {
    rootDir = env.CLAUDE_CONFIG_DIR ? absolute(env.CLAUDE_CONFIG_DIR, "CLAUDE_CONFIG_DIR") : path.join(home, ".claude");
    skillsRoot = path.join(rootDir, "skills");
  }
  return { name, scope: "user", rootDir, skillsRoot, skills: "skills", rules: ["omp", "pi"].includes(name) ? "rules" : "z-rules", startup: name === "omp" || name === "codex" ? "AGENTS.md" : name === "pi" ? "APPEND_SYSTEM.md" : "rules/z-global.md", lock: "zak-lock.json", guard: "z-global-operation.lock", marker: `.${name}/z-project.json`, invocation: name === "codex" ? "$" : name === "claude" ? "/" : "/skill:" };
}
function hostTarget(name) {
  if (!["codex", "claude"].includes(name))
    throw new Error(`unsupported host: ${name}`);
  const root = `.${name}`;
  return {
    name,
    root,
    skills: name === "codex" ? ".agents/skills" : ".claude/skills",
    rules: `${root}/z-rules`,
    agents: `${root}/agents`,
    marker: `${root}/z-project.json`,
    lock: `${root}/zak-lock.json`,
    guard: `${root}/z-operation.lock`,
    startup: name === "codex" ? "AGENTS.md" : ".claude/rules/z-project.md",
    invocation: name === "codex" ? "$" : "/",
  };
}
function piProjectTarget(root) {
  const rootDir = path.join(root, ".pi");
  return { name: "pi", scope: "repository", rootDir, skillsRoot: path.join(rootDir, "skills"),
    skills: "skills", rules: "rules", startup: "APPEND_SYSTEM.md", lock: "zak-lock.json",
    guard: "z-operation.lock", marker: ".pi/z-project.json", invocation: "/skill:" };
}
function canonicalDirectory(value) {
  const resolved = absolute(value, "target root");
  let parent = path.parse(resolved).root, nearest;
  if (resolved === parent) throw new Error("filesystem root is not a target");
  for (const segment of resolved.slice(parent.length).split(path.sep).filter(Boolean)) {
    parent = path.join(parent, segment);
    let entry;
    try { entry = fs.lstatSync(parent); }
    catch (error) { if (error.code === "ENOENT") continue; throw new Error("target root inspection failed"); }
    if (entry.isSymbolicLink() || !entry.isDirectory()) throw new Error("unsafe target root");
    nearest = entry;
    if (process.getuid && entry.uid !== process.getuid() && (entry.mode & 0o022) &&
        !(entry.uid === 0 && (entry.mode & 0o1000)))
      throw new Error("foreign writable ancestor ownership");
  }
  if (process.getuid && (!nearest || nearest.uid !== process.getuid()))
    throw new Error("foreign target ancestor ownership");
  return resolved;
}
function resolveTarget({ host, scope, project, env = process.env }) {
  if (!["project", "global"].includes(scope)) throw new Error("invalid target scope");
  if (!["omp", "pi", "codex", "claude"].includes(host)) throw new Error("unsupported host");
  const canonicalProject = scope === "global" ? null : canonicalDirectory(project);
  const target = scope === "global" ? globalTarget(host, env)
    : host === "pi" ? piProjectTarget(canonicalProject)
    : host === "omp" ? { root: ".omp", skills: ".omp/skills", lock: ".omp/zak-lock.json" } : hostTarget(host);
  const controlRoot = canonicalDirectory(target.rootDir || path.join(canonicalProject, target.root));
  const skillsRoot = canonicalDirectory(target.skillsRoot || path.join(canonicalProject, target.skills));
  const lockPath = target.rootDir ? path.join(controlRoot, target.lock) : path.join(canonicalProject, target.lock);
  return Object.freeze({ schema: 1, host, scope, project: canonicalProject, controlRoot, skillsRoot, lockPath });
}
module.exports = { globalTarget, hostTarget, piProjectTarget, resolveTarget };
