import type { Sandbox } from "@daytona/sdk"
import { tool, type InferUITools, type UIDataTypes, type UIMessage } from "ai"
import { and, eq } from "drizzle-orm"
import { z } from "zod"

import { db } from "@/db"
import { memories, type Agent } from "@/db/schema"
import { webFetch, webSearch } from "@/lib/web"
import { ensureDesktop, ensureWorkstation } from "@/lib/workstation"

// The tool belt an agent carries. Every tool acts on behalf of whichever
// agent holds the turn right now, which changes when a squad delegates.

export type ToolEnv = {
  current: () => Agent
}

const MAX_OUTPUT = 20_000

function clip(text: string) {
  if (text.length <= MAX_OUTPUT) return text
  return `${text.slice(0, MAX_OUTPUT)}\n… ${text.length - MAX_OUTPUT} more characters truncated`
}

const shellQuote = (value: string) => `'${value.replace(/'/g, `'\\''`)}'`

const coordinates = {
  x: z.number().int().min(0).describe("Pixels from the left edge of the screen"),
  y: z.number().int().min(0).describe("Pixels from the top edge of the screen"),
}

/* ──────────────────────────── screen ──────────────────────────── */

async function capture(sandbox: Sandbox) {
  const [shot, display] = await Promise.all([
    sandbox.computerUse.screenshot.takeCompressed({
      format: "jpeg",
      quality: 70,
      showCursor: true,
    }),
    sandbox.computerUse.display.getInfo(),
  ])
  if (!shot.screenshot) throw new Error("The screenshot came back empty.")
  const screen = display.displays?.[0]
  return {
    image: shot.screenshot as string | null,
    mediaType: "image/jpeg",
    width: screen?.width ?? null,
    height: screen?.height ?? null,
  }
}

export type ScreenCapture = Awaited<ReturnType<typeof capture>>

// The model sees the picture itself, not its base64. Old captures are
// stripped from the history (image: null) to keep the context small.
function screenToModel({ output }: { output: ScreenCapture }) {
  if (!output.image) {
    return {
      type: "content" as const,
      value: [
        { type: "text" as const, text: "[Earlier screenshot omitted to save context.]" },
      ],
    }
  }
  return {
    type: "content" as const,
    value: [
      {
        type: "text" as const,
        text: `Screenshot of the ${output.width}×${output.height} display. Coordinates are pixels from the top-left corner.`,
      },
      {
        type: "file" as const,
        mediaType: output.mediaType,
        data: { type: "data" as const, data: output.image },
      },
    ],
  }
}

/* ────────────────────────── workstation ───────────────────────── */

export function createWorkstationTools(env: ToolEnv) {
  const machine = () => ensureWorkstation(env.current().id)
  const desktop = () => ensureDesktop(env.current().id)

  return {
    shell: tool({
      description:
        "Run a shell command on your workstation (Linux, bash). Returns combined output and the exit code. Each call is a fresh shell that starts in your home directory unless `cwd` is given.",
      inputSchema: z.object({
        command: z.string().min(1).describe("The command to run"),
        cwd: z.string().optional().describe("Working directory"),
        timeout: z
          .number()
          .int()
          .min(1)
          .max(900)
          .optional()
          .describe("Seconds before the command is abandoned. Default 120."),
      }),
      execute: async ({ command, cwd, timeout = 120 }) => {
        const sandbox = await machine()
        const started = Date.now()
        const result = await sandbox.process.executeCommand(
          command,
          cwd?.replace(/^~(\/|$)/, "") || undefined,
          undefined,
          timeout
        )
        return {
          exitCode: result.exitCode,
          output: clip(result.result ?? ""),
          durationMs: Date.now() - started,
        }
      },
    }),

    fs_read: tool({
      description: "Read a text file from your workstation.",
      inputSchema: z.object({
        path: z.string().describe("Path on the workstation; relative paths start at ~"),
      }),
      execute: async ({ path }) => {
        const sandbox = await machine()
        const file = await sandbox.fs.downloadFile(path)
        return { path, content: clip(file.toString("utf8")), bytes: file.byteLength }
      },
    }),

    fs_write: tool({
      description:
        "Create or overwrite a text file on your workstation. Missing parent folders are created.",
      inputSchema: z.object({
        path: z.string().describe("Path on the workstation; relative paths start at ~"),
        content: z.string().describe("The complete new contents"),
      }),
      execute: async ({ path, content }) => {
        const sandbox = await machine()
        const dir = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : ""
        if (dir) await sandbox.process.executeCommand(`mkdir -p ${shellQuote(dir)}`)
        const bytes = Buffer.from(content, "utf8")
        await sandbox.fs.uploadFile(bytes, path)
        return { path, bytes: bytes.byteLength }
      },
    }),

    fs_list: tool({
      description: "List a directory on your workstation.",
      inputSchema: z.object({
        path: z
          .string()
          .default(".")
          .describe("Path on the workstation; relative paths start at ~"),
      }),
      execute: async ({ path }) => {
        const sandbox = await machine()
        const entries = await sandbox.fs.listFiles(path)
        return {
          path,
          entries: entries.slice(0, 500).map((entry) => ({
            name: entry.name,
            dir: entry.isDir,
            size: entry.size,
          })),
        }
      },
    }),

    screen_capture: tool({
      description:
        "Look at your workstation's desktop. Only you see this screenshot. Take one before clicking or typing, and again afterwards to verify the result.",
      inputSchema: z.object({}),
      execute: async () => capture(await desktop()),
      toModelOutput: screenToModel,
    }),

    screen_share: tool({
      description:
        "Show your desktop to the person: the screenshot appears in the conversation. Use only when they ask to see the screen.",
      inputSchema: z.object({}),
      execute: async () => capture(await desktop()),
      toModelOutput: screenToModel,
    }),

    pointer_click: tool({
      description: "Click at a point on the desktop.",
      inputSchema: z.object({
        ...coordinates,
        button: z.enum(["left", "right", "middle"]).default("left"),
        double: z.boolean().default(false),
      }),
      execute: async ({ x, y, button, double }) => {
        await (await desktop()).computerUse.mouse.click(x, y, button, double)
        return { x, y, button, double }
      },
    }),

    pointer_move: tool({
      description: "Move the pointer without clicking, e.g. to reveal a hover menu.",
      inputSchema: z.object(coordinates),
      execute: async ({ x, y }) => {
        await (await desktop()).computerUse.mouse.move(x, y)
        return { x, y }
      },
    }),

    pointer_drag: tool({
      description: "Press the left button at one point, drag to another and release.",
      inputSchema: z.object({
        fromX: coordinates.x,
        fromY: coordinates.y,
        toX: coordinates.x,
        toY: coordinates.y,
      }),
      execute: async ({ fromX, fromY, toX, toY }) => {
        await (await desktop()).computerUse.mouse.drag(fromX, fromY, toX, toY)
        return { fromX, fromY, toX, toY }
      },
    }),

    pointer_scroll: tool({
      description: "Scroll the mouse wheel at a point on the desktop.",
      inputSchema: z.object({
        ...coordinates,
        direction: z.enum(["up", "down"]),
        amount: z.number().int().min(1).max(30).default(3).describe("Wheel notches"),
      }),
      execute: async ({ x, y, direction, amount }) => {
        await (await desktop()).computerUse.mouse.scroll(x, y, direction, amount)
        return { x, y, direction, amount }
      },
    }),

    key_type: tool({
      description:
        "Type text into the focused element on the desktop. Newlines are sent as Enter.",
      inputSchema: z.object({ text: z.string() }),
      execute: async ({ text }) => {
        await (await desktop()).computerUse.keyboard.type(text)
        return { characters: text.length }
      },
    }),

    key_press: tool({
      description:
        "Press one key, optionally with modifiers held — e.g. key 'enter', or key 'l' with ['ctrl'].",
      inputSchema: z.object({
        key: z
          .string()
          .describe(
            "A letter or digit, or one of: enter, escape, tab, backspace, delete, space, up, down, left, right, home, end, pageup, pagedown, f1–f12"
          ),
        modifiers: z.array(z.enum(["ctrl", "alt", "shift", "cmd"])).default([]),
      }),
      execute: async ({ key, modifiers }) => {
        // Models sometimes send a modifier as both the key and a modifier
        const held = modifiers.filter((modifier) => modifier !== key.toLowerCase())
        await (await desktop()).computerUse.keyboard.press(key, held)
        return { key, modifiers: held }
      },
    }),
  }
}

/* ──────────────────────────── memory ──────────────────────────── */

export function createMemoryTools(env: ToolEnv) {
  return {
    memory_write: tool({
      description:
        "Save a durable note to your long-term memory. It will be in front of you in every future conversation, in every thread. Use it for facts about the person, their projects, preferences, decisions and standing instructions — and whenever they ask you to remember something.",
      inputSchema: z.object({
        note: z
          .string()
          .min(1)
          .max(2000)
          .describe(
            "One self-contained statement that makes sense without this conversation"
          ),
      }),
      execute: async ({ note }) => {
        const [row] = db
          .insert(memories)
          .values({ agentId: env.current().id, content: note.trim() })
          .returning({ id: memories.id })
          .all()
        return { id: row.id, saved: note.trim() }
      },
    }),

    memory_forget: tool({
      description:
        "Delete a note from your memory by its id, when it is wrong, outdated or the person asks you to forget it.",
      inputSchema: z.object({
        id: z.string().describe("The note's id, shown in your memory"),
      }),
      execute: async ({ id }) => {
        const removed = db
          .delete(memories)
          .where(and(eq(memories.id, id), eq(memories.agentId, env.current().id)))
          .returning({ id: memories.id })
          .all()
        if (removed.length === 0) throw new Error(`No note with id ${id} in your memory.`)
        return { forgotten: id }
      },
    }),
  }
}

/* ───────────────────────────── web ────────────────────────────── */

export function createWebTools() {
  return {
    web_search: tool({
      description:
        "Search the web. Returns titles, URLs and snippets. Follow up with web_fetch to read a result in full.",
      inputSchema: z.object({
        query: z.string().min(1),
        limit: z.number().int().min(1).max(10).default(5),
      }),
      execute: async ({ query, limit }) => ({
        query,
        results: await webSearch(query, limit),
      }),
    }),

    web_fetch: tool({
      description:
        "Read a web page as clean markdown. Use it on URLs from search results or ones the person gives you.",
      inputSchema: z.object({ url: z.url() }),
      execute: async ({ url }) => webFetch(url),
    }),
  }
}

/* ─────────────────────────── delegation ───────────────────────── */

export type Delegation = { agentId: string; name: string }

export function createDelegateTool(
  delegate: (agentId: string, brief: string) => Delegation
) {
  return {
    delegate: tool({
      description:
        "Hand this request to another agent in the squad whose role fits it better. They take over the rest of the turn and reply to the person in your place.",
      inputSchema: z.object({
        agentId: z.string().describe("The id of the squad member to hand over to"),
        brief: z.string().describe("What they should do, in one or two sentences"),
      }),
      execute: async ({ agentId, brief }) => delegate(agentId, brief),
      // Spelled out for the model: the next step belongs to someone else
      toModelOutput: ({ output }) => ({
        type: "text" as const,
        value: `Handover complete. ${output.name} now holds this turn and must do the work and answer the person.`,
      }),
    }),
  }
}

/* ───────────────────────────── types ──────────────────────────── */

export type OrynTools = ReturnType<typeof createWorkstationTools> &
  ReturnType<typeof createMemoryTools> &
  ReturnType<typeof createWebTools> &
  ReturnType<typeof createDelegateTool>

export type OrynMetadata = {
  // The agent that started the reply, or that a squad message was sent to
  agentId?: string
  model?: string
  usage?: { input: number; output: number }
  durationMs?: number
  // Set on messages that arrived through Telegram
  via?: "telegram"
}

export type OrynMessage = UIMessage<OrynMetadata, UIDataTypes, InferUITools<OrynTools>>
