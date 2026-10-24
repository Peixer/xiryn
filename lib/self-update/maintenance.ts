import fs from "node:fs"

// The helper writes this as root. The app can read it and cannot delete it
// when the path sits outside its ReadWritePaths (the default is /etc/xiryn).
export function maintenanceFile() {
  return process.env.XIRYN_MAINTENANCE_FILE || "/etc/xiryn/maintenance"
}

export function maintenanceActive() {
  try {
    return fs.existsSync(maintenanceFile())
  } catch {
    return false
  }
}
