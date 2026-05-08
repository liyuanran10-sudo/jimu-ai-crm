import path from "node:path";
import { loadDotEnv, getConfig } from "../src/config.js";
import { listFeishuSpaces } from "../src/feishu.js";

loadDotEnv(path.resolve(".env"));
const config = getConfig();

if (!config.feishuAppId || !config.feishuAppSecret) {
  console.error("Please fill FEISHU_APP_ID and FEISHU_APP_SECRET in .env first.");
  process.exit(1);
}

const spaces = await listFeishuSpaces(config);

if (!spaces.length) {
  console.log("No accessible Feishu wiki spaces found. Make sure the app has wiki permissions and has been added to the knowledge base as a member/admin.");
  process.exit(0);
}

console.log("Accessible Feishu wiki spaces:");
for (const space of spaces) {
  console.log(JSON.stringify({
    name: space.name,
    space_id: space.space_id,
    description: space.description || "",
    visibility: space.visibility || ""
  }, null, 2));
}
