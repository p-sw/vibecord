import { spawn } from "node:child_process";
import { access, mkdir, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { createInterface } from "node:readline/promises";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import {
  getDefaultStateFilePath,
  resolveConfigFilePath,
  writeBotConfigFile,
} from "./config.ts";
import { startDiscordBot } from "./discord/bot.ts";

type CommandName = "start" | "setup" | "help";
type ServiceScope = "user" | "system";

interface CliOptions {
  configPath?: string;
}

interface SetupResult {
  configPath: string;
  serviceName?: string;
  serviceFilePath?: string;
}

interface ProcessResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

interface SystemdInstallInput {
  serviceName: string;
  scope: ServiceScope;
  configPath: string;
  launchCommand: string[];
}

export async function runCli(rawArgs: string[] = process.argv.slice(2)): Promise<void> {
  const command = parseCommand(rawArgs[0]);
  const options = parseOptions(rawArgs.slice(command ? 1 : 0));

  if (!command || command === "start") {
    await startDiscordBot(options.configPath);
    return;
  }

  if (command === "setup") {
    const result = await runInteractiveSetup(options);
    printSetupSummary(result);
    return;
  }

  printHelp();
}

function parseCommand(rawCommand?: string): CommandName | undefined {
  if (!rawCommand) {
    return undefined;
  }

  if (rawCommand === "--help" || rawCommand === "-h") {
    return "help";
  }

  if (rawCommand.startsWith("-")) {
    return undefined;
  }

  if (rawCommand === "start") {
    return "start";
  }

  if (rawCommand === "setup" || rawCommand === "help") {
    return rawCommand;
  }

  throw new Error(`Unknown command "${rawCommand}". Run "vibecord help".`);
}

function parseOptions(args: string[]): CliOptions {
  const options: CliOptions = {};

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === "--config") {
      const value = args[index + 1];

      if (!value) {
        throw new Error('Missing value for "--config".');
      }

      options.configPath = value;
      index += 1;
      continue;
    }

    if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    }

    throw new Error(`Unknown option "${arg}". Run "vibecord help".`);
  }

  return options;
}

async function runInteractiveSetup(options: CliOptions): Promise<SetupResult> {
  const configPath = resolveConfigFilePath(options.configPath);
  const prompt = createPromptSession();

  try {
    console.log("Vibecord setup");
    console.log(`Config file: ${configPath}`);

    const configExists = await pathExists(configPath);

    if (configExists) {
      const shouldOverwrite = await prompt.askYesNo(
        "Config file already exists. Overwrite it",
        false,
      );

      if (!shouldOverwrite) {
        throw new Error("Setup cancelled by user.");
      }
    }

    const token = await prompt.askRequired("Discord bot token");
    const mode = await prompt.askChoice("Bot mode (dm/channel)", ["dm", "channel"], "dm");
    const guildId =
      mode === "channel" ? await prompt.askRequired("Discord guild ID") : undefined;
    const categoryId =
      mode === "channel" ? await prompt.askRequired("Discord category ID") : undefined;
    const stateFilePath = await prompt.askRequired(
      "State file path",
      getDefaultStateFilePath(),
    );

    await writeBotConfigFile(configPath, {
      token,
      mode,
      guildId,
      categoryId,
      stateFilePath,
    });

    const shouldInstallService = await prompt.askYesNo(
      "Install and enable a systemd service",
      true,
    );

    if (!shouldInstallService) {
      return {
        configPath,
      };
    }

    if (process.platform !== "linux") {
      throw new Error("systemd setup is only supported on Linux.");
    }

    const serviceScope = await prompt.askChoice(
      "Service scope (user/system)",
      ["user", "system"],
      "user",
    );
    const serviceName = await prompt.askRequired("Service name", "vibecord");
    const launchCommand = resolveLaunchCommand(configPath);
    const serviceFilePath = await installSystemdService({
      serviceName,
      scope: serviceScope,
      configPath,
      launchCommand,
    });

    return {
      configPath,
      serviceName,
      serviceFilePath,
    };
  } finally {
    prompt.close();
  }
}

async function installSystemdService(input: SystemdInstallInput): Promise<string> {
  const isUserScope = input.scope === "user";
  const serviceFilePath = isUserScope
    ? resolve(homedir(), ".config", "systemd", "user", `${input.serviceName}.service`)
    : resolve("/etc/systemd/system", `${input.serviceName}.service`);
  const wantedBy = isUserScope ? "default.target" : "multi-user.target";
  const workingDirectory = dirname(input.configPath);
  const pathValue = process.env.PATH || "/usr/local/bin:/usr/bin:/bin";
  const serviceFileContent = [
    "[Unit]",
    `Description=Vibecord Discord bot (${input.serviceName})`,
    "After=network.target",
    "",
    "[Service]",
    "Type=simple",
    `WorkingDirectory=${quoteSystemdValue(workingDirectory)}`,
    `Environment=PATH=${quoteSystemdValue(pathValue)}`,
    `ExecStart=${input.launchCommand.map(quoteSystemdValue).join(" ")}`,
    "Restart=on-failure",
    "RestartSec=5",
    "",
    "[Install]",
    `WantedBy=${wantedBy}`,
    "",
  ].join("\n");

  try {
    await mkdir(dirname(serviceFilePath), {
      recursive: true,
    });
    await writeFile(serviceFilePath, serviceFileContent, "utf8");
  } catch (error: unknown) {
    if (isPermissionError(error)) {
      throw new Error(
        `Permission denied while writing ${serviceFilePath}. Try user scope or run setup with elevated privileges.`,
      );
    }

    throw error;
  }

  const scopeArgs = isUserScope ? ["--user"] : [];
  const serviceUnitName = `${input.serviceName}.service`;
  const daemonReload = await runProcess("systemctl", [...scopeArgs, "daemon-reload"]);

  if (daemonReload.exitCode !== 0) {
    throw new Error(
      `Failed to reload systemd daemon: ${daemonReload.stderr.trim() || daemonReload.stdout.trim()}`,
    );
  }

  const enableNow = await runProcess("systemctl", [
    ...scopeArgs,
    "enable",
    "--now",
    serviceUnitName,
  ]);

  if (enableNow.exitCode !== 0) {
    throw new Error(
      `Service file written to ${serviceFilePath}, but failed to enable/start service: ${enableNow.stderr.trim() || enableNow.stdout.trim()}`,
    );
  }

  return serviceFilePath;
}

function quoteSystemdValue(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function runProcess(command: string, args: string[]): Promise<ProcessResult> {
  return new Promise((resolveResult, rejectResult) => {
    const child = spawn(command, args, {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");

    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.once("error", (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") {
        rejectResult(new Error(`Unable to find "${command}" in PATH.`));
        return;
      }

      rejectResult(error);
    });
    child.once("close", (code) => {
      resolveResult({
        exitCode: code ?? 1,
        stdout,
        stderr,
      });
    });
  });
}

function printHelp(): void {
  console.log(
    [
      "vibecord commands:",
      "  vibecord start [--config <path>]    Start the Discord bot",
      "  vibecord setup [--config <path>]    Interactive setup + optional systemd install",
      "  vibecord help                       Show help",
    ].join("\n"),
  );
}

function printSetupSummary(result: SetupResult): void {
  console.log("");
  console.log("Setup complete.");
  console.log(`Config file: ${result.configPath}`);

  if (result.serviceName && result.serviceFilePath) {
    console.log(`Service: ${result.serviceName}`);
    console.log(`Service file: ${result.serviceFilePath}`);
  } else {
    console.log("Service: not installed");
  }

  console.log(`Run: vibecord start --config ${result.configPath}`);
}

function resolveLaunchCommand(configPath: string): string[] {
  const argv1 = process.argv[1];
  const scriptPath = argv1 ? resolve(argv1) : undefined;
  const isScriptRuntime =
    scriptPath &&
    (scriptPath.endsWith(".ts") ||
      scriptPath.endsWith(".js") ||
      scriptPath.endsWith(".mjs") ||
      scriptPath.endsWith(".cjs"));

  if (isScriptRuntime) {
    return [process.execPath, scriptPath, "start", "--config", configPath];
  }

  return [process.execPath, "start", "--config", configPath];
}

function createPromptSession() {
  const readline = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return {
    async askRequired(label: string, defaultValue?: string): Promise<string> {
      for (;;) {
        const suffix = defaultValue ? ` [${defaultValue}]` : "";
        const response = (await readline.question(`${label}${suffix}: `)).trim();
        const value = response || defaultValue || "";

        if (value) {
          return value;
        }

        console.log(`${label} is required.`);
      }
    },
    async askChoice<TChoice extends string>(
      label: string,
      choices: readonly TChoice[],
      defaultValue: TChoice,
    ): Promise<TChoice> {
      const choiceList = choices.join("/");

      for (;;) {
        const response = (
          await readline.question(`${label} [${choiceList}] (${defaultValue}): `)
        )
          .trim()
          .toLowerCase();
        const value = (response || defaultValue) as TChoice;

        if (choices.includes(value)) {
          return value;
        }

        console.log(`Please enter one of: ${choiceList}`);
      }
    },
    async askYesNo(label: string, defaultValue: boolean): Promise<boolean> {
      const defaultLabel = defaultValue ? "Y/n" : "y/N";

      for (;;) {
        const response = (await readline.question(`${label} [${defaultLabel}]: `))
          .trim()
          .toLowerCase();

        if (!response) {
          return defaultValue;
        }

        if (response === "y" || response === "yes") {
          return true;
        }

        if (response === "n" || response === "no") {
          return false;
        }

        console.log("Please enter y or n.");
      }
    },
    close(): void {
      readline.close();
    },
  };
}

async function pathExists(pathValue: string): Promise<boolean> {
  try {
    await access(pathValue, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function isPermissionError(error: unknown): error is NodeJS.ErrnoException {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    ((error as NodeJS.ErrnoException).code === "EACCES" ||
      (error as NodeJS.ErrnoException).code === "EPERM")
  );
}
