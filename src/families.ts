// All table-generated endpoint families, in catalog order.
import type { Entry } from "./family";
import { AI_TEXT, BASICS } from "./routes/ai-text";
import { CHAIN_READS } from "./routes/chain-reads";
import { COMPANY } from "./routes/company";
import { FUN } from "./routes/fun";
import { PDF } from "./routes/pdf";
import { PRICES } from "./routes/prices";
import { PUBLIC_DATA } from "./routes/public-data";
import { SANCTIONS } from "./routes/sanctions";
import { SEARCH } from "./routes/search";
import { UTILS } from "./routes/utils";

export const FAMILIES: Entry[] = [...CHAIN_READS, ...PRICES, ...SEARCH, ...PDF, ...COMPANY, ...SANCTIONS, ...UTILS, ...PUBLIC_DATA, ...FUN, ...BASICS, ...AI_TEXT];
