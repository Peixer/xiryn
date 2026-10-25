// Only the primary Coder can change the shared credentials. Other opted-in
// agents consume them read-only; agents without the capability get no mount.
export function codingAccess(agent: { name: string; codingTools: boolean }) {
  return agent.codingTools
    ? agent.name.trim().toLowerCase() === "coder"
      ? "rw"
      : "ro"
    : "off"
}

export function codingVolumeArgs(agent: { name: string; codingTools: boolean }) {
  const access = codingAccess(agent)
  return access === "off"
    ? []
    : [
        "--volume",
        `xiryn-coding-creds:/home/xiryn/.coding-creds:${access}`,
        "--env",
        "XIRYN_CODING_TOOLS=1",
      ]
}
