import { Command, ValidationError } from "@cliffy/command";
import { CompletionsCommand } from "@cliffy/command/completions";
import { UpgradeCommand } from "@cliffy/command/upgrade";
import { GithubProvider } from "@cliffy/command/upgrade/provider/github";
import versionJson from "../version.json" with { type: "json" };
import { browserCommand } from "./browser.ts";
import { controllerCommand } from "./controller.ts";

const cmd = new Command()
  .name("konaste-buddy")
  .version(versionJson)
  .usage("<game> <command> [options]")
  .description("My personal Konaste Buddy CLI")
  .meta("deno", Deno.version.deno)
  .command("completions", new CompletionsCommand())
  .command(
    "upgrade",
    new UpgradeCommand({
      provider: [
        new GithubProvider({ repository: "atty303/konaste-buddy" }),
      ],
    }).action(() => {
      // Upgrade command is not supported for single binary distribution
      throw new ValidationError(
        "This command is not supported yet. Please update manually.",
      );
    }),
  )
  .command("browser", browserCommand)
  .command("controller", controllerCommand);

await cmd.parse();
