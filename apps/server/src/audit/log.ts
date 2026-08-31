import { randomUUID } from "node:crypto";
import { mkdir, readFile, appendFile } from "node:fs/promises";
import path from "node:path";

export interface AuditEntry {
  id: string;
  requestId: string;
  decidedAt: string;
  humanId: string;
  agentId: string;
  principalKind: "human" | "agent";
  action: string;
  resource: string;
  effect: "permit" | "deny";
  reason: string;
}

export class AuditLog {
  private queue: Promise<void> = Promise.resolve();

  constructor(private readonly filePath: string) {}

  async initialize(): Promise<void> {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    try {
      await readFile(this.filePath, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error;
      }
      await appendFile(this.filePath, "", "utf8");
    }
  }

  async append(entry: Omit<AuditEntry, "id">): Promise<AuditEntry> {
    const record: AuditEntry = { id: randomUUID(), ...entry };
    const operation = this.queue.then(() =>
      appendFile(this.filePath, JSON.stringify(record) + "\n", "utf8"),
    );
    this.queue = operation.catch(() => undefined);
    await operation;
    return record;
  }

  async list(): Promise<AuditEntry[]> {
    const raw = await readFile(this.filePath, "utf8").catch(() => "");
    return raw
      .split("\n")
      .filter(Boolean)
      .flatMap((line) => {
        try {
          return [JSON.parse(line) as AuditEntry];
        } catch {
          return [];
        }
      })
      .reverse();
  }

  async listForHuman(humanId: string): Promise<AuditEntry[]> {
    return (await this.list()).filter((entry) => entry.humanId === humanId);
  }
}
