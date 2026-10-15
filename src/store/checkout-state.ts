// Called through the existing Durable Object so payment allocation is transactional.
export interface AmountReservation {
  scope: string;
  amount: string;
  orderId: string;
  expiresAt: number;
}
export interface TransferClaim {
  scope: string;
  amount: string;
  orderId: string;
  transaction: string;
  logIndex: number;
}

function validOrder(record: { scope: string; amount: string; orderId: string }): boolean {
  return /^eip155:8453:0x[0-9a-f]{40}$/.test(record.scope) &&
    /^[1-9]\d{0,29}$/.test(record.amount) && /^[0-9a-f]{32}$/.test(record.orderId);
}

export async function reserveAmount(storage: DurableObjectStorage, reservation: AmountReservation): Promise<boolean> {
  if (!validOrder(reservation) || !Number.isSafeInteger(reservation.expiresAt) ||
      reservation.expiresAt <= Date.now() || reservation.expiresAt > Date.now() + 3 * 3600_000) return false;
  return storage.transaction(async txn => {
    const key = `checkout:amount:${reservation.scope}:${reservation.amount}`;
    const existing = await txn.get<AmountReservation>(key);
    if (existing && existing.expiresAt > Date.now() && existing.orderId !== reservation.orderId) return false;
    await txn.put(key, reservation);
    return true;
  });
}

export async function claimTransfer(storage: DurableObjectStorage, claim: TransferClaim): Promise<boolean> {
  if (!validOrder(claim) || !/^0x[0-9a-f]{64}$/.test(claim.transaction) ||
      !Number.isSafeInteger(claim.logIndex) || claim.logIndex < 0) return false;
  return storage.transaction(async txn => {
    const key = `checkout:transfer:${claim.scope}:${claim.transaction}:${claim.logIndex}`;
    const existing = await txn.get<TransferClaim>(key);
    if (existing) return existing.orderId === claim.orderId && existing.amount === claim.amount;
    const reservation = await txn.get<AmountReservation>(`checkout:amount:${claim.scope}:${claim.amount}`);
    if (reservation && reservation.orderId !== claim.orderId && reservation.expiresAt > Date.now()) return false;
    // Legacy orders may have no reservation. The transfer is still consumed once.
    await txn.put(key, claim);
    return true;
  });
}
