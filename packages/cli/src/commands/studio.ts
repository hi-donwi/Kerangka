import { startStudio } from "@kerangka/studio-server";

export interface StudioCommandOptions {
  port?: number;
  prefix?: string;
}

export async function studioCommand(target: string, options: StudioCommandOptions = {}): Promise<boolean> {
  if (options.port !== undefined && (!Number.isInteger(options.port) || options.port < 0 || options.port > 65535)) {
    console.error("Studio port must be an integer between 0 and 65535.");
    return false;
  }
  try {
    const host = await startStudio({ target, port: options.port, prefix: options.prefix });
    console.log("Kerangka Studio / read-only / loopback only");
    // This is the trusted operator bootstrap channel, never a request/operational log.
    console.log(`Local launch link (do not share): ${host.url}`);
    console.log("Source is not writable. Preview uses synthetic data. Stop with Ctrl+C.");
    return await new Promise<boolean>((resolve) => {
      const stop = () => {
        process.off("SIGINT", stop);
        process.off("SIGTERM", stop);
        void host.close().then(
          () => resolve(true),
          () => resolve(false),
        );
      };
      process.once("SIGINT", stop);
      process.once("SIGTERM", stop);
    });
  } catch {
    console.error("Studio could not start. Check the chosen source, build assets, and available local port.");
    return false;
  }
}
