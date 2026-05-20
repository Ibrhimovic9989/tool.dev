"use client";

import { useState, useTransition } from "react";
import { Plus, Trash2, ShieldCheck, Link2, Sparkles, Loader2 } from "lucide-react";
import { nanoid } from "nanoid";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { useBuilder } from "@/lib/store";
import type { DatabaseSourceData, DbTable } from "@/lib/types";
import { parsePostgresUrl } from "@/lib/db/connection-string";
import { isPlausiblePasswordEnvVar } from "@/lib/ai/extract-secrets";
import { toast } from "sonner";

interface Props {
  nodeId: string;
  data: DatabaseSourceData & { kind: "source.database" };
}

const DEFAULT_PORTS: Record<DatabaseSourceData["engine"], number> = {
  postgres: 5432,
  mysql: 3306,
  mssql: 1433,
};

export function DatabaseConfig({ nodeId, data }: Props) {
  const updateNodeData = useBuilder((s) => s.updateNodeData);
  const setSecret = useBuilder((s) => s.setSecret);
  const savedPwd = useBuilder(
    (s) =>
      (s.currentProjectId &&
        s.projects[s.currentProjectId]?.secrets?.[data.passwordEnvVar]) ||
      "",
  );
  const [connString, setConnString] = useState("");
  const [discoverPwd, setDiscoverPwd] = useState(savedPwd);
  const [discoverOpen, setDiscoverOpen] = useState(false);
  const [discovering, startDiscover] = useTransition();

  const setReady = (next: Partial<DatabaseSourceData>) => {
    const merged = { ...data, ...next };
    const ready =
      !!merged.host &&
      !!merged.database &&
      !!merged.username &&
      merged.tables.some((t) => t.enabled);
    updateNodeData(nodeId, { ...next, status: ready ? "ready" : "draft" });
  };

  const applyConnString = () => {
    const parsed = parsePostgresUrl(connString);
    if (!parsed) {
      toast.error("That doesn't look like a postgres:// URL");
      return;
    }
    // If the current passwordEnvVar is something URL-shaped (DATABASE_URL,
    // DIRECT_URL, …) it would silently break: secrets[passwordEnvVar] would
    // hold a URL, not a password. Normalize to DB_PASSWORD so we always
    // store / read the password under the right name.
    const passwordEnvVar = isPlausiblePasswordEnvVar(data.passwordEnvVar)
      ? data.passwordEnvVar
      : "DB_PASSWORD";

    setReady({
      engine: "postgres",
      host: parsed.host,
      port: parsed.port,
      database: parsed.database,
      username: parsed.username,
      ssl: parsed.ssl,
      passwordEnvVar,
    });
    setConnString("");
    if (parsed.password) {
      setDiscoverPwd(parsed.password);
      // Persist the parsed password to the project's secret store so the
      // Test panel and any later Discover click can pick it up without a
      // second paste from the user.
      setSecret(passwordEnvVar, parsed.password);
    }
    setDiscoverOpen(true);
    toast.success(
      parsed.password
        ? `Parsed connection. Host: ${parsed.host}. Password saved as ${passwordEnvVar}.`
        : `Parsed connection. Host: ${parsed.host}`,
    );
  };

  const handleDiscover = () => {
    if (!discoverPwd) {
      toast.error("Add the database password to discover tables.");
      return;
    }
    if (data.engine !== "postgres") {
      toast.error("In-builder discovery currently supports Postgres only.");
      return;
    }
    // Persist whatever password the user just typed.
    setSecret(data.passwordEnvVar, discoverPwd);
    startDiscover(async () => {
      try {
        const res = await fetch("/api/db/discover", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            host: data.host,
            port: data.port,
            database: data.database,
            username: data.username,
            password: discoverPwd,
            ssl: data.ssl,
          }),
        });
        const json = await res.json();
        if (!res.ok) {
          toast.error(json.error || "Couldn't connect");
          return;
        }
        const discovered: DbTable[] = json.tables ?? [];
        if (discovered.length === 0) {
          toast.warning("Connected, but no tables found in the public schema.");
          return;
        }
        // Merge — keep existing tables, append discovered ones not already there
        const existing = new Set(
          data.tables.map((t) => `${t.schema}.${t.name}`),
        );
        const fresh = discovered.filter(
          (t) => !existing.has(`${t.schema}.${t.name}`),
        );
        setReady({ tables: [...data.tables, ...fresh] });
        toast.success(`Added ${fresh.length} table(s) as MCP tools.`);
        setDiscoverPwd("");
        setDiscoverOpen(false);
      } catch (e) {
        toast.error(
          e instanceof Error ? e.message : "Couldn't discover tables",
        );
      }
    });
  };

  const addTable = () => {
    const table: DbTable = {
      id: nanoid(8),
      schema: "public",
      name: "",
      toolName: "",
      description: "",
      readOnly: true,
      enabled: true,
    };
    setReady({ tables: [...data.tables, table] });
  };

  const updateTable = (id: string, patch: Partial<DbTable>) => {
    setReady({
      tables: data.tables.map((t) => (t.id === id ? { ...t, ...patch } : t)),
    });
  };

  const removeTable = (id: string) => {
    setReady({ tables: data.tables.filter((t) => t.id !== id) });
  };

  return (
    <div className="space-y-5">
      <div className="rounded-lg border bg-gov-50 p-3 space-y-2">
        <div className="flex items-center gap-2 text-sm font-medium text-gov-700">
          <Link2 className="size-4" />
          Paste a connection string
        </div>
        <p className="text-xs text-muted-foreground">
          We&apos;ll fill in host, port, database, and username. Works with{" "}
          <code>postgres://</code> URLs from Supabase, Neon, RDS, etc.
        </p>
        <div className="flex gap-2">
          <Input
            placeholder="postgresql://user:pass@host:5432/db"
            value={connString}
            onChange={(e) => setConnString(e.target.value)}
            type="password"
            className="font-mono text-xs"
          />
          <Button variant="outline" size="sm" onClick={applyConnString}>
            Apply
          </Button>
        </div>
      </div>

      <div className="space-y-1.5">
        <Label>Database engine</Label>
        <Select
          value={data.engine}
          onValueChange={(v) =>
            setReady({
              engine: v as DatabaseSourceData["engine"],
              port: DEFAULT_PORTS[v as DatabaseSourceData["engine"]],
            })
          }
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="postgres">PostgreSQL</SelectItem>
            <SelectItem value="mysql">MySQL / MariaDB</SelectItem>
            <SelectItem value="mssql">Microsoft SQL Server</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="grid grid-cols-3 gap-2">
        <div className="col-span-2 space-y-1.5">
          <Label>Host</Label>
          <Input
            value={data.host}
            placeholder="db.your-agency.gov"
            onChange={(e) => setReady({ host: e.target.value })}
          />
        </div>
        <div className="space-y-1.5">
          <Label>Port</Label>
          <Input
            type="number"
            value={data.port}
            onChange={(e) => setReady({ port: Number(e.target.value) })}
          />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label>Database name</Label>
        <Input
          value={data.database}
          placeholder="health_records"
          onChange={(e) => setReady({ database: e.target.value })}
        />
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1.5">
          <Label>Username</Label>
          <Input
            value={data.username}
            placeholder="mcp_reader"
            onChange={(e) => setReady({ username: e.target.value })}
          />
        </div>
        <div className="space-y-1.5">
          <Label>Password env var</Label>
          <Input
            value={data.passwordEnvVar}
            placeholder="DB_PASSWORD"
            onChange={(e) => setReady({ passwordEnvVar: e.target.value })}
          />
        </div>
      </div>

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={data.ssl}
          onChange={(e) => setReady({ ssl: e.target.checked })}
        />
        Require SSL/TLS connection
      </label>

      <div className="rounded-lg border bg-emerald-50 p-3 text-xs flex gap-2">
        <ShieldCheck className="size-4 text-emerald-700 shrink-0 mt-0.5" />
        <p className="text-emerald-900">
          All tables are <strong>read-only by default</strong>. We strongly
          recommend creating a dedicated database user with SELECT-only
          permissions for the tables you expose.
        </p>
      </div>

      <div>
        <div className="flex items-center justify-between mb-2">
          <Label>Tables exposed to AI</Label>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setDiscoverOpen((v) => !v)}
              title="Connect and list tables automatically"
            >
              <Sparkles className="size-3.5" />
              Discover
            </Button>
            <Button variant="ghost" size="sm" onClick={addTable}>
              <Plus className="size-3.5" />
              Add
            </Button>
          </div>
        </div>

        {discoverOpen && (
          <div className="mb-3 rounded-lg border bg-amber-50 p-3 space-y-2">
            <p className="text-xs text-amber-900">
              We&apos;ll connect to <code>{data.host || "your host"}</code> as{" "}
              <code>{data.username || "your user"}</code> and list every table in
              the <code>public</code> schema. The password is used once, in
              memory only — it&apos;s never saved.
            </p>
            <div className="flex gap-2">
              <Input
                type="password"
                placeholder="Database password"
                value={discoverPwd}
                onChange={(e) => setDiscoverPwd(e.target.value)}
              />
              <Button
                size="sm"
                onClick={handleDiscover}
                disabled={discovering || !data.host}
              >
                {discovering ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Sparkles className="size-4" />
                )}
                Connect & list
              </Button>
            </div>
          </div>
        )}
        {data.tables.length === 0 ? (
          <p className="text-xs text-muted-foreground rounded-md border border-dashed p-3">
            No tables yet. Add the ones AI is allowed to read.
          </p>
        ) : (
          <div className="space-y-2">
            {data.tables.map((t) => (
              <div
                key={t.id}
                className="rounded-lg border p-3 space-y-2 bg-white"
              >
                <div className="flex items-center gap-2">
                  <Input
                    placeholder="schema"
                    className="h-8 w-[110px] text-xs"
                    value={t.schema}
                    onChange={(e) =>
                      updateTable(t.id, { schema: e.target.value })
                    }
                  />
                  <Input
                    placeholder="table_name"
                    className="h-8 flex-1 text-xs"
                    value={t.name}
                    onChange={(e) => updateTable(t.id, { name: e.target.value })}
                  />
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-8"
                    onClick={() => removeTable(t.id)}
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </div>
                <Input
                  className="h-8 text-xs"
                  placeholder="tool_name (e.g. list_clinics)"
                  value={t.toolName}
                  onChange={(e) =>
                    updateTable(t.id, {
                      toolName: e.target.value
                        .replace(/[^a-z0-9_]/gi, "_")
                        .toLowerCase(),
                    })
                  }
                />
                <Textarea
                  className="text-xs"
                  rows={2}
                  placeholder="What does this table contain?"
                  value={t.description}
                  onChange={(e) =>
                    updateTable(t.id, { description: e.target.value })
                  }
                />
                <Input
                  className="h-8 text-xs font-mono"
                  placeholder="Optional WHERE filter (e.g. status = 'public')"
                  value={t.rowFilter ?? ""}
                  onChange={(e) =>
                    updateTable(t.id, { rowFilter: e.target.value })
                  }
                />
                <div className="flex items-center justify-between">
                  <Badge variant="outline" className="text-[10px]">
                    {t.readOnly ? "Read-only" : "Read/Write"}
                  </Badge>
                  <label className="flex items-center gap-2 text-xs text-muted-foreground">
                    <input
                      type="checkbox"
                      checked={t.enabled}
                      onChange={(e) =>
                        updateTable(t.id, { enabled: e.target.checked })
                      }
                    />
                    Available to AI
                  </label>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
