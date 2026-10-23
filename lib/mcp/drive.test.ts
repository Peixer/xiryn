import assert from "node:assert/strict"
import { test } from "node:test"

import {
  DRIVE_BYTE_CAP,
  DRIVE_PAGE_MAX,
  DRIVE_TEXT_CAP,
  applyDriveChange,
  assertSafeDriveMethod,
  buildDriveQuery,
  clampPageSize,
  driveAbout,
  driveRequest,
  driveToolSchemas,
  escapeDriveQuery,
  exportMime,
  getDriveFile,
  listDriveFiles,
  mapDriveError,
  parseShareDetail,
  readDriveFile,
  redactDriveText,
  workspacePath,
  type DriveDeps,
} from "./drive"
import {
  DRIVE_FILE_SCOPE,
  DRIVE_FULL_SCOPE,
  DRIVE_READONLY_SCOPE,
  GOOGLE_BASE_SCOPES,
  describeDriveGrant,
  driveCapabilities,
  driveToolNames,
  oauthScopes,
  sanitizeGrantedScopes,
  scopeAllowsDriveRead,
  scopeAllowsDriveWrite,
} from "./drive-scopes"

const TOKEN = "ya29.SUPERSECRETTOKENVALUE"

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(body === null ? null : JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  })
}

function deps(fetchImpl: DriveDeps["fetchImpl"], sleep?: DriveDeps["sleep"]): DriveDeps {
  return { token: TOKEN, fetchImpl, sleep: sleep ?? (async () => {}) }
}

function payload(over: Record<string, string> = {}) {
  return {
    action: "",
    fileId: "",
    name: "",
    destination: "",
    detail: "",
    share: "",
    content: "",
    sourcePath: "",
    mimeType: "",
    sha256: "",
    newName: "",
    addParent: "",
    removeParents: "",
    ...over,
  }
}

test("read-only is the default scope and read-write asks only for the full drive scope", () => {
  assert.deepEqual(oauthScopes({ driveEnabled: false, driveAccess: "readwrite" }), [
    ...GOOGLE_BASE_SCOPES,
  ])
  assert.deepEqual(oauthScopes({ driveEnabled: true, driveAccess: "readonly" }), [
    ...GOOGLE_BASE_SCOPES,
    DRIVE_READONLY_SCOPE,
  ])
  assert.deepEqual(oauthScopes({ driveEnabled: true, driveAccess: "nope" }), [
    ...GOOGLE_BASE_SCOPES,
    DRIVE_READONLY_SCOPE,
  ])
  assert.deepEqual(oauthScopes({ driveEnabled: true, driveAccess: "readwrite" }), [
    ...GOOGLE_BASE_SCOPES,
    DRIVE_FULL_SCOPE,
  ])
  assert.equal(
    oauthScopes({ driveEnabled: true, driveAccess: "readwrite" }).includes(
      DRIVE_FILE_SCOPE
    ),
    false
  )
})

test("a read-only grant is not treated as permission to write", () => {
  assert.equal(scopeAllowsDriveRead(DRIVE_READONLY_SCOPE), true)
  assert.equal(scopeAllowsDriveWrite(DRIVE_READONLY_SCOPE), false)
  assert.equal(
    scopeAllowsDriveWrite(`${DRIVE_READONLY_SCOPE} ${DRIVE_FILE_SCOPE}`),
    false
  )
  assert.equal(scopeAllowsDriveRead(DRIVE_FILE_SCOPE), false)
  assert.equal(scopeAllowsDriveWrite(DRIVE_FULL_SCOPE), true)
  assert.equal(DRIVE_READONLY_SCOPE.includes(DRIVE_FULL_SCOPE), true)
  const caps = driveCapabilities({
    enabled: true,
    access: "readwrite",
    granted: DRIVE_READONLY_SCOPE,
  })
  assert.equal(caps.read, true)
  assert.equal(caps.write, false)
  assert.deepEqual(
    driveCapabilities({ enabled: true, access: "readonly", granted: DRIVE_FULL_SCOPE }),
    { access: "readonly", read: true, write: false }
  )
  assert.deepEqual(
    driveCapabilities({ enabled: false, access: "readwrite", granted: DRIVE_FULL_SCOPE }),
    { access: "readwrite", read: false, write: false }
  )
  assert.deepEqual(driveToolNames({ read: false, write: true }), [])
  assert.equal(
    driveToolNames({ read: true, write: false }).includes("drive_share"),
    false
  )
  assert.equal(driveToolNames({ read: true, write: true }).includes("drive_share"), true)
  assert.equal(describeDriveGrant(""), "unknown")
  assert.equal(describeDriveGrant("none"), "none")
  assert.equal(describeDriveGrant(DRIVE_READONLY_SCOPE), "read")
  assert.equal(sanitizeGrantedScopes(undefined), null)
  assert.equal(
    sanitizeGrantedScopes(`ya29.token ${DRIVE_READONLY_SCOPE}`),
    DRIVE_READONLY_SCOPE
  )
})

test("search text cannot break out of the Drive query", () => {
  const query = buildDriveQuery({
    query: "a' or name contains 'b",
    folderId: "folder_1",
    mimeType: "text/plain",
  })
  assert.equal(query.includes("name contains 'b'"), false)
  assert.match(query, /name contains 'a\\' or name contains \\'b'/)
  assert.match(query, /trashed = false/)
  assert.match(query, /'folder_1' in parents/)
  assert.equal(escapeDriveQuery("a'b"), "a\\'b")
  assert.equal(clampPageSize(100), DRIVE_PAGE_MAX)
  assert.equal(clampPageSize(undefined), 10)
})

test("list requests one page and does not follow the next token", async () => {
  const calls: string[] = []
  const files = Array.from({ length: 25 }, (_, index) => ({
    id: `file${index}`,
    name: `Note ${index}`,
    mimeType: "text/plain",
    trashed: index === 3,
  }))
  const listed = await listDriveFiles(
    { query: "notes", limit: 100, pageToken: "page~token" },
    deps(async (url) => {
      calls.push(url)
      const parsed = new URL(url)
      assert.equal(parsed.searchParams.get("pageSize"), String(DRIVE_PAGE_MAX))
      assert.equal(parsed.searchParams.get("pageToken"), "page~token")
      assert.equal(parsed.searchParams.get("orderBy"), null)
      return jsonResponse({ files, nextPageToken: "next~page" })
    })
  )
  assert.equal(calls.length, 1)
  assert.equal(listed.files.length, DRIVE_PAGE_MAX - 1)
  assert.equal(
    listed.files.some((file) => file.name === "Note 3"),
    false
  )
  assert.equal(listed.nextPageToken, "next~page")
})

test("docs export to markdown, fall back to text, and stop at the size cap", async () => {
  const calls: string[] = []
  const tail = "TAIL-NOT-RETURNED"
  const body = `${"a".repeat(DRIVE_TEXT_CAP)}${tail}`
  const result = await readDriveFile(
    { id: "doc1", format: "markdown" },
    deps(async (url) => {
      calls.push(url)
      if (url.includes("/files/doc1?") || url.endsWith("/files/doc1")) {
        return jsonResponse({
          id: "doc1",
          name: "Plan",
          mimeType: "application/vnd.google-apps.document",
        })
      }
      if (url.includes("text%2Fmarkdown") || url.includes("text/markdown")) {
        return jsonResponse({ error: { message: "bad mime" } }, 400)
      }
      return new Response(body, { status: 200 })
    })
  )
  assert.equal(calls.length, 3)
  assert.match(calls[2], /text\/plain|text%2Fplain/)
  assert.equal(result.truncated, true)
  assert.equal(result.text?.includes(tail), false)
  assert.match(result.text ?? "", new RegExp(`truncated, ${tail.length} more chars`))
  assert.equal(
    exportMime("application/vnd.google-apps.document", "pdf-text"),
    "text/plain"
  )
  assert.equal(exportMime("application/vnd.google-apps.spreadsheet", "csv"), "text/csv")
  assert.equal(
    exportMime("application/vnd.google-apps.presentation", "text"),
    "text/plain"
  )
})

test("binary files stay metadata until a download, and an oversize body is not saved", async () => {
  const calls: string[] = []
  const meta = {
    id: "bin1",
    name: "scan.pdf",
    mimeType: "application/pdf",
    size: "12",
    webViewLink: "https://evil.example/phish",
  }
  const listed = await readDriveFile(
    { id: "bin1" },
    deps(async (url) => {
      calls.push(url)
      return jsonResponse(meta)
    })
  )
  assert.equal(calls.length, 1)
  assert.equal(listed.binary, true)
  assert.equal(listed.bytes, undefined)
  assert.equal(listed.file.link, "")

  const huge = Buffer.alloc(DRIVE_BYTE_CAP + 10, 7)
  const downloaded = await readDriveFile(
    { id: "bin1", download: true },
    deps(async (url) => {
      if (url.includes("alt=media")) return new Response(huge, { status: 200 })
      return jsonResponse({
        ...meta,
        webViewLink: "https://drive.google.com/file/d/bin1/view",
      })
    })
  )
  assert.equal(downloaded.tooLarge, true)
  assert.equal(downloaded.bytes, undefined)
  assert.match(downloaded.file.link, /^https:\/\/drive\.google\.com\//)

  const known = await readDriveFile(
    { id: "bin1", download: true },
    deps(async () =>
      jsonResponse({ ...meta, size: String(DRIVE_BYTE_CAP + 1), webViewLink: "" })
    )
  )
  assert.equal(known.tooLarge, true)
})

test("rate limits back off and errors never include the token", async () => {
  const sleeps: number[] = []
  let tries = 0
  const about = await driveAbout(
    deps(
      async () => {
        tries += 1
        if (tries === 1) {
          return jsonResponse({ error: { message: `slow ${TOKEN}` } }, 429, {
            "retry-after": "1",
          })
        }
        return jsonResponse({ user: { emailAddress: "ada@example.com" } })
      },
      async (ms) => {
        sleeps.push(ms)
      }
    )
  )
  assert.deepEqual(sleeps, [1000])
  assert.equal(about.email, "ada@example.com")

  const leaked = `Bearer ${TOKEN} and ${TOKEN} and 1//refresh-token-value`
  const message = mapDriveError(403, JSON.stringify({ error: { message: leaked } }), [
    TOKEN,
  ])
  assert.equal(message.includes(TOKEN), false)
  assert.equal(message.includes("1//refresh-token-value"), false)
  assert.equal(redactDriveText(leaked, [TOKEN]).includes(TOKEN), false)

  let attempts = 0
  await assert.rejects(
    () =>
      driveRequest(
        "https://www.googleapis.com/drive/v3/about?fields=user",
        {},
        deps(async () => {
          attempts += 1
          return jsonResponse({ error: { message: TOKEN } }, 429)
        })
      ),
    (error: unknown) => {
      const text = error instanceof Error ? error.message : ""
      assert.equal(text.includes(TOKEN), false)
      assert.match(text, /rate-limited/)
      return true
    }
  )
  assert.equal(attempts, 4)
})

test("permanent delete is refused and trash is a patch", async () => {
  assert.throws(
    () =>
      assertSafeDriveMethod("DELETE", "https://www.googleapis.com/drive/v3/files/abc"),
    /Permanent delete/
  )
  assert.doesNotThrow(() =>
    assertSafeDriveMethod(
      "DELETE",
      "https://www.googleapis.com/drive/v3/files/abc/permissions/anyone"
    )
  )
  let called = false
  await assert.rejects(
    () =>
      driveRequest(
        "https://www.googleapis.com/drive/v3/files/abc",
        { method: "DELETE" },
        deps(async () => {
          called = true
          return jsonResponse({})
        })
      ),
    /Permanent delete/
  )
  assert.equal(called, false)
  await assert.rejects(
    () =>
      driveRequest(
        "https://evil.example/drive/v3/files/abc",
        {},
        deps(async () => {
          called = true
          return jsonResponse({})
        })
      ),
    /www\.googleapis\.com/
  )
  assert.equal(called, false)

  const calls: { method: string; url: string; body?: string }[] = []
  const trashed = await applyDriveChange(
    payload({ action: "Trash", fileId: "file1", name: "Notes" }),
    deps(async (url, init) => {
      calls.push({
        method: init?.method ?? "GET",
        url,
        body: typeof init?.body === "string" ? init.body : undefined,
      })
      assert.equal(init?.headers?.Authorization, `Bearer ${TOKEN}`)
      return jsonResponse({ id: "file1", trashed: true })
    })
  )
  assert.equal("trashed" in trashed && trashed.trashed, true)
  assert.equal(calls.length, 1)
  assert.equal(calls[0].method, "PATCH")
  assert.equal(JSON.parse(calls[0].body ?? "{}").trashed, true)
  assert.equal(
    calls.some((call) => call.method === "DELETE"),
    false
  )

  await assert.rejects(
    () =>
      applyDriveChange(
        payload({ action: "Delete", fileId: "file1" }),
        deps(async () => {
          called = true
          return jsonResponse({})
        })
      ),
    /not available/
  )
})

test("a public share is the approved grant and does not discover the file", async () => {
  const calls: { url: string; body?: string }[] = []
  const shared = await applyDriveChange(
    payload({
      action: "Share",
      fileId: "file1",
      detail: "grant anyone writer",
      share: "PUBLIC: anyone with the link as writer",
    }),
    deps(async (url, init) => {
      calls.push({ url, body: typeof init?.body === "string" ? init.body : undefined })
      return jsonResponse({ id: "perm", type: "anyone", role: "writer" })
    })
  )
  assert.equal("shared" in shared && shared.shared, true)
  const body = JSON.parse(calls[0].body ?? "{}") as {
    type: string
    role: string
    allowFileDiscovery: boolean
  }
  assert.equal(body.type, "anyone")
  assert.equal(body.role, "writer")
  assert.equal(body.allowFileDiscovery, false)
  assert.match(calls[0].url, /sendNotificationEmail=false/)
  assert.equal(parseShareDetail("grant anyone writer")?.op, "grant")
  assert.equal(parseShareDetail("delete file1"), null)
})

test("workspace paths cannot climb out, and tool schemas reject writes that are not specific", () => {
  assert.throws(() => workspacePath("../secrets"), /cannot climb/)
  assert.throws(() => workspacePath("notes/../../etc/passwd"), /cannot climb/)
  assert.equal(workspacePath("notes/a.txt"), "notes/a.txt")
  assert.equal(driveToolSchemas.drive_search.safeParse({ limit: 21 }).success, false)
  assert.equal(
    driveToolSchemas.drive_search.safeParse({ limit: 5, query: "budget" }).success,
    true
  )
  assert.equal(driveToolSchemas.drive_trash.safeParse({ id: "../x" }).success, false)
  assert.equal(
    driveToolSchemas.drive_create_file.safeParse({ name: "a.txt" }).success,
    false
  )
  assert.equal(
    driveToolSchemas.drive_create_file.safeParse({
      name: "a.txt",
      content: "hi",
      workspacePath: "a",
    }).success,
    false
  )
  assert.equal(
    driveToolSchemas.drive_create_file.safeParse({ name: "a.txt", content: "hi" })
      .success,
    true
  )
  assert.equal(
    driveToolSchemas.drive_share.safeParse({
      id: "abc",
      op: "grant",
      type: "anyone",
      role: "writer",
      email: "ada@example.com",
    }).success,
    false
  )
  assert.equal(
    driveToolSchemas.drive_share.safeParse({
      id: "abc",
      op: "grant",
      type: "anyone",
      role: "writer",
    }).success,
    true
  )
  assert.equal("drive_delete" in driveToolSchemas, false)
  const linked = getDriveFile
  assert.equal(typeof linked, "function")
})

test("sheets export as csv", async () => {
  const calls: string[] = []
  const result = await readDriveFile(
    { id: "sheet1" },
    deps(async (url) => {
      calls.push(url)
      if (!url.includes("/export")) {
        return jsonResponse({
          id: "sheet1",
          name: "Numbers",
          mimeType: "application/vnd.google-apps.spreadsheet",
        })
      }
      return new Response("a,b\n1,2", { status: 200 })
    })
  )
  assert.match(calls[1], /text\/csv|text%2Fcsv/)
  assert.equal(result.text, "a,b\n1,2")
  assert.equal(result.truncated, false)
})
