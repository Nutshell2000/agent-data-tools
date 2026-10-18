// All table-generated endpoint families, in catalog order.
import type { Entry } from "./family";
import { AI_TEXT, BASICS } from "./routes/ai-text";
import { CHAIN_READS } from "./routes/chain-reads";
import { FUN } from "./routes/fun";
import { PRICES } from "./routes/prices";
import { PUBLIC_DATA } from "./routes/public-data";
import { SEARCH } from "./routes/search";
import { UTILS } from "./routes/utils";

export const FAMILIES: Entry[] = [...CHAIN_READS, ...PRICES, ...SEARCH, ...UTILS, ...PUBLIC_DATA, ...FUN, ...BASICS, ...AI_TEXT];
