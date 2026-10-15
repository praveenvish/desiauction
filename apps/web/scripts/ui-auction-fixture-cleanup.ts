/** Teardown only for exact receipts created by an owned, stopped validation run. */
import { writeFile } from "node:fs/promises";
import { cleanupOwnedAuctionStages } from "../e2e/ui-auction-fixtures";

const file = process.argv[2];
if (!file || process.argv.length !== 3) throw new Error("Supply one owned fixture registry");
const result = await cleanupOwnedAuctionStages(file);
await writeFile(`${file}.cleanup.json`, JSON.stringify(result, null, 2) + "\n", { mode: 0o600 });
