import { runBootstrap } from "../../schema/bootstrap.js";
export async function runSchemaBootstrap(opts: { force?: boolean; cwd?: string; profile?: string }) {
  return runBootstrap(opts);
}
