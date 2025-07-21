import { downloadRelease } from "npm:@terascope/fetch-github-release";
import xdg from "jsr:@404wolf/xdg-portable";
import * as path from "jsr:@std/path";
import $ from "@david/dax";

export async function getProcessCompose() {
  const cache = path.join(xdg.cache(), "konaste-buddy");
  const processComposePath = path.join(cache, "process-compose");
  if (await $.path(processComposePath).exists()) {
    return processComposePath;
  }

  const tmp = await Deno.makeTempDir();
  try {
    const arch = Deno.build.arch.includes("aarch64") ? "arm64" : "amd64";
    const files = await downloadRelease(
      "F1bonacc1",
      "process-compose",
      tmp,
      (_) => true,
      (_) => _.name.includes(Deno.build.os) && _.name.includes(arch),
    );
    if (!Array.isArray(files) || files.length !== 1) {
      throw new Error("Failed to download process-compose.");
    }
    await $`tar -zxf ${files[0]} process-compose`.cwd(cache);

    return processComposePath;
  } finally {
    await Deno.remove(tmp, { recursive: true });
  }
}
