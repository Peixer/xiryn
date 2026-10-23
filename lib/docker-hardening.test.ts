import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import { test } from "node:test"

import {
  hardenContainerCreateArgs,
  WORKSTATION_DEFAULT_MEMORY,
  WORKSTATION_PIDS_LIMIT,
} from "./docker"

const root = path.join(import.meta.dirname, "..")

function flagValues(args: readonly string[], flag: string) {
  const values: string[] = []
  for (let i = 0; i < args.length; i++) {
    if (args[i] === flag) values.push(args[i + 1] ?? "")
  }
  return values
}

function serviceBlock(yaml: string, name: string) {
  const lines = yaml.split("\n")
  const start = lines.findIndex((line) => line === `  ${name}:`)
  assert.ok(start >= 0, name)
  let end = lines.length
  for (let i = start + 1; i < lines.length; i++) {
    if (/^ {2}[a-z0-9-]+:$/.test(lines[i]) || /^[a-z]/.test(lines[i])) {
      end = i
      break
    }
  }
  return lines.slice(start, end).join("\n")
}

test("create args drop privileges and cap processes", () => {
  const args = hardenContainerCreateArgs([
    "create",
    "--name",
    "xiryn-ws-abc",
    "--memory",
    "2048m",
    "xiryn-workstation:test",
  ])
  assert.deepEqual(flagValues(args, "--security-opt"), ["no-new-privileges"])
  assert.deepEqual(flagValues(args, "--cap-drop"), ["ALL"])
  assert.deepEqual(flagValues(args, "--pids-limit"), [WORKSTATION_PIDS_LIMIT])
  assert.deepEqual(flagValues(args, "--memory"), ["2048m"])
  assert.equal(args.at(-1), "xiryn-workstation:test")
  assert.equal(args.includes("--cap-add"), false, "no capability is added back")
})

test("create args add a memory limit only when the caller did not", () => {
  const args = hardenContainerCreateArgs(["create", "xiryn-workstation:test"])
  assert.deepEqual(flagValues(args, "--memory"), [WORKSTATION_DEFAULT_MEMORY])
  assert.deepEqual(flagValues(args, "--pids-limit"), [WORKSTATION_PIDS_LIMIT])
})

test("create args are not duplicated when already set", () => {
  const args = hardenContainerCreateArgs([
    "create",
    "--security-opt",
    "no-new-privileges",
    "--cap-drop",
    "ALL",
    "--pids-limit",
    "128",
    "--memory",
    "512m",
    "img",
  ])
  assert.deepEqual(flagValues(args, "--security-opt"), ["no-new-privileges"])
  assert.deepEqual(flagValues(args, "--cap-drop"), ["ALL"])
  assert.deepEqual(flagValues(args, "--pids-limit"), ["128"])
  assert.deepEqual(flagValues(args, "--memory"), ["512m"])
})

test("non-create docker commands are left unchanged", () => {
  const exec = ["exec", "--interactive", "xiryn-ws-abc", "xiryn-run", "10", "true"]
  assert.deepEqual(hardenContainerCreateArgs(exec), exec)
  const info = ["info", "--format", "{{.ServerVersion}}"]
  assert.deepEqual(hardenContainerCreateArgs(info), info)
})

test("dockerRaw runs create through the hardener", () => {
  const source = fs.readFileSync(path.join(root, "lib/docker.ts"), "utf8")
  assert.match(source, /const command = hardenContainerCreateArgs\(args\)/)
  assert.match(source, /spawnOnce\(shared\.binary, command, options\)/)
  assert.match(source, /spawnOnce\(binary, command, options\)/)
})

test("workstation create still sets --memory itself", () => {
  const source = fs.readFileSync(path.join(root, "lib/workstation.ts"), "utf8")
  const start = source.indexOf('"create"')
  assert.ok(start > 0)
  const block = source.slice(start, source.indexOf("timeoutMs: 60_000", start))
  assert.match(block, /"--memory"/)
  assert.match(block, /"--shm-size"/)
})

test("compose file does not hand the app the engine socket", () => {
  const yaml = fs.readFileSync(path.join(root, "docker-compose.yml"), "utf8")
  const app = serviceBlock(yaml, "xiryn")
  const proxy = serviceBlock(yaml, "docker-socket-proxy")
  assert.match(app, /user: node/)
  assert.doesNotMatch(app, /user: root/)
  assert.doesNotMatch(app, /docker\.sock/)
  assert.match(app, /DOCKER_HOST: tcp:\/\/docker-socket-proxy:2375/)
  assert.match(app, /DOCKER_BUILDKIT: "0"/)
  assert.match(app, /127\.0\.0\.1:6796:6796/)
  assert.match(proxy, /\/var\/run\/docker\.sock:\/var\/run\/docker\.sock:ro/)
  assert.match(proxy, /docker-socket-proxy\.haproxy\.cfg/)
  assert.match(
    proxy,
    /haproxy:3\.4\.2-alpine@sha256:0878b11eb64c433be1b0f578a584b8aca12f6caaa64c8f239b8b556c0dd5eeeb/
  )
  assert.match(proxy, /user: "0:0"/)
  assert.match(proxy, /no-new-privileges:true/)
  assert.match(proxy, /cap_drop:\n\s+- ALL/)
  assert.doesNotMatch(proxy, /\n\s+ports:/)
  assert.match(yaml, /internal: true/)
  assert.doesNotMatch(yaml, /user: root/)
})

test("socket proxy allowlist matches the calls Xiryn makes and denies the rest", () => {
  const cfg = fs.readFileSync(
    path.join(root, "deploy/docker-socket-proxy.haproxy.cfg"),
    "utf8"
  )
  const allows = cfg.split("\n").filter((line) => line.includes("http-request allow"))
  const required = [
    "/info$",
    "/version$",
    "/_ping$",
    "/containers/json$",
    "/containers/create$",
    "/start$",
    "/stop$",
    "METH_DELETE",
    "/exec$",
    "/exec/",
    "/exec/[A-Za-z0-9_.-]+/json$",
    "/volumes/create$",
    "/images/json$",
    "/build$",
  ]
  for (const piece of required) {
    assert.ok(
      allows.some((line) => line.includes(piece)),
      `missing allow: ${piece}`
    )
  }
  for (const denied of [
    "/networks",
    "/plugins",
    "/swarm",
    "/secrets",
    "/system",
    "/auth",
    "/nodes",
    "/services",
    "/tasks",
    "/configs",
    "/distribution",
    "/commit",
    "/events",
    "/images/create",
    "/logs",
    "/session",
    "/grpc",
  ]) {
    assert.equal(
      allows.some((line) => line.includes(denied)),
      false,
      `unexpected allow: ${denied}`
    )
  }
  assert.match(cfg, /http-request deny unless METH_GET/)
  assert.match(cfg, /http-request deny\n/)
})

test("systemd unit keeps the service user and adds the sandbox", () => {
  const unit = fs.readFileSync(path.join(root, "deploy/xiryn.service"), "utf8")
  for (const line of [
    "User=xiryn",
    "Group=xiryn",
    "SupplementaryGroups=docker",
    "NoNewPrivileges=true",
    "PrivateTmp=true",
    "ProtectSystem=strict",
    "ProtectHome=read-only",
    "UMask=0077",
    "RestrictSUIDSGID=true",
    "LockPersonality=true",
  ]) {
    assert.match(unit, new RegExp(`^${line}$`, "m"), line)
  }
  assert.doesNotMatch(unit, /^User=root$/m)
  assert.match(unit, /^ReadWritePaths=.*\/opt\/xiryn\/data/m)
  assert.match(unit, /\/var\/lib\/xiryn/)
  assert.match(unit, /\/opt\/xiryn\/\.next\/cache/)
  assert.match(unit, /\/run\/docker\.sock/)
  const docs = fs.readFileSync(path.join(root, "docs/aws.md"), "utf8")
  assert.match(docs, /ProtectSystem=strict/)
  assert.match(docs, /install -d -o xiryn/)
  assert.match(docs, /Not checked:/)
})
