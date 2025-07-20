import { Command } from "@cliffy/command";
import playwright from "patchright";
import { Entry } from "@napi-rs/keyring";
import $ from "@david/dax";

const entry = new Entry("io.github.atty303.konaste-linux", "passkey-default");

async function launchBrowser(executablePath?: string) {
  const browser = await playwright.chromium.launch({
    headless: false,
    executablePath: executablePath,
  });
  const context = await browser.newContext();
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  const virtualAuthenticator = await cdp.send(
    "WebAuthn.addVirtualAuthenticator",
    {
      options: {
        protocol: "ctap2",
        ctap2Version: "ctap2_1",
        hasUserVerification: true,
        transport: "internal",
        automaticPresenceSimulation: true,
        isUserVerified: true,
        hasResidentKey: true,
      },
    },
  );
  return {
    browser,
    context,
    page,
    cdp,
    virtualAuthenticator,
    close: async () => {
      await context.close();
      await browser.close();
    },
    loadCredentials: async () => {
      const text = entry.getPassword();
      if (!text) {
        throw new Error(
          "No credential found in keyring. Please run the registration or import keyring first.",
        );
      }
      const credential = JSON.parse(text);
      await cdp.send("WebAuthn.addCredential", {
        authenticatorId: virtualAuthenticator.authenticatorId,
        credential,
      });
    },
  };
}

function importPasskeyCommand() {
  return new Command()
    .description("Import a passkey to the keyring")
    .example(
      "Import a passkey from stdin",
      "cat passkey.json | konaste-buddy browser import-passkey",
    )
    .action(async () => {
      if (Deno.stdin) {
        const text = await new Response(Deno.stdin.readable).text();
        if (!text) {
          throw new Error("No input provided. Please provide a passkey JSON.");
        }
        entry.setPassword(text);
      }
    });
}

function exportPasskeyCommand() {
  return new Command()
    .description("Export the passkey from the keyring")
    .action(() => {
      const text = entry.getPassword();
      if (!text) {
        throw new Error("No passkey found in keyring.");
      }
      console.log(text);
    });
}

function registerCommand() {
  return new Command()
    .description("Register a passkey at visiting account page")
    .option("--browser <exe:file>", "The browser executable to use", {
      required: true,
    })
    .option(
      "-s, --start-url <url:string>",
      "The URL to start the registration process",
      { required: true, default: "https://my.konami.net/" },
    )
    .action(async (options) => {
      const b = await launchBrowser(options.browser);
      b.cdp.on("WebAuthn.credentialAdded", (payload) => {
        $.logStep(
          `Added credential: ${payload.credential.userDisplayName} (${payload.credential.credentialId})`,
        );
        $.logLight(JSON.stringify(payload.credential));
        entry.setPassword(JSON.stringify(payload.credential));
      });

      await b.page.goto(options.startUrl);

      $.logWarn(
        "Please complete the passkey registration in the browser. When done, close the browser window to continue.",
      );
      await b.page.pause();

      await b.close();
    });
}

function recordCommand() {
  return new Command()
    .description("Record a login flow for development purposes")
    .hidden()
    .option("--browser <exe:file>", "The browser executable to use", {
      required: true,
    })
    .option(
      "-u, --url <url:string>",
      "The URL to visit for login",
      { required: true },
    )
    .action(async (options) => {
      const b = await launchBrowser(options.browser);
      b.loadCredentials();

      await b.page.goto(options.url);

      $.logWarn(
        "Please complete the login flow in the browser. When done, close the browser window to continue.",
      );
      await b.page.pause();

      await b.close();
    });
}

function launchCommand() {
  return new Command()
    .description("Perform a login and launch the game")
    .option("--browser <exe:file>", "The browser executable to use", {
      required: true,
    })
    .option(
      "-u, --url <url:string>",
      "The URL to visit after launching the browser",
      { required: true },
    )
    .option("-s, --scheme <scheme:string>", "The URL scheme to expect", {
      required: true,
    })
    .action(async (options) => {
      const b = await launchBrowser(options.browser);
      await b.loadCredentials();

      await b.page.goto(options.url, { timeout: 30000 });

      await b.page.waitForLoadState("networkidle");

      let navigatedSchemeUrl: string | undefined = undefined;
      // Some games have a direct link to a game URL scheme then fails navigation
      // (e.g., bm2dxinf://)
      b.page.on("requestfailed", (request) => {
        $.logLight(
          `Request failed: ${request.url()} - ${request.failure()?.errorText}`,
        );
        if (request.url().startsWith(`${options.scheme}://`)) {
          navigatedSchemeUrl = request.url();
        }
      });
      await b.page.getByRole("link", { name: "ゲーム起動" }).click({
        timeout: 10000,
      }).catch((error) => {
        // Some games redirect to a game URL scheme by script then net::ERR_ABORTED error occurs
        // (e.g., konaste.sdvx://)
        $.logWarn("Failed to click the game launch link:", error);
      });

      if (!navigatedSchemeUrl) {
        throw new Error(
          `No request with scheme ${options.scheme} found.`,
        );
      }

      $.logStep("Successfully navigated to the game URL:");
      console.log(navigatedSchemeUrl);

      await b.close();
    });
}

export const browserCommand = new Command()
  .description("Browser management commands")
  .command("register-passkey", registerCommand())
  .command("import-passkey", importPasskeyCommand())
  .command("export-passkey", exportPasskeyCommand())
  .command("record", recordCommand())
  .command("launch", launchCommand());
