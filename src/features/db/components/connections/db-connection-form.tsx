import type { JSX } from "solid-js";
import type { DbConnection } from "../../models";
import { useDbPanel } from "../db-panel-context";

export function renderConfigField(
  label: string,
  getValue: string | (() => string),
  onInput: (value: string) => void,
  type = "text",
  placeholder?: string,
) {
  const value = typeof getValue === "function" ? getValue : () => getValue;
  return (
    <label class="grid gap-1">
      <span class="theme-text-soft text-[11px] uppercase tracking-[0.16em]">
        {label}
      </span>
      <input
        class="theme-input h-8 rounded-md px-2.5 text-sm"
        type={type}
        value={value()}
        placeholder={placeholder}
        onInput={(event) => onInput(event.currentTarget.value)}
      />
    </label>
  );
}

export function DbConnectionDraftForm(props: { connection: DbConnection }): JSX.Element {
  const { connectionDraftState, updateConnectionDraftConfig } = useDbPanel();
  const connection = props.connection;
    const cfg = () => connectionDraftState.value!.config;

    if (connection.kind === "sqlite") {
      return (
        <div class="grid gap-3">
          {renderConfigField(
            "File Path",
            () => cfg().filePath,
            (value) => updateConnectionDraftConfig("filePath", value),
            "text",
            "./devx.db",
          )}
        </div>
      );
    }

    if (connection.kind === "redis") {
      return (
        <div class="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {renderConfigField(
            "Host",
            () => cfg().host,
            (value) => updateConnectionDraftConfig("host", value),
          )}
          {renderConfigField(
            "Port",
            () => cfg().port,
            (value) => updateConnectionDraftConfig("port", value),
            "text",
            "6379",
          )}
          {renderConfigField(
            "DB",
            () => cfg().database,
            (value) => updateConnectionDraftConfig("database", value),
            "text",
            "0",
          )}
          {renderConfigField(
            "Login",
            () => cfg().username,
            (value) => updateConnectionDraftConfig("username", value),
          )}
          {renderConfigField(
            "Password",
            () => cfg().password,
            (value) => updateConnectionDraftConfig("password", value),
            "password",
          )}
          {renderConfigField(
            "Parameters",
            () => cfg().options,
            (value) => updateConnectionDraftConfig("options", value),
            "text",
            "protocol=3",
          )}
        </div>
      );
    }

    if (connection.kind === "mongodb") {
      return (
        <div class="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {renderConfigField(
            "Host",
            () => cfg().host,
            (value) => updateConnectionDraftConfig("host", value),
          )}
          {renderConfigField(
            "Port",
            () => cfg().port,
            (value) => updateConnectionDraftConfig("port", value),
            "text",
            "27017",
          )}
          {renderConfigField(
            "Database",
            () => cfg().database,
            (value) => updateConnectionDraftConfig("database", value),
            "text",
          )}
          {renderConfigField(
            "Login",
            () => cfg().username,
            (value) => updateConnectionDraftConfig("username", value),
          )}
          {renderConfigField(
            "Password",
            () => cfg().password,
            (value) => updateConnectionDraftConfig("password", value),
            "password",
          )}
          {renderConfigField(
            "Auth Source",
            () => cfg().authSource,
            (value) => updateConnectionDraftConfig("authSource", value),
            "text",
            "admin",
          )}
          <div class="md:col-span-2 xl:col-span-3">
            {renderConfigField(
              "Parameters",
              () => cfg().options,
              (value) => updateConnectionDraftConfig("options", value),
              "text",
              "replicaSet=rs0",
            )}
          </div>
        </div>
      );
    }

    if (connection.kind === "oracle") {
      return (
        <div class="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {renderConfigField(
            "Host",
            () => cfg().host,
            (value) => updateConnectionDraftConfig("host", value),
          )}
          {renderConfigField(
            "Port",
            () => cfg().port,
            (value) => updateConnectionDraftConfig("port", value),
            "text",
            "1521",
          )}
          {renderConfigField(
            "Service",
            () => cfg().serviceName,
            (value) => updateConnectionDraftConfig("serviceName", value),
            "text",
            "FREEPDB1",
          )}
          {renderConfigField(
            "Login",
            () => cfg().username,
            (value) => updateConnectionDraftConfig("username", value),
          )}
          {renderConfigField(
            "Password",
            () => cfg().password,
            (value) => updateConnectionDraftConfig("password", value),
            "password",
          )}
          {renderConfigField(
            "Parameters",
            () => cfg().options,
            (value) => updateConnectionDraftConfig("options", value),
            "text",
            "standaloneConnection=0",
          )}
        </div>
      );
    }

    const portPlaceholder =
      connection.kind === "sqlserver"
        ? "1433"
        : connection.kind === "clickhouse"
          ? "8123"
          : connection.kind === "mysql" || connection.kind === "tidb"
            ? "3306"
            : connection.kind === "elasticsearch"
              ? "9200"
              : "5432";

    return (
      <div class="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {renderConfigField(
          "Host",
          () => cfg().host,
          (value) => updateConnectionDraftConfig("host", value),
        )}
        {renderConfigField(
          "Port",
          () => cfg().port,
          (value) => updateConnectionDraftConfig("port", value),
          "text",
          portPlaceholder,
        )}
        {renderConfigField(
          "Database",
          () => cfg().database,
          (value) => updateConnectionDraftConfig("database", value),
          "text",
          "",
        )}
        {renderConfigField(
          "Login",
          () => cfg().username,
          (value) => updateConnectionDraftConfig("username", value),
        )}
        {renderConfigField(
          "Password",
          () => cfg().password,
          (value) => updateConnectionDraftConfig("password", value),
          "password",
        )}
        {renderConfigField(
          "Parameters",
          () => cfg().options,
          (value) => updateConnectionDraftConfig("options", value),
          "text",
          "sslmode=disable",
        )}
      </div>
    );
}
