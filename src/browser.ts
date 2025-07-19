import { Command } from "@cliffy/command";

function registerCommands() {
    return new Command()
    .description("Register a passkey at visiting account page")
}

export const browserCommand = new Command()
    .description("Browser management commands")
    .command("register-passkey", registerCommands());
