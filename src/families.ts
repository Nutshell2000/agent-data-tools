// All table-generated endpoint families, in catalog order.
import type { Entry } from "./family";
import { AI_TEXT, BASICS } from "./routes/ai-text";
import { CHAIN_READS } from "./routes/chain-reads";
import { FUN } from "./routes/fun";
import { PUBLIC_DATA } from "./routes/public-data";
import { UTILS } from "./routes/utils";

export const FAMILIES: Entry[] = [...CHAIN_READS, ...UTILS, ...PUBLIC_DATA, ...FUN, ...BASICS, ...AI_TEXT];
