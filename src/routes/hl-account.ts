/**
 * Hyperliquid account state (6 Nov 2026). Demand: "Hyperliquid Account Intelligence" (x402atlas /state) was paid by 4 of
 * the 47 open shoppers in the 5 Nov sample of Base transfers; we sold Hyperliquid market data but nothing per account.
 * Same public info API and approval as the other Hyperliquid tools: clearinghouseState (perps) and spotClearinghouseState
 * (weight 2 each) and frontendOpenOrders (weight 20), in parallel.
 */
import { entry, need, type Entry } from "../family";
import { HttpError } from "../lib/env";
import { info } from "./hyperliquid";

const n = (v: string | number | null | undefined) => (v === null || v === undefined || v === "" ? null : Number(v));

interface Clearinghouse {
  marginSummary?: { accountValue?: string; totalNtlPos?: string; totalRawUsd?: string; totalMarginUsed?: string };
  crossMaintenanceMarginUsed?: string; withdrawable?: string; time?: number;
  assetPositions?: { position: { coin: string; szi: string; entryPx?: string; positionValue?: string; unrealizedPnl?: string; returnOnEquity?: string; liquidationPx?: string | null; marginUsed?: string; leverage?: { type?: string; value?: number }; cumFunding?: { sinceOpen?: string } } }[];
}
interface Spot { balances?: { coin: string; total: string; hold: string; entryNtl?: string }[] }
interface Order { coin: string; side: "A" | "B"; limitPx: string; sz: string; oid: number; timestamp: number; orderType?: string; reduceOnly?: boolean; triggerPx?: string; isTrigger?: boolean }

export function accountView(address: string, ch: Clearinghouse, spot: Spot, orders: Order[]) {
  const positions = (ch.assetPositions ?? []).map(({ position: p }) => {
    const size = Number(p.szi);
    return {
      coin: p.coin, side: size > 0 ? "long" : size < 0 ? "short" : "flat", size: Math.abs(size), entryPrice: n(p.entryPx),
      positionValueUsd: n(p.positionValue), unrealizedPnlUsd: n(p.unrealizedPnl), returnOnEquity: n(p.returnOnEquity),
      liquidationPrice: n(p.liquidationPx), leverage: p.leverage?.value ?? null, marginMode: p.leverage?.type ?? null,
      marginUsedUsd: n(p.marginUsed), cumFundingSinceOpen: n(p.cumFunding?.sinceOpen),
    };
  });
  const accountValue = n(ch.marginSummary?.accountValue);
  const notional = n(ch.marginSummary?.totalNtlPos);
  return {
    address,
    perps: {
      accountValueUsd: accountValue, notionalUsd: notional, marginUsedUsd: n(ch.marginSummary?.totalMarginUsed),
      maintenanceMarginUsd: n(ch.crossMaintenanceMarginUsed), withdrawableUsd: n(ch.withdrawable),
      leverage: accountValue && notional !== null ? Math.round((notional / accountValue) * 100) / 100 : null,
      unrealizedPnlUsd: Math.round(positions.reduce((s, p) => s + (p.unrealizedPnlUsd ?? 0), 0) * 100) / 100,
      positions,
    },
    spot: (spot.balances ?? []).filter((b) => Number(b.total) !== 0).map((b) => ({ coin: b.coin, total: Number(b.total), onHold: Number(b.hold), entryNotionalUsd: n(b.entryNtl) })),
    openOrders: {
      count: orders.length,
      orders: orders.slice(0, 50).map((o) => ({ coin: o.coin, side: o.side === "B" ? "buy" : "sell", price: Number(o.limitPx), size: Number(o.sz), type: o.orderType ?? null, reduceOnly: !!o.reduceOnly, triggerPrice: o.isTrigger ? n(o.triggerPx) : null, placedAt: new Date(o.timestamp).toISOString(), id: o.oid })),
    },
    asOf: new Date(ch.time ?? Date.now()).toISOString(),
    source: "Hyperliquid public info API",
  };
}

export const HL_ACCOUNT: Entry[] = [
  entry("/hyperliquid/account", "Hyperliquid account, positions and PnL",
    "Any Hyperliquid account by address: perp account value, notional, margin used, withdrawable, leverage and unrealized PnL; every open position with side, size, entry, value, PnL, ROE, liquidation price, leverage and cumulative funding since open (Hyperliquid's cumFunding); spot balances; and up to 50 open orders. Public on-chain data from Hyperliquid's info API, read live. Use to track a trader, a vault or your own agent's book.",
    ["hyperliquid-account", "hyperliquid-positions", "trader-positions", "perp-positions", "pnl", "hyperliquid"], {
      address: { type: "string", description: "The account's 0x address", required: true, example: "0x31ca8395cf837de08b24da3f660e77761dfb974b" },
    },
    {
      address: "0x31ca8395cf837de08b24da3f660e77761dfb974b",
      perps: { accountValueUsd: 3026839.66, notionalUsd: 3356515.67, marginUsedUsd: 167825.78, maintenanceMarginUsd: 33565.16, withdrawableUsd: 2691188.1, leverage: 1.11, unrealizedPnlUsd: 0.32,
        positions: [{ coin: "BTC", side: "long", size: 0.01658, entryPrice: 75767.4, positionValueUsd: 1256.55, unrealizedPnlUsd: 0.32, returnOnEquity: 0.0052, liquidationPrice: null, leverage: 20, marginMode: "cross", marginUsedUsd: 62.83, cumFundingSinceOpen: 0 }] },
      spot: [{ coin: "USDC", total: 1200.5, onHold: 0, entryNotionalUsd: 0 }],
      openOrders: { count: 1, orders: [{ coin: "ETH", side: "sell", price: 2400, size: 1.1, type: "Limit", reduceOnly: false, triggerPrice: null, placedAt: "2026-11-06T04:00:00.000Z", id: 123456 }] },
      asOf: "2026-11-06T05:00:00.000Z", source: "Hyperliquid public info API",
    },
    async (_env, q) => {
      const address = need(q, "address", 42).toLowerCase();
      if (!/^0x[0-9a-f]{40}$/.test(address)) throw new HttpError(400, "address must be a 0x address with 40 hex characters");
      const [ch, spot, orders] = await Promise.all([
        info<Clearinghouse>({ type: "clearinghouseState", user: address }),
        info<Spot>({ type: "spotClearinghouseState", user: address }).catch(() => ({}) as Spot),
        info<Order[]>({ type: "frontendOpenOrders", user: address }).catch(() => [] as Order[]),
      ]);
      return accountView(address, ch ?? {}, spot ?? {}, Array.isArray(orders) ? orders : []);
    }),
];
