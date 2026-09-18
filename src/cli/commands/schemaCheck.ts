import { runSchemaCheck } from "../../schema/checker.js";
export async function runSchemaCheckCommand(opts: { profile?: string; cwd?: string }) {
  return runSchemaCheck(opts);
}
export { runSchemaCheck };
